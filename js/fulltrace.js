import { CHAIN } from './chains.js';
import { withTimeout } from './core.js';
import { collect, analyze, suspiciousToken } from './investigate.js';
import { resolveBridgeTx } from './crosschain.js';
import { entityOf } from './entities.js';
import { Trace } from './trace.js';
import { short } from './ui.js';
import { prefetchLabels, hasLiveLabels } from './labels-live.js';

const nid = (chainId, address) => `${chainId}:${String(address).toLowerCase()}`;
const TERMINAL = { exchange: 'exchange', dex: 'dex', token: 'contract', burn: 'contract', staking: 'contract', bridge: 'bridge' };

export class FullTrace extends Trace {
  constructor(root, { prices = {}, maxHops = 8, maxWallets = 60, minUsd = 0, perWalletItems = 300 } = {}) {
    super(root, { direction: 'out', prices, perNode: 1e9, maxNodes: 1e9 });
    this.maxHops = maxHops;
    this.maxWallets = maxWallets;
    this.minUsd = minUsd;
    this.perWalletItems = perWalletItems;
    this.finals = new Map();
    this.pending = new Map();
    this.plans = new Map();
    this.expanded = 0;
    this.total = 0;
    this.parent = new Map();
  }

  addFinal(type, usd, { label, entity = null, chainId = null, address = null, hop = 0, nodeId = null }) {
    if (usd <= 0) return;
    const key = `${type}:${entity && type === 'exchange' ? entity.name : nodeId || label}`;
    const f = this.finals.get(key) || { key, type, label, entity, chainId, address, usd: 0, hops: new Set(), byHop: {}, nodeId, arrival: null };
    f.usd += usd;
    f.hops.add(hop);
    f.byHop[hop] = (f.byHop[hop] || 0) + usd;
    this.finals.set(key, f);
    return f;
  }

  ensureNode(chainId, address, hop, ent, name) {
    const id = nid(chainId, address);
    let n = this.nodes.get(id);
    if (!n) {
      const kind = !ent ? (name && !/\.(eth|ton|near|sol)$/i.test(name) ? 'contract' : 'wallet')
        : ent.category === 'exploit' ? 'wallet' : TERMINAL[ent.category] ? (ent.category === 'bridge' ? 'bridge' : ent.category === 'exchange' ? 'exchange' : ent.category === 'dex' ? 'dex' : 'contract') : 'wallet';
      n = { id, chainId, address, label: (ent && ent.label) || name || short(address), entity: ent || null, hop, kind, terminal: kind !== 'wallet', status: 'idle', traced: 0 };
      if (ent && ['fund', 'custodian', 'issuer'].includes(ent.category)) { n.kind = 'contract'; n.service = true; n.terminal = true; }
      this.nodes.set(id, n);
    }
    n.hop = Math.min(n.hop, hop);
    return n;
  }

  flow(fromId, to, usd, hop, tx, cross = null) {
    if (usd <= 0) return;
    const e = this.addEdge(fromId, to.id, { ...tx, usd }, cross).edge;
    e.traced = (e.traced || 0) + usd;
    if (!this.parent.has(to.id)) this.parent.set(to.id, fromId);
    this.arrive(to, usd, hop, tx && tx.time);
  }

  arrive(node, usd, hop, time, replay = false) {
    node.traced = (node.traced || 0) + usd;
    if (!replay && node.id !== this.rootId) {
      const hs = (this.hopStats ||= {})[hop] ||= { usd: 0, ids: new Set() };
      hs.usd += usd;
      if (node.kind === 'wallet') hs.ids.add(node.id);
    }
    if (node.kind !== 'wallet' && node.kind !== 'root') {
      const type = node.kind === 'exchange' ? 'exchange' : node.kind === 'bridge' ? 'bridge' : node.kind === 'dex' ? 'dex' : node.service ? 'service' : 'contract';
      return this.addFinal(type, usd, { label: node.label, entity: node.entity, chainId: node.chainId, address: node.address, hop, nodeId: node.id });
    }
    if (usd < this.minUsd) return this.addFinal('small', usd, { label: `Amounts under $${Math.round(this.minUsd)}`, hop });
    const plan = this.plans.get(node.id);
    if (plan) {
      for (const c of plan.children) {
        const child = this.nodes.get(c.id);
        const part = usd * c.ratio;
        const e = this.edges.get(`${node.id}>${c.id}`);
        if (e) { e.usd += part; e.traced = (e.traced || 0) + part; }
        this.arrive(child, part, hop + 1, (e && e.first) || time);
      }
      if (plan.heldRatio > 0) this.addFinal('held', usd * plan.heldRatio, { label: node.label, chainId: node.chainId, address: node.address, hop, nodeId: node.id });
      return;
    }
    if (node.status === 'error') return this.addFinal('error', usd, { label: node.label, chainId: node.chainId, address: node.address, hop, nodeId: node.id });
    const p = this.pending.get(node.id) || { usd: 0, hop, arrival: time || null };
    p.usd += usd;
    p.hop = Math.min(p.hop, hop);
    if (time && (!p.arrival || time < p.arrival)) p.arrival = time;
    this.pending.set(node.id, p);
  }

  async plan(node, rows, pendingUsd, hop, arrival) {
    const me = node.address.toLowerCase();
    const after = rows.filter(r => r.usdValue > 0 && !suspiciousToken(r) && (!arrival || !r.time || r.time >= arrival - 60000));
    const outs = after.filter(r => r.direction === 'out' && r.counterparty && r.counterparty.toLowerCase() !== me);
    const received = after.filter(r => r.direction === 'in').reduce((s, r) => s + r.usdValue, 0);
    const sent = outs.reduce((s, r) => s + r.usdValue, 0);
    const D = Math.max(received, sent, pendingUsd, 1e-9);

    const groups = new Map();
    const bridgeRows = [];
    for (const r of outs) {
      const ent = r.entity || entityOf(CHAIN[r.chainId], r.counterparty, null, r.cpName);
      if (ent && (ent.category === 'bridge' || ent.name === 'CoW Swap')) { bridgeRows.push({ r, ent }); continue; }
      const k = nid(r.chainId, r.counterparty);
      const g = groups.get(k) || { chainId: r.chainId, address: r.counterparty, ent, name: r.cpName, usd: 0, tx: r, first: r.time };
      g.usd += r.usdValue;
      if (r.time && (!g.first || r.time < g.first)) g.first = r.time;
      groups.set(k, g);
    }
    for (const { r, ent } of bridgeRows.slice(0, 12)) {
      const b = await withTimeout(resolveBridgeTx(r.chainId, r.hash, node.address, { to: r.counterparty, value: r.value, time: r.time }), 20000).catch(() => null);
      const dst = b && CHAIN[b.dstChain];
      if (b && b.recipient && dst) {
        const k = nid(b.dstChain, b.recipient);
        const g = groups.get(k) || { chainId: b.dstChain, address: b.recipient, ent: entityOf(dst, b.recipient), name: null, usd: 0, tx: { ...r, chainId: b.srcChain && CHAIN[b.srcChain] ? b.srcChain : r.chainId }, cross: b };
        g.usd += r.usdValue;
        groups.set(k, g);
      } else {
        const k = `bridgeend:${ent.name}:${r.chainId}`;
        const g = groups.get(k) || { bridgeEnd: true, chainId: r.chainId, address: r.counterparty, ent, name: ent.label, usd: 0, tx: r, cross: b };
        g.usd += r.usdValue;
        groups.set(k, g);
      }
    }
    for (const { r, ent } of bridgeRows.slice(12)) {
      const k = `bridgeend:${ent.name}:${r.chainId}`;
      const g = groups.get(k) || { bridgeEnd: true, chainId: r.chainId, address: r.counterparty, ent, name: ent.label, usd: 0, tx: r };
      g.usd += r.usdValue;
      groups.set(k, g);
    }

    const plan = { children: [], heldRatio: Math.max(0, 1 - sent / D) };
    for (const g of groups.values()) {
      const child = this.ensureNode(g.chainId, g.address, hop + 1, g.ent, g.name);
      if (g.bridgeEnd) { child.kind = 'bridge'; child.terminal = true; child.reason = g.cross ? `${g.cross.protocol}: destination on unsupported chain` : 'Bridge destination not found'; }
      const ratio = g.usd / D;
      plan.children.push({ id: child.id, ratio, cross: g.cross || null });
      const e = this.addEdge(node.id, child.id, { hash: g.tx.hash, time: g.first || g.tx.time, amount: g.tx.value, symbol: g.tx.symbol, usd: 0, chainId: g.tx.chainId, cross: g.cross || null }, g.cross || null).edge;
      e.traced = e.traced || 0;
      if (!this.parent.has(child.id)) this.parent.set(child.id, node.id);
    }
    this.plans.set(node.id, plan);
    node.traced = (node.traced || 0) - pendingUsd;
    this.arrive(node, pendingUsd, hop, arrival, true);
  }

  async run(rootModel, { shouldStop = () => false, onProgress = () => {}, concurrency = 5 } = {}) {
    const root = this.nodes.get(this.rootId);
    root.status = 'done';
    const rows = rootModel.rows.filter(r => r.direction === 'out' && r.usdValue > 0 && !suspiciousToken(r));
    this.total = rows.reduce((s, r) => s + r.usdValue, 0);
    if (!this.minUsd) this.minUsd = Math.max(10, this.total * 0.002);
    root.traced = this.total;
    await this.plan(root, rootModel.rows.filter(r => !r.chainId || true), 0, 0, null);
    const rp = this.plans.get(this.rootId);
    const sentRoot = rows.reduce((s, r) => s + r.usdValue, 0) || 1;
    for (const c of rp.children) {
      const e = this.edges.get(`${this.rootId}>${c.id}`);
      const usd = c.ratio * Math.max(sentRoot, rootModel.rows.filter(r => r.direction === 'in' && r.usdValue > 0).reduce((s, r) => s + r.usdValue, 0));
      if (e) { e.usd += usd; e.traced = (e.traced || 0) + usd; }
      const child = this.nodes.get(c.id);
      this.arrive(child, usd, 1, e && e.first);
    }
    rp.heldRatio = 0;
    onProgress(this.progress());

    return this.drain({ shouldStop, onProgress, concurrency });
  }

  async resume({ maxHops, maxWallets, minUsd, shouldStop = () => false, onProgress = () => {}, concurrency = 5 } = {}) {
    if (maxHops) this.maxHops = maxHops;
    if (maxWallets) this.maxWallets = maxWallets;
    if (minUsd != null) this.minUsd = minUsd;
    for (const [k, f] of [...this.finals]) {
      if (f.type !== 'limit' || !f.nodeId) continue;
      this.finals.delete(k);
      const n = this.nodes.get(f.nodeId);
      n.reason = null;
      this.pending.set(f.nodeId, { usd: f.usd, hop: Math.min(...f.hops), arrival: f.arrival });
    }
    return this.drain({ shouldStop, onProgress, concurrency });
  }

  async drain({ shouldStop = () => false, onProgress = () => {}, concurrency = 5 } = {}) {
    onProgress(this.progress());
    while (this.pending.size && !shouldStop()) {
      const batch = [...this.pending.entries()].filter(([, p]) => p.hop <= this.maxHops).sort((a, b) => b[1].usd - a[1].usd || a[1].hop - b[1].hop);
      if (!batch.length || this.expanded >= this.maxWallets) break;
      const take = batch.slice(0, Math.max(1, Math.min(concurrency, this.maxWallets - this.expanded)));
      await Promise.all(take.map(async ([id, p]) => {
        this.pending.delete(id);
        const node = this.nodes.get(id);
        if (this.plans.has(id)) { node.traced = (node.traced || 0) - p.usd; return this.arrive(node, p.usd, p.hop, p.arrival, true); }
        node.status = 'loading';
        this.expanded++;
        this.emit({ type: 'node', node });
        try {
          const r = await collect(node.chainId, node.address, { maxItems: this.perWalletItems, shouldStop });
          if (hasLiveLabels(node.chainId)) {
            const outs = r.items.filter(t => t.direction === 'out' && t.to).sort((a, b) => (b.value || 0) - (a.value || 0));
            await prefetchLabels(node.chainId, outs.map(t => t.to), 15);
          }
          const model = analyze(r.items, node.address, this.prices);
          const span = model.totals.last && model.totals.first ? model.totals.last - model.totals.first : Infinity;
          if (r.items.length >= this.perWalletItems * 0.9 && (model.totals.counterparties > 150 || span < 3 * 86400000)) {
            node.kind = 'contract'; node.service = true; node.terminal = true;
            node.reason = `Very busy wallet (${model.totals.counterparties}+ counterparties): likely an exchange or service`;
            node.status = 'done';
            node.traced = (node.traced || 0) - p.usd;
            this.arrive(node, p.usd, p.hop, p.arrival, true);
          } else {
            node.status = 'done';
            node.expanded = true;
            await this.plan(node, model.rows, p.usd, p.hop, p.arrival);
          }
        } catch (e) {
          node.status = 'error';
          node.reason = e.message;
          this.addFinal('error', p.usd, { label: node.label, chainId: node.chainId, address: node.address, hop: p.hop, nodeId: node.id });
        }
        this.emit({ type: 'expand', node });
        onProgress(this.progress());
      }));
    }
    for (const [id, p] of this.pending) {
      const n = this.nodes.get(id);
      n.reason = 'Not followed yet: hop or wallet limit reached';
      const f = this.addFinal('limit', p.usd, { label: n.label, chainId: n.chainId, address: n.address, hop: p.hop, nodeId: id });
      if (f && p.arrival && (!f.arrival || p.arrival < f.arrival)) f.arrival = p.arrival;
    }
    this.pending.clear();
    onProgress(this.progress(true));
    return this.summary();
  }

  progress(done = false) {
    const pendingUsd = [...this.pending.values()].reduce((s, p) => s + p.usd, 0);
    const settled = [...this.finals.values()].reduce((s, f) => s + f.usd, 0);
    const hop = Math.max(0, ...[...this.nodes.values()].filter(n => n.status === 'done' || n.status === 'loading').map(n => n.hop));
    return { done, total: this.total, settled, pendingUsd, wallets: this.expanded, hop };
  }

  summary() {
    const finals = [...this.finals.values()].sort((a, b) => b.usd - a.usd);
    const byType = {};
    for (const f of finals) byType[f.type] = (byType[f.type] || 0) + f.usd;
    const exchanges = {};
    for (const f of finals.filter(x => x.type === 'exchange')) {
      const k = f.entity ? f.entity.name : f.label;
      exchanges[k] = exchanges[k] || { name: k, usd: 0, country: f.entity && f.entity.country, wallets: 0 };
      exchanges[k].usd += f.usd;
      exchanges[k].wallets++;
    }
    const hops = {};
    const H = h => (hops[h] ||= { hop: h, wallets: 0, arrived: 0, ended: {}, endedTotal: 0 });
    for (const [h, hs] of Object.entries(this.hopStats || {})) { const row = H(Number(h)); row.arrived = hs.usd; row.wallets = hs.ids.size; }
    for (const f of finals) for (const [h, v] of Object.entries(f.byHop || {})) {
      const row = H(Number(h));
      row.ended[f.type] = (row.ended[f.type] || 0) + v;
      row.endedTotal += v;
    }
    const hopRows = Object.values(hops).sort((a, b) => a.hop - b.hop).map(r => ({ ...r, passedOn: Math.max(0, r.arrived - r.endedTotal) }));
    const notFollowed = byType.limit || 0;
    const institutions = {};
    for (const f of finals.filter(x => x.type === 'service' && x.entity)) {
      const k = f.entity.name;
      institutions[k] = institutions[k] || { name: k, usd: 0, country: f.entity.country, category: f.entity.category };
      institutions[k].usd += f.usd;
    }
    return { total: this.total, finals, byType, institutions: Object.values(institutions).sort((a, b) => b.usd - a.usd), exchanges: Object.values(exchanges).sort((a, b) => b.usd - a.usd), wallets: this.expanded, minUsd: this.minUsd,
      hops: hopRows, notFollowed, maxHops: this.maxHops, maxWallets: this.maxWallets };
  }

  pathTo(id) {
    const path = [id];
    const seen = new Set(path);
    while (this.parent.has(path[0]) && path[0] !== this.rootId) {
      const p = this.parent.get(path[0]);
      if (seen.has(p)) break;
      seen.add(p);
      path.unshift(p);
    }
    return path;
  }
}
