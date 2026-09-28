import { esc, usd, amount } from './ui.js';

const W = 960;
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDateY = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const tip = (value, label) => `data-tip="${esc(value)}" data-tip-sub="${esc(label)}" tabindex="0"`;

function ticks(lo, hi, n = 4) {
  if (hi === lo) return [lo];
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const compactNum = v => Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : amount(v);

export function balanceChart(points, symbol) {
  if (points.length < 2) return '<p class="muted small">Not enough history to draw a balance line.</p>';
  const H = 220, pl = 56, pr = 16, pt = 14, pb = 28;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const vmax = Math.max(...points.map(p => p.v)), vmin = Math.min(0, ...points.map(p => p.v));
  const x = t => pl + ((t - t0) / Math.max(1, t1 - t0)) * (W - pl - pr);
  const y = v => pt + (1 - (v - vmin) / Math.max(1e-12, vmax - vmin)) * (H - pt - pb);
  let d = `M${x(points[0].t)},${y(points[0].v)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i].t)} V${y(points[i].v)}`;
  const area = `${d} V${y(vmin)} H${x(points[0].t)} Z`;
  const yt = ticks(vmin, vmax, 4), xt = [0, 1, 2, 3].map(i => t0 + (i / 3) * (t1 - t0));
  const data = esc(JSON.stringify(points.map(p => [p.t, p.v])));
  return `<svg class="chart balance" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(symbol)} balance over time" data-series="${data}" data-symbol="${esc(symbol)}" data-geom="${pl},${pr},${pt},${pb},${t0},${t1},${vmin},${vmax}">
    ${yt.map(v => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${compactNum(v)}</text>`).join('')}
    ${xt.map(t => `<text class="tick" x="${x(t)}" y="${H - 8}" text-anchor="middle">${fmtDate(t)}</text>`).join('')}
    <path d="${area}" class="bal-area"/><path d="${d}" class="bal-line"/>
    <g class="xhair" visibility="hidden"><line y1="${pt}" y2="${H - pb}"/><circle r="4.5"/></g>
    <rect class="hit" x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent"/>
  </svg>`;
}

export function volumeChart(buckets, useUsd, unit) {
  if (!buckets.length) return '<p class="muted small">No dated transfers.</p>';
  const H = 240, pl = 56, pr = 16, pt = 14, pb = 28, mid = pt + (H - pt - pb) / 2;
  const vi = b => useUsd ? b.inUsd : b.nIn, vo = b => useUsd ? b.outUsd : b.nOut;
  const max = Math.max(1e-9, ...buckets.map(b => Math.max(vi(b), vo(b))));
  const half = (H - pt - pb) / 2 - 2;
  const slot = (W - pl - pr) / buckets.length, bw = Math.max(1.5, Math.min(18, slot - 2));
  const f = v => useUsd ? usd(v) || '$0' : `${v} transfer${v === 1 ? '' : 's'}`;
  const yt = ticks(0, max, 2);
  const bars = buckets.map((b, i) => {
    const cx = pl + i * slot + (slot - bw) / 2, hi = (vi(b) / max) * half, ho = (vo(b) / max) * half;
    const lbl = `${unit === 'week' ? 'Week of ' : ''}${fmtDateY(Date.parse(b.day))}`;
    const r = Math.min(4, bw / 2);
    return `${hi ? `<path class="bar in" d="M${cx},${mid - 1} V${mid - hi + r} Q${cx},${mid - hi} ${cx + r},${mid - hi} H${cx + bw - r} Q${cx + bw},${mid - hi} ${cx + bw},${mid - hi + r} V${mid - 1} Z" ${tip(f(vi(b)) + ' received', lbl)}/>` : ''}
      ${ho ? `<path class="bar out" d="M${cx},${mid + 1} V${mid + ho - r} Q${cx},${mid + ho} ${cx + r},${mid + ho} H${cx + bw - r} Q${cx + bw},${mid + ho} ${cx + bw},${mid + ho - r} V${mid + 1} Z" ${tip(f(vo(b)) + ' sent', lbl)}/>` : ''}`;
  }).join('');
  const first = Date.parse(buckets[0].day), last = Date.parse(buckets[buckets.length - 1].day);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Transfer volume per ${unit}">
    ${yt.filter(v => v > 0).map(v => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${mid - (v / max) * half}" y2="${mid - (v / max) * half}"/><text class="tick" x="${pl - 8}" y="${mid - (v / max) * half + 4}" text-anchor="end">${useUsd ? '$' + compactNum(v) : v}</text>
      <line class="grid" x1="${pl}" x2="${W - pr}" y1="${mid + (v / max) * half}" y2="${mid + (v / max) * half}"/><text class="tick" x="${pl - 8}" y="${mid + (v / max) * half + 4}" text-anchor="end">${useUsd ? '$' + compactNum(v) : v}</text>`).join('')}
    <line class="axis" x1="${pl}" x2="${W - pr}" y1="${mid}" y2="${mid}"/>
    ${bars}
    <text class="tick" x="${pl}" y="${H - 8}">${fmtDateY(first)}</text>
    <text class="tick" x="${W - pr}" y="${H - 8}" text-anchor="end">${fmtDateY(last)}</text>
    <text class="tick strong" x="${W - pr}" y="${pt + 10}" text-anchor="end">▲ Received</text>
    <text class="tick strong" x="${W - pr}" y="${H - pb - 4}" text-anchor="end">▼ Sent</text>
  </svg>`;
}

export function hbarChart(items, fmt, { emptyText = 'Nothing to show.' } = {}) {
  const list = items.filter(i => i.value > 0);
  if (!list.length) return `<p class="muted small">${esc(emptyText)}</p>`;
  const max = Math.max(...list.map(i => i.value));
  return `<div class="hbars" role="list">${list.map(i => `
    <div class="hbar" role="listitem" ${tip(fmt(i.value), i.label + (i.sub ? ' · ' + i.sub : ''))}>
      <div class="hbar-label">${i.href ? `<a href="${esc(i.href)}">${esc(i.label)}</a>` : esc(i.label)}${i.sub ? `<span class="muted small"> ${esc(i.sub)}</span>` : ''}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1.5, (i.value / max) * 100)}%;${i.color ? `background:${i.color}` : ''}"></div></div>
      <div class="hbar-val">${esc(fmt(i.value))}</div>
    </div>`).join('')}</div>`;
}

export function heatmap(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let n = 0;
  for (const r of rows) if (r.time) { const d = new Date(r.time); grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++; n++; }
  if (!n) return '<p class="muted small">No dated transfers.</p>';
  const max = Math.max(...grid.flat());
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const step = v => v === 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999));
  const cw = 34, ch = 22, pl = 40, pt = 18;
  const cells = grid.map((row, di) => row.map((v, h) =>
    `<rect class="cell s${step(v)}" x="${pl + h * cw + 1}" y="${pt + di * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" ${tip(`${v} transfer${v === 1 ? '' : 's'}`, `${days[di]} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 UTC`)}/>`).join('')).join('');
  const Wd = pl + 24 * cw, Hd = pt + 7 * ch + 22;
  return `<svg class="chart heat" viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="Activity by weekday and hour (UTC)">
    ${[0, 3, 6, 9, 12, 15, 18, 21].map(h => `<text class="tick" x="${pl + h * cw + cw / 2}" y="${pt - 6}" text-anchor="middle">${String(h).padStart(2, '0')}h</text>`).join('')}
    ${days.map((d, i) => `<text class="tick" x="${pl - 8}" y="${pt + i * ch + ch / 2 + 4}" text-anchor="end">${d}</text>`).join('')}
    ${cells}
    <text class="tick" x="${pl}" y="${Hd - 4}">Fewer</text>
    ${[1, 2, 3, 4, 5, 6, 7].map(s => `<rect class="cell s${s}" x="${pl + 44 + (s - 1) * 18}" y="${Hd - 14}" width="16" height="10" rx="2"/>`).join('')}
    <text class="tick" x="${pl + 44 + 7 * 18 + 6}" y="${Hd - 4}">More</text>
  </svg>`;
}

let tipEl = null;
function tooltip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'viz-tip';
    tipEl.innerHTML = '<div class="tv"></div><div class="tl"></div>';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(x, y, value, label) {
  const t = tooltip();
  t.querySelector('.tv').textContent = value;
  t.querySelector('.tl').textContent = label || '';
  t.style.display = 'block';
  const r = t.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

export function bindCharts(root) {
  root.addEventListener('pointermove', e => {
    const m = e.target.closest('[data-tip]');
    if (m && root.contains(m)) showTip(e.clientX, e.clientY, m.dataset.tip, m.dataset.tipSub);
    else if (!e.target.closest('svg.balance')) hideTip();
  });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('focusin', e => {
    const m = e.target.closest('[data-tip]');
    if (m) { const r = m.getBoundingClientRect(); showTip(r.left + r.width / 2, r.top, m.dataset.tip, m.dataset.tipSub); }
  });
  root.addEventListener('focusout', hideTip);

  root.querySelectorAll('svg.balance').forEach(svg => {
    const pts = JSON.parse(svg.dataset.series);
    const [pl, pr, pt, pb, t0, t1, vmin, vmax] = svg.dataset.geom.split(',').map(Number);
    const H = svg.viewBox.baseVal.height;
    const xh = svg.querySelector('.xhair');
    const sym = svg.dataset.symbol;
    svg.querySelector('.hit').addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * W;
      const t = t0 + ((vx - pl) / (W - pl - pr)) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      const px = pl + ((best[0] - t0) / Math.max(1, t1 - t0)) * (W - pl - pr);
      const py = pt + (1 - (best[1] - vmin) / Math.max(1e-12, vmax - vmin)) * (H - pt - pb);
      xh.setAttribute('visibility', 'visible');
      xh.querySelector('line').setAttribute('x1', px); xh.querySelector('line').setAttribute('x2', px);
      xh.querySelector('circle').setAttribute('cx', px); xh.querySelector('circle').setAttribute('cy', py);
      showTip(e.clientX, e.clientY, `${amount(best[1])} ${sym}`, new Date(best[0]).toLocaleString());
    });
    svg.querySelector('.hit').addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
  });
}
