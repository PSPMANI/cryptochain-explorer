import { CHAIN } from '../chains.js';
import { FullTrace } from '../fulltrace.js';
import { COUNTRY, flag, CATEGORY_LABEL } from '../entities.js';
import { mountTrace } from './tracegraph.js';
import { entityBadge } from '../alerts.js';
import { esc, short, usd, link } from '../ui.js';

const TYPES = {
  exchange: { label: 'Cashed in at exchanges', icon: '🏦', color: 'var(--cat-exchange)' },
  bridge: { label: 'Bridged out (destination unknown)', icon: '🌉', color: 'var(--cat-bridge)' },
  dex: { label: 'Swapped on DEXs', icon: '🔁', color: 'var(--cat-dex)' },
  contract: { label: 'Into contracts / tokens', icon: '📄', color: 'var(--cat-other)' },
  service: { label: 'Institutions & busy services', icon: '🏢', color: 'var(--cat-other)' },
  held: { label: 'Still held in wallets', icon: '👛', color: 'var(--cat-none)' },
  small: { label: 'Small amounts (not followed)', icon: '·', color: 'var(--cat-none)' },
  limit: { label: 'Not followed (limit reached)', icon: '⋯', color: 'var(--cat-none)' },
  error: { label: 'Could not load', icon: '⚠', color: 'var(--cat-none)' },
};
const ORDER = ['exchange', 'bridge', 'dex', 'contract', 'service', 'held', 'small', 'limit', 'error'];

export function mountFinalDestinations(el, m, ctx, stale) {
  let params = { maxHops: 10, maxWallets: 150, minUsd: 0, showAll: true };
  el.innerHTML = `
    <div class="ft-controls row-gap">
      <label>Max hops <select id="ft-hops">${[4, 6, 8, 10, 15, 20].map(h => `<option ${h === 10 ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <label>Wallets to follow <select id="ft-wallets">${[60, 150, 300, 500].map(w => `<option ${w === 150 ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
      <label>Follow amounts from <select id="ft-min"><option value="0">Auto</option><option value="1">$1</option><option value="10">$10</option><option value="100">$100</option><option value="1000">$1,000</option></select></label>
      <label class="chk"><input type="checkbox" id="ft-all" checked> Show every wallet in the graph</label>
      <button class="btn small-btn" id="ft-run">↻ Re-run</button><button class="btn ghost small-btn" id="ft-stop">■ Stop</button>
    </div>
    <div class="ft-progress"><div class="bar"><div id="ft-bar" style="width:0%"></div></div><div class="small muted" id="ft-status">Starting…</div></div>
    <div id="ft-more"></div>
    <div id="ft-summary"></div>
    <div id="ft-hops-table"></div>
    <div class="ft-graph"><h3>Every route the money took</h3><div id="ft-graph"></div></div>
    <div id="ft-geo"></div>
    <div id="ft-table"></div>`;

  let token = 0, graph = null, tr = null, stopped = false;
  const run = async () => {
    const my = ++token;
    stopped = false;
    const alive = () => my === token && !stale();
    tr = new FullTrace({ chainId: ctx.chainIds[0], address: ctx.address, label: ctx.name || short(ctx.address) },
      { prices: ctx.prices, maxHops: params.maxHops, maxWallets: params.maxWallets, minUsd: params.minUsd });
    graph = mountTrace(el.querySelector('#ft-graph'), { mode: 'full', trace: tr, stale: () => !alive(), showAll: () => params.showAll });
    el.querySelector('#ft-more').innerHTML = '';
    el.querySelector('#ft-summary').innerHTML = '';
    el.querySelector('#ft-table').innerHTML = '';
    let last = 0;
    const onProgress = p => {
        if (!alive()) return;
        const pct = p.total ? Math.min(100, (p.settled / p.total) * 100) : 100;
        el.querySelector('#ft-bar').style.width = pct + '%';
        el.querySelector('#ft-status').textContent = p.done
          ? `Done: followed ${p.wallets} wallets. All ${usd(p.total) || '$0'} sent by this wallet is accounted for below.`
          : `Following the money: hop ${p.hop} · ${p.wallets} wallets checked · ${usd(p.settled) || '$0'} of ${usd(p.total) || '$0'} traced to an end point (${pct.toFixed(0)}%)`;
        if (Date.now() - last > 1500 || p.done) { last = Date.now(); renderSummary(tr.summary()); }
    };
    const sum = await tr.run(m, { shouldStop: () => stopped || !alive(), onProgress });
    if (!alive()) return;
    finish(sum, my, onProgress);
  };

  function finish(sum, my, onProgress) {
    renderSummary(sum);
    renderHops(sum);
    renderTable(sum);
    renderGeo(sum);
    graph.fit();
    const more = el.querySelector('#ft-more');
    if (sum.notFollowed > 0.5) {
      more.innerHTML = `<div class="notice warn ft-continue"><b>${usd(sum.notFollowed)} (${((sum.notFollowed / (sum.total || 1)) * 100).toFixed(1)}%) hasn't been followed to the end yet.</b>
        The hop limit (${sum.maxHops}) or wallet limit (${sum.maxWallets}) was reached.
        <button class="btn small-btn" id="ft-deeper">Continue tracing deeper →</button></div>`;
      more.querySelector('#ft-deeper').onclick = async () => {
        more.innerHTML = '<div class="notice"><span class="spinner tiny"></span> Continuing from where the trace stopped…</div>';
        stopped = false;
        const next = await tr.resume({ maxHops: tr.maxHops + 5, maxWallets: tr.expanded + params.maxWallets, shouldStop: () => stopped || my !== token || stale(), onProgress });
        if (my === token && !stale()) finish(next, my, onProgress);
      };
    } else more.innerHTML = sum.total ? '<div class="notice ok-note">✓ Every dollar was followed to an end point (or is below the follow threshold).</div>' : '';
  }

  function renderHops(sum) {
    if (!sum.hops.length) { el.querySelector('#ft-hops-table').innerHTML = ''; return; }
    const cell = (row, t) => row.ended[t] ? `<span title="${esc(TYPES[t].label)}">${TYPES[t].icon} ${usd(row.ended[t])}</span>` : '';
    el.querySelector('#ft-hops-table').innerHTML = `<h3>Hop by hop</h3>
      <div class="table-scroll"><table class="hop-table"><thead><tr><th>Hop</th><th class="r">Wallets reached</th><th class="r">Money arriving</th><th>Ended at this hop</th><th class="r">Passed on to next hop</th></tr></thead><tbody>
      ${sum.hops.map(r => `<tr><td><b>Hop ${r.hop}</b></td><td class="r">${r.wallets}</td><td class="r">${usd(r.arrived) || '$0'}</td>
        <td class="small">${ORDER.map(t => cell(r, t)).filter(Boolean).join(' · ') || '—'}</td><td class="r">${usd(r.passedOn) || '$0'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function renderSummary(sum) {
    const total = sum.total || 1;
    const parts = ORDER.filter(t => sum.byType[t] > 0.005 * total || (sum.byType[t] && t === 'exchange'));
    el.querySelector('#ft-summary').innerHTML = !sum.total ? '<p class="muted">This wallet has no priced outgoing transfers to follow.</p>' : `
      <div class="ft-stack" role="img" aria-label="Final destinations of all money sent">
        ${parts.map(t => `<div class="seg-part" style="flex:${sum.byType[t]};background:${TYPES[t].color}" data-tip="${esc(usd(sum.byType[t]))} · ${((sum.byType[t] / total) * 100).toFixed(1)}%" data-tip-sub="${esc(TYPES[t].label)}"></div>`).join('')}
      </div>
      <div class="ft-legend">${parts.map(t => `<div class="ft-leg"><span class="sw" style="background:${TYPES[t].color}"></span>
        <span>${TYPES[t].icon} ${esc(TYPES[t].label)}</span><b>${usd(sum.byType[t]) || '$0'}</b><span class="muted">${((sum.byType[t] / total) * 100).toFixed(1)}%</span></div>`).join('')}</div>
      ${sum.exchanges.length ? `<h3>🏦 Exchanges that received the money</h3>
        <div class="ft-ex">${sum.exchanges.map(x => `<div class="ft-exrow"><span class="ft-exname">${x.country ? flag(x.country) + ' ' : ''}${esc(x.name)}</span>
          <span class="muted small">${x.country && COUNTRY[x.country] ? esc(COUNTRY[x.country].name) : ''}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${(x.usd / sum.exchanges[0].usd) * 100}%;background:var(--cat-exchange)"></div></div>
          <b>${usd(x.usd)}</b><span class="muted small">${((x.usd / total) * 100).toFixed(1)}%</span></div>`).join('')}</div>` : ''}
      ${sum.institutions && sum.institutions.length ? `<h3>🏢 Institutions that received the money</h3>
        <div class="ft-ex">${sum.institutions.map(x => `<div class="ft-exrow"><span class="ft-exname">${x.country ? flag(x.country) + ' ' : ''}${esc(x.name)}</span>
          <span class="muted small">${esc(CATEGORY_LABEL[x.category] || '')}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${(x.usd / sum.institutions[0].usd) * 100}%;background:var(--cat-other)"></div></div>
          <b>${usd(x.usd)}</b><span class="muted small">${((x.usd / total) * 100).toFixed(1)}%</span></div>`).join('')}</div>` : ''}`;
  }

  function renderTable(sum) {
    const total = sum.total || 1;
    const rows = sum.finals.filter(f => f.type !== 'small').slice(0, 60);
    el.querySelector('#ft-table').innerHTML = `<h3>Final destinations</h3>
      <div class="table-scroll"><table><thead><tr><th>Where the money ended</th><th>Network · location</th><th>Type</th><th class="r">Amount</th><th class="r">Share</th><th class="r">Hops</th><th></th></tr></thead><tbody>
      ${rows.map((f, i) => {
        const ch = CHAIN[f.chainId];
        const cc = f.entity && f.entity.country;
        return `<tr><td>${f.address && ch ? link(f.chainId, 'address', f.address, f.entity ? f.entity.label : null) : esc(f.label)} ${entityBadge(f.entity)}</td>
          <td class="small">${ch ? `<span class="dot" style="background:${ch.color}"></span> ${esc(ch.name)}` : ''}${cc && COUNTRY[cc] ? ` · ${flag(cc)} ${esc(COUNTRY[cc].name)}` : ''}</td>
          <td class="small">${TYPES[f.type].icon} ${esc(TYPES[f.type].label)}</td>
          <td class="r"><b>${usd(f.usd) || '<$1'}</b></td><td class="r muted">${((f.usd / total) * 100).toFixed(1)}%</td>
          <td class="r muted">${Math.min(...f.hops)}</td>
          <td class="r">${f.nodeId ? `<button class="btn ghost small-btn" data-path="${esc(f.nodeId)}">Show path</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div id="ft-path" class="ft-path"></div>
      <p class="muted small">Model: each wallet passes on traced money in proportion to what it sent after the money arrived, diluted by its other incoming funds;
      the rest counts as held. Amounts under ${usd(sum.minUsd)} aren't followed. Unpriced tokens can't be weighed and are excluded.</p>`;
    el.querySelector('#ft-table').addEventListener('click', e => {
      const b = e.target.closest('[data-path]');
      if (!b) return;
      const ids = tr.pathTo(b.dataset.path);
      graph.highlightPath(ids);
      el.querySelector('#ft-path').innerHTML = `<div class="path-chips">${ids.map((id, i) => {
        const n = tr.nodes.get(id);
        const ch = CHAIN[n.chainId];
        const cc = n.entity && n.entity.country;
        return `${i ? '<span class="path-arrow">→</span>' : ''}<span class="path-chip"><b>${esc(short(n.label, 10))}</b><span class="small muted">${ch ? esc(ch.name) : ''}${cc ? ' · ' + flag(cc) : ''}</span></span>`;
      }).join('')}<button class="btn ghost small-btn" id="ft-clear">Clear</button></div>`;
      el.querySelector('#ft-clear').onclick = () => { graph.highlightPath(null); el.querySelector('#ft-path').innerHTML = ''; };
      el.querySelector('#ft-graph').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  async function renderGeo(sum) {
    const box = el.querySelector('#ft-geo');
    const byCc = {};
    for (const x of sum.exchanges) { const cc = x.country || 'GLOBAL'; byCc[cc] = (byCc[cc] || 0) + x.usd; }
    const entries = Object.entries(byCc).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { box.innerHTML = ''; return; }
    const list = `<div class="geo-list">${entries.map(([cc, v]) => `<div class="geo-row"><span>${flag(cc)} ${esc(COUNTRY[cc] ? COUNTRY[cc].name : cc)}</span><b>${usd(v)}</b></div>`).join('')}</div>`;
    box.innerHTML = `<h3>Where the money was cashed in (exchange locations)</h3><div class="geo-wrap"><div class="geo-map" id="geo-map"><div class="muted small">Loading map…</div></div>${list}</div>
      <p class="muted small">Locations are where each exchange is based or regulated, not where the wallet owners are. Blockchains don't reveal that.</p>`;
    try {
      const [{ geoNaturalEarth1, geoPath }, topo, world] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/d3-geo@3/+esm'),
        import('https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'),
        fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json()),
      ]);
      const W = 720, H = 360;
      const proj = geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' });
      const path = geoPath(proj);
      const land = topo.feature(world, world.objects.countries);
      const max = Math.max(...entries.map(e => e[1]));
      const bubbles = entries.filter(([cc]) => COUNTRY[cc] && COUNTRY[cc].lat != null).map(([cc, v]) => {
        const [x, y] = proj([COUNTRY[cc].lon, COUNTRY[cc].lat]);
        const r = 6 + 22 * Math.sqrt(v / max);
        return `<g data-tip="${esc(usd(v))}" data-tip-sub="${esc(`${flag(cc)} ${COUNTRY[cc].name} · exchanges`)}" tabindex="0">
          <circle cx="${x}" cy="${y}" r="${r}" class="geo-bubble"/><text x="${x}" y="${y - r - 4}" text-anchor="middle" class="geo-label">${flag(cc)} ${esc(usd(v))}</text></g>`;
      }).join('');
      const glob = byCc.GLOBAL ? `<g data-tip="${esc(usd(byCc.GLOBAL))}" data-tip-sub="🌐 Global / offshore exchanges (e.g. Binance)" tabindex="0">
        <rect x="8" y="${H - 44}" width="200" height="36" rx="8" class="geo-global"/><text x="20" y="${H - 21}" class="geo-label">🌐 Global / offshore · ${esc(usd(byCc.GLOBAL))}</text></g>` : '';
      el.querySelector('#geo-map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="geo-svg" role="img" aria-label="Map of exchange locations that received the money">
        <path d="${path({ type: 'Sphere' })}" class="geo-sphere"/>
        ${land.features.map(f => `<path d="${path(f)}" class="geo-land"/>`).join('')}
        ${bubbles}${glob}</svg>`;
    } catch {
      el.querySelector('#geo-map').innerHTML = '<p class="muted small">Map unavailable offline; see the list.</p>';
    }
  }

  el.querySelector('#ft-hops').onchange = e => { params.maxHops = Number(e.target.value); };
  el.querySelector('#ft-wallets').onchange = e => { params.maxWallets = Number(e.target.value); };
  el.querySelector('#ft-min').onchange = e => { params.minUsd = Number(e.target.value); };
  el.querySelector('#ft-all').onchange = e => { params.showAll = e.target.checked; graph && graph.fit(); };
  el.querySelector('#ft-run').onclick = () => run();
  const api = { latest: () => (tr ? { sum: tr.summary(), tr, running: el.querySelector('#ft-status').textContent.startsWith('Following') } : null) };
  el.querySelector('#ft-stop').onclick = () => { stopped = true; el.querySelector('#ft-status').textContent = 'Stopped. Results so far are shown; unfinished amounts count as "not followed".'; };
  run();
  return api;
}
