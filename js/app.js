import { CHAINS, CHAIN } from './chains.js';
import { detect } from './detect.js';
import { getPrices, priceOf } from './prices.js';
import { knownLabel, entityOf, INDIAN_EXCHANGES, DIRECTORY, loadLabels } from './entities.js';
import { poll, stopAll, track } from './live.js';
import { onBlock, hasRealtime, isLive } from './realtime.js';
import { LIVE_INTERVAL } from './config.js';
import { NotFound } from './utils.js';
import { main, adapter, withTimeout, pool, showError, loading, toast, setQuery } from './core.js';
import { isWatched, addWatch, removeWatch, pushAlerts, unreadAlerts, listLabels, saveLabel, removeLabel } from './store.js';
import { inspectTx, depositCheck, entityBadge } from './alerts.js';
import { resolveBridgeTx } from './crosschain.js';
import { startMonitor } from './monitor.js';
import { initShell } from './shell.js';
import { mountOutgoing } from './pages/xfers.js';
import { alertItem, chainLabel } from './pages/shared.js';
import { liveLabel, prefetchLabels, hasLiveLabels } from './labels-live.js';
import { usdOf } from './investigate.js';
import { isFakeToken, lookalike } from './scam.js';
import { flag, COUNTRY, setCustomLabels, customLabelOf } from './entities.js';
import { esc, short, amount, usd, compact, timeCell, identicon, chainDot, chainChip, link, copyBtn, statusChip, dirChip, stat } from './ui.js';

let routeId = 0;
window.addEventListener('hashchange', route);

async function route() {
  stopAll();
  const id = ++routeId;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').map(decodeURIComponent);
  const [a, b, ...rest] = parts;
  const c = rest.join('/');
  document.body.classList.toggle('home', !a);
  window.scrollTo(0, 0);
  const stale = () => id !== routeId;
  try {
    if (a && a !== 'account' && a !== 'investigate-start') { loading('Loading…'); await loadLabels(); }
    if (!a) return await homePage(stale);
    if (a === 'search') return await searchPage([b, c].filter(Boolean).join('/'), stale);
    if (a === 'login') { location.replace('#/account'); return; }
    if (a === 'account') return await (await import('./pages/account.js')).accountPage(stale);
    if (a === 'cases') return await (await import('./pages/cases.js')).casesPage();
    if (a === 'case') { loading('Opening case…'); return await (await import('./pages/cases.js')).casePage(b, stale); }
    if (a === 'investigate-start') return investigateStart();
    if (a === 'investigate') { loading('Opening investigation…'); return await (await import('./pages/investigate.js')).investigatePage(b, c, params, stale); }
    if (a === 'exchanges') { loading('Loading exchange directory…'); return await (await import('./pages/exchanges.js')).exchangesPage(stale, b || 'all', c || null); }
    if (!CHAIN[a]) return showError(`Unknown network "${a}".`);
    if (b === 'address') return await addressPage(a, c, stale);
    if (b === 'tx') return await txPage(a, c, stale);
    showError('Page not found.');
  } catch (e) {
    if (!stale()) showError(e instanceof NotFound ? `Not found on ${CHAIN[a] ? CHAIN[a].name : 'this network'}. Check the address or hash.` : e.message);
  }
}

const normName = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
function findEntities(q) {
  const n = normName(q);
  if (n.length < 2) return [];
  const hits = [];
  for (const e of DIRECTORY) {
    const k = normName(e.name);
    const score = k === n ? 0 : k.startsWith(n) ? 1 : k.includes(n) ? 2 : n.includes(k) && k.length >= 4 ? 3 : -1;
    if (score >= 0) hits.push({ ...e, score, exact: score === 0 });
  }
  return hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
}

function submitSearch(q) {
  q = q.trim();
  if (!q) return;
  const c = detect(q);
  const ex = !c.length || /\s/.test(q) || !/[0-9.:]/.test(q) ? findEntities(q) : [];
  if (ex.length === 1 || (ex.length && ex[0].exact)) { location.hash = `#/exchanges/${ex[0].country === 'IN' ? 'india' : 'all'}/${encodeURIComponent(ex[0].name)}`; return; }
  if (ex.length) { location.hash = `#/exchanges/all/${encodeURIComponent(q)}`; return; }
  if (!c.length) {
    main.innerHTML = `<div class="card error"><strong>Unrecognized input.</strong>
      <p>Enter a wallet address, a transaction hash, or a name like <code>vitalik.eth</code> or <code>root.near</code>.
      Supported networks: ${CHAINS.filter(x => !x.testnet).map(x => esc(x.name)).join(', ')}.</p></div>`;
    return;
  }
  const target = c.length === 1 && c[0].kind !== 'name' ? `#/${c[0].chainId}/${c[0].kind}/${encodeURIComponent(q)}` : `#/search/${encodeURIComponent(q)}`;
  if (location.hash === target) route(); else location.hash = target;
}
document.addEventListener('submit', e => {
  const input = e.target.querySelector('input[name=q]');
  if (!input) return;
  e.preventDefault();
  input.blur();
  submitSearch(input.value);
});

async function searchPage(q, stale) {
  const cands = detect(q);
  setQuery(q);
  if (!cands.length) return submitSearch(q);

  const name = cands.find(c => c.kind === 'name');
  if (name) {
    loading(`Resolving ${q}…`);
    const a = await adapter(name.chainId);
    const addr = await a.resolveName(q);
    if (!stale()) location.replace(`#/search/${addr}`);
    return;
  }

  const isAddr = cands.every(c => c.kind === 'address');
  const allEvm = cands.every(c => CHAIN[c.chainId].family === 'evm');
  document.title = `Search ${short(q)} · CryptChain`;
  main.innerHTML = `
    <div class="card">
      <h2>${isAddr ? 'Address' : 'Search'} across ${cands.length} network${cands.length > 1 ? 's' : ''}</h2>
      <div class="identity">${identicon(q, 48)}<div><div class="mono break">${esc(q)}</div>
        <div class="muted" id="sprog">Checking networks…</div></div></div>
      <div id="portfolio"></div>
    </div>
    <div class="card"><div class="hits" id="hits"></div><div id="misses" class="muted small"></div></div>`;

  const prices = await getPrices();
  const hits = [], misses = [];
  let done = 0;
  const render = () => {
    if (stale()) return;
    document.getElementById('sprog').textContent = done < cands.length ? `Checked ${done} of ${cands.length} networks…` : `Found on ${hits.length} of ${cands.length} networks`;
    hits.sort((x, y) => (y.usd || 0) - (x.usd || 0) || (y.info?.txCount || 0) - (x.info?.txCount || 0));
    document.getElementById('hits').innerHTML = hits.map(h => {
      const ch = CHAIN[h.chainId];
      const href = `#/${h.chainId}/${h.kind}/${encodeURIComponent(h.kind === 'address' ? h.info.address : q)}`;
      const body = h.kind === 'address'
        ? `<div class="hit-main">${amount(h.info.balance)} ${esc(ch.symbol)} <span class="muted">${usd(h.usd)}</span></div>
           <div class="muted small">${esc(h.info.kind)}${h.info.txCount ? ` · ${compact(h.info.txCount)} txs` : ''}${h.info.name ? ` · ${esc(h.info.name)}` : ''}</div>`
        : `<div class="hit-main">Transaction ${statusChip(h.info.status)}</div>
           <div class="muted small">${h.info.time ? new Date(h.info.time).toLocaleString() : 'Pending'} · value ${amount(h.info.value)} ${esc(ch.symbol)}</div>`;
      return `<a class="hit" href="${href}" style="--c:${ch.color}">${chainDot(ch)}<div class="hit-chain">${esc(ch.name)}</div><div class="hit-body">${body}</div><span class="arrow">→</span></a>`;
    }).join('') || (done < cands.length ? '<div class="loading"><div class="spinner"></div></div>' : '<p>Nothing found on any network. Check the input and try again.</p>');
    if (misses.length && done === cands.length) {
      document.getElementById('misses').innerHTML = `<details><summary>No activity on ${misses.length} network${misses.length > 1 ? 's' : ''}</summary><p>${misses.map(m => esc(CHAIN[m.chainId].name) + (m.err ? ` <span title="${esc(m.err)}">⚠</span>` : '')).join(', ')}</p></details>`;
    }
    const total = hits.reduce((s, h) => s + (h.usd || 0), 0);
    if (isAddr && allEvm && hits.length) {
      document.getElementById('portfolio').innerHTML = `<div class="grid">${stat('Total native balance value', usd(total) || '$0')}${stat('Active on', `${hits.length} networks`)}</div>`;
    }
  };

  await pool(cands, 10, async c => {
    try {
      const a = await adapter(c.chainId);
      const info = await withTimeout(c.kind === 'address' ? a.getAddress(q) : a.getTx(q), 20000);
      if (c.kind === 'address' && !info.active) misses.push(c);
      else {
        if (c.kind === 'tx' && !stale()) { routeId++; location.replace(`#/${c.chainId}/tx/${encodeURIComponent(q)}`); return; }
        const p = priceOf(prices, CHAIN[c.chainId]);
        hits.push({ ...c, info, usd: c.kind === 'address' && p ? info.balance * p.usd : null });
      }
    } catch (e) {
      misses.push({ ...c, err: e instanceof NotFound ? null : e.message });
    }
    done++;
    render();
  });
  if (stale()) return;
  if (hits.length === 1 && !(isAddr && allEvm)) {
    const h = hits[0];
    location.replace(`#/${h.chainId}/${h.kind}/${encodeURIComponent(h.kind === 'address' ? h.info.address : q)}`);
  }
}

const FILTERS = { all: 'All', evm: 'EVM', utxo: 'Bitcoin-like', other: 'Other L1s', testnet: 'Testnets' };
let filter = 'all';
const inFilter = c => filter === 'testnet' ? c.testnet : !c.testnet && (filter === 'all' || (filter === 'other' ? !['evm', 'utxo'].includes(c.family) : c.family === filter));

async function homePage(stale) {
  document.title = 'CryptChain Explorer · Multichain block explorer';
  setQuery('');
  const recent = getRecent();
  const live = CHAINS.filter(c => !c.testnet).length;
  const feature = (href, icon, title, text) => `<a class="feature-x" href="${href}"><span class="fx-i">${icon}</span><b>${title}</b><span>${text}</span></a>`;
  main.innerHTML = `
    <section class="hero-x">
      <span class="hero-badge"><span class="pulse"></span> Live on ${live} blockchains · free · no sign-in</span>
      <h1>Trace any wallet across <span class="grad">every chain</span>, down to the exchange.</h1>
      <p class="lead">Paste a wallet address, transaction hash or name. CryptChain finds the network, names the exchanges and follows the money hop by hop.</p>
      <form class="search hero-search"><input name="q" placeholder="Address, tx hash, vitalik.eth, root.near or an exchange name" autocomplete="off" spellcheck="false" aria-label="Search"><button class="btn">Search</button></form>
      <div class="quick">
        <a href="#/search/vitalik.eth">◎ vitalik.eth</a>
        <a href="#/bitcoin/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa">₿ Satoshi's address</a>
        <a href="#/bitcoin/tx/a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d">🍕 Bitcoin pizza tx</a>
        <a href="#/tron/address/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t">₮ USDT on TRON</a>
        ${INDIAN_EXCHANGES.slice(0, 4).map(n => `<a href="#/exchanges/india/${encodeURIComponent(n)}">🇮🇳 ${esc(n)}</a>`).join('')}
      </div>
      ${recent.length ? `<div class="quick">${recent.map(r => `<a href="${esc(r.href)}">${chainDot(CHAIN[r.chainId])}${esc(r.label)}</a>`).join('')}</div>` : ''}
    </section>
    <section class="kpi-strip">
      <div class="kpi-x"><div class="k">Networks</div><div class="v" id="kpi-live">${live}</div><div class="s" id="kpi-live-s">connecting…</div></div>
      <div class="kpi-x"><div class="k">Labeled wallets</div><div class="v">15k+</div><div class="s">exchanges, funds, bridges</div></div>
      <div class="kpi-x"><div class="k">Exchanges & institutions</div><div class="v">${DIRECTORY.length.toLocaleString()}</div><div class="s">${INDIAN_EXCHANGES.length} Indian exchanges</div></div>
      <div class="kpi-x"><div class="k">Refresh</div><div class="v">${LIVE_INTERVAL.dashboard / 1000}s</div><div class="s">blocks & prices, live</div></div>
    </section>
    <section class="feature-grid">
      ${feature('#/investigate-start', '⌖', 'Investigate', 'Incoming and outgoing flows, counterparties, charts and a hop-by-hop money trail.')}
      ${feature('#/investigate-start', '⇶', 'Follow the money', 'Track the whole balance through every hop to its final exchanges and wallets.')}
      ${feature('#/account', '🔔', 'Live alerts', 'Watch wallets and get flagged the moment funds hit an exchange or bridge.')}
      ${feature('#/exchanges/all', '⬡', 'Exchange directory', 'Global and Indian exchanges with their verified hot, cold and deposit wallets.')}
    </section>
    <section>
      <div class="section-head"><h2><span class="live-dot"></span> Live networks</h2>
        <div class="tabs">${Object.entries(FILTERS).map(([k, v]) => `<button data-filter="${k}" class="${k === filter ? 'active' : ''}">${v}</button>`).join('')}</div></div>
      <div class="net-grid" id="nets">${CHAINS.map(netCard).join('')}</div>
    </section>`;
  applyFilter();
  main.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
    filter = b.dataset.filter;
    main.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    applyFilter();
    refreshNets(stale);
  });
  for (const c of CHAINS) {
    if (!hasRealtime(c.id)) continue;
    track(onBlock(c.id, h => {
      if (stale()) return;
      const el = document.getElementById('net-' + c.id);
      if (!el || el.hidden) return;
      const hEl = el.querySelector('.h'), txt = Number(h).toLocaleString();
      if (hEl.textContent !== txt) { hEl.textContent = txt; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      const st = el.querySelector('.net-state');
      st.className = 'net-state ok rt'; st.title = 'Real-time: new block ' + txt + ' at ' + new Date().toLocaleTimeString();
      if (!el.querySelector('.rt-badge')) el.querySelector('.net-top').insertAdjacentHTML('beforeend', '<span class="rt-badge" title="Updates the moment a block is produced">⚡ LIVE</span>');
    }));
  }
  await refreshNets(stale);
  poll(() => refreshNets(stale), LIVE_INTERVAL.dashboard);

}

const applyFilter = () => CHAINS.forEach(c => { const el = document.getElementById('net-' + c.id); if (el) el.hidden = !inFilter(c); });

function netCard(c) {
  return `<div class="net" id="net-${c.id}" style="--c:${c.color}">
    <div class="net-top">${chainDot(c)}<span class="net-name">${esc(c.name)}</span><span class="net-state" title="Waiting for data"></span></div>
    <div class="net-price"><span class="p">—</span> <span class="chg"></span></div>
    <div class="net-height"><span class="k">Block</span> <span class="h mono">—</span></div>
    <div class="net-extra muted small"></div>
  </div>`;
}

const lastStats = {};
async function refreshNets(stale) {
  const visible = CHAINS.filter(inFilter);
  const prices = await getPrices();
  if (stale()) return;
  for (const c of visible) {
    const p = priceOf(prices, c), el = document.getElementById('net-' + c.id);
    if (!el || !p) continue;
    el.querySelector('.p').textContent = `${c.symbol} ${usd(p.usd)}`;
    const chg = el.querySelector('.chg');
    chg.textContent = p.change != null ? `${p.change >= 0 ? '▲' : '▼'} ${Math.abs(p.change).toFixed(2)}%` : '';
    chg.className = 'chg ' + (p.change >= 0 ? 'up' : 'down');
  }
  await pool(visible, 8, async c => {
    const el = document.getElementById('net-' + c.id);
    const state = el.querySelector('.net-state');
    if (c.statsEvery && Date.now() - (lastStats[c.id] || 0) < c.statsEvery && el.querySelector('.h').textContent !== '—') return;
    lastStats[c.id] = Date.now();
    try {
      const s = await withTimeout((await adapter(c.id)).getStats(), 15000);
      if (stale()) return;
      const h = el.querySelector('.h'), txt = s.height != null ? Number(s.height).toLocaleString() : '—';
      if (!isLive(c.id)) {
        if (h.textContent !== txt && h.textContent !== '—') { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
        h.textContent = txt;
      }
      el.querySelector('.net-extra').innerHTML = s.extra.slice(0, 2).map(x => `<span>${esc(x.label)}: <b>${esc(x.value)}</b></span>`).join('');
      if (!isLive(c.id)) { state.className = 'net-state ok'; state.title = 'Live · updated ' + new Date().toLocaleTimeString(); }
    } catch (e) {
      state.className = 'net-state err'; state.title = 'Unavailable: ' + e.message;
    }
  });
  if (!stale()) updateLiveCount();
}

function updateLiveCount() {
  const total = CHAINS.filter(c => !c.testnet).length;
  const ok = CHAINS.filter(c => !c.testnet && document.querySelector(`#net-${c.id} .net-state.ok`)).length;
  if (!ok) return;
  document.getElementById('net-count').textContent = `${ok} of ${total} networks live`;
  const k = document.getElementById('kpi-live'), ks = document.getElementById('kpi-live-s');
  if (k) { k.textContent = ok; ks.textContent = `of ${total} live right now`; }
}

function investigateChains(cands) {
  const ids = cands.filter(c => c.kind === 'address' && !CHAIN[c.chainId].testnet).map(c => c.chainId);
  return ids.some(id => CHAIN[id].family === 'evm') ? ['ethereum'] : ids;
}

function investigateStart() {
  document.title = 'Investigate · CryptChain';
  setQuery('');
  main.innerHTML = `
    <div class="card start-card">
      <span class="hero-badge">⌖ Investigation</span>
      <h1 class="page-title" style="margin-top:14px">Which wallet do you want to investigate?</h1>
      <p class="muted">Paste an address on any supported network. We find where it is active, then trace every incoming and outgoing transfer.</p>
      <form class="hero-search" id="inv-start"><input id="inv-addr" placeholder="Wallet address (0x…, bc1…, T…, Solana, TON, XRP…)" autocomplete="off" spellcheck="false" aria-label="Wallet address"><button class="btn">Start</button></form>
      <p class="small" id="inv-msg" style="min-height:1.4em"></p>
      <div class="start-steps">
        <div><b>1 · Flows</b><span class="muted small">Every transfer in and out, grouped by counterparty and token, with charts.</span></div>
        <div><b>2 · Follow the money</b><span class="muted small">The balance is traced hop by hop until it reaches exchanges or rests.</span></div>
        <div><b>3 · Report</b><span class="muted small">Download a plain-language report with timestamps, hops and CSV data.</span></div>
      </div>
    </div>`;
  const input = document.getElementById('inv-addr'), msg = document.getElementById('inv-msg');
  input.focus();
  document.getElementById('inv-start').onsubmit = e => {
    e.preventDefault();
    const q = input.value.trim();
    const ids = investigateChains(detect(q));
    if (!ids.length) { msg.textContent = 'That doesn’t look like a wallet address on a supported network.'; return; }
    location.hash = `#/investigate/${ids.join(',')}/${encodeURIComponent(q)}`;
  };
}

const FLOW_CATS = new Set(['exchange', 'bridge', 'fund', 'custodian', 'issuer', 'exploit']);
async function addressPage(chainId, addr, stale) {
  const chain = CHAIN[chainId];
  const a = await adapter(chainId);
  setQuery(addr);
  loading(`Loading address on ${chain.name}…`);
  const [info, prices] = await Promise.all([a.getAddress(addr), getPrices()]);
  if (stale()) return;
  addr = info.address;
  const known = knownLabel(chain, addr);
  let name = info.name || (known && known.name);
  const labels = [...new Set([...(info.labels || []), ...(known ? known.tags : [])])];
  const price = priceOf(prices, chain);
  document.title = `${name || short(addr)} · ${chain.name} · CryptChain`;
  addRecent({ chainId, href: location.hash, label: name || short(addr) });
  const plainWallet = /Wallet|SegWit|Legacy|Taproot|P2SH|Address/.test(info.kind);

  main.innerHTML = `
    <div class="card">
      <div class="card-head">${chainChip(chain)}<span class="chip">${esc(info.kind)}</span>
        <span id="ent-chips">${labels.map(l => `<span class="chip tag">${esc(l)}</span>`).join('')}</span>
        ${info.active ? '' : '<span class="chip">No activity yet</span>'}
        <span class="grow"></span>
        <button class="btn ghost small-btn" id="label-btn" title="Name this address (e.g. your exchange deposit address)">🏷 Label</button>
        <button class="btn ghost small-btn" id="watch-btn">👁 Watch</button>
        <a class="btn small-btn" href="#/investigate/${chainId}/${encodeURIComponent(addr)}">🔎 Investigate</a></div>
      <div class="identity">${identicon(addr)}
        <div class="grow"><div class="name" id="id-name">${esc(name || (plainWallet ? 'Unlabeled wallet' : info.kind))}</div>
          <div class="muted small" id="id-note"></div>
          <div class="mono break muted">${esc(addr)} ${copyBtn(addr)}</div>
          ${chain.family === 'evm' ? `<a class="small" href="#/search/${addr}">See this address on all EVM networks →</a>` : ''}</div></div>
      <div id="label-form" class="label-form" hidden></div>
      <div class="grid" id="astats">${addrStats(info, chain, price)}</div>
    </div>
    <div class="card" id="tx-card">
      <div class="section-head"><h2>Transactions</h2><span class="live-badge" title="Checks for new transactions every ${LIVE_INTERVAL.address / 1000}s"><span class="live-dot"></span>LIVE</span>
        <div class="tabs" id="tx-filter"><button data-f="all" class="active">All</button><button data-f="in">Received</button><button data-f="out">Sent</button><button data-f="ent">Exchanges & bridges</button></div></div>
      <div class="legend small"><span class="ent ex"><span class="ent-i">🏦</span>Exchange</span><span class="ent br"><span class="ent-i">🌉</span>Bridge</span><span class="ent dx"><span class="ent-i">🔁</span>DEX</span><span class="ent inst"><span class="ent-i">🏢</span>Fund / custodian</span><span class="ent danger"><span class="ent-i">⚠</span>Scam / hacker</span><span class="ent mine"><span class="ent-i">🏷</span>Your label</span><span class="muted">≈ deposit address found by where it forwards funds</span></div>
      <div class="table-scroll"><table class="txs" data-f="all">
        <thead><tr><th>Transaction</th><th>Type</th><th>Time</th><th>From</th><th></th><th>To</th><th class="r">Amount</th><th class="r">Fee</th></tr></thead>
        <tbody id="txs"></tbody></table></div>
      <div class="more" id="more"></div>
    </div>
    ${info.tokens && info.tokens.length ? tokenCard(info.tokens) : ''}
    <div class="card" id="xfer-card">
      <div class="section-head"><h2>📤 Outgoing transfers</h2><span class="live-badge" title="Checks for new transfers every few seconds"><span class="live-dot"></span>LIVE</span></div>
      <p class="muted small">Every transfer this wallet sends shows up here with its destination, which is checked automatically: exchange, deposit address, bridge to another chain, or private wallet.</p>
      <div id="xfers" class="xfer-list"></div>
    </div>
    <div class="side-grid">
    <div class="card" id="conn-card">
      <div class="section-head"><h2>🔗 Exchange connections</h2><span class="muted small" id="conn-state"></span></div>
      <p class="muted small">Exchanges and institutions this wallet has sent money to or received money from, including personal deposit addresses (recognized by where they forward funds).</p>
      <div id="conns"><div class="muted small">Checking counterparties…</div></div>
    </div>
    <div class="card" id="alerts-card">
      <div class="section-head"><h2>⚡ Flow alerts</h2><span class="muted small" id="alerts-state"></span></div>
      <div id="alerts" class="alert-list"><div class="muted small">Checking recent transfers for exchanges and bridges…</div></div>
    </div>
    </div>`;

  const watchBtn = document.getElementById('watch-btn');
  let watched = await isWatched(chainId, addr);
  const paintWatch = () => { watchBtn.textContent = watched ? '✓ Watching' : '👁 Watch'; watchBtn.classList.toggle('on', !!watched); };
  paintWatch();
  watchBtn.onclick = async () => {
    if (watched) { await removeWatch(watched.id); watched = null; toast('Removed from watchlist'); }
    else { watched = await addWatch(chainId, addr, name || ''); toast('Watching: alerts will appear in your account'); }
    paintWatch();
  };

  const labelChain = chain.family === 'evm' ? 'evm' : chainId;
  const mine = customLabelOf(chain, addr);
  document.getElementById('label-btn').textContent = mine ? '🏷 Edit label' : '🏷 Label';
  document.getElementById('label-btn').onclick = () => {
    const f = document.getElementById('label-form');
    f.hidden = !f.hidden;
    if (f.hidden) return;
    const cur = customLabelOf(chain, addr) || {};
    const types = [['exchange', '🏦 Exchange'], ['fund', '🏢 Market maker / fund'], ['custodian', '🏛 Custodian'], ['issuer', '💵 Stablecoin issuer'], ['exploit', '⚠ Scam / hacker'], ['other', '🏷 Other']];
    f.innerHTML = `<div class="row-gap">
        <input id="lf-name" placeholder="Name, e.g. WazirX deposit / Binance DOGE hot wallet" value="${esc(cur.name || '')}" maxlength="60">
        <select id="lf-cat">${types.map(([v, l]) => `<option value="${v}" ${cur.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="lf-cc"><option value="">Location (optional)</option>${Object.entries(COUNTRY).map(([cc, c]) => `<option value="${cc}" ${cur.country === cc ? 'selected' : ''}>${flag(cc)} ${esc(c.name)}</option>`).join('')}</select>
        <button class="btn small-btn" id="lf-save">Save label</button>${cur.id ? '<button class="btn ghost small-btn" id="lf-del">Remove</button>' : ''}
      </div><p class="muted small">Only you see this label${chain.family === 'evm' ? '. It applies on every EVM network' : ''}. It shows up in alerts, connections, investigations and money trails.</p>`;
    const reloadLabels = async () => { setCustomLabels(await listLabels()); route(); };
    f.querySelector('#lf-save').onclick = async () => {
      try {
        await saveLabel({ chain_id: labelChain, address: addr, name: f.querySelector('#lf-name').value, category: f.querySelector('#lf-cat').value, country: f.querySelector('#lf-cc').value || null });
        toast('Label saved'); await reloadLabels();
      } catch (e) { toast(e.message); }
    };
    f.querySelector('#lf-del')?.addEventListener('click', async () => { await removeLabel(cur.id); toast('Label removed'); await reloadLabels(); });
  };

  const setIdentity = (ent, note) => {
    if (!ent || stale()) return;
    if (!name) { name = ent.label; document.getElementById('id-name').textContent = ent.label; document.title = `${ent.label} · ${chain.name} · CryptChain`; }
    document.getElementById('ent-chips').insertAdjacentHTML('beforeend', entityBadge(ent));
    if (note) document.getElementById('id-note').textContent = note;
  };

  const tbody = document.getElementById('txs'), more = document.getElementById('more');
  document.getElementById('tx-filter').onclick = e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    document.querySelectorAll('#tx-filter button').forEach(x => x.classList.toggle('active', x === b));
    tbody.closest('table').dataset.f = b.dataset.f;
  };
  const rows = new Map();
  const isMe = x => !!x && x.toLowerCase() === addr.toLowerCase();
  const self = () => `<span class="muted">${esc(name || short(addr))}</span>`;
  const depositEnt = new Map();
  const entOf = (p, pEnt, pName) => entityOf(chain, p, pEnt, pName) || (p ? depositEnt.get(p.toLowerCase()) : null) || null;
  const party = (p, pName, pEnt) => {
    const ent = entOf(p, pEnt, pName);
    return `${link(chainId, 'address', p, pName || (ent && ent.label) || null)}${ent && ent.category !== 'other' ? ' ' + entityBadge(ent) : ''}`;
  };
  const cps = new Set();
  const poisonOf = t => {
    const cp = t.direction === 'in' ? t.from : t.to;
    if (!cp) return null;
    const fake = isFakeToken({ ...t, chainId });
    const zero = t.token && !t.value;
    if (!fake && !zero) return null;
    for (const o of cps) if (lookalike(o, cp)) return `Lookalike of ${short(o)}: address-poisoning spam, never copy it`;
    return fake ? 'Fake token imitating a real one' : null;
  };
  const row = t => `<tr data-h="${esc(t.hash)}" data-dir="${esc(t.direction || '')}"${[t.from, t.to].some(p => { const e = p && !isMe(p) && entOf(p, p === t.to ? t.toEntity : t.fromEntity, p === t.to ? t.toName : t.fromName); return e && FLOW_CATS.has(e.category); }) ? ' data-ent="1"' : ''}>
      <td>${link(chainId, 'tx', t.hash)}${t.status === 'failed' ? ' ' + statusChip('failed') : ''}</td>
      <td><span class="chip method" title="${esc(t.method || '')}">${esc(t.method && t.method.length > 22 ? t.method.slice(0, 20) + '…' : t.method || '—')}</span></td>
      <td>${timeCell(t.time)}</td>
      <td>${isMe(t.from) ? self() : party(t.from, t.fromName, t.fromEntity)}</td>
      <td>${dirChip(t.direction)}</td>
      <td>${isMe(t.to) ? self() : party(t.to, t.toName, t.toEntity)}</td>
      <td class="r ${t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : ''}">${amount(t.value)} <span class="muted">${esc(t.symbol)}</span>${(w => w ? ` <span class="ent danger" title="${esc(w)}"><span class="ent-i">⚠</span>${/Lookalike/.test(w) ? 'Poisoning' : 'Fake token'}</span>` : '')(poisonOf(t))}</td>
      <td class="r muted">${t.fee != null ? amount(t.fee) : '—'}</td></tr>`;
  const append = (items, where = 'beforeend') => {
    for (const t of items) { const cp = t.direction === 'in' ? t.from : t.to; if (cp && !isFakeToken({ ...t, chainId }) && !(t.token && !t.value)) cps.add(cp); }
    const fresh = items.filter(t => !rows.has(t.hash));
    tbody.insertAdjacentHTML(where, fresh.map(row).join(''));
    fresh.forEach(t => rows.set(t.hash, t));
    return fresh;
  };

  const shown = [];
  const alertsEl = document.getElementById('alerts');
  const showAlerts = (list, { prepend = false } = {}) => {
    if (stale()) return [];
    const fresh = list.filter(x => !shown.some(s => s.kind === x.kind && s.hash === x.hash));
    if (prepend) shown.unshift(...fresh); else shown.push(...fresh);
    shown.sort((x, y) => (y.time || 0) - (x.time || 0));
    alertsEl.innerHTML = shown.length ? shown.slice(0, 12).map(alertItem).join('')
      : '<div class="muted small">No exchange or bridge transfers in recent activity. New transactions are checked live.</div>';
    return fresh;
  };

  let cursor = null, historyOk = true, firstPage = [];
  const loadMore = async () => {
    more.innerHTML = '<div class="spinner"></div>';
    try {
      const page = await a.getTxs(addr, cursor);
      if (stale()) return;
      if (!cursor) firstPage = page.items;
      if (page.note && !document.getElementById('hist-note')) {
        tbody.closest('.card').querySelector('.section-head').insertAdjacentHTML('afterend', `<div class="notice" id="hist-note">ℹ ${esc(page.note)}</div>`);
      }
      append(page.items);
      if (cursor) enrich(page.items);
      cursor = page.next;
      if (!rows.size) tbody.innerHTML = '<tr><td colspan="8" class="muted">No transactions found.</td></tr>';
      more.innerHTML = cursor ? '<button class="btn ghost">Load more</button>' : '';
      if (cursor) more.firstChild.onclick = loadMore;
    } catch (e) {
      if (e.code === 'NO_HISTORY') historyOk = false;
      more.innerHTML = `<div class="notice">${esc(e.message)}</div>${e.code === 'NO_HISTORY' ? '' : '<button class="btn ghost" style="margin-top:10px">Retry</button>'}`;
      more.querySelector('button')?.addEventListener('click', loadMore);
    }
  };
  await loadMore();
  if (stale()) return;

  const repaint = () => {
    for (const t of rows.values()) {
      const tr = tbody.querySelector(`tr[data-h="${CSS.escape(t.hash)}"]`);
      if (tr) { const fresh = tr.classList.contains('new'); tr.outerHTML = row(t); if (fresh) tbody.querySelector(`tr[data-h="${CSS.escape(t.hash)}"]`)?.classList.add('new'); }
    }
    renderConnections();
  };
  let enriching = 0;
  async function enrich(items) {
    enriching++;
    document.getElementById('conn-state').textContent = 'checking counterparties…';
    try {
      const cps = items.flatMap(t => [t.from, t.to]).filter(x => x && !isMe(x));
      if (hasLiveLabels(chainId)) await prefetchLabels(chainId, cps, 25);
      if (stale()) return;
      repaint();
      const outs = items.filter(t => t.direction === 'out' && t.to && !isMe(t.to) && !entOf(t.to, t.toEntity, t.toName))
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      const uniq = [...new Map(outs.map(t => [t.to.toLowerCase(), t])).values()].slice(0, 6);
      await pool(uniq, 2, async t => {
        const d = await depositCheck(chainId, t.to).catch(() => null);
        if (d) depositEnt.set(t.to.toLowerCase(), d);
      });
      if (!stale()) repaint();
    } finally {
      enriching--;
      if (!enriching && !stale()) document.getElementById('conn-state').textContent = '';
    }
  }

  function renderConnections() {
    const el = document.getElementById('conns');
    if (!el) return;
    const prices = lastPrices || {};
    const by = new Map();
    for (const t of rows.values()) {
      const dir = t.direction;
      if (dir !== 'in' && dir !== 'out') continue;
      const cp = dir === 'out' ? t.to : t.from;
      const e = entOf(cp, dir === 'out' ? t.toEntity : t.fromEntity, dir === 'out' ? t.toName : t.fromName);
      if (!e || !['exchange', 'fund', 'custodian', 'issuer', 'exploit'].includes(e.category)) continue;
      const k = e.name;
      const c = by.get(k) || { e, sent: 0, recv: 0, sentUsd: 0, recvUsd: 0, deposit: false, addrs: new Set() };
      const v = usdOf({ ...t, chainId }, prices) || 0;
      if (dir === 'out') { c.sent++; c.sentUsd += v; } else { c.recv++; c.recvUsd += v; }
      if (e.inferred) c.deposit = true;
      c.addrs.add(cp);
      by.set(k, c);
    }
    const list = [...by.values()].sort((a, b) => (b.sentUsd + b.recvUsd) - (a.sentUsd + a.recvUsd) || (b.sent + b.recv) - (a.sent + a.recv));
    el.innerHTML = list.length ? `<div class="conn-list">${list.map(c => `<div class="conn">
        ${entityBadge(c.e)}
        <span class="muted small">${c.e.country && COUNTRY[c.e.country] ? `${flag(c.e.country)} ${esc(COUNTRY[c.e.country].name)}` : ''}${c.deposit ? ' · via deposit address' : ''}</span>
        <span class="grow"></span>
        ${c.sent ? `<span class="out">↑ sent ${c.sent}× ${c.sentUsd ? usd(c.sentUsd) : ''}</span>` : ''}
        ${c.recv ? `<span class="in">↓ received ${c.recv}× ${c.recvUsd ? usd(c.recvUsd) : ''}</span>` : ''}
        <span class="muted small">${[...c.addrs].slice(0, 2).map(a => link(chainId, 'address', a, short(a))).join(', ')}${c.addrs.size > 2 ? ` +${c.addrs.size - 2}` : ''}</span>
      </div>`).join('')}</div>`
      : `<div class="muted small">${enriching ? 'Checking counterparties…' : 'No exchange or institution among the counterparties loaded so far.'} Load more transactions to check further back.</div>`;
  }
  let lastPrices = prices;
  enrich(firstPage);
  const xfers = mountOutgoing(document.getElementById('xfers'), { chainId, address: addr });
  const tokPage = async () => (a.getTokenTransfers ? (await a.getTokenTransfers(addr).catch(() => ({ items: [] }))).items : []);
  if (historyOk) xfers.update(firstPage, await tokPage(), { initial: true });
  else document.getElementById('xfers').innerHTML = '<div class="muted small">Transfer history is not available for this network without an indexer key.</div>';

  const own = firstPage.map(t => isMe(t.from) ? t.fromEntity : isMe(t.to) ? t.toEntity : null).find(Boolean);
  const ownLive = !own && !known && hasLiveLabels(chainId) ? await liveLabel(chainId, addr).catch(() => null) : null;
  if (stale()) return;
  if (own && !known) setIdentity(own);
  else if (ownLive) setIdentity(ownLive, `Label from ${ownLive.source}`);
  else if (!known && !info.name && plainWallet && historyOk) {
    depositCheck(chainId, addr).then(dep => dep && setIdentity(dep, `Forwards incoming funds to ${dep.sweepToLabel || dep.name}. This is how exchanges sweep customer deposit addresses.`));
  }

  if (historyOk) {
    const state = document.getElementById('alerts-state');
    const quick = (await Promise.all(firstPage.map(t => inspectTx(chainId, addr, t, { deep: false })))).flat();
    showAlerts(quick.filter(x => !x.pending));
    const flagged = new Set(quick.filter(x => !x.pending).map(x => x.hash));
    const deepList = firstPage.filter(t => t.direction === 'out' && !flagged.has(t.hash)).slice(0, 4);
    state.textContent = deepList.length ? 'checking deposit addresses & bridges…' : '';
    pool(deepList, 2, async t => { showAlerts(await inspectTx(chainId, addr, t).catch(() => [])); })
      .finally(() => { if (!stale()) { state.textContent = ''; if (!shown.length) showAlerts([]); } });
  } else {
    showAlerts([]);
  }

  poll(async () => {
    const [fresh, page, pr, toks] = await Promise.all([a.getAddress(addr), historyOk ? a.getTxs(addr, null) : { items: [] }, getPrices(), historyOk ? tokPage() : []]);
    if (historyOk) xfers.update(page.items, toks);
    if (stale()) return;
    document.getElementById('astats').innerHTML = addrStats(fresh, chain, priceOf(pr, chain));
    for (const t of page.items) {
      const old = rows.get(t.hash);
      if (old && old.status !== t.status) {
        const tr = tbody.querySelector(`tr[data-h="${CSS.escape(t.hash)}"]`);
        if (tr) { tr.outerHTML = row(t); rows.set(t.hash, t); }
      }
    }
    const added = append(page.items.filter(t => !rows.has(t.hash)), 'afterbegin');
    added.forEach(t => tbody.querySelector(`tr[data-h="${CSS.escape(t.hash)}"]`)?.classList.add('new'));
    if (!added.length) return;
    enrich(added);
    const found = (await Promise.all(added.slice(0, 8).map(t => inspectTx(chainId, addr, t).catch(() => [])))).flat();
    const freshAlerts = showAlerts(found, { prepend: true });
    const top = freshAlerts.find(x => x.level === 'high') || freshAlerts.find(x => x.level === 'medium');
    toast(top ? top.title : `${added.length} new transaction${added.length > 1 ? 's' : ''}`, top ? top.level : '');
    if (watched && freshAlerts.length) { pushAlerts(freshAlerts); window.dispatchEvent(new Event('alerts-changed')); }
  }, ['evm', 'utxo', 'tron'].includes(chain.family) && chain.adapter !== 'blockcypher' && chain.adapter !== 'blockchair' ? (hasRealtime(chainId) ? 30000 : 8000) : LIVE_INTERVAL.address, { chainId });
}

function addrStats(info, chain, price) {
  return [
    stat('Balance', `${amount(info.balance)} ${esc(chain.symbol)}`, price ? usd(info.balance * price.usd) : ''),
    stat('Transactions', info.txCount != null ? Number(info.txCount).toLocaleString() : '—'),
    ...info.stats.map(s => stat(s.label, s.link ? link(chain.id, s.link, s.value) : esc(s.value))),
  ].join('');
}

function tokenCard(tokens) {
  const rowsHtml = tokens.map((t, i) => `<tr ${i >= 10 ? 'class="extra" hidden' : ''}><td><b>${esc(t.symbol)}</b> <span class="muted small">${esc(t.name)}</span></td>
    <td class="r mono">${amount(t.balance)}</td><td class="r muted">${t.usd ? usd(t.usd) : ''}</td></tr>`).join('');
  return `<div class="card"><div class="section-head"><h2>Tokens <span class="muted">(${tokens.length})</span></h2></div>
    <div class="table-scroll"><table><thead><tr><th>Token</th><th class="r">Balance</th><th class="r">Value</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    ${tokens.length > 10 ? `<div class="more"><button class="btn ghost" onclick="this.closest('.card').querySelectorAll('tr.extra').forEach(r=>r.hidden=false);this.remove()">Show all ${tokens.length}</button></div>` : ''}</div>`;
}

async function txPage(chainId, hash, stale) {
  const chain = CHAIN[chainId];
  const a = await adapter(chainId);
  setQuery(hash);
  loading(`Loading transaction on ${chain.name}…`);
  const [tx, prices] = await Promise.all([a.getTx(hash), getPrices()]);
  if (stale()) return;
  document.title = `Tx ${short(tx.hash)} · ${chain.name} · CryptChain`;
  addRecent({ chainId, href: location.hash, label: 'Tx ' + short(tx.hash, 4) });
  let bridge = null;
  const render = async () => { main.innerHTML = txView(tx, chain, priceOf(await getPrices(), chain), bridge); };
  await render();
  if (hasLiveLabels(chainId)) {
    prefetchLabels(chainId, [...tx.inputs, ...tx.outputs, ...(tx.transfers || []).flatMap(t => [{ address: t.from }, { address: t.to }])].map(p => p.address), 20)
      .then(() => { if (!stale()) render(); });
  }

  const sender = tx.inputs[0] && tx.inputs[0].address;
  const findBridge = async () => {
    const b = await withTimeout(resolveBridgeTx(chainId, tx.hash, sender, { to: tx.outputs[0] && tx.outputs[0].address, value: tx.value, time: tx.time }), 20000).catch(() => null);
    if (b && !stale()) { bridge = b; await render(); }
  };
  findBridge();

  const settled = t => t.status !== 'pending' && (t.confirmations == null || t.confirmations >= 100) && (!bridge || bridge.status !== 'pending');
  if (!settled(tx)) {
    const stop = poll(async () => {
      const fresh = await a.getTx(hash);
      if (stale()) return;
      if (tx.status === 'pending' && fresh.status !== 'pending') toast(`Transaction ${fresh.status === 'success' ? 'confirmed' : fresh.status}`);
      Object.assign(tx, fresh);
      if (bridge && bridge.status === 'pending') {
        const b = await resolveBridgeTx(chainId, tx.hash, sender).catch(() => null);
        if (b && b.status !== 'pending') toast(`Bridge transfer arrived on ${CHAIN[b.dstChain] ? CHAIN[b.dstChain].name : b.dstChain}`);
        if (b) bridge = b;
      }
      await render();
      if (settled(tx)) stop();
    }, LIVE_INTERVAL.tx, { chainId });
  }
}

function txView(tx, chain, price, bridge) {
  const c = chain.id;
  const party = p => {
    const ent = p.address ? entityOf(chain, p.address, p.entity, p.name) : null;
    return `<div class="io-row">${p.address ? link(c, 'address', p.address, p.name || (ent && ent.label) || null) : `<span class="muted">${esc(p.name || p.note || 'Unknown')}</span>`}
      ${ent && ent.category !== 'other' ? entityBadge(ent) : ''}
      ${p.note && p.address ? `<span class="chip small">${esc(p.note)}</span>` : ''}
      <span class="io-val">${p.value != null ? amount(p.value) : ''}</span></div>`;
  };
  const list = arr => arr.slice(0, 25).map(party).join('') + (arr.length > 25 ? `<div class="muted small">…and ${arr.length - 25} more</div>` : '') || '<div class="muted">—</div>';
  const exOut = tx.outputs.map(o => o.address && entityOf(chain, o.address, o.entity, o.name)).find(e => e && e.category === 'exchange');
  const exIn = tx.inputs.map(o => o.address && entityOf(chain, o.address, o.entity, o.name)).find(e => e && e.category === 'exchange');
  const dst = bridge && CHAIN[bridge.dstChain];
  const dstEnt = dst && bridge.recipient ? entityOf(dst, bridge.recipient) : null;
  return `
    ${exOut ? `<div class="notice flag ex">🏦 <b>Deposit to ${esc(exOut.name)}</b>: this transaction sends funds to ${esc(exOut.label)}.</div>` : ''}
    ${exIn ? `<div class="notice flag ex">🏦 <b>Withdrawal from ${esc(exIn.name)}</b>: funds come from ${esc(exIn.label)}.</div>` : ''}
    ${bridge ? `<div class="card bridge-card"><div class="section-head"><h2>${bridge.srcChain === bridge.dstChain ? '🔁 Swap via ' : bridge.dstChain ? '🌉 Cross-chain transfer via ' : '🔁 Swapped via '}${esc(bridge.app && bridge.app !== bridge.protocol ? `${bridge.app} (${bridge.protocol})` : bridge.protocol)}</h2>
        <span class="chip ${bridge.status === 'completed' ? 'ok' : bridge.status === 'failed' ? 'fail' : 'pend'}">${esc(bridge.status)}</span></div>
      <div class="bridge-route">
        <div>${chainLabel(bridge.srcChain)}<div class="small">${bridge.srcTx && CHAIN[bridge.srcChain] ? link(bridge.srcChain, 'tx', bridge.srcTx) : ''}</div></div>
        <div class="bridge-arrow">${bridge.amount != null ? `${amount(bridge.amount)} ${esc(bridge.symbol || '')}` : ''}${bridge.usd ? `<div class="muted small">${usd(bridge.usd)}</div>` : ''}<div>⟶</div></div>
        <div>${bridge.dstChain ? chainLabel(bridge.dstChain) : '<b>Unknown chain</b>'}<div class="small">${bridge.dstTx ? (dst ? link(bridge.dstChain, 'tx', bridge.dstTx) : esc(short(bridge.dstTx))) : bridge.dstChain === bridge.srcChain ? '<span class="chip ok">same chain</span>' : '<span class="chip pend">in flight</span>'}</div></div>
      </div>
      ${bridge.recipient ? `<p>Recipient on ${esc(dst ? dst.name : bridge.dstChain)}: ${dst ? link(bridge.dstChain, 'address', bridge.recipient, dstEnt ? dstEnt.label : null) : `<span class="mono">${esc(bridge.recipient)}</span>`} ${entityBadge(dstEnt)}
        ${dstEnt && dstEnt.category === 'exchange' ? '<b class="out">→ funds are going to an exchange</b>' : ''}
        ${dst ? ` <a class="btn ghost small-btn" href="#/investigate/${esc(bridge.dstChain)}/${encodeURIComponent(bridge.recipient)}">Follow this wallet →</a>` : ''}</p>` : ''}
      ${bridge.note ? `<p class="muted small">${esc(bridge.note)} ${bridge.link ? `<a href="${esc(bridge.link)}" target="_blank" rel="noopener">Open Chainflip explorer ↗</a>` : ''}</p>` : ''}
    </div>` : ''}
    <div class="card">
      <div class="card-head">${chainChip(chain)}<span class="chip">Transaction</span>${statusChip(tx.status)}
        ${tx.method ? `<span class="chip method">${esc(tx.method)}</span>` : ''}
        ${tx.status === 'pending' || (tx.confirmations != null && tx.confirmations < 100) || (bridge && bridge.status === 'pending') ? `<span class="live-badge"><span class="live-dot"></span>LIVE</span>` : ''}</div>
      <div class="mono break muted hash">${esc(tx.hash)} ${copyBtn(tx.hash)}</div>
      <div class="grid">
        ${stat('Value', `${amount(tx.value)} ${esc(chain.symbol)}`, price && tx.value ? usd(tx.value * price.usd) : '')}
        ${stat('Fee', tx.fee != null ? `${amount(tx.fee)} ${esc(chain.symbol)}` : '—', price && tx.fee ? usd(tx.fee * price.usd) : '')}
        ${stat('Block', tx.block != null ? esc(Number.isFinite(Number(tx.block)) ? Number(tx.block).toLocaleString() : tx.block) : 'Pending')}
        ${stat('Confirmations', tx.confirmations != null ? Number(tx.confirmations).toLocaleString() : '—')}
        ${stat('Time', tx.time ? timeCell(tx.time) : 'Pending', tx.time ? esc(new Date(tx.time).toLocaleString()) : '')}
      </div>
    </div>
    <div class="card"><h2>${chain.family === 'utxo' ? 'Inputs → Outputs' : 'From → To'}</h2>
      <div class="io">
        <div><div class="muted small">${tx.inputs.length} ${chain.family === 'utxo' ? 'input(s)' : 'sender(s)'}</div>${list(tx.inputs)}</div>
        <div class="io-arrow">→</div>
        <div><div class="muted small">${tx.outputs.length} ${chain.family === 'utxo' ? 'output(s)' : 'receiver(s)'}</div>${list(tx.outputs)}</div>
      </div></div>
    ${tx.transfers && tx.transfers.length ? `<div class="card"><h2>Token transfers <span class="muted">(${tx.transfers.length})</span></h2>
      <div class="table-scroll"><table><thead><tr><th>From</th><th></th><th>To</th><th class="r">Amount</th><th>Token</th></tr></thead><tbody>
      ${tx.transfers.map(t => {
        const te = entityOf(chain, t.to, t.toEntity, t.toName), fe = entityOf(chain, t.from, t.fromEntity, t.fromName);
        return `<tr><td>${link(c, 'address', t.from, t.fromName || (fe && fe.label) || null)} ${fe && fe.category !== 'other' ? entityBadge(fe) : ''}</td><td class="muted">→</td>
        <td>${link(c, 'address', t.to, t.toName || (te && te.label) || null)} ${te && te.category !== 'other' ? entityBadge(te) : ''}</td>
        <td class="r mono">${amount(t.amount)}</td><td><b>${esc(t.symbol)}</b>${isFakeToken({ ...t, chainId: c }) ? ' <span class="ent danger" title="This token imitates a real one (wrong contract or lookalike letters). It has no value."><span class="ent-i">⚠</span>Fake token</span>' : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>` : ''}
    ${tx.extra && tx.extra.length ? `<div class="card"><h2>Details</h2><dl class="details">
      ${tx.extra.map(x => `<dt>${esc(x.label)}</dt><dd class="break">${esc(x.value)}</dd>`).join('')}</dl></div>` : ''}`;
}

function renderAccountNav() {
  const el = document.getElementById('acct');
  const n = unreadAlerts();
  el.innerHTML = `<a class="bell" href="#/account" title="Flow alerts">🔔${n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}</a>
    <a class="hdr-link small" href="#/account" title="Watchlist, alerts, labels and saved investigations">📋 My workspace</a>`;
}
const loadMyLabels = async () => { try { setCustomLabels(await listLabels()); } catch { setCustomLabels([]); } };
window.addEventListener('alerts-changed', renderAccountNav);

document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied to clipboard')).catch(() => toast('Copy failed'));
});

function getRecent() {
  try { return JSON.parse(localStorage.getItem('recent') || '[]').filter(r => CHAIN[r.chainId]); } catch { return []; }
}
function addRecent(r) {
  try {
    const list = [r, ...getRecent().filter(x => x.href !== r.href)].slice(0, 6);
    localStorage.setItem('recent', JSON.stringify(list));
  } catch { }
}

document.getElementById('net-count').textContent = `${CHAINS.filter(c => !c.testnet).length} networks`;
initShell({ search: submitSearch, recent: getRecent });
renderAccountNav();
startMonitor();
loadMyLabels().finally(route);
(window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => loadLabels());
