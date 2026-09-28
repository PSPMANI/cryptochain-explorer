import { CHAIN } from '../chains.js';
import { CATEGORY_LABEL, flag } from '../entities.js';
import { toCSV } from '../investigate.js';
import { download, toast } from '../core.js';
import { esc, short, amount, usd, chainDot, link, timeCell } from '../ui.js';

const DAY = 86400000;
const CAT_VAR = c => `var(--cat-${c && ['exchange', 'bridge', 'dex', 'exploit'].includes(c) ? c : c ? 'other' : 'none'})`;
const dateVal = ms => new Date(ms).toISOString().slice(0, 10);
const nameOf = r => (r.entity && (r.entity.label || r.entity.name)) || r.cpName || null;

export function mountFlowGraph(el, m, ctx) {
  const rows = m.rows.filter(r => r.counterparty);
  const times = rows.map(r => r.time).filter(Boolean);
  const minT = times.length ? Math.min(...times) : Date.now(), maxT = times.length ? Math.max(...times) : Date.now();
  const symbols = [...new Set(rows.map(r => r.symbol).filter(Boolean))].sort();
  const chains = [...new Set(rows.map(r => r.chainId))];
  const cpOptions = (dir) => {
    const seen = new Map();
    for (const r of rows) if (r.direction === dir && !seen.has(r.counterparty.toLowerCase())) seen.set(r.counterparty.toLowerCase(), r);
    return [...seen.values()].slice(0, 400).map(r => `<option value="${esc(r.counterparty)}">${esc(nameOf(r) || '')}</option>`).join('');
  };
  const st = { from: dateVal(minT), to: dateVal(maxT), chain: '', sym: '', min: 0, src: '', dst: '', dir: '', top: 12, shown: 50, after: false };

  el.innerHTML = `
    <div class="fg-filters">
      <div class="fg-presets">${[['all', 'All time'], [1, '24 h'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([k, l]) => `<button class="chip-btn" data-preset="${k}">${l}</button>`).join('')}</div>
      <label>From (UTC)<input type="date" id="fg-from" value="${st.from}" min="${dateVal(minT)}" max="${dateVal(maxT)}"></label>
      <label>To (UTC)<input type="date" id="fg-to" value="${st.to}" min="${dateVal(minT)}" max="${dateVal(maxT)}"></label>
      <label>Direction<select id="fg-dir"><option value="">Received & sent</option><option value="in">Only received</option><option value="out">Only sent</option></select></label>
      ${chains.length > 1 ? `<label>Network<select id="fg-chain"><option value="">All networks</option>${chains.map(c => `<option value="${c}">${esc(CHAIN[c].name)}</option>`).join('')}</select></label>` : ''}
      <label>Asset<select id="fg-sym"><option value="">All assets</option>${symbols.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Min USD<input type="number" id="fg-min" min="0" step="1" value="0" inputmode="decimal"></label>
      <label class="wide">Received from<input id="fg-src" list="fg-src-list" placeholder="Any sender (address or name)" autocomplete="off" spellcheck="false"><datalist id="fg-src-list">${cpOptions('in')}</datalist></label>
      <label class="wide">Sent to<input id="fg-dst" list="fg-dst-list" placeholder="Any receiver (address or name)" autocomplete="off" spellcheck="false"><datalist id="fg-dst-list">${cpOptions('out')}</datalist></label>
      <label class="fg-check"><input type="checkbox" id="fg-after"> Only money sent after the first receipt from this sender</label>
      <label>Show top<select id="fg-top">${[8, 12, 20, 30, 50].map(n => `<option ${n === st.top ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="btn ghost small-btn" id="fg-reset">Reset filters</button>
    </div>
    <div class="fg-kpis" id="fg-kpis"></div>
    <div class="fg-canvas" id="fg-canvas"></div>
    <p class="muted small">Tip: click any wallet in the graph to filter by it. Thicker lines mean more money. Colors: <span style="color:var(--cat-exchange)">■</span> exchange <span style="color:var(--cat-bridge)">■</span> bridge <span style="color:var(--cat-dex)">■</span> DEX <span style="color:var(--cat-exploit)">■</span> scam / hacker <span style="color:var(--cat-other)">■</span> other label <span style="color:var(--cat-none)">■</span> unlabeled wallet.</p>
    <div class="section-head"><h3>Transfers in this view <span class="muted" id="fg-count"></span></h3><button class="btn ghost small-btn" id="fg-csv">⬇ CSV of this view</button></div>
    <div class="table-scroll"><table><thead><tr><th>Time</th><th>From</th><th></th><th>To</th><th class="r">Amount</th><th class="r">USD</th><th>Tx</th></tr></thead><tbody id="fg-rows"></tbody></table></div>
    <div class="more" id="fg-more"></div>`;

  const $ = id => el.querySelector('#' + id);
  const me = ctx.name || short(ctx.address);
  const match = (r, q) => {
    if (!q) return true;
    const s = q.trim().toLowerCase();
    return r.counterparty.toLowerCase() === s || r.counterparty.toLowerCase().includes(s) || (nameOf(r) || '').toLowerCase().includes(s);
  };
  const filtered = () => {
    const from = Date.parse(st.from + 'T00:00:00Z'), to = Date.parse(st.to + 'T00:00:00Z') + DAY;
    const base = rows.filter(r => (!r.time || (r.time >= from && r.time < to))
      && (!st.chain || r.chainId === st.chain) && (!st.sym || r.symbol === st.sym) && (!st.min || (r.usdValue || 0) >= st.min));
    const ins = st.dir === 'out' ? [] : base.filter(r => r.direction === 'in' && match(r, st.src));
    const firstIn = st.after && st.src ? Math.min(...ins.map(r => r.time || Infinity)) : -Infinity;
    const outs = st.dir === 'in' ? [] : base.filter(r => r.direction === 'out' && match(r, st.dst) && (r.time || Infinity) >= firstIn);
    return [...ins, ...outs];
  };

  function groups(list, dir) {
    const g = new Map();
    for (const r of list) {
      if (r.direction !== dir) continue;
      const k = `${r.chainId}:${r.counterparty.toLowerCase()}`;
      const x = g.get(k) || { key: k, chainId: r.chainId, address: r.counterparty, name: nameOf(r), entity: r.entity, usd: 0, n: 0, amounts: {}, first: r.time, last: r.time };
      x.usd += r.usdValue || 0; x.n++;
      x.amounts[r.symbol] = (x.amounts[r.symbol] || 0) + (r.value || 0);
      if (r.time) { x.first = Math.min(x.first ?? r.time, r.time); x.last = Math.max(x.last ?? r.time, r.time); }
      if (!x.entity && r.entity) x.entity = r.entity;
      g.set(k, x);
    }
    const all = [...g.values()].sort((a, b) => b.usd - a.usd || b.n - a.n);
    if (all.length <= st.top) return all;
    const rest = all.slice(st.top - 1);
    const other = { key: `other-${dir}`, other: true, name: `${rest.length} other wallets`, usd: 0, n: 0, amounts: {} };
    for (const x of rest) { other.usd += x.usd; other.n += x.n; for (const [s, v] of Object.entries(x.amounts)) other.amounts[s] = (other.amounts[s] || 0) + v; }
    return [...all.slice(0, st.top - 1), other];
  }

  const amtText = x => usd(x.usd) || Object.entries(x.amounts).sort((a, b) => b[1] - a[1]).slice(0, 1).map(([s, v]) => `${amount(v)} ${s}`).join('') || `${x.n} tx`;

  function graph(list) {
    const L = groups(list, 'in'), R = groups(list, 'out');
    if (!L.length && !R.length) return '<p class="muted center fg-empty">No transfers match these filters.</p>';
    const W = 1100, NW = 300, CW = 190, rowH = 46, gap = 8;
    const H = Math.max(160, Math.max(L.length, R.length) * (rowH + gap) + 40);
    const useUsd = [...L, ...R].some(x => x.usd > 0);
    const maxV = Math.max(1e-9, ...[...L, ...R].map(x => useUsd ? x.usd : x.n));
    const wOf = x => 2 + 22 * Math.sqrt((useUsd ? x.usd : x.n) / maxV);
    const cx = (W - CW) / 2, cy = H / 2, ch = Math.min(H - 40, 150);
    const colY = (n, i) => (H - n * (rowH + gap) + gap) / 2 + i * (rowH + gap);
    const node = (x, nx, y, side) => {
      const cat = x.entity && x.entity.category;
      const fl = x.entity && x.entity.country ? flag(x.entity.country) + ' ' : '';
      const title = x.other ? x.name : `${x.name || x.address}\n${x.address}\n${CHAIN[x.chainId].name}${cat ? ' · ' + (CATEGORY_LABEL[cat] || cat) : ''}\n${x.n} transfer(s) · ${amtText(x)}`;
      const label = x.other ? x.name : `${fl}${x.name || short(x.address)}`;
      const sub = x.other ? `${x.n} transfers` : `${cat ? (CATEGORY_LABEL[cat] || 'Labeled') + ' · ' : ''}${x.n} tx`;
      return `<g class="fg-node${x.other ? ' other' : ''}" ${x.other ? '' : `data-side="${side}" data-addr="${esc(x.address)}"`} tabindex="0">
        <title>${esc(title)}</title>
        <rect x="${nx}" y="${y}" width="${NW}" height="${rowH}" rx="10" style="--c:${CAT_VAR(cat)}"/>
        <rect x="${side === 'in' ? nx : nx + NW - 5}" y="${y}" width="5" height="${rowH}" rx="2" fill="${CAT_VAR(cat)}"/>
        <text x="${nx + 14}" y="${y + 19}" class="fg-t">${esc(label.length > 30 ? label.slice(0, 29) + '…' : label)}</text>
        <text x="${nx + 14}" y="${y + 36}" class="fg-s">${esc(sub)}</text>
        <text x="${nx + NW - 12}" y="${y + 19}" class="fg-v" text-anchor="end">${esc(amtText(x))}</text>
      </g>`;
    };
    const ribbon = (x1, y1, x2, y2, w, cat, tip) => `<path class="fg-link" d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" stroke="${CAT_VAR(cat)}" stroke-width="${w.toFixed(1)}"><title>${esc(tip)}</title></path>`;
    let links = '', nodes = '';
    const inTotal = L.reduce((s, x) => s + (useUsd ? x.usd : x.n), 0) || 1, outTotal = R.reduce((s, x) => s + (useUsd ? x.usd : x.n), 0) || 1;
    let accIn = cy - ch / 2 + 10, accOut = cy - ch / 2 + 10;
    L.forEach((x, i) => {
      const y = colY(L.length, i), share = (useUsd ? x.usd : x.n) / inTotal * (ch - 20);
      links += ribbon(NW, y + rowH / 2, cx, accIn + share / 2, wOf(x), x.entity && x.entity.category, `${x.name || x.address} → ${me}: ${amtText(x)}`);
      accIn += share;
      nodes += node(x, 0, y, 'in');
    });
    R.forEach((x, i) => {
      const y = colY(R.length, i), share = (useUsd ? x.usd : x.n) / outTotal * (ch - 20);
      links += ribbon(cx + CW, accOut + share / 2, W - NW, y + rowH / 2, wOf(x), x.entity && x.entity.category, `${me} → ${x.name || x.address}: ${amtText(x)}`);
      accOut += share;
      nodes += node(x, W - NW, y, 'out');
    });
    const inSum = L.reduce((s, x) => s + x.usd, 0), outSum = R.reduce((s, x) => s + x.usd, 0);
    const center = `<g class="fg-center"><rect x="${cx}" y="${cy - ch / 2}" width="${CW}" height="${ch}" rx="16"/>
      <text x="${cx + CW / 2}" y="${cy - 14}" text-anchor="middle" class="fg-t">${esc(me.length > 22 ? short(ctx.address) : me)}</text>
      <text x="${cx + CW / 2}" y="${cy + 6}" text-anchor="middle" class="fg-s">investigated wallet</text>
      <text x="${cx + CW / 2}" y="${cy + 28}" text-anchor="middle" class="fg-in">↓ ${esc(usd(inSum) || L.reduce((s, x) => s + x.n, 0) + ' tx')}</text>
      <text x="${cx + CW / 2}" y="${cy + 46}" text-anchor="middle" class="fg-out">↑ ${esc(usd(outSum) || R.reduce((s, x) => s + x.n, 0) + ' tx')}</text></g>`;
    const heads = `<text x="0" y="16" class="fg-h">RECEIVED FROM (${L.length})</text><text x="${W}" y="16" class="fg-h" text-anchor="end">SENT TO (${R.length})</text>`;
    return `<svg viewBox="0 0 ${W} ${H + 20}" class="fg-svg" role="img" aria-label="Money flow graph"><g transform="translate(0,20)">${links}${nodes}${center}</g>${heads}</svg>`;
  }

  function render() {
    const list = filtered();
    const inR = list.filter(r => r.direction === 'in'), outR = list.filter(r => r.direction === 'out');
    const sum = a => a.reduce((s, r) => s + (r.usdValue || 0), 0);
    $('fg-kpis').innerHTML = `
      <div class="kpi"><div class="k">Received</div><div class="v in">${usd(sum(inR)) || '$0'}</div><div class="sub">${inR.length} transfers · ${new Set(inR.map(r => r.counterparty.toLowerCase())).size} senders</div></div>
      <div class="kpi"><div class="k">Sent</div><div class="v out">${usd(sum(outR)) || '$0'}</div><div class="sub">${outR.length} transfers · ${new Set(outR.map(r => r.counterparty.toLowerCase())).size} receivers</div></div>
      <div class="kpi"><div class="k">Net</div><div class="v">${(sum(inR) - sum(outR) >= 0 ? '+' : '−') + (usd(Math.abs(sum(inR) - sum(outR))) || '$0')}</div><div class="sub">${esc(st.from)} → ${esc(st.to)}</div></div>
      ${st.src || st.dst ? `<div class="kpi fg-path"><div class="k">Path</div><div class="v small-v">${esc(st.src ? short(st.src) : 'any')} → ${esc(short(me))} → ${esc(st.dst ? short(st.dst) : 'any')}</div><div class="sub">filtered route</div></div>` : ''}`;
    $('fg-canvas').innerHTML = graph(list);
    const sorted = [...list].sort((a, b) => (b.time || 0) - (a.time || 0));
    $('fg-count').textContent = `(${list.length.toLocaleString()})`;
    const self = `<b>${esc(short(me, 8))}</b>`;
    $('fg-rows').innerHTML = sorted.slice(0, st.shown).map(r => {
      const cp = `${link(r.chainId, 'address', r.counterparty, nameOf(r) || null)}`;
      return `<tr><td>${r.time ? esc(new Date(r.time).toLocaleString()) : '—'}</td>
        <td>${r.direction === 'in' ? cp : self}</td><td class="${r.direction === 'in' ? 'in' : 'out'}">→</td><td>${r.direction === 'out' ? cp : self}</td>
        <td class="r ${r.direction === 'in' ? 'in' : 'out'}">${amount(r.value)} <span class="muted">${esc(r.symbol || '')}</span></td>
        <td class="r muted">${r.usdValue ? usd(r.usdValue) : ''}</td><td>${r.hash ? link(r.chainId, 'tx', r.hash) : ''} ${chainDot(CHAIN[r.chainId])}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No transfers match these filters.</td></tr>';
    $('fg-more').innerHTML = sorted.length > st.shown ? `<button class="btn ghost">Show more (${(sorted.length - st.shown).toLocaleString()})</button>` : '';
    if ($('fg-more').firstChild) $('fg-more').firstChild.onclick = () => { st.shown += 100; render(); };
    return list;
  }

  const read = () => {
    st.from = $('fg-from').value || dateVal(minT); st.to = $('fg-to').value || dateVal(maxT);
    st.dir = $('fg-dir').value; st.chain = $('fg-chain') ? $('fg-chain').value : ''; st.sym = $('fg-sym').value;
    st.min = Number($('fg-min').value) || 0; st.src = $('fg-src').value.trim(); st.dst = $('fg-dst').value.trim(); st.after = $('fg-after').checked;
    st.top = Number($('fg-top').value) || 12; st.shown = 50;
    render();
  };
  let t = 0;
  el.querySelector('.fg-filters').addEventListener('input', () => { clearTimeout(t); t = setTimeout(read, 250); });
  el.querySelector('.fg-filters').addEventListener('change', read);
  el.querySelector('.fg-presets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const k = b.dataset.preset;
    $('fg-from').value = k === 'all' ? dateVal(minT) : dateVal(Math.max(minT, maxT - Number(k) * DAY));
    $('fg-to').value = dateVal(maxT);
    el.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x === b));
    read();
  });
  $('fg-reset').onclick = () => {
    $('fg-from').value = dateVal(minT); $('fg-to').value = dateVal(maxT);
    ['fg-dir', 'fg-sym', 'fg-src', 'fg-dst'].forEach(id => { $(id).value = ''; });
    if ($('fg-chain')) $('fg-chain').value = '';
    $('fg-min').value = 0;
    $('fg-after').checked = false;
    read();
  };
  $('fg-canvas').addEventListener('click', e => {
    const n = e.target.closest('.fg-node[data-addr]');
    if (!n) return;
    const input = $(n.dataset.side === 'in' ? 'fg-src' : 'fg-dst');
    input.value = input.value.toLowerCase() === n.dataset.addr.toLowerCase() ? '' : n.dataset.addr;
    read();
    toast(input.value ? `Filtered to ${short(n.dataset.addr)}. Click it again to clear.` : 'Filter cleared');
  });
  $('fg-csv').onclick = () => download(`cryptchain-flow-${short(ctx.address, 4).replace('…', '-')}-${st.from}_${st.to}.csv`, toCSV(filtered()));
  render();
}
