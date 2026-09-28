import { CHAIN } from './chains.js';
import { knownLabel } from './entities.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const short = (h, n = 6) => (h && h.length > n * 2 + 3 ? `${h.slice(0, n + (h.startsWith('0x') ? 2 : 0))}…${h.slice(-n)}` : h || '');

export function amount(x) {
  if (x === null || x === undefined || isNaN(x)) return '—';
  const a = Math.abs(x);
  if (a > 0 && a < 0.01) return Number(x).toLocaleString(undefined, { maximumSignificantDigits: 4 });
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 4 : 6 });
}
export function usd(x) {
  if (x === null || x === undefined || isNaN(x)) return '';
  const a = Math.abs(x);
  return '$' + Number(x).toLocaleString(undefined, { maximumFractionDigits: a >= 100 ? 0 : a >= 1 ? 2 : 4 });
}
export const compact = x => x == null ? '—' : Number(x).toLocaleString(undefined, { notation: x >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: 2 });

function ago(ms) {
  if (!ms) return 'Pending';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}
export const timeCell = ms => ms ? `<span class="time" data-t="${ms}" title="${esc(new Date(ms).toLocaleString())}">${ago(ms)}</span>` : '<span class="chip">Pending</span>';

if (typeof document !== 'undefined') {
  setInterval(() => document.querySelectorAll('.time[data-t]').forEach(el => { el.textContent = ago(Number(el.dataset.t)); }), 10000);
}

export function identicon(seed, size = 56) {
  let h = 2166136261;
  for (const c of String(seed).toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hue = h % 360, cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    h = Math.imul(h ^ (h >>> 13), 1540483477) >>> 0;
    if (h & 4) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
  }
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="-0.5 -0.5 6 6" style="background:hsl(${hue} 35% 14%)" aria-hidden="true">${
    cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="hsl(${hue} 75% 62%)"/>`).join('')}</svg>`;
}

export const chainDot = chain => `<span class="dot" style="background:${chain.color}"></span>`;
export const chainChip = chain => `<a class="chip chain" href="#/" style="--c:${chain.color}">${chainDot(chain)}${esc(chain.name)}</a>`;

export function link(chainId, kind, id, label) {
  if (!id) return `<span class="muted">${esc(label || '—')}</span>`;
  const chain = CHAIN[chainId];
  const known = kind === 'address' && !label ? knownLabel(chain, id) : null;
  const text = label || (known && known.name) || short(id);
  return `<a class="mono ${label || known ? 'named' : ''}" href="#/${chainId}/${kind}/${encodeURIComponent(id)}" title="${esc(id)}">${esc(text)}</a>`;
}

export const copyBtn = text => `<button class="icon-btn copy" data-copy="${esc(text)}" title="Copy">⧉</button>`;

export function statusChip(s) {
  const map = { success: ['ok', 'Success'], failed: ['fail', 'Failed'], pending: ['pend', 'Pending'], unknown: ['', 'Confirmed'] };
  const [cls, txt] = map[s] || ['', s];
  return `<span class="chip ${cls}">${txt}</span>`;
}
export function dirChip(d) {
  if (!d) return '';
  const map = { in: ['in', 'IN'], out: ['out', 'OUT'], self: ['', 'SELF'] };
  return `<span class="chip dir ${map[d][0]}">${map[d][1]}</span>`;
}

export const stat = (k, v, sub = '') => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
