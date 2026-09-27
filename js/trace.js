// Follow-the-money trace engine (DOM-free).
// Builds a layered graph: hop 0 = the investigated wallet, hop 1 = its destinations (or sources),
// hop 2 = their destinations, … Money is followed through ordinary wallets and across bridges;
// exchanges are terminal ("money exits here"), DEXs / tokens / contracts are terminal too.
//
//   node: { id, chainId, address, label, entity, hop, kind, terminal, status, reason }
//         kind: 'root' | 'wallet' | 'exchange' | 'bridge' | 'dex' | 'contract' | 'more'
//         status: 'idle' | 'loading' | 'done' | 'error'
//   edge: { id, from, to, usd, count, amounts: { SYMBOL: n }, first, last, txs: [{ hash, time, amount, symbol, usd, chainId }], cross }
import { CHAIN } from './chains.js';
import { adapter, withTimeout } from './core.js';
import { analyze, suspiciousToken } from './investigate.js';
import { resolveBridgeTx } from './crosschain.js';
import { entityOf } from './entities.js';
import { short } from './ui.js';

const nodeId = (chainId, address) => `${chainId}:${String(address).toLowerCase()}`;
const kindOf = ent => !ent ? 'wallet'
  : ent.category === 'exchange' ? 'exchange' : ent.category === 'bridge' ? 'bridge'
  : ent.category === 'dex' ? 'dex' : ent.category === 'token' || ent.category === 'burn' || ent.category === 'staking' ? 'contract' : 'wallet';

export class Trace {
  /**
   * @param root    { chainId, address, label }
   * @param opts    { direction: 'out' | 'in', prices, perNode = 5, maxNodes = 70, minUsd = 0 }
   */
  constructor(root, { direction = 'out', prices = {}, perNode = 5, maxNodes = 70, minUsd = 0 } = {}) {
    this.direction = direction;
    this.prices = prices;
    this.perNode = perNode;
    this.maxNodes = maxNodes;
    this.minUsd = minUsd;
    this.nodes = new Map();
    this.edges = new Map();
    this.seenTx = new Set();
    this.listeners = new Set();
    const id = nodeId(root.chainId, root.address);
    this.rootId = id;
    this.nodes.set(id, { id, chainId: root.chainId, address: root.address, label: root.label || short(root.address), entity: null, hop: 0, kind: 'root', terminal: false, status: 'idle' });
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { this.listeners.forEach(fn => fn(evt)); }

  addNode(n) {
    if (this.nodes.has(n.id)) {
      const cur = this.nodes.get(n.id);
      cur.hop = Math.min(cur.hop, n.hop);
      if (!cur.entity && n.entity) { cur.entity = n.entity; cur.label = n.label; }
      return cur;
    }
    if (this.nodes.size >= this.maxNodes) return null;
    this.nodes.set(n.id, n);
    return n;
  }

  addEdge(fromId, toId, tx, cross = null) {
    const [a, b] = this.direction === 'out' ? [fromId, toId] : [toId, fromId]; // edges always point along money flow
    const id = `${a}>${b}`;
    let e = this.edges.get(id);
    if (!e) { e = { id, from: a, to: b, usd: 0, count: 0, amounts: {}, first: null, last: null, txs: [], cross }; this.edges.set(id, e); }
    const key = `${tx.hash}:${tx.symbol}:${tx.amount}`;
    if (e.txs.some(t => `${t.hash}:${t.symbol}:${t.amount}` === key)) return { edge: e, added: false };
    e.txs.push(tx);
    e.count++;
    e.usd += tx.usd || 0;
    e.amounts[tx.symbol] = (e.amounts[tx.symbol] || 0) + (tx.amount || 0);
    if (tx.time) { e.first = Math.min(e.first ?? tx.time, tx.time); e.last = Math.max(e.last ?? tx.time, tx.time); }
    if (cross && !e.cross) e.cross = cross;
    return { edge: e, added: true };
  }

  /** Counterparty groups from an analysis model, in trace direction, strongest first. */
  groups(model) {
    const list = this.direction === 'out' ? model.destinations : model.sources;
    const val = c => this.direction === 'out' ? c.outUsd : c.inUsd;
    const cnt = c => this.direction === 'out' ? c.nOut : c.nIn;
    return list.filter(c => !c.poison && (val(c) >= this.minUsd || (!this.minUsd && cnt(c))))
      .sort((x, y) => (val(y) - val(x)) || (cnt(y) - cnt(x)));
  }

  /** Attach children to `parent` from classified rows (analysis model of the parent wallet). */
  attach(parent, model, { live = false } = {}) {
    const dir = this.direction;
    // Fake / spam tokens are not money: keep them out of the trail entirely
    const legit = r => !suspiciousToken(r);
    const hasLegit = new Set(model.rows.filter(r => r.direction === dir && legit(r)).map(r => `${r.chainId}:${r.counterparty.toLowerCase()}`));
    const groups = this.groups(model).filter(g => hasLegit.has(`${g.chainId}:${g.address.toLowerCase()}`));
    const shown = groups.slice(0, this.perNode);
    const hidden = groups.slice(this.perNode);
    const added = [];
    for (const g of shown) {
      let kind = kindOf(g.entity);
      // A plain name that isn't a name-service domain is a contract name (Aave gateway, vaults, …): stop there
      if (kind === 'wallet' && g.name && !/\.(eth|ton|near|sol|base\.eth)$/i.test(g.name)) kind = 'contract';
      const child = this.addNode({
        id: nodeId(g.chainId, g.address), chainId: g.chainId, address: g.address,
        label: g.name || (g.entity && g.entity.label) || short(g.address), entity: g.entity || null,
        hop: parent.hop + 1, kind, terminal: kind !== 'wallet', status: 'idle',
        reason: kind === 'exchange' ? `Funds ${dir === 'out' ? 'enter' : 'come from'} ${g.entity.name}` : null,
      });
      if (!child) break;
      for (const r of model.rows.filter(r => r.direction === dir && legit(r) && r.counterparty.toLowerCase() === g.address.toLowerCase() && r.chainId === g.chainId)) {
        const res = this.addEdge(parent.id, child.id, { hash: r.hash, time: r.time, amount: r.value, symbol: r.symbol, usd: r.usdValue, chainId: r.chainId, method: r.method });
        if (res.added && live && !this.seenTx.has(r.hash)) added.push({ edge: res.edge, tx: r });
        this.seenTx.add(r.hash);
      }
    }
    if (hidden.length && !live) {
      const more = this.addNode({ id: `${parent.id}:more`, chainId: parent.chainId, address: null, label: `+${hidden.length} more`, entity: null, hop: parent.hop + 1, kind: 'more', terminal: true, status: 'done',
        reason: `${hidden.length} smaller counterparties` });
      if (more) {
        const usd = hidden.reduce((s, c) => s + (dir === 'out' ? c.outUsd : c.inUsd), 0);
        const count = hidden.reduce((s, c) => s + (dir === 'out' ? c.nOut : c.nIn), 0);
        const [a, b] = dir === 'out' ? [parent.id, more.id] : [more.id, parent.id];
        this.edges.set(`${a}>${b}`, { id: `${a}>${b}`, from: a, to: b, usd, count, amounts: {}, first: null, last: null, txs: [], cross: null, aggregate: true });
      }
    }
    return added;
  }

  /** Bridge transfers of the root wallet (from crosschain.bridgeActivity) → bridge node → recipient on the other chain. */
  attachBridges(bridges) {
    const root = this.nodes.get(this.rootId);
    for (const b of bridges.filter(x => x.direction === this.direction)) {
      const otherChain = this.direction === 'out' ? b.dstChain : b.srcChain;
      const other = this.direction === 'out' ? b.recipient : b.sender;
      const bridgeNode = this.addNode({ id: `bridge:${b.protocol}:${otherChain}`, chainId: CHAIN[otherChain] ? otherChain : root.chainId, address: null,
        label: `${b.protocol} → ${CHAIN[otherChain] ? CHAIN[otherChain].name : otherChain}`, entity: { name: b.protocol, category: 'bridge', label: `${b.protocol} bridge` },
        hop: 1, kind: 'bridge', terminal: true, status: 'done', reason: 'Cross-chain transfer' });
      if (!bridgeNode) continue;
      const tx = { hash: b.srcTx, time: b.time, amount: b.amount, symbol: b.symbol || '?', usd: b.usd, chainId: CHAIN[b.srcChain] ? b.srcChain : null, cross: b };
      this.addEdge(root.id, bridgeNode.id, tx, b);
      if (other && CHAIN[otherChain] && other.toLowerCase() !== root.address.toLowerCase()) {
        const dest = this.addNode({ id: nodeId(otherChain, other), chainId: otherChain, address: other, label: short(other), entity: entityOf(CHAIN[otherChain], other), hop: 2, kind: 'wallet', terminal: false, status: 'idle' });
        if (dest) {
          if (dest.entity) { dest.kind = kindOf(dest.entity); dest.terminal = dest.kind !== 'wallet'; dest.label = dest.entity.label; }
          this.addEdge(bridgeNode.id, dest.id, { ...tx, hash: b.dstTx || b.srcTx, chainId: CHAIN[b.dstChain] ? b.dstChain : null }, b);
        }
      } else if (other && CHAIN[otherChain]) {
        // Bridged to the same address on the other chain: continue from there
        const same = this.addNode({ id: nodeId(otherChain, other), chainId: otherChain, address: other, label: `Same wallet on ${CHAIN[otherChain].name}`, entity: null, hop: 2, kind: 'wallet', terminal: false, status: 'idle' });
        if (same) this.addEdge(bridgeNode.id, same.id, { ...tx, hash: b.dstTx || b.srcTx, chainId: CHAIN[b.dstChain] ? b.dstChain : null }, b);
      }
    }
  }

  /** Fetch a wallet node's recent history and attach its counterparties. */
  async expand(id, { live = false } = {}) {
    const node = this.nodes.get(id);
    if (!node || !node.address || node.kind === 'more' || (node.terminal && node.kind !== 'bridge') || node.status === 'loading') return [];
    if (node.kind === 'bridge') return this.expandBridge(node);
    node.status = 'loading';
    this.emit({ type: 'node', node });
    try {
      const a = await adapter(node.chainId);
      const [txs, tok] = await Promise.all([
        withTimeout(a.getTxs(node.address), 30000),
        a.getTokenTransfers ? withTimeout(a.getTokenTransfers(node.address), 30000).catch(() => ({ items: [] })) : { items: [] },
      ]);
      const items = [...txs.items.filter(t => !(a.getTokenTransfers && !t.value)), ...tok.items].map(t => ({ ...t, chainId: node.chainId }));
      const model = analyze(items, node.address, this.prices);
      const added = this.attach(node, model, { live });
      node.status = 'done';
      node.expanded = true;
      this.emit({ type: 'expand', node, added });
      return added;
    } catch (e) {
      node.status = 'error';
      node.reason = e.message;
      this.emit({ type: 'node', node });
      return [];
    }
  }

  /** A bridge contract reached at hop ≥ 1: resolve each tx's destination through the bridge indexers. */
  async expandBridge(node) {
    const incoming = [...this.edges.values()].filter(e => e.to === node.id && !e.aggregate);
    if (!incoming.length || node.status === 'loading') return [];
    node.status = 'loading';
    this.emit({ type: 'node', node });
    const added = [];
    for (const e of incoming) {
      const src = this.nodes.get(e.from);
      for (const t of e.txs.slice(0, 5)) {
        if (!t.chainId) continue;
        const b = await withTimeout(resolveBridgeTx(t.chainId, t.hash, src && src.address), 20000).catch(() => null);
        if (!b || !b.recipient || !CHAIN[b.dstChain]) continue;
        const ent = entityOf(CHAIN[b.dstChain], b.recipient);
        const kind = kindOf(ent);
        const dest = this.addNode({ id: nodeId(b.dstChain, b.recipient), chainId: b.dstChain, address: b.recipient,
          label: ent ? ent.label : short(b.recipient), entity: ent, hop: node.hop + 1, kind, terminal: kind !== 'wallet', status: 'idle' });
        if (!dest) continue;
        const r = this.addEdge(node.id, dest.id, { hash: b.dstTx || t.hash, time: b.time || t.time, amount: b.amount ?? t.amount, symbol: b.symbol || t.symbol, usd: b.usd ?? t.usd, chainId: CHAIN[b.dstChain] ? b.dstChain : null }, b);
        if (r.added) added.push(r);
      }
    }
    node.status = 'done';
    node.expanded = true;
    node.reason = added.length ? `Resolved ${added.length} cross-chain destination(s)` : 'Destination not found in Across / LayerZero / Wormhole';
    this.emit({ type: 'expand', node, added });
    return added;
  }

  /** Breadth-first auto-expansion up to `depth` hops. */
  async expandTo(depth, shouldStop = () => false, concurrency = 3) {
    for (let hop = 1; hop < depth; hop++) {
      const frontier = [...this.nodes.values()].filter(n => n.hop === hop && !n.expanded && (n.kind === 'wallet' || n.kind === 'bridge') && n.status === 'idle');
      const queue = [...frontier];
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length && !shouldStop()) await this.expand(queue.shift().id);
      }));
      if (shouldStop()) return;
    }
  }

  /** Every individual transfer in the graph, oldest first: the playback timeline. */
  events() {
    const out = [];
    for (const e of this.edges.values()) for (const t of e.txs) out.push({ edge: e, tx: t, time: t.time || 0 });
    return out.sort((x, y) => x.time - y.time);
  }

  /** Layered layout: x by hop, y stacked within each hop following parent order. */
  layout({ colW = 270, rowH = 64, nodeW = 190, nodeH = 46, include = null } = {}) {
    const byHop = new Map();
    for (const n of this.nodes.values()) {
      if (include && !include(n)) continue;
      const h = this.direction === 'out' ? n.hop : -n.hop;
      if (!byHop.has(h)) byHop.set(h, []);
      byHop.get(h).push(n);
    }
    const hops = [...byHop.keys()].sort((a, b) => a - b);
    const pos = new Map();
    const parentY = n => {
      const inc = [...this.edges.values()].filter(e => (this.direction === 'out' ? e.to : e.from) === n.id)
        .map(e => pos.get(this.direction === 'out' ? e.from : e.to)).filter(Boolean);
      return inc.length ? Math.min(...inc.map(p => p.y)) : 0;
    };
    const weight = n => [...this.edges.values()].filter(e => e.to === n.id || e.from === n.id).reduce((s, e) => s + (e.usd || e.count), 0);
    const order = this.direction === 'out' ? hops : [...hops].reverse();
    let maxRows = 1;
    for (const h of order) {
      const col = byHop.get(h);
      col.sort((a, b) => (parentY(a) - parentY(b)) || (weight(b) - weight(a)));
      maxRows = Math.max(maxRows, col.length);
      col.forEach((n, i) => pos.set(n.id, { x: (h - hops[0]) * colW, y: i * rowH, w: nodeW, h: nodeH, col: h }));
    }
    // center each column vertically
    const H = maxRows * rowH;
    for (const h of hops) {
      const col = byHop.get(h);
      const off = (H - col.length * rowH) / 2;
      col.forEach(n => { pos.get(n.id).y += off; });
    }
    return { pos, width: (hops.length - 1) * colW + nodeW, height: H, hops };
  }
}
