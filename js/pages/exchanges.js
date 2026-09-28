import { CHAIN } from '../chains.js';
import { DIRECTORY, COUNTRY, CATEGORY_LABEL, flag, loadLabels } from '../entities.js';
import { addWatch } from '../store.js';
import { main, adapter, pool, withTimeout, toast } from '../core.js';
import { getPrices, priceOf } from '../prices.js';
import { esc, short, amount, usd, identicon, link } from '../ui.js';

const ROLES = [
  ['Hot wallets', l => /hot wallet/i.test(l)],
  ['Cold wallets', l => /cold wallet/i.test(l)],
  ['Withdrawal wallets', l => /withdraw/i.test(l)],
  ['Deposits held at other exchanges', l => /(binance|coinbase|okx|kraken) deposit/i.test(l)],
  ['Customer deposit addresses', l => /deposit/i.test(l)],
  ['Gas suppliers & deposit funders', l => /gas supplier|funder/i.test(l)],
  ['Treasury & reserves', l => /treasury|reserve|multisig/i.test(l)],
  ['Deployers', l => /deployer/i.test(l)],
  ['Wallets', () => true],
];
const roleOf = (label, cat) => cat === 'exploit' ? '⚠ Hack / exploiter wallets' : ROLES.find(([, test]) => test(label))[0];
const CAT_ICON = { exchange: '🏦', fund: '🏢', custodian: '🏛', issuer: '💵' };

const WALLETS = new Map();
const addWallet = (name, address, category, label, chainId = 'ethereum') => {
  if (!WALLETS.has(name)) WALLETS.set(name, []);
  if (!WALLETS.get(name).some(w => w.address === address)) WALLETS.get(name).push({ address, category, label, chainId, role: roleOf(label, category) });
};
let nonEvmAdded = false;

export async function exchangesPage(stale, region = 'all', selected = null) {
  region = (region || 'all').toLowerCase();
  const extra = [];
  const { curated = [], ...nonEvm } = await loadLabels();
  if (!nonEvmAdded) {
    for (const [address, name, category, label] of curated) addWallet(name, address, category, label);
    for (const [chainId, rows] of Object.entries(nonEvm || {})) for (const [a, name, label] of rows) addWallet(name, a, 'exchange', label, chainId);
    nonEvmAdded = true;
  }
  const inDir = new Set(DIRECTORY.map(e => e.name));
  for (const name of WALLETS.keys()) if (!inDir.has(name)) extra.push({ name, category: 'exchange', country: null });
  const matchRegion = e => region === 'all' || (region === 'india' ? e.country === 'IN' : region === 'global' ? e.country === 'GLOBAL' : (e.country || '').toLowerCase() === region);
  const all = [...DIRECTORY, ...extra].map(e => ({ ...e, wallets: WALLETS.get(e.name) || [] }));
  const own = x => x.wallets.filter(w => w.category !== 'exploit').length;
  const list = all.filter(matchRegion).sort((a, b) => own(b) - own(a) || a.name.localeCompare(b.name));
  const sel = all.find(x => x.name.toLowerCase() === (selected || '').toLowerCase()) || null;
  const walletCount = list.reduce((s, x) => s + x.wallets.filter(w => w.category !== 'exploit').length, 0);
  const countries = [...new Set(all.map(e => e.country).filter(Boolean))].sort((a, b) => (COUNTRY[a] ? COUNTRY[a].name : a).localeCompare(COUNTRY[b] ? COUNTRY[b].name : b));
  const title = region === 'india' ? '🇮🇳 Indian exchanges' : region === 'all' ? '🌐 Exchanges & institutions' : `${flag(region.toUpperCase())} ${COUNTRY[region.toUpperCase()] ? COUNTRY[region.toUpperCase()].name : region}`;
  document.title = `${title} · CryptChain`;

  main.innerHTML = `
    <div class="card">
      <div class="section-head"><div><h2 class="page-title">${esc(title)}</h2>
        <p class="muted">${list.length} exchanges and institutions · ${walletCount.toLocaleString()} publicly labeled wallets (Open Labels Initiative, via Blockscout).
        CryptChain recognizes them in live alerts, destination checks, investigations and money trails on every EVM network.</p></div></div>
      <div class="row-gap ex-filters">
        <div class="tabs">${[['all', '🌐 All'], ['india', '🇮🇳 India'], ['us', '🇺🇸 US'], ['kr', '🇰🇷 Korea'], ['jp', '🇯🇵 Japan'], ['global', '🌐 Offshore']]
          .map(([k, l]) => `<a class="tab-link ${region === k ? 'active' : ''}" href="#/exchanges/${k}">${l}</a>`).join('')}</div>
        <select id="ex-country" aria-label="Country"><option value="">More countries…</option>${countries.map(c => `<option value="${c.toLowerCase()}" ${region === c.toLowerCase() ? 'selected' : ''}>${flag(c)} ${esc(COUNTRY[c] ? COUNTRY[c].name : c)}</option>`).join('')}</select>
        <select id="ex-type" aria-label="Type"><option value="">All types</option>${Object.keys(CAT_ICON).map(c => `<option value="${c}">${CAT_ICON[c]} ${esc(CATEGORY_LABEL[c])}</option>`).join('')}</select>
        <input class="filter-in" id="ex-filter" placeholder="Search by name" autocomplete="off">
      </div>
      <div class="ex-grid" id="ex-grid">${list.map(x => `
        <a class="ex-card ${sel && sel.name === x.name ? 'on' : ''}" href="#/exchanges/${region}/${encodeURIComponent(x.name)}" data-name="${esc(x.name.toLowerCase())}" data-cat="${x.category}">
          <div class="ex-top">${identicon(x.name, 36)}<div><b>${CAT_ICON[x.category] || ''} ${esc(x.name)}</b>
            <div class="muted small">${x.country ? `${flag(x.country)} ${esc(COUNTRY[x.country] ? COUNTRY[x.country].name : x.country)}` : ''} · ${esc(CATEGORY_LABEL[x.category] || 'Exchange')}</div></div></div>
          <div class="small">${x.wallets.some(w => w.category !== 'exploit') ? `<span class="chip ok">${(n => `${n} labeled wallet${n === 1 ? '' : 's'}`)(x.wallets.filter(w => w.category !== 'exploit').length)}</span>` : '<span class="chip">Name-based detection</span>'}
            ${x.wallets.some(w => w.category === 'exploit') ? '<span class="chip fail">⚠ exploit wallets</span>' : ''}</div>
          ${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}
        </a>`).join('') || '<p class="muted">No entities for this region.</p>'}</div>
    </div>
    <div id="ex-detail">${sel ? '' : '<p class="muted center">Select an exchange or institution to see its wallets.</p>'}</div>`;

  const applyFilters = () => {
    const q = document.getElementById('ex-filter').value.trim().toLowerCase();
    const t = document.getElementById('ex-type').value;
    document.querySelectorAll('.ex-card').forEach(c => { c.hidden = (q && !c.dataset.name.includes(q)) || (t && c.dataset.cat !== t); });
  };
  document.getElementById('ex-filter').oninput = applyFilters;
  document.getElementById('ex-type').onchange = applyFilters;
  document.getElementById('ex-country').onchange = e => { if (e.target.value) location.hash = `#/exchanges/${e.target.value}`; };
  if (sel) renderDetail(sel, stale);
}

function renderDetail(x, stale) {
  const el = document.getElementById('ex-detail');
  const groups = {};
  x.wallets.forEach(w => (groups[w.role] ||= []).push(w));
  const order = ['⚠ Hack / exploiter wallets', ...ROLES.map(r => r[0])].filter(r => groups[r]);
  const main = x.wallets.filter(w => ['Hot wallets', 'Wallets', 'Withdrawal wallets', 'Cold wallets', 'Treasury & reserves'].includes(w.role));
  const place = x.country ? `${flag(x.country)} ${COUNTRY[x.country] ? COUNTRY[x.country].name : x.country}` : '';
  const shown = w => [...(groups[w] || [])].sort((p, q) => (p.chainId === 'ethereum') - (q.chainId === 'ethereum') || p.chainId.localeCompare(q.chainId)).slice(0, 400);
  const nets = {};
  for (const w of x.wallets) if (w.category !== 'exploit') nets[w.chainId] = (nets[w.chainId] || 0) + 1;

  el.innerHTML = `
    <div class="card">
      <div class="section-head"><div><h2>${CAT_ICON[x.category] || ''} ${esc(x.name)}</h2>
        <div class="muted small">${esc(place)} · ${esc(CATEGORY_LABEL[x.category] || 'Exchange')}${x.site ? ' · ' + esc(x.site) : ''}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        ${x.wallets.length ? `<div class="row-gap"><button class="btn ghost small-btn" id="ex-bal">Load live balances</button>
          <button class="btn small-btn" id="ex-watch">👁 Watch ${Math.min(10, main.length)} main wallets</button></div>` : ''}</div>
      ${Object.keys(nets).length ? `<div class="row-gap net-chips">${Object.entries(nets).sort((p, q) => q[1] - p[1]).map(([c, n]) => `<span class="chip chain" style="--c:${CHAIN[c] ? CHAIN[c].color : '#888'}"><span class="dot" style="background:${CHAIN[c] ? CHAIN[c].color : '#888'}"></span>${esc(c === 'ethereum' ? 'EVM networks' : CHAIN[c] ? CHAIN[c].name : c)} · ${n}</span>`).join('')}</div>` : ''}
      ${x.wallets.length ? `<div class="grid" id="ex-totals"></div>` : `
        <div class="notice">No wallets of ${esc(x.name)} are publicly labeled yet. CryptChain still recognizes ${esc(x.name)} whenever an explorer label
        names it, and the deposit-address check catches funds swept into its wallets once one of them is labeled.</div>`}
      ${order.map(role => `
        <h3 class="${role.startsWith('⚠') ? 'out' : ''}">${esc(role)} <span class="muted">(${groups[role].length})</span></h3>
        ${role.startsWith('⚠') ? '<p class="small muted">Publicly flagged as belonging to an attacker. These are <b>not</b> the entity\'s wallets; transfers to or from them raise a ⚠ alert.</p>' : ''}
        <div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Network</th><th>Label</th><th class="r">ETH balance</th><th></th></tr></thead><tbody>
        ${shown(role).map(w => `<tr data-addr="${esc(w.address)}"><td>${link(w.chainId, 'address', w.address, short(w.address))}</td>
          <td class="small">${CHAIN[w.chainId] ? `<span class="dot" style="background:${CHAIN[w.chainId].color}"></span> ${esc(w.chainId === 'ethereum' ? 'EVM (all networks)' : CHAIN[w.chainId].name)}` : ''}</td><td>${esc(w.label)}</td>
          <td class="r bal muted">—</td>
          <td class="r"><a class="btn ghost small-btn" href="#/investigate/${w.chainId}/${encodeURIComponent(w.address)}">Investigate</a></td></tr>`).join('')}
        </tbody></table></div>${groups[role].length > 400 ? `<p class="muted small">…and ${groups[role].length - 400} more (all are recognized by the app).</p>` : ''}`).join('')}
      <p class="muted small">Addresses are EVM wallets: the same address is also this entity's on Base, Arbitrum, Polygon, BNB Chain and the other EVM networks.</p>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('ex-bal')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Loading…';
    const a = await adapter('ethereum');
    const p = priceOf(await getPrices(), CHAIN.ethereum);
    let total = 0, done = 0;
    const targets = x.wallets.filter(w => w.category !== 'exploit' && w.chainId === 'ethereum').slice(0, 120);
    await pool(targets, 4, async w => {
      const info = await withTimeout(a.getAddress(w.address), 15000).catch(() => null);
      if (stale()) return;
      const cell = el.querySelector(`tr[data-addr="${w.address}"] .bal`);
      if (info && cell) { cell.textContent = amount(info.balance); cell.classList.remove('muted'); total += info.balance; }
      done++;
      document.getElementById('ex-totals').innerHTML = `
        <div class="stat"><div class="k">ETH held in labeled wallets</div><div class="v">${amount(total)} ETH</div><div class="sub">${p ? usd(total * p.usd) : ''}</div></div>
        <div class="stat"><div class="k">Wallets checked</div><div class="v">${done} of ${targets.length}</div></div>`;
    });
    if (!stale()) e.target.textContent = 'Balances loaded';
  });

  document.getElementById('ex-watch')?.addEventListener('click', async () => {
    try {
      for (const w of main.slice(0, 10)) await addWatch(w.chainId, w.address, w.label);
      toast(`Watching ${Math.min(10, main.length)} ${x.name} wallets: alerts appear in your account`);
    } catch (err) { toast(err.message); }
  });
}
