import { CHAIN, CHAINS } from '../chains.js';
import { detect } from '../detect.js';
import { main, adapter, withTimeout, toast, download } from '../core.js';
import { entityOf, loadLabels, CATEGORY_LABEL } from '../entities.js';
import { entityBadge } from '../alerts.js';
import { resolveBridgeTx } from '../crosschain.js';
import { isFakeToken, serviceOf, freezableIssuer, lookalike } from '../scam.js';
import { getPrices } from '../prices.js';
import { usdOf } from '../investigate.js';
import { track } from '../live.js';
import { esc, short, amount, usd, link, chainDot, timeCell } from '../ui.js';

const KEY = 'cc_cases_local';
const IMPORT_KEYS = { btc: 'bitcoin', eth: 'ethereum', arb: 'arbitrum', base: 'base', op: 'optimism', bsc: 'bsc', avax: 'avalanche', sol: 'solana', tron: 'tron', trx: 'tron', xrp: 'xrp', linea: 'linea', polygon: 'polygon', matic: 'polygon', ltc: 'litecoin', doge: 'dogecoin', ton: 'ton', atom: 'cosmos' };
const DEFAULT_EVM = ['ethereum', 'arbitrum', 'base'];
const uid = () => Math.random().toString(36).slice(2, 10);

const loadCases = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const saveCases = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { toast('Browser storage is full: remove old cases'); } };
const getCase = id => loadCases().find(c => c.id === id) || null;
const putCase = c => { const all = loadCases(); const i = all.findIndex(x => x.id === c.id); if (i >= 0) all[i] = c; else all.unshift(c); saveCases(all); };

function parseAddresses(text, evmChains) {
  const out = [];
  const add = (chainId, address, label = '') => {
    if (!CHAIN[chainId]) return;
    if (!out.some(a => a.chainId === chainId && a.address.toLowerCase() === address.toLowerCase())) out.push({ chainId, address, label });
  };
  for (const raw of String(text).split(/[\s,;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([a-z0-9-]+):(.+)$/i);
    if (m && CHAIN[m[1].toLowerCase()]) { add(m[1].toLowerCase(), m[2]); continue; }
    const c = detect(line).filter(x => x.kind === 'address' && !CHAIN[x.chainId].testnet);
    if (!c.length) continue;
    if (c.some(x => CHAIN[x.chainId].family === 'evm')) evmChains.forEach(id => add(id, line));
    else add(c[0].chainId, line);
  }
  return out;
}

function importJSON(data, evmChains) {
  if (Array.isArray(data)) return parseAddresses(data.join('\n'), evmChains);
  const lines = [];
  for (const [k, list] of Object.entries(data || {})) {
    const chainId = IMPORT_KEYS[k.toLowerCase()] || (CHAIN[k] ? k : null);
    if (!chainId || !Array.isArray(list)) continue;
    for (const a of list) lines.push(`${chainId}:${typeof a === 'string' ? a : a.address}`);
  }
  return parseAddresses(lines.join('\n'), evmChains);
}

export async function casesPage() {
  document.title = 'Hack tracker · CryptChain';
  const list = loadCases();
  main.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">🎯 Hack tracker</h1>
      <p class="muted">Follow stolen funds live. Add the attacker's addresses; CryptChain watches every movement, follows swaps and bridges to the next chain, spots new attacker wallets, exchange deposits and freezable stablecoins, and writes the report for you.</p></div></div>
    <div class="card"><h2>Your cases</h2>
      ${list.length ? `<div class="table-scroll"><table><thead><tr><th>Case</th><th class="r">Addresses</th><th class="r">Movements</th><th class="r">Leads</th><th>Created</th><th></th></tr></thead><tbody>
        ${list.map(c => `<tr><td><a href="#/case/${esc(c.id)}"><b>${esc(c.name)}</b></a></td><td class="r">${c.addresses.length}</td><td class="r">${(c.movements || []).length}</td>
          <td class="r">${(c.leads || []).filter(l => l.level === 'green').length ? `<span class="ent danger">🟢 ${(c.leads || []).filter(l => l.level === 'green').length}</span>` : (c.leads || []).length}</td>
          <td>${timeCell(c.created)}</td><td class="r"><a class="btn small-btn" href="#/case/${esc(c.id)}">Open</a> <button class="icon-btn" data-del="${esc(c.id)}" title="Delete case">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No cases yet. Create one below.</p>'}
    </div>
    <div class="card"><h2>New case</h2>
      <form id="case-new" class="case-form">
        <label>Case name<input name="name" placeholder="e.g. Bitget hack Sept 2026" required maxlength="80"></label>
        <label class="wide">Attacker addresses<textarea name="addrs" rows="6" placeholder="One per line. Any chain: 0x…, bc1…, T…, r…, Solana, TON…&#10;Force a chain with chain:address, e.g. arbitrum:0xabc…"></textarea></label>
        <label class="wide">Or import from a JSON link <span class="muted small">(like a tracker's address API: {"eth":[…],"btc":[…]})</span><input name="url" type="url" placeholder="https://…/api/holdings"></label>
        <div class="row-gap">
          <label>Check EVM addresses on<select name="evm" multiple size="4">${CHAINS.filter(c => c.family === 'evm' && !c.testnet).map(c => `<option value="${c.id}" ${DEFAULT_EVM.includes(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Look back<select name="lookback"><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="168">7 days</option></select></label>
          <label>Ignore moves under<select name="min"><option value="100">$100</option><option value="1000" selected>$1,000</option><option value="10000">$10,000</option></select></label>
          <label class="chk"><input type="checkbox" name="follow" checked> Auto-follow new wallets</label>
        </div>
        <button class="btn">Create case</button> <span class="muted small" id="case-msg"></span>
      </form>
      <p class="muted small">Cases are saved only in this browser. Large cases are checked a few addresses at a time, most active first.</p>
    </div>`;
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('Delete this case?')) return;
    saveCases(loadCases().filter(c => c.id !== b.dataset.del));
    casesPage();
  });
  const f = document.getElementById('case-new');
  f.onsubmit = async e => {
    e.preventDefault();
    e.stopPropagation();
    const msg = document.getElementById('case-msg');
    const evm = [...f.evm.selectedOptions].map(o => o.value);
    let addrs = parseAddresses(f.addrs.value, evm.length ? evm : DEFAULT_EVM);
    if (f.url.value.trim()) {
      msg.textContent = 'Importing…';
      try {
        const r = await fetch(f.url.value.trim());
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = text.split(/\s+/); }
        addrs = [...addrs, ...importJSON(data, evm.length ? evm : DEFAULT_EVM)];
      } catch (err) { msg.textContent = `Import failed (${err.message}). The site may block other websites; paste the addresses instead.`; return; }
    }
    if (!addrs.length) { msg.textContent = 'No valid addresses found.'; return; }
    const now = Date.now();
    const c = {
      id: uid(), name: f.name.value.trim() || 'Untitled case', created: now,
      since: now - Number(f.lookback.value) * 3600e3,
      settings: { minUsd: Number(f.min.value), autoFollow: f.follow.checked, evm: evm.length ? evm : DEFAULT_EVM, maxAddresses: 400 },
      addresses: addrs.map(a => ({ ...a, role: 'seed', added: now, lastChecked: 0 })),
      movements: [], leads: [], seen: [],
    };
    putCase(c);
    location.hash = `#/case/${c.id}`;
  };
}

class CaseEngine {
  constructor(c, onChange) { this.c = c; this.onChange = onChange; this.running = false; this.busy = false; this.timer = null; this.prices = {}; this.status = 'Idle'; }
  start() { if (this.running) return; this.running = true; this.loop(); }
  stop() { this.running = false; clearTimeout(this.timer); this.status = 'Paused'; this.onChange(); }
  save() { putCase(this.c); }
  isCase(chainId, address) { return this.c.addresses.some(a => a.chainId === chainId && a.address.toLowerCase() === String(address).toLowerCase()); }
  addAddress(chainId, address, label, role = 'downstream', parent = null) {
    if (!CHAIN[chainId] || this.isCase(chainId, address) || this.c.addresses.length >= this.c.settings.maxAddresses) return false;
    this.c.addresses.push({ chainId, address, label: label || '', role, parent, added: Date.now(), lastChecked: 0 });
    return true;
  }
  addLead(lead) {
    if ((this.c.leads || []).some(l => l.key === lead.key)) return;
    this.c.leads.unshift({ ...lead, time: lead.time || Date.now(), found: Date.now() });
    this.c.leads = this.c.leads.slice(0, 300);
    if (lead.level === 'green') {
      toast(`🟢 ${lead.title}`, 'high');
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('CryptChain lead: ' + this.c.name, { body: lead.title }); } catch {}
    }
  }
  async loop() {
    if (!this.running) return;
    if (!this.busy) {
      this.busy = true;
      try { await this.tick(); } catch (e) { this.status = 'Error: ' + e.message; }
      this.busy = false;
      this.save();
      this.onChange();
    }
    if (this.running) this.timer = setTimeout(() => this.loop(), 12000);
  }
  async tick() {
    await loadLabels();
    this.prices = await getPrices().catch(() => this.prices);
    const batch = [...this.c.addresses].sort((a, b) => (a.lastChecked || 0) - (b.lastChecked || 0)).slice(0, 5);
    this.status = `Checking ${batch.length} of ${this.c.addresses.length} addresses…`;
    this.onChange();
    await Promise.all(batch.map(a => this.check(a).catch(() => { a.lastChecked = Date.now(); a.error = true; })));
    const due = this.c.addresses.filter(a => !a.lastChecked).length;
    this.status = `Live · ${this.c.addresses.length} addresses · ${due ? `${due} not checked yet` : 'all checked, repeating'} · last check ${new Date().toLocaleTimeString()}`;
  }
  async check(a) {
    const chain = CHAIN[a.chainId];
    const ad = await adapter(a.chainId);
    const since = Math.max(this.c.since, a.added - 6 * 3600e3);
    const pages = [withTimeout(ad.getTxs(a.address), 20000).catch(() => ({ items: [] }))];
    if (ad.getTokenTransfers) pages.push(withTimeout(ad.getTokenTransfers(a.address), 20000).catch(() => ({ items: [] })));
    const items = (await Promise.all(pages)).flatMap(p => p.items || []);
    const seen = new Set(this.c.seen || []);
    for (const t of items) {
      if (t.direction !== 'out' || !t.to || !t.time || t.time < since) continue;
      const key = `${a.chainId}:${t.hash}:${t.to}:${t.symbol}:${t.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.classify(a, { ...t, chainId: a.chainId }, chain);
    }
    this.c.seen = [...seen].slice(-4000);
    if (chain.adapter === 'blockscout') {
      const info = await withTimeout(ad.getAddress(a.address), 20000).catch(() => null);
      if (info) {
        a.balance = info.balance;
        a.stables = (info.tokens || []).map(t => ({ sym: t.symbol, amount: t.balance, issuer: freezableIssuer(a.chainId, t.symbol, t.contract) })).filter(t => t.issuer && t.amount >= 1);
        for (const s of a.stables) {
          if (s.amount >= this.c.settings.minUsd) this.addLead({ key: `hold:${a.chainId}:${a.address}:${s.sym}`, level: 'green', chainId: a.chainId, address: a.address,
            title: `${short(a.address)} holds ${Math.round(s.amount).toLocaleString()} ${s.sym} on ${chain.name}. ${s.issuer} can freeze it`,
            detail: `Freezable stablecoins still sitting in a ${a.role === 'seed' ? 'known attacker' : 'followed'} wallet.`, usd: s.amount, txs: [] });
        }
      }
    }
    a.lastChecked = Date.now();
    a.error = false;
  }
  async classify(a, t, chain) {
    if (isFakeToken(t) || (t.token && !t.value)) return;
    if (this.c.addresses.some(x => x.chainId === a.chainId && lookalike(x.address, t.to))) return;
    const v = usdOf(t, this.prices);
    const internal = this.isCase(a.chainId, t.to);
    let ent = entityOf(chain, t.to, t.toEntity, t.toName) || await serviceOf(a.chainId, t.to).catch(() => null);
    const mv = { id: `${t.hash}:${t.to}:${t.symbol}`, chainId: a.chainId, time: t.time, from: a.address, to: t.to, amount: t.value, sym: t.symbol, usd: v, hash: t.hash, entity: ent, cls: 'wallet' };
    const small = v != null ? v < this.c.settings.minUsd : false;
    if (internal) mv.cls = 'internal';
    else if (ent && ent.category === 'exchange') {
      mv.cls = 'exchange';
      this.addLead({ key: `ex:${a.chainId}:${t.hash}:${t.to}`, level: 'green', chainId: a.chainId, address: t.to, usd: v, txs: [t.hash], time: t.time,
        title: `${amount(t.value)} ${t.symbol} (${usd(v) || 'value unknown'}) reached ${ent.name}${ent.inferred ? ' (deposit address)' : ''}`,
        detail: `From ${short(a.address)} on ${chain.name} to ${ent.label || ent.name} ${t.to}. The exchange can freeze the account that owns this deposit.` });
    } else if (ent && ent.category === 'exploit') mv.cls = 'internal';
    else if (ent && (ent.category === 'bridge' || ent.category === 'dex' || ent.service)) {
      mv.cls = 'exit';
      if (!small) {
        const b = await withTimeout(resolveBridgeTx(a.chainId, t.hash, a.address, { to: t.to, value: t.value, time: t.time }), 20000).catch(() => null);
        if (b) {
          mv.dest = { protocol: b.protocol, chain: b.dstChain, recipient: b.recipient, amount: b.amount, symbol: b.symbol, note: b.note || null };
          const dst = b.dstChain && CHAIN[b.dstChain];
          if (dst && b.recipient) {
            const dEnt = entityOf(dst, b.recipient) || await serviceOf(b.dstChain, b.recipient).catch(() => null);
            if (dEnt && dEnt.category === 'exchange') {
              this.addLead({ key: `exb:${b.dstChain}:${b.recipient}:${t.hash}`, level: 'green', chainId: b.dstChain, address: b.recipient, usd: b.usd || v, txs: [t.hash, b.dstTx].filter(Boolean), time: t.time,
                title: `${b.protocol} delivered ${b.amount != null ? amount(b.amount) + ' ' + (b.symbol || '') : 'funds'} to ${dEnt.name} on ${dst.name}`, detail: `Swap/bridge from ${short(a.address)} ended at ${dEnt.label || dEnt.name} ${b.recipient}.` });
            } else if (!dEnt && this.c.settings.autoFollow && this.addAddress(b.dstChain, b.recipient, `via ${b.protocol}`, 'downstream', a.address)) {
              const stable = !!b.symbol && /^(USDC|USDT|USDT0)$/i.test(b.symbol);
              this.addLead({ key: `newx:${b.dstChain}:${b.recipient}`, level: stable ? 'green' : 'yellow', chainId: b.dstChain, address: b.recipient, usd: b.usd || v, txs: [t.hash, b.dstTx].filter(Boolean), time: t.time,
                title: `New wallet on ${dst.name} received ${b.amount != null ? amount(b.amount) + ' ' + (b.symbol || '') : 'funds'} via ${b.protocol}${stable ? `. ${/USDC/i.test(b.symbol) ? 'Circle' : 'Tether'} can freeze it if still held` : ''}`,
                detail: `Followed from ${short(a.address)} (${chain.name}). Now tracked automatically.` });
            }
          }
        }
      }
    } else if (!small) {
      mv.cls = 'new-wallet';
      const issuer = freezableIssuer(a.chainId, t.symbol, t.token);
      if (this.c.settings.autoFollow && this.addAddress(a.chainId, t.to, `from ${short(a.address)}`, 'downstream', a.address)) {
        this.addLead({ key: `new:${a.chainId}:${t.to}`, level: issuer ? 'green' : 'yellow', chainId: a.chainId, address: t.to, usd: v, txs: [t.hash], time: t.time,
          title: `New wallet received ${amount(t.value)} ${t.symbol} (${usd(v) || 'value unknown'})${issuer ? `. ${issuer} can freeze it if still held` : ''}`,
          detail: `Sent by ${short(a.address)} on ${chain.name}. Added to the case and watched from now on.` });
      }
    }
    if (mv.cls !== 'wallet' || !small) {
      this.c.movements = [mv, ...(this.c.movements || []).filter(x => x.id !== mv.id)].sort((x, y) => (y.time || 0) - (x.time || 0)).slice(0, 1500);
    }
  }
}

const CLS = { exchange: ['🏦', 'Exchange deposit', 'danger'], exit: ['🔁', 'Swap / bridge', 'br'], 'new-wallet': ['🆕', 'New wallet', 'ex'], internal: ['↔', 'Between attacker wallets', ''], wallet: ['•', 'Small move', ''] };

function caseMarkdown(c) {
  const green = c.leads.filter(l => l.level === 'green'), yellow = c.leads.filter(l => l.level === 'yellow');
  const exp = (id, kind, v) => { const ch = CHAIN[id]; return ch ? `${location.origin}${location.pathname}#/${id}/${kind}/${encodeURIComponent(v)}` : v; };
  const lead = l => `- **${l.title}**\n  - ${l.detail}\n  - Address: ${l.address} (${CHAIN[l.chainId] ? CHAIN[l.chainId].name : l.chainId}) ${exp(l.chainId, 'address', l.address)}\n${l.txs.map(h => `  - Tx: ${h}`).join('\n')}\n  - Time: ${l.time ? new Date(l.time).toISOString() : 'n/a'}`;
  return `# ${c.name}: case report

Generated ${new Date().toISOString()} with CryptChain Explorer (created by Manikanta).

- Addresses tracked: ${c.addresses.length} (${c.addresses.filter(a => a.role === 'seed').length} starting addresses, ${c.addresses.filter(a => a.role !== 'seed').length} found by following the money)
- Movements recorded: ${c.movements.length}
- Strong leads: ${green.length} · Other leads: ${yellow.length}

## Strong leads (can lead to a freeze)
${green.map(lead).join('\n') || 'None.'}

## Other leads
${yellow.map(lead).join('\n') || 'None.'}

## Recent movements
| Time (UTC) | Chain | From | To | Amount | USD | Type | Tx |
|---|---|---|---|---|---|---|---|
${c.movements.slice(0, 200).map(m => `| ${new Date(m.time).toISOString().slice(0, 16).replace('T', ' ')} | ${CHAIN[m.chainId] ? CHAIN[m.chainId].name : m.chainId} | ${m.from} | ${m.to}${m.entity ? ` (${m.entity.label || m.entity.name})` : ''}${m.dest && m.dest.recipient ? ` → ${m.dest.protocol} → ${m.dest.recipient} (${m.dest.chain})` : ''} | ${m.amount} ${m.sym} | ${m.usd ? Math.round(m.usd) : ''} | ${CLS[m.cls] ? CLS[m.cls][1] : m.cls} | ${m.hash} |`).join('\n')}

## All tracked addresses
${c.addresses.map(a => `- ${CHAIN[a.chainId] ? CHAIN[a.chainId].name : a.chainId}: ${a.address}${a.label ? ` (${a.label})` : ''} [${a.role}]`).join('\n')}
`;
}

export async function casePage(id, stale) {
  const c = getCase(id);
  if (!c) { main.innerHTML = '<div class="card error">Case not found. <a href="#/cases">Back to cases</a></div>'; return; }
  c.leads ||= []; c.movements ||= []; c.seen ||= [];
  document.title = `${c.name} · Hack tracker · CryptChain`;
  let tab = 'feed';
  let feedFilter = 'all';
  const engine = new CaseEngine(c, () => { if (!stale()) render(); });
  track(() => engine.stop());

  main.innerHTML = `
    <div class="page-head"><div><a class="muted small" href="#/cases">← All cases</a><h1 class="page-title">🎯 ${esc(c.name)}</h1>
      <div class="muted small" id="case-status">Idle</div></div>
      <div class="row-gap"><button class="btn" id="case-run">▶ Start live tracking</button><button class="btn ghost small-btn" id="case-md">⬇ Report</button><button class="btn ghost small-btn" id="case-csv">⬇ CSV</button></div></div>
    <div class="fg-kpis" id="case-kpis"></div>
    <div class="tabs case-tabs" id="case-tabs">${[['feed', 'Live feed'], ['leads', 'Leads'], ['addresses', 'Addresses'], ['settings', 'Settings']].map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="card" id="case-body"></div>`;

  const kpis = () => {
    const green = c.leads.filter(l => l.level === 'green').length, yellow = c.leads.filter(l => l.level === 'yellow').length;
    const exits = c.movements.filter(m => m.cls === 'exit').length, exch = c.movements.filter(m => m.cls === 'exchange').length;
    const stables = c.addresses.flatMap(a => a.stables || []).reduce((s, x) => s + x.amount, 0);
    document.getElementById('case-kpis').innerHTML = `
      <div class="kpi"><div class="k">Addresses</div><div class="v">${c.addresses.length}</div><div class="sub">${c.addresses.filter(a => a.role !== 'seed').length} found by following</div></div>
      <div class="kpi"><div class="k">🟢 Strong leads</div><div class="v ${green ? 'out' : ''}">${green}</div><div class="sub">${yellow} other leads</div></div>
      <div class="kpi"><div class="k">Movements</div><div class="v">${c.movements.length}</div><div class="sub">${exits} swaps/bridges · ${exch} exchange deposits</div></div>
      <div class="kpi"><div class="k">Freezable stablecoins held</div><div class="v">${usd(stables) || '$0'}</div><div class="sub">USDT / USDC in tracked wallets</div></div>`;
  };

  const feed = () => {
    const list = c.movements.filter(m => feedFilter === 'all' || m.cls === feedFilter);
    return `<div class="row-gap" style="margin-bottom:10px"><div class="tabs" id="feed-f">${[['all', 'All'], ['exchange', '🏦 Exchange'], ['exit', '🔁 Swaps & bridges'], ['new-wallet', '🆕 New wallets'], ['internal', '↔ Internal']].map(([k, l]) => `<button data-f="${k}" class="${k === feedFilter ? 'active' : ''}">${l}</button>`).join('')}</div></div>
      <div class="table-scroll"><table><thead><tr><th>Time</th><th>Chain</th><th>From</th><th>To</th><th class="r">Amount</th><th class="r">USD</th><th>What happened</th><th>Tx</th></tr></thead><tbody>
      ${list.slice(0, 300).map(m => { const [ic, lbl, cls] = CLS[m.cls] || ['•', m.cls, '']; return `<tr>
        <td>${timeCell(m.time)}</td><td>${CHAIN[m.chainId] ? chainDot(CHAIN[m.chainId]) + ' ' + esc(CHAIN[m.chainId].name) : esc(m.chainId)}</td>
        <td>${link(m.chainId, 'address', m.from, short(m.from))}</td>
        <td>${link(m.chainId, 'address', m.to, (m.entity && m.entity.label) || short(m.to))} ${m.entity ? entityBadge(m.entity) : ''}
          ${m.dest ? `<div class="small muted">→ ${esc(m.dest.protocol)}${m.dest.chain ? ' to ' + esc(CHAIN[m.dest.chain] ? CHAIN[m.dest.chain].name : m.dest.chain) : ''}${m.dest.recipient ? ': ' + (CHAIN[m.dest.chain] ? link(m.dest.chain, 'address', m.dest.recipient, short(m.dest.recipient)) : esc(short(m.dest.recipient))) : ''}${m.dest.amount != null ? ` · ${amount(m.dest.amount)} ${esc(m.dest.symbol || '')}` : ''}${m.dest.note ? ' · ' + esc(m.dest.note) : ''}</div>` : ''}</td>
        <td class="r">${amount(m.amount)} <span class="muted">${esc(m.sym)}</span></td><td class="r">${m.usd ? usd(m.usd) : ''}</td>
        <td><span class="ent ${cls}"><span class="ent-i">${ic}</span>${lbl}</span></td><td>${link(m.chainId, 'tx', m.hash)}</td></tr>`; }).join('') || `<tr><td colspan="8" class="muted">${engine.running ? 'Watching… movements appear here as they happen.' : 'Press ▶ Start live tracking to begin.'}</td></tr>`}
      </tbody></table></div>`;
  };

  const leads = () => c.leads.length ? c.leads.map((l, i) => `<div class="lead-card ${l.level}">
      <div class="section-head"><b>${l.level === 'green' ? '🟢' : '🟡'} ${esc(l.title)}</b><button class="btn ghost small-btn" data-copy-lead="${i}">Copy for report</button></div>
      <div class="muted small">${esc(l.detail)}</div>
      <div class="small">${CHAIN[l.chainId] ? link(l.chainId, 'address', l.address) : esc(l.address)} ${l.txs.map(h => CHAIN[l.chainId] ? link(l.chainId, 'tx', h) : esc(short(h))).join(' ')} · ${timeCell(l.time)}</div>
    </div>`).join('') : `<p class="muted">No leads yet. 🟢 strong leads: money reaching an exchange, or USDT/USDC that can be frozen. 🟡 other leads: new attacker wallets holding funds.</p>`;

  const addresses = () => `<form id="case-add" class="search" style="margin-bottom:10px"><input name="addr" placeholder="Add an address (chain:address to force a chain)" autocomplete="off" spellcheck="false"><button class="btn">Add</button></form>
    <div class="table-scroll"><table><thead><tr><th>Address</th><th>Chain</th><th>Role</th><th class="r">Balance</th><th>Freezable</th><th>Last checked</th><th></th></tr></thead><tbody>
    ${c.addresses.map((a, i) => `<tr><td>${link(a.chainId, 'address', a.address, short(a.address))}${a.label ? ` <span class="muted small">${esc(a.label)}</span>` : ''}</td>
      <td>${CHAIN[a.chainId] ? chainDot(CHAIN[a.chainId]) + ' ' + esc(CHAIN[a.chainId].name) : esc(a.chainId)}</td>
      <td>${a.role === 'seed' ? '<span class="chip">Starting</span>' : '<span class="chip ok">Followed</span>'}</td>
      <td class="r">${a.balance != null ? `${amount(a.balance)} ${esc(CHAIN[a.chainId].symbol)}` : '—'}</td>
      <td>${(a.stables || []).map(s => `<span class="ent danger">${Math.round(s.amount).toLocaleString()} ${esc(s.sym)}</span>`).join(' ')}</td>
      <td>${a.lastChecked ? timeCell(a.lastChecked) : '<span class="muted small">waiting</span>'}${a.error ? ' ⚠' : ''}</td>
      <td class="r"><a class="btn ghost small-btn" href="#/investigate/${a.chainId}/${encodeURIComponent(a.address)}">Investigate</a> <button class="icon-btn" data-rm="${i}" title="Remove">✕</button></td></tr>`).join('')}
    </tbody></table></div>`;

  const settings = () => `<form id="case-set" class="case-form">
      <label>Case name<input name="name" value="${esc(c.name)}" maxlength="80"></label>
      <label>Ignore moves under<select name="min">${[100, 1000, 10000, 100000].map(v => `<option value="${v}" ${c.settings.minUsd === v ? 'selected' : ''}>$${v.toLocaleString()}</option>`).join('')}</select></label>
      <label>Most addresses to track<select name="max">${[100, 200, 400, 800].map(v => `<option ${c.settings.maxAddresses === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="follow" ${c.settings.autoFollow ? 'checked' : ''}> Auto-follow new wallets</label>
      <button class="btn">Save</button></form>
    <p class="muted small">Watching since ${new Date(c.since).toLocaleString()}. Tip: keep this tab open (it can be in the background). Tracking stops when you leave this page or close the tab.</p>`;

  function render() {
    document.getElementById('case-status').textContent = engine.status;
    document.getElementById('case-run').textContent = engine.running ? '■ Stop tracking' : '▶ Start live tracking';
    kpis();
    const body = document.getElementById('case-body');
    const scroll = body.querySelector('.table-scroll') ? body.querySelector('.table-scroll').scrollTop : 0;
    if (tab === 'feed') body.innerHTML = feed();
    if (tab === 'leads') body.innerHTML = leads();
    if (tab === 'addresses' && !body.querySelector('#case-add input:focus')) body.innerHTML = addresses();
    if (tab === 'settings' && !body.querySelector('#case-set')) body.innerHTML = settings();
    const ts = body.querySelector('.table-scroll'); if (ts) ts.scrollTop = scroll;
  }

  document.getElementById('case-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; document.querySelectorAll('#case-tabs button').forEach(x => x.classList.toggle('active', x === b)); document.getElementById('case-body').innerHTML = ''; render(); };
  document.getElementById('case-run').onclick = () => { engine.running ? engine.stop() : engine.start(); render(); };
  document.getElementById('case-md').onclick = () => { download(`case-${c.name.replace(/\W+/g, '-').toLowerCase()}.md`, caseMarkdown(c), 'text/markdown'); toast('Case report downloaded'); };
  document.getElementById('case-csv').onclick = () => {
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
    download(`case-${c.name.replace(/\W+/g, '-').toLowerCase()}.csv`, [['time_utc', 'chain', 'from', 'to', 'to_label', 'amount', 'asset', 'usd', 'type', 'next_protocol', 'next_chain', 'next_recipient', 'tx'].join(','),
      ...c.movements.map(m => [new Date(m.time).toISOString(), m.chainId, m.from, m.to, m.entity ? m.entity.label || m.entity.name : '', m.amount, m.sym, m.usd != null ? m.usd.toFixed(2) : '', m.cls, m.dest ? m.dest.protocol : '', m.dest ? m.dest.chain : '', m.dest ? m.dest.recipient : '', m.hash].map(q).join(','))].join('\n'));
  };
  document.getElementById('case-body').addEventListener('click', e => {
    const f = e.target.closest('#feed-f [data-f]');
    if (f) { feedFilter = f.dataset.f; render(); return; }
    const cp = e.target.closest('[data-copy-lead]');
    if (cp) {
      const l = c.leads[Number(cp.dataset.copyLead)];
      const text = `${l.title}\n${l.detail}\nChain: ${CHAIN[l.chainId] ? CHAIN[l.chainId].name : l.chainId}\nAddress: ${l.address}\n${l.txs.map(h => 'Tx: ' + h).join('\n')}\nTime (UTC): ${l.time ? new Date(l.time).toISOString() : 'n/a'}`;
      navigator.clipboard.writeText(text).then(() => toast('Lead copied: paste it into the report form')).catch(() => toast('Copy failed'));
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { c.addresses.splice(Number(rm.dataset.rm), 1); putCase(c); render(); }
  });
  document.getElementById('case-body').addEventListener('submit', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.target.id === 'case-add') {
      const added = parseAddresses(e.target.addr.value, c.settings.evm || DEFAULT_EVM);
      let n = 0; for (const a of added) if (engine.addAddress(a.chainId, a.address, 'added by you', 'seed')) n++;
      putCase(c); toast(n ? `Added ${n} address${n > 1 ? 'es' : ''}` : 'Nothing new to add'); render();
    }
    if (e.target.id === 'case-set') {
      c.name = e.target.name.value.trim() || c.name; c.settings.minUsd = Number(e.target.min.value); c.settings.maxAddresses = Number(e.target.max.value); c.settings.autoFollow = e.target.follow.checked;
      putCase(c); toast('Settings saved'); document.getElementById('case-body').innerHTML = ''; render();
    }
  });
  render();
}
