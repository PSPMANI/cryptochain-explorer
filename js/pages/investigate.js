import { CHAIN, CHAINS } from '../chains.js';
import { ETHERSCAN_API_KEY } from '../config.js';
import { main, adapter, withTimeout, pool, toast, download } from '../core.js';
import { collect, analyze, toCSV } from '../investigate.js';
import { bridgeActivity } from '../crosschain.js';
import { depositCheck, entityBadge } from '../alerts.js';
import { known, CATEGORY_LABEL } from '../entities.js';
import { getPrices } from '../prices.js';
import { saveInvestigation, addWatch } from '../store.js';
import { esc, short, amount, usd, compact, identicon, chainDot, link, timeCell, dirChip } from '../ui.js';
import { chainLabel } from './shared.js';
import { prefetchLabels, hasLiveLabels } from '../labels-live.js';
import { mountTrace } from './tracegraph.js';
import { mountFinalDestinations } from './finaldest.js';
import { buildReport, trailCSV } from '../report.js';
import { balanceChart, volumeChart, hbarChart, heatmap, bindCharts } from '../charts.js';

const STEPS = ['Target', 'Collect', 'Classify', 'Money flow', 'Cross-chain', 'Report'];
const DEPTHS = [250, 500, 1000, 2500];
const CAT_COLOR = { exchange: 'var(--cat-exchange)', bridge: 'var(--cat-bridge)', dex: 'var(--cat-dex)', exploit: 'var(--cat-exploit)', other: 'var(--cat-other)', unlabeled: 'var(--cat-none)' };

const hasHistory = c => c.adapter !== 'evmrpc' || c.historyApi || ETHERSCAN_API_KEY;

export async function investigatePage(chainsParam, address, params, stale) {
  const requested = (chainsParam || '').split(',').filter(id => CHAIN[id]);
  if (!requested.length || !address) { main.innerHTML = '<div class="card error">Open Investigate from an address page.</div>'; return; }
  const first = CHAIN[requested[0]];
  const evm = first.family === 'evm';
  let depth = DEPTHS.includes(Number(params.get('depth'))) ? Number(params.get('depth')) : 500;
  document.title = `Investigate ${short(address)} · CryptChain`;

  main.innerHTML = `
    <div class="stepper" id="stepper">${STEPS.map((s, i) => `<div class="step" data-i="${i}"><span>${i + 1}</span>${s}</div>`).join('')}</div>
    <div class="card" id="setup">
      <div class="identity">${identicon(address)}<div class="grow"><div class="name" id="inv-name">Investigation</div>
        <div class="mono break muted">${esc(address)}</div></div></div>
      <h2>Networks to analyze</h2>
      <div id="chain-pick" class="chain-pick"><div class="loading"><div class="spinner"></div>Finding where this wallet is active…</div></div>
      <div class="row-gap setup-row">
        <label>Depth <select id="depth">${DEPTHS.map(d => `<option value="${d}" ${d === depth ? 'selected' : ''}>${d.toLocaleString()} transfers per network</option>`).join('')}</select></label>
        <button class="btn" id="run" disabled>Run investigation</button>
      </div>
    </div>
    <div id="progress"></div>
    <div id="report"></div>`;
  setStep(0);

  const pick = document.getElementById('chain-pick');
  const runBtn = document.getElementById('run');
  const autoRun = params.get('run') === '1';
  let named = null;
  const opt = (c, info) => `<label class="chain-opt" style="--c:${c.color}" data-chain="${c.id}">
      <input type="checkbox" value="${c.id}" ${requested.includes(c.id) ? 'checked' : ''}>
      ${chainDot(c)} <b>${esc(c.name)}</b>
      <span class="muted small">${info ? `${amount(info.balance)} ${esc(c.symbol)}${info.txCount ? ` · ${compact(info.txCount)} txs` : ''}` : 'checking…'}</span></label>`;
  pick.innerHTML = requested.map(id => opt(CHAIN[id], null)).join('')
    + (evm && !autoRun ? `<div class="muted small scan-note"><span class="spinner"></span> Checking other EVM networks for activity…</div>` : '');
  runBtn.disabled = false;
  document.getElementById('depth').onchange = e => { depth = Number(e.target.value); };

  const start = () => {
    const chainIds = [...pick.querySelectorAll('input:checked')].map(i => i.value);
    if (!chainIds.length) return toast('Pick at least one network');
    runBtn.disabled = true;
    run(chainIds, address, depth, named, stale).finally(() => { if (!stale()) runBtn.disabled = false; });
  };
  runBtn.onclick = start;

  const setName = (c, info) => {
    const n = info.name || (known(c, address) || {}).label;
    if (n && !named) { named = n; document.getElementById('inv-name').textContent = n; }
  };
  requested.forEach(async id => {
    const info = await withTimeout((await adapter(id)).getAddress(address), 15000).catch(() => null);
    if (stale() || !info) return;
    setName(CHAIN[id], info);
    const el = pick.querySelector(`[data-chain="${id}"] .muted`);
    if (el) el.textContent = `${amount(info.balance)} ${CHAIN[id].symbol}${info.txCount ? ` · ${compact(info.txCount)} txs` : ''}`;
  });
  if (autoRun) { start(); return; }

  if (evm) {
    const others = CHAINS.filter(c => c.family === 'evm' && !c.testnet && hasHistory(c) && !requested.includes(c.id));
    let foundOthers = 0;
    await pool(others, 8, async c => {
      try {
        const info = await withTimeout((await adapter(c.id)).getAddress(address), 10000);
        if (stale() || !info.active) return;
        setName(c, info);
        foundOthers++;
        pick.querySelector('.scan-note').insertAdjacentHTML('beforebegin', opt(c, info));
      } catch { }
    });
    if (stale()) return;
    pick.querySelector('.scan-note').innerHTML = `${foundOthers ? `Also active on ${foundOthers} other network${foundOthers > 1 ? 's' : ''}; tick them to include.` : 'Not active on other EVM networks with history support.'}
      Networks with only public RPC (BNB Chain, Gnosis, …) need an indexer key for history, so they aren't listed.`;
  }
}

function setStep(n, done = false) {
  document.querySelectorAll('#stepper .step').forEach(s => {
    const i = Number(s.dataset.i);
    s.classList.toggle('done', i < n || (done && i === n));
    s.classList.toggle('active', i === n && !done);
  });
}

async function run(chainIds, address, depth, name, stale) {
  const prog = document.getElementById('progress');
  const report = document.getElementById('report');
  report.innerHTML = '';
  setStep(1);
  prog.innerHTML = `<div class="card"><h2>Collecting history</h2>${chainIds.map(id => `
    <div class="prog-row" id="prog-${id}">${chainDot(CHAIN[id])}<span class="prog-name">${esc(CHAIN[id].name)}</span>
      <div class="bar"><div style="width:0%"></div></div><span class="muted small prog-txt">waiting…</span></div>`).join('')}
    <div class="prog-row">🌉<span class="prog-name">Bridges</span><div class="bar"><div class="indet"></div></div><span class="muted small" id="prog-bridge">Across · LayerZero · Wormhole…</span></div></div>`;

  const bridgesP = bridgeActivity(address, 50).catch(() => []).then(b => {
    const el = document.getElementById('prog-bridge');
    if (el) { el.textContent = `${b.length} bridge transfer${b.length === 1 ? '' : 's'}`; el.previousElementSibling.firstElementChild.className = 'full'; }
    return b;
  });
  const items = [], errors = [];
  await pool(chainIds, 3, async id => {
    const row = document.getElementById('prog-' + id);
    const r = await collect(id, address, {
      maxItems: depth,
      shouldStop: stale,
      onProgress: p => {
        if (!row) return;
        row.querySelector('.bar div').style.width = `${Math.min(100, p.done ? 100 : (p.count / depth) * 100)}%`;
        row.querySelector('.prog-txt').textContent = `${p.count.toLocaleString()} ${p.stream}${p.done ? ' ✓' : '…'}`;
      },
    });
    items.push(...r.items);
    r.errors.forEach(e => errors.push(`${CHAIN[id].name}: ${e}`));
    if (row) { row.querySelector('.bar div').style.width = '100%'; row.querySelector('.prog-txt').textContent = `${r.items.length.toLocaleString()} transfers ✓`; }
  });
  if (stale()) return;

  setStep(2);
  for (const id of chainIds.filter(hasLiveLabels)) {
    const byValue = items.filter(t => t.chainId === id).sort((a, b) => (b.value || 0) - (a.value || 0));
    await prefetchLabels(id, byValue.map(t => (t.direction === 'out' ? t.to : t.from)), 40);
  }
  const prices = await getPrices();
  const model = analyze(items, address, prices);
  setStep(3);
  const bridges = await bridgesP;
  if (stale()) return;
  setStep(4);
  const infos = {};
  await Promise.all(chainIds.map(async id => { infos[id] = await withTimeout((await adapter(id)).getAddress(address), 15000).catch(() => null); }));
  const ctx = { address, name, chainIds, depth, errors, bridges, prices, infos };
  renderReport(report, model, ctx, stale);
  setStep(5, true);
  report.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReport(el, m, ctx, stale) {
  const t = m.totals;
  const cats = m.categories;
  const net = t.inUsd - t.outUsd;
  const exOut = cats.exchange.out, exIn = cats.exchange.in;
  const brOut = ctx.bridges.filter(b => b.direction === 'out').length, brIn = ctx.bridges.filter(b => b.direction === 'in').length;
  const useUsd = t.inUsd + t.outUsd > 0;
  const f = v => useUsd ? usd(v) || '$0' : `${Math.round(v)} transfers`;
  const val = (c, dir) => useUsd ? c[dir + 'Usd'] : c[dir === 'in' ? 'nIn' : 'nOut'];
  const catItems = dir => ['exchange', 'bridge', 'dex', 'exploit', 'other', 'unlabeled'].map(k => ({
    label: k === 'unlabeled' ? 'Unlabeled wallets' : k === 'other' ? 'Other labeled' : k === 'exploit' ? '⚠ Exploiters' : CATEGORY_LABEL[k] + 's',
    value: useUsd ? cats[k][dir] : 0, sub: `${cats[k].n} transfers`, color: `var(--cat-${k === 'unlabeled' ? 'none' : k})`,
  }));
  const cpItems = (list, dir) => list.slice(0, 8).map(c => ({
    label: (c.entity && c.entity.country === 'IN' ? '🇮🇳 ' : '') + (c.name || (c.entity && c.entity.label) || short(c.address)), value: val(c, dir),
    sub: `${CHAIN[c.chainId].name} · ${dir === 'in' ? c.nIn : c.nOut} tx`,
    color: `var(--cat-${c.entity ? (['exchange', 'bridge', 'dex', 'exploit'].includes(c.entity.category) ? c.entity.category : 'other') : 'none'})`,
    href: `#/${c.chainId}/address/${encodeURIComponent(c.address)}`,
  }));
  const vol = volumeBuckets(m.timeline);
  const bal = balanceSeries(m.rows, ctx);

  el.innerHTML = `
    ${ctx.errors.length ? `<div class="notice warn">Some data could not be loaded: ${esc(ctx.errors.join('; '))}</div>` : ''}
    ${m.warnings.filter(w => w.kind !== 'address-poisoning').map(w => `<div class="notice danger"><b>⚠ ${esc(w.title)}</b><div class="small break">${esc(w.detail)}</div></div>`).join('')}
    ${(p => p.length ? `<details class="notice danger"><summary><b>⚠ ${p.length} address-poisoning lookalike${p.length > 1 ? 's' : ''}</b>: fake addresses that imitate real counterparties. Never copy addresses from history.</summary>
      <div class="small break">${p.map(w => `${esc(w.address)} imitates ${esc(w.real)}`).join('<br>')}</div></details>` : '')(m.warnings.filter(w => w.kind === 'address-poisoning'))}
    <nav class="rep-nav" aria-label="Report sections">
      ${[['overview', 'Overview'], ['report', '📄 Report'], ['final', 'Where it ended up'], ['trace', 'Explore hops'], ['charts', 'Charts'], ['cp', 'Counterparties'], ['xchain', 'Cross-chain'], ['assets', 'Assets'], ['tx', 'Transfers']]
        .map(([k, l], i) => `<button data-sec="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}
    </nav>

    <section class="card" id="sec-overview">
      <div class="section-head"><h2>Overview</h2>
        <div class="row-gap"><button class="btn small-btn" id="go-report">📄 Report</button><button class="btn ghost small-btn" id="save">💾 Save</button><button class="btn ghost small-btn" id="watch">👁 Watch</button><button class="btn ghost small-btn" id="csv">⬇ CSV</button></div></div>
      <div class="kpis">
        <div class="kpi hero"><div class="k">Net flow</div><div class="v ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${usd(Math.abs(net)) || '$0'}</div>
          <div class="sub">${usd(t.inUsd) || '$0'} received · ${usd(t.outUsd) || '$0'} sent</div></div>
        <div class="kpi"><div class="k">Received</div><div class="v">${usd(t.inUsd) || '$0'}</div><div class="sub">${m.rows.filter(r => r.direction === 'in').length} transfers</div></div>
        <div class="kpi"><div class="k">Sent</div><div class="v">${usd(t.outUsd) || '$0'}</div><div class="sub">${m.rows.filter(r => r.direction === 'out').length} transfers</div></div>
        <div class="kpi"><div class="k">🏦 Sent to exchanges</div><div class="v">${usd(exOut) || '$0'}</div><div class="sub">${usd(exIn) || '$0'} received from exchanges</div></div>
        <div class="kpi"><div class="k">🇮🇳 Indian exchanges</div><div class="v">${usd(m.india.out) || '$0'} sent</div>
          <div class="sub">${usd(m.india.in) || '$0'} received · ${Object.keys(m.india.byExchange).join(', ') || 'none'}</div></div>
        ${m.categories.exploit.n ? `<div class="kpi danger"><div class="k">⚠ Hack / exploit wallets</div><div class="v">${m.categories.exploit.n} transfers</div>
          <div class="sub">${usd(m.categories.exploit.in) || '$0'} in · ${usd(m.categories.exploit.out) || '$0'} out</div></div>` : ''}
        <div class="kpi"><div class="k">🌉 Bridge transfers</div><div class="v">${brOut} out · ${brIn} in</div><div class="sub">Across · LayerZero · Wormhole</div></div>
        <div class="kpi"><div class="k">Counterparties</div><div class="v">${t.counterparties.toLocaleString()}</div>
          <div class="sub">${t.first ? `${new Date(t.first).toLocaleDateString()} – ${new Date(t.last).toLocaleDateString()}` : '—'}</div></div>
      </div>
      <p class="muted small">${ctx.chainIds.length} network${ctx.chainIds.length > 1 ? 's' : ''} · up to ${ctx.depth} transfers each. USD values use current prices for native coins and stablecoins; unpriced tokens count as $0.</p>
    </section>

    <section class="card" id="sec-report">
      <div class="section-head"><div><h2>📄 Report</h2>
        <p class="muted small">An easy-to-read report of this investigation for anyone: a plain-language summary, key findings, where the money ended up,
        the money trail hop by hop with timestamps, cross-chain transfers, counterparties and the complete transaction log. Opens in any browser; print it or save it as PDF.</p></div></div>
      <div class="row-gap report-actions">
        <button class="btn" id="rep-html">⬇ Download report (HTML)</button>
        <button class="btn ghost" id="rep-print">🖨 Open &amp; print / Save as PDF</button>
        <button class="btn ghost" id="rep-csv">⬇ All transactions (CSV)</button>
        <button class="btn ghost" id="rep-trail">⬇ Money trail (CSV)</button>
      </div>
      <p class="muted small" id="rep-note"></p>
    </section>

    <section class="card" id="sec-final">
      <div class="section-head"><div><h2>Where did all the money end up?</h2>
        <p class="muted small">Follows every dollar this wallet sent, hop after hop, across chains, until it reaches an exchange, a bridge, a DEX or a contract, or stays in a wallet. Runs automatically.</p></div></div>
      <div id="final-mount"></div>
    </section>

    <section class="card" id="sec-trace">
      <div class="section-head"><div><h2>Explore hop by hop</h2>
        <p class="muted small">Where the funds went next, hop by hop and across chains. Money stops at exchanges (🏦). Press ▶ Playback to watch every transfer in order, or ● Live to keep tracking.</p></div></div>
      <div id="trace-mount"></div>
    </section>

    <section id="sec-charts" class="chart-grid">
      <div class="card span-2"><div class="section-head"><h2>${esc(bal.symbol)} balance over time</h2><span class="muted small">${esc(CHAIN[bal.chainId].name)} · reconstructed from collected transfers</span></div>${balanceChart(bal.points, bal.symbol)}</div>
      <div class="card span-2"><div class="section-head"><h2>Volume per ${vol.unit}</h2><span class="muted small">${useUsd ? 'USD' : 'transfer count'}</span></div>${volumeChart(vol.buckets, useUsd, vol.unit)}</div>
      <div class="card"><h2>Where the money went</h2>${hbarChart(catItems('out'), f, { emptyText: 'No priced outgoing transfers.' })}</div>
      <div class="card"><h2>Where the money came from</h2>${hbarChart(catItems('in'), f, { emptyText: 'No priced incoming transfers.' })}</div>
      ${m.india.n ? `<div class="card span-2"><div class="section-head"><h2>🇮🇳 Indian exchanges</h2><span class="muted small">sent to (bar) · received from in tooltip</span></div>
        ${hbarChart(Object.entries(m.india.byExchange).sort((a, b) => (b[1].out + b[1].in) - (a[1].out + a[1].in)).map(([k, v]) => ({ label: '🇮🇳 ' + k, value: useUsd ? v.out + v.in : v.n, sub: `${usd(v.out) || '$0'} sent · ${usd(v.in) || '$0'} received`, color: 'var(--cat-exchange)', href: '#/exchanges/india' })), f)}</div>` : ''}
      <div class="card"><h2>Top destinations</h2>${hbarChart(cpItems(m.destinations, 'out'), f, { emptyText: 'No outgoing transfers.' })}</div>
      <div class="card"><h2>Top sources</h2>${hbarChart(cpItems(m.sources, 'in'), f, { emptyText: 'No incoming transfers.' })}</div>
      <div class="card span-2"><div class="section-head"><h2>Money flow</h2><span class="muted small">sources → wallet → destinations</span></div>
        <div class="flow-wrap">${flowSVG(m, ctx)}</div></div>
      <div class="card span-2"><div class="section-head"><h2>When is this wallet active?</h2><span class="muted small">transfers by weekday and hour (UTC)</span></div>${heatmap(m.rows)}</div>
    </section>

    <section class="card" id="sec-xchain"><div class="section-head"><h2>🌉 Cross-chain transfers <span class="muted">(${ctx.bridges.length})</span></h2></div>
      ${bridgeTable(ctx)}</section>

    <section class="card" id="sec-cp"><div class="section-head"><h2>Counterparties</h2><div class="tabs" id="cp-tabs">
      ${['all', 'india', 'exchange', 'bridge', 'dex', 'exploit', 'unlabeled'].map(k => `<button data-k="${k}" class="${k === 'all' ? 'active' : ''}">${k === 'all' ? 'All' : k === 'india' ? '🇮🇳 India' : k === 'unlabeled' ? 'Unlabeled' : k === 'exploit' ? '⚠ Exploiters' : CATEGORY_LABEL[k]}</button>`).join('')}</div></div>
      <div class="table-scroll"><table><thead><tr><th>Counterparty</th><th>Network</th><th class="r">Received from</th><th class="r">Sent to</th><th class="r">Txs</th><th>Last</th><th></th></tr></thead><tbody id="cp-rows"></tbody></table></div>
      <div class="more" id="cp-more"></div></section>

    <section class="card" id="sec-assets"><h2>Assets</h2><div class="table-scroll"><table><thead><tr><th>Asset</th><th>Network</th><th class="r">Received</th><th class="r">Sent</th><th class="r">Net</th><th class="r">Value moved</th></tr></thead><tbody>
      ${m.assets.slice(0, 30).map(a => `<tr><td><b>${esc(a.symbol)}</b>${a.token ? ` <span class="muted small mono">${esc(short(a.token, 4))}</span>` : ''}</td><td>${chainDot(CHAIN[a.chainId])} ${esc(CHAIN[a.chainId].name)}</td>
        <td class="r in">${amount(a.in)}</td><td class="r out">${amount(a.out)}</td><td class="r">${amount(a.in - a.out)}</td><td class="r muted">${usd(a.inUsd + a.outUsd)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No transfers.</td></tr>'}
      </tbody></table></div></section>

    <section class="card" id="sec-tx"><div class="section-head"><h2>All transfers <span class="muted">(${m.rows.length.toLocaleString()})</span></h2>
      <div class="row-gap filters"><select id="f-dir"><option value="">Both directions</option><option value="in">Incoming</option><option value="out">Outgoing</option></select>
      <select id="f-cat"><option value="">All counterparties</option><option value="india">🇮🇳 Indian exchanges</option><option value="exchange">Exchanges</option><option value="bridge">Bridges</option><option value="dex">DEXs</option><option value="unlabeled">Unlabeled</option></select>
      <input id="f-q" placeholder="Filter by address, asset, label" autocomplete="off"></div></div>
      <div class="table-scroll"><table><thead><tr><th>Time</th><th>Network</th><th></th><th class="r">Amount</th><th class="r">USD</th><th>Counterparty</th><th>Tx</th></tr></thead><tbody id="tx-rows"></tbody></table></div>
      <div class="more" id="tx-more"></div></section>`;

  bindCharts(el);
  const finalApi = mountFinalDestinations(el.querySelector('#final-mount'), m, ctx, stale);

  const site = location.origin + location.pathname;
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `cryptchain-report-${short(ctx.address, 4).replace('…', '-')}-${stamp}`;
  const reportHTML = () => {
    const tr = finalApi && finalApi.latest();
    const note = document.getElementById('rep-note');
    note.textContent = tr && tr.running ? 'The full money trace is still running: the report includes what has been traced so far. Download again when it finishes for the complete picture.' : '';
    return buildReport(m, ctx, tr && tr.sum && tr.sum.total ? tr : null, site);
  };
  el.querySelector('#rep-html').onclick = () => { download(`${base}.html`, reportHTML(), 'text/html'); toast('Report downloaded'); };
  el.querySelector('#rep-print').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print, or use Download and open the file'); return; }
    w.document.open(); w.document.write(reportHTML()); w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);
  };
  el.querySelector('#rep-csv').onclick = () => download(`${base}-transactions.csv`, toCSV(m.rows));
  el.querySelector('#rep-trail').onclick = () => {
    const tr = finalApi && finalApi.latest();
    if (!tr) return toast('The money trace has not started yet');
    download(`${base}-money-trail.csv`, trailCSV(tr.tr));
  };
  el.querySelector('#go-report').onclick = () => document.getElementById('sec-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  mountTrace(el.querySelector('#trace-mount'), {
    root: { chainId: ctx.chainIds[0], address: ctx.address, label: ctx.name || short(ctx.address) },
    prices: ctx.prices, model: m, bridges: ctx.bridges, stale,
  });

  const nav = el.querySelector('.rep-nav');
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-sec]');
    if (b) document.getElementById('sec-' + b.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const io = new IntersectionObserver(entries => {
    const vis = entries.filter(x => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (vis) nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', 'sec-' + b.dataset.sec === vis.target.id));
  }, { rootMargin: '-120px 0px -60% 0px' });
  el.querySelectorAll('section[id^="sec-"]').forEach(s => io.observe(s));

  let cpFilter = 'all', cpShown = 25;
  const cpMatch = c => cpFilter === 'all' || (cpFilter === 'unlabeled' ? !c.entity : cpFilter === 'india' ? c.entity && c.entity.country === 'IN' : c.entity && c.entity.category === cpFilter);
  const renderCps = () => {
    const list = m.counterparties.filter(cpMatch);
    document.getElementById('cp-rows').innerHTML = list.slice(0, cpShown).map((c, i) => `<tr>
      <td>${link(c.chainId, 'address', c.address, c.name || (c.entity && c.entity.label) || null)} ${entityBadge(c.entity)}
        ${c.poison ? `<span class="ent danger" title="Imitates ${esc(c.poison)}">⚠ Lookalike</span>` : ''}</td>
      <td>${chainDot(CHAIN[c.chainId])}</td>
      <td class="r in">${c.nIn ? usd(c.inUsd) || '—' : ''}</td><td class="r out">${c.nOut ? usd(c.outUsd) || '—' : ''}</td>
      <td class="r">${c.nIn + c.nOut}</td><td>${timeCell(c.last)}</td>
      <td class="r">${c.checking ? '<span class="muted small"><span class="spinner tiny"></span> Checking…</span>' : c.checked && !c.entity ? '<span class="muted small">✓ Not an exchange</span>' : !c.entity && !c.poison && CHAIN[c.chainId].family !== 'utxo' ? `<button class="btn ghost small-btn" data-check="${i}" title="Is this an exchange deposit address?">Check</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">None.</td></tr>';
    const more = document.getElementById('cp-more');
    more.innerHTML = list.length > cpShown ? `<button class="btn ghost">Show more (${list.length - cpShown})</button>` : '';
    if (more.firstChild) more.firstChild.onclick = () => { cpShown += 50; renderCps(); };
    document.querySelectorAll('#cp-rows [data-check]').forEach(b => b.onclick = async () => {
      const c = list[Number(b.dataset.check)];
      b.disabled = true; b.textContent = '…';
      const dep = await depositCheck(c.chainId, c.address);
      if (stale()) return;
      if (dep) { c.entity = dep; renderCps(); toast(`${short(c.address)} looks like a ${dep.name} deposit address`); }
      else { b.textContent = 'Not an exchange'; }
    });
  };
  document.querySelectorAll('#cp-tabs button').forEach(b => b.onclick = () => {
    cpFilter = b.dataset.k; cpShown = 25;
    document.querySelectorAll('#cp-tabs button').forEach(x => x.classList.toggle('active', x === b));
    renderCps();
  });
  renderCps();

  const autoTargets = m.counterparties.filter(c => !c.entity && !c.poison && c.nOut && CHAIN[c.chainId].family !== 'utxo')
    .sort((a, b) => b.outUsd - a.outUsd).slice(0, 12);
  autoTargets.forEach(c => { c.checking = true; });
  if (autoTargets.length) renderCps();
  pool(autoTargets, 2, async c => {
    const dep = await depositCheck(c.chainId, c.address).catch(() => null);
    c.checking = false; c.checked = true;
    if (dep) c.entity = dep;
    if (!stale()) renderCps();
  });
  setTimeout(() => { if (!stale()) el.querySelectorAll('[data-dcheck]').forEach((b, i) => { if (i < 8) b.click(); }); }, 500);

  let txShown = 100;
  const renderTxs = () => {
    const dir = document.getElementById('f-dir').value, cat = document.getElementById('f-cat').value, q = document.getElementById('f-q').value.trim().toLowerCase();
    const list = m.rows.filter(r => (!dir || r.direction === dir)
      && (!cat || (cat === 'unlabeled' ? !r.entity : cat === 'india' ? r.entity && r.entity.country === 'IN' : r.entity && r.entity.category === cat))
      && (!q || [r.counterparty, r.symbol, r.hash, r.entity && r.entity.label, r.cpName].some(v => v && String(v).toLowerCase().includes(q))));
    document.getElementById('tx-rows').innerHTML = list.slice(0, txShown).map(r => `<tr>
      <td>${timeCell(r.time)}</td><td>${chainDot(CHAIN[r.chainId])}</td><td>${dirChip(r.direction)}</td>
      <td class="r ${r.direction}">${amount(r.value)} <span class="muted">${esc(r.symbol)}</span></td>
      <td class="r muted">${r.usdValue != null ? usd(r.usdValue) : ''}</td>
      <td>${link(r.chainId, 'address', r.counterparty, r.cpName || (r.entity && r.entity.label) || null)} ${entityBadge(r.entity)}</td>
      <td>${link(r.chainId, 'tx', r.hash)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No matching transfers.</td></tr>';
    const more = document.getElementById('tx-more');
    more.innerHTML = list.length > txShown ? `<button class="btn ghost">Show more (${(list.length - txShown).toLocaleString()})</button>` : '';
    if (more.firstChild) more.firstChild.onclick = () => { txShown += 200; renderTxs(); };
  };
  ['f-dir', 'f-cat'].forEach(id => { document.getElementById(id).onchange = () => { txShown = 100; renderTxs(); }; });
  document.getElementById('f-q').oninput = () => { txShown = 100; renderTxs(); };
  renderTxs();

  document.getElementById('csv').onclick = () => download(`cryptchain-${short(ctx.address, 4).replace('…', '-')}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(m.rows));
  document.getElementById('save').onclick = async () => {
    try {
      await saveInvestigation({ address: ctx.address, chain_ids: ctx.chainIds, params: { depth: ctx.depth },
        summary: { name: ctx.name || null, inUsd: m.totals.inUsd, outUsd: m.totals.outUsd, count: m.totals.count, exchangeOutUsd: m.categories.exchange.out, bridges: ctx.bridges.length } });
      toast('Investigation saved to your account');
    } catch (e) { toast(e.message); }
  };
  document.getElementById('watch').onclick = async () => {
    try { for (const id of ctx.chainIds) await addWatch(id, ctx.address, ctx.name || ''); toast(`Watching on ${ctx.chainIds.length} network(s). Alerts will appear in your account.`); }
    catch (e) { toast(e.message); }
  };
}

function bridgeTable(ctx) {
  if (!ctx.bridges.length) return '<p class="muted">No bridge transfers found for this wallet in Across, LayerZero or Wormhole. Bridge contracts it interacted with directly still appear under Counterparties → Bridges.</p>';
  return `<div class="table-scroll"><table><thead><tr><th>Time</th><th>Protocol</th><th>Route</th><th class="r">Amount</th><th>Other side</th><th>Status</th><th>Txs</th></tr></thead><tbody>
    ${ctx.bridges.map(b => {
      const otherChain = b.direction === 'out' ? b.dstChain : b.srcChain;
      const other = b.direction === 'out' ? b.recipient : b.sender;
      const ent = other && CHAIN[otherChain] ? known(CHAIN[otherChain], other) : null;
      const self = other && other.toLowerCase() === ctx.address.toLowerCase();
      return `<tr><td>${timeCell(b.time)}</td>
        <td><b>${esc(b.protocol)}</b>${b.app && b.app !== b.protocol ? `<div class="muted small">${esc(b.app)}</div>` : ''}</td>
        <td>${chainLabel(b.srcChain)} → ${chainLabel(b.dstChain)} ${dirChip(b.direction)}</td>
        <td class="r">${b.amount != null ? `${amount(b.amount)} ${esc(b.symbol || '')}` : '—'}${b.usd ? `<div class="muted small">${usd(b.usd)}</div>` : ''}</td>
        <td>${other ? (CHAIN[otherChain] ? link(otherChain, 'address', other, self ? 'Same wallet' : null) : `<span class="mono">${esc(short(other))}</span>`) : '<span class="muted">—</span>'} ${entityBadge(ent)}
          ${other && !self && !ent && CHAIN[otherChain] && CHAIN[otherChain].family !== 'utxo' ? `<button class="btn ghost small-btn" data-dcheck="${esc(otherChain)}|${esc(other)}">Check</button>` : ''}</td>
        <td><span class="chip ${b.status === 'completed' ? 'ok' : b.status === 'failed' ? 'fail' : 'pend'}">${esc(b.status)}</span></td>
        <td class="small">${b.srcTx ? (CHAIN[b.srcChain] ? link(b.srcChain, 'tx', b.srcTx) : esc(short(b.srcTx))) : ''}${b.dstTx ? '<br>→ ' + (CHAIN[b.dstChain] ? link(b.dstChain, 'tx', b.dstTx) : esc(short(b.dstTx))) : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-dcheck]');
  if (!b) return;
  const [chainId, addr] = b.dataset.dcheck.split('|');
  b.disabled = true; b.textContent = '…';
  const dep = await depositCheck(chainId, addr);
  b.outerHTML = dep ? entityBadge(dep) : '<span class="muted small">Not an exchange</span>';
});

function flowSVG(m, ctx) {
  const useUsd = m.totals.inUsd + m.totals.outUsd > 0;
  const N = 7;
  const v = (c, dir) => useUsd ? c[dir + 'Usd'] : c[dir === 'in' ? 'nIn' : 'nOut'];
  const side = (list, dir) => {
    const top = list.filter(c => v(c, dir) > 0).slice(0, N);
    const rest = list.filter(c => v(c, dir) > 0).slice(N);
    const nodes = top.map(c => ({ c, val: v(c, dir), label: c.name || (c.entity && c.entity.label) || short(c.address), cat: c.entity ? (CAT_COLOR[c.entity.category] ? c.entity.category : 'other') : 'unlabeled' }));
    if (rest.length) nodes.push({ c: null, val: rest.reduce((s, c) => s + v(c, dir), 0), label: `${rest.length} others`, cat: 'unlabeled' });
    return nodes;
  };
  const L = side(m.sources, 'in'), R = side(m.destinations, 'out');
  if (!L.length && !R.length) return '<p class="muted">No value moved in the collected history.</p>';
  const W = 960, gap = 10, top = 16;
  const H = Math.max(280, Math.max(L.length, R.length) * 52 + top * 2);
  const avail = Math.max(80, H - top * 2 - gap * Math.max(L.length, R.length) - 32 * Math.max(0, Math.max(L.length, R.length) - 2));
  const sumL = L.reduce((s, n) => s + n.val, 0), sumR = R.reduce((s, n) => s + n.val, 0);
  const scale = avail / Math.max(sumL, sumR, 1e-9);
  const fmt = x => useUsd ? usd(x) : `${Math.round(x)} tx`;
  const cx0 = 455, cx1 = 505, lx = 215, rx = 745;
  const cH = Math.max(sumL, sumR) * scale, cy = (H - cH) / 2;

  const SLOT = 32;
  const place = (nodes) => {
    const total = nodes.reduce((s, n) => s + Math.max(SLOT, n.val * scale) + gap, 0);
    let y = Math.max(top, (H - total) / 2);
    return nodes.map(n => { const h = Math.max(3, n.val * scale); const r = { ...n, y, h }; y += Math.max(SLOT, h) + gap; return r; });
  };
  const band = (x0, y0, h0, x1, y1, h1, color, title) => {
    const mx = (x0 + x1) / 2;
    return `<path d="M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h1} C${mx},${y1 + h1} ${mx},${y0 + h0} ${x0},${y0 + h0} Z" fill="${color}" fill-opacity=".32"><title>${esc(title)}</title></path>`;
  };
  const node = (n, x, anchorRight, dir) => {
    const href = n.c ? `#/${n.c.chainId}/address/${encodeURIComponent(n.c.address)}` : null;
    const tx = anchorRight ? x - 8 : x + 18;
    const text = `<text x="${tx}" y="${n.y + n.h / 2 - 2}" text-anchor="${anchorRight ? 'end' : 'start'}" class="fl-label">${esc(n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label)}</text>
      <text x="${tx}" y="${n.y + n.h / 2 + 12}" text-anchor="${anchorRight ? 'end' : 'start'}" class="fl-val">${esc(fmt(n.val))}${n.c && n.c.entity && n.c.entity.category !== 'other' ? ' · ' + esc(CATEGORY_LABEL[n.c.entity.category]) : ''}</text>`;
    const rect = `<rect x="${x}" y="${n.y}" width="10" height="${n.h}" rx="2" fill="${CAT_COLOR[n.cat]}"><title>${esc(n.label)}: ${esc(fmt(n.val))} ${dir}</title></rect>`;
    return href ? `<a href="${href}">${rect}${text}</a>` : rect + text;
  };

  const Lp = place(L), Rp = place(R);
  let ly = cy, ry = cy;
  const offL = (cH - sumL * scale) / 2, offR = (cH - sumR * scale) / 2;
  ly += offL; ry += offR;
  const bandsL = Lp.map(n => { const h = n.val * scale; const s = band(lx + 10, n.y, n.h, cx0, ly, h, CAT_COLOR[n.cat], `${n.label} → wallet: ${fmt(n.val)}`); ly += h; return s; }).join('');
  const bandsR = Rp.map(n => { const h = n.val * scale; const s = band(cx1, ry, h, rx, n.y, n.h, CAT_COLOR[n.cat], `wallet → ${n.label}: ${fmt(n.val)}`); ry += h; return s; }).join('');
  const centerName = ctx.name || short(ctx.address);
  return `<svg class="flow" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money flow diagram">
    <text x="${lx + 5}" y="11" text-anchor="middle" class="fl-head">SOURCES · ${esc(fmt(sumL))}</text>
    <text x="${rx + 5}" y="11" text-anchor="middle" class="fl-head">DESTINATIONS · ${esc(fmt(sumR))}</text>
    ${bandsL}${bandsR}
    <rect x="${cx0}" y="${cy}" width="${cx1 - cx0}" height="${Math.max(cH, 4)}" rx="4" class="fl-center"/>
    <text x="${(cx0 + cx1) / 2}" y="${cy - 8}" text-anchor="middle" class="fl-label strong">${esc(centerName)}</text>
    ${Lp.map(n => node(n, lx, true, 'received')).join('')}
    ${Rp.map(n => node(n, rx, false, 'sent')).join('')}
  </svg>`;
}

function volumeBuckets(days) {
  if (days.length <= 120) return { buckets: days, unit: 'day' };
  const wk = new Map();
  for (const d of days) {
    const dt = new Date(d.day); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const k = dt.toISOString().slice(0, 10);
    const b = wk.get(k) || { day: k, inUsd: 0, outUsd: 0, nIn: 0, nOut: 0 };
    b.inUsd += d.inUsd; b.outUsd += d.outUsd; b.nIn += d.nIn; b.nOut += d.nOut;
    wk.set(k, b);
  }
  return { buckets: [...wk.values()].sort((a, b) => a.day.localeCompare(b.day)), unit: 'week' };
}

function balanceSeries(rows, ctx) {
  const chainId = ctx.chainIds[0], chain = CHAIN[chainId];
  const info = ctx.infos && ctx.infos[chainId];
  const native = rows.filter(r => r.chainId === chainId && !r.token && r.symbol === chain.symbol && r.time).sort((a, b) => b.time - a.time);
  if (!info || !native.length) return { chainId, symbol: chain.symbol, points: [] };
  let bal = info.balance;
  const pts = [{ t: Date.now(), v: bal }];
  for (const r of native) {
    pts.push({ t: r.time, v: bal });
    bal = r.direction === 'in' ? bal - r.value : bal + r.value + (r.fee || 0);
    if (bal < 0) bal = 0;
  }
  pts.push({ t: native[native.length - 1].time - 1, v: bal });
  return { chainId, symbol: chain.symbol, points: pts.reverse() };
}
