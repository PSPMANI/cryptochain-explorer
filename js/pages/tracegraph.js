import { CHAIN } from '../chains.js';
import { Trace } from '../trace.js';
import { toast } from '../core.js';
import { addWatch } from '../store.js';
import { CATEGORY_LABEL, flag, COUNTRY } from '../entities.js';
import { esc, short, amount, usd, link, timeCell } from '../ui.js';
import { chainLabel } from './shared.js';

const ICON = { root: '◎', wallet: '👛', exchange: '🏦', bridge: '🌉', dex: '🔁', contract: '📄', more: '⋯' };
const CAT = { exchange: 'exchange', bridge: 'bridge', dex: 'dex', contract: 'other', wallet: 'none', root: 'root', more: 'none' };
const NODE_W = 206, NODE_H = 62;

export function mountTrace(el, opts) {
  const fullMode = opts.mode === 'full';
  const state = { direction: 'out', depth: 2, minUsd: 0, trace: null, view: null, selected: null, playing: null, live: null, feed: [] };

  el.innerHTML = `
    <div class="trace-toolbar">
      <div class="seg" role="group" aria-label="Direction" ${fullMode ? 'hidden' : ''}>
        <button data-dir="out" class="on">Follow outflows →</button><button data-dir="in">← Trace sources</button></div>
      <label ${fullMode ? 'hidden' : ''}>Hops <select id="tr-depth">${[1, 2, 3, 4].map(d => `<option value="${d}" ${d === 2 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label ${fullMode ? 'hidden' : ''}>Min value <select id="tr-min"><option value="0">Any</option><option value="100">$100+</option><option value="1000">$1k+</option><option value="10000">$10k+</option></select></label>
      <span class="grow"></span>
      <button class="btn ghost small-btn" id="tr-play">▶ Playback</button>
      <button class="btn ghost small-btn" id="tr-live" ${fullMode ? 'hidden' : ''} title="Poll traced wallets for new transfers every 25 s">● Live</button>
      <div class="seg zoom"><button id="tr-zin" title="Zoom in">+</button><button id="tr-zout" title="Zoom out">−</button><button id="tr-fit" title="Fit">⤢</button></div>
    </div>
    <div class="trace-body">
      <div class="trace-canvas" id="tr-canvas"><div class="trace-status" id="tr-status"></div></div>
      <aside class="trace-panel" id="tr-panel"></aside>
    </div>
    <div class="trace-legend small muted">
      <span class="lgd root">Investigated wallet</span><span class="lgd exchange">Exchange (end)</span><span class="lgd bridge">Bridge / cross-chain</span>
      <span class="lgd dex">DEX</span><span class="lgd exploit">⚠ Exploiter</span><span class="lgd other">Contract / labeled</span><span class="lgd none">Unlabeled wallet</span>
      <span>· Line thickness = value · moving dots = direction of money · click a 👛 wallet to follow the next hop</span></div>
    <details class="trace-table"><summary>Table view of all traced transfers</summary><div id="tr-table"></div></details>`;

  const canvas = el.querySelector('#tr-canvas');
  const panel = el.querySelector('#tr-panel');
  const statusEl = el.querySelector('#tr-status');
  const setStatus = t => { statusEl.textContent = t; statusEl.hidden = !t; };

  let scheduled = false;
  const schedule = () => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; if (canvas.isConnected) render(); }, 400); };
  async function build() {
    stopPlay(); stopLive();
    if (fullMode) {
      state.trace = opts.trace;
      state.selected = opts.trace.rootId;
      state.view = null;
      opts.trace.onChange(schedule);
      render();
      return;
    }
    const tr = new Trace(opts.root, { direction: state.direction, prices: opts.prices, minUsd: state.minUsd, perNode: 5, maxNodes: 80 });
    state.trace = tr;
    state.selected = tr.rootId;
    state.feed = [];
    tr.attach(tr.nodes.get(tr.rootId), opts.model);
    tr.nodes.get(tr.rootId).status = 'done';
    tr.nodes.get(tr.rootId).expanded = true;
    tr.attachBridges(opts.bridges || []);
    tr.onChange(() => { if (state.trace === tr) render(); });
    state.view = null;
    render();
    if (state.depth > 1) {
      setStatus(`Following the money ${state.depth} hops…`);
      await tr.expandTo(state.depth, () => state.trace !== tr || opts.stale());
      if (state.trace === tr) { setStatus(''); state.view = null; render(); }
    }
  }

  function render() {
    const tr = state.trace;
    const include = fullMode && tr.minUsd && !(opts.showAll && opts.showAll()) ? n => n.id === tr.rootId || (n.traced || 0) >= tr.minUsd || n.status === 'loading' || (state.path && state.path.has(n.id)) : null;
    const L = tr.layout({ nodeW: NODE_W, nodeH: NODE_H, rowH: 76, colW: 280, include });
    const pad = 40;
    if (fullMode && !state.userMoved) state.view = null;
    const full = { x: -pad, y: -pad, w: L.width + pad * 2, h: Math.max(L.height, NODE_H) + pad * 2 };
    state.full = full;
    const cw = canvas.clientWidth || 800;
    canvas.style.height = `${Math.round(Math.min(760, Math.max(420, full.h * Math.min(1, cw / full.w))))}px`;
    if (!state.view) {
      const ch = canvas.clientHeight;
      const fit = Math.min(cw / full.w, ch / full.h);
      if (fit >= 0.72) state.view = { ...full };
      else {
        const s = Math.max(fit, 0.8), w = cw / s, h = ch / s;
        const r = L.pos.get(tr.rootId);
        state.view = { x: Math.max(full.x, Math.min(r.x - w * 0.12, full.x + full.w - w)), y: r.y + NODE_H / 2 - h / 2, w, h };
      }
    }
    const edges = [...tr.edges.values()];
    const maxVal = Math.max(1e-9, ...edges.map(e => e.usd || 0));
    const maxCnt = Math.max(1, ...edges.map(e => e.count));
    const useUsd = edges.some(e => e.usd > 0);
    const widthOf = e => 1.5 + 9 * Math.sqrt(useUsd ? (e.usd || 0) / maxVal : e.count / maxCnt);
    const topLabels = new Set([...edges].sort((a, b) => (b.usd || b.count) - (a.usd || a.count)).slice(0, 14).map(e => e.id));

    const edgeSvg = edges.map(e => {
      const a = L.pos.get(e.from), b = L.pos.get(e.to);
      if (!a || !b) return '';
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      const to = tr.nodes.get(e.to), from = tr.nodes.get(e.from);
      const far = state.direction === 'out' ? to : from;
      const cat = e.cross ? 'bridge' : far.entity && far.entity.category === 'exploit' ? 'exploit' : CAT[far.kind] || 'none';
      const w = widthOf(e);
      const val = fullMode ? (usd(e.usd) || '<$1') : e.usd ? usd(e.usd) : Object.entries(e.amounts).map(([s, v]) => `${amount(v)} ${s}`).slice(0, 1).join('') || `${e.count} tx`;
      const label = topLabels.has(e.id) ? `<text class="edge-label" x="${mx}" y="${(y1 + y2) / 2 - w / 2 - 4}" text-anchor="middle">${esc(val)}${e.count > 1 ? ` · ${e.count} tx` : ''}</text>` : '';
      return `<g class="edge cat-${cat} ${state.path && state.path.has(e.from) && state.path.has(e.to) ? 'onpath' : ''} ${e.aggregate ? 'agg' : ''} ${e.fresh ? 'pulse' : ''}" data-edge="${esc(e.id)}" tabindex="0"
          data-tip="${esc(val)}" data-tip-sub="${esc(`${from.label} → ${to.label} · ${e.count} transfer${e.count === 1 ? '' : 's'}`)}">
        <path class="edge-hit" d="${d}" stroke-width="${w + 12}"/>
        <path class="edge-line" d="${d}" stroke-width="${w}"/>
        ${e.aggregate || !topLabels.has(e.id) ? '' : `<path class="edge-flow" d="${d}" stroke-width="${Math.max(2, w * 0.45)}"/>`}
        ${label}</g>`;
    }).join('');

    const nodeSvg = [...tr.nodes.values()].filter(n => L.pos.has(n.id)).map(n => {
      const p = L.pos.get(n.id);
      if (!p) return '';
      const cat = CAT[n.kind] || 'none';
      const chain = CHAIN[n.chainId];
      const canExpand = !fullMode && (n.kind === 'wallet' || (n.kind === 'bridge' && n.address === null && n.hop > 0 && !n.expanded && [...tr.edges.values()].some(e => e.to === n.id && e.txs.some(t => !t.cross)))) && !n.expanded && n.status !== 'loading';
      const title = (n.entity && n.entity.category === 'exploit' ? '⚠ ' : '') + n.label;
      const lbl = title.length > 26 ? title.slice(0, 25) + '…' : title;
      const cc = n.entity && n.entity.country;
      const where = cc && COUNTRY[cc] ? `${flag(cc)} ${COUNTRY[cc].name}` : '';
      const role = n.kind === 'more' ? n.reason
        : n.kind === 'root' ? 'Investigated wallet'
        : n.entity ? (CATEGORY_LABEL[n.entity.category] || 'Labeled') : n.service ? 'Busy service' : n.kind === 'contract' ? 'Contract' : 'Wallet';
      const line3raw = [where, fullMode && n.traced ? usd(n.traced) || '<$1' : role].filter(Boolean).join(' · ') + (fullMode && n.status === 'loading' ? ' · following…' : '');
      const line3 = line3raw.length > 34 ? line3raw.slice(0, 33) + '…' : line3raw;
      return `<g class="node cat-${cat} k-${n.kind} ${n.entity && n.entity.category === 'exploit' ? 'flag-exploit' : ''} ${state.path && state.path.has(n.id) ? 'onpath' : ''} ${state.selected === n.id ? 'sel' : ''} ${n.status}" data-node="${esc(n.id)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(n.label)}">
        <rect class="node-box" width="${NODE_W}" height="${NODE_H}" rx="10"/>
        <rect class="node-bar" width="5" height="${NODE_H}" rx="2"/>
        <text class="node-icon" x="16" y="25">${ICON[n.kind] || '•'}</text>
        <text class="node-title" x="36" y="19">${esc(lbl)}</text>
        ${chain && n.kind !== 'more' ? `<circle cx="40" cy="32" r="4" fill="${chain.color}"/><text class="node-chain" x="49" y="36">${esc(chain.name)}</text>` : ''}
        <text class="node-sub" x="36" y="52">${esc(line3)}</text>
        ${n.status === 'loading' ? `<circle class="node-spin" cx="${NODE_W - 14}" cy="14" r="6"/>` : ''}
        ${canExpand ? `<g class="node-plus" data-expand="${esc(n.id)}"><circle cx="${NODE_W}" cy="${NODE_H / 2}" r="10"/><text x="${NODE_W}" y="${NODE_H / 2 + 4}" text-anchor="middle">+</text></g>` : ''}
        ${n.status === 'error' ? `<text class="node-err" x="${NODE_W - 16}" y="${NODE_H - 8}">⚠</text>` : ''}
      </g>`;
    }).join('');

    const hopHeads = L.hops.map(h => {
      const x = (h - L.hops[0]) * 280 + NODE_W / 2;
      const label = h === 0 ? 'Wallet' : state.direction === 'out' ? `Hop ${h}` : `Hop ${-h} (sources)`;
      return `<text class="hop-head" x="${x}" y="${-16}" text-anchor="middle">${label}</text>`;
    }).join('');

    const v = state.view;
    canvas.querySelector('svg')?.remove();
    canvas.insertAdjacentHTML('afterbegin', `<svg class="trace-svg ${state.playing ? 'playing' : ''} ${state.path ? 'pathmode' : ''}" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" role="img" aria-label="Money trace graph">
      ${hopHeads}<g class="edges">${edgeSvg}</g><g class="nodes">${nodeSvg}</g></svg>`);
    renderPanel();
    renderTable();
  }

  function renderPanel() {
    const tr = state.trace;
    if (state.playing) return;
    const n = tr.nodes.get(state.selected) || tr.nodes.get(tr.rootId);
    const flowsIn = [...tr.edges.values()].filter(e => e.to === n.id);
    const flowsOut = [...tr.edges.values()].filter(e => e.from === n.id);
    const txs = [...flowsIn, ...flowsOut].flatMap(e => e.txs.map(t => ({ ...t, e }))).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 12);
    const tot = list => list.reduce((s, e) => s + (e.usd || 0), 0);
    const chain = CHAIN[n.chainId];
    panel.innerHTML = `
      ${state.feed.length ? `<div class="live-feed"><div class="small muted">Live feed</div>${state.feed.slice(0, 5).map(f => `<div class="feed-item">${esc(f)}</div>`).join('')}</div>` : ''}
      <div class="panel-head"><span class="node-ico">${ICON[n.kind] || '•'}</span><div class="grow"><b class="break">${esc(n.label)}</b>
        <div class="small muted">${chain ? esc(chain.name) : ''}${n.entity ? ' · ' + esc(n.entity.label || n.entity.name) : ''}</div></div></div>
      ${n.address ? `<div class="mono small break muted">${esc(n.address)}</div>` : ''}
      ${n.reason ? `<p class="small">${esc(n.reason)}</p>` : ''}
      <div class="panel-stats">
        <div><span class="muted small">Money in (traced)</span><b>${usd(tot(flowsIn)) || (flowsIn.length ? `${flowsIn.reduce((s, e) => s + e.count, 0)} tx` : '—')}</b></div>
        <div><span class="muted small">Money out (traced)</span><b>${usd(tot(flowsOut)) || (flowsOut.length ? `${flowsOut.reduce((s, e) => s + e.count, 0)} tx` : '—')}</b></div>
      </div>
      <div class="row-gap">
        ${(n.kind === 'wallet' || n.kind === 'bridge') && !n.expanded && n.kind !== 'more' ? `<button class="btn small-btn" data-expand="${esc(n.id)}" ${n.status === 'loading' ? 'disabled' : ''}>${n.status === 'loading' ? 'Following…' : n.kind === 'bridge' ? 'Resolve destination' : 'Follow next hop'}</button>` : ''}
        ${n.address && chain ? `<a class="btn ghost small-btn" href="#/${n.chainId}/address/${encodeURIComponent(n.address)}">Open</a>
          <a class="btn ghost small-btn" href="#/investigate/${n.chainId}/${encodeURIComponent(n.address)}">Investigate</a>
          <button class="btn ghost small-btn" data-watch="${esc(n.id)}">👁 Watch</button>` : ''}
      </div>
      <div class="panel-txs">${txs.length ? txs.map(t => {
        const from = tr.nodes.get(t.e.from), to = tr.nodes.get(t.e.to);
        return `<div class="ptx"><div><b>${t.amount != null ? amount(t.amount) : '?'} ${esc(t.symbol || '')}</b>${t.usd ? ` <span class="muted small">${usd(t.usd)}</span>` : ''}</div>
          <div class="small muted">${esc(short(from.label, 8))} → ${esc(short(to.label, 8))}</div>
          <div class="small">${t.chainId && t.hash ? link(t.chainId, 'tx', t.hash) : ''} ${timeCell(t.time)}${t.cross ? ` <span class="ent br">${esc(t.cross.protocol)}</span>` : ''}</div></div>`;
      }).join('') : '<p class="muted small">No individual transfers for this node.</p>'}</div>`;
  }

  function renderTable() {
    const tr = state.trace;
    const rows = tr.events().slice().reverse().slice(0, 300);
    el.querySelector('#tr-table').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Time</th><th>From</th><th></th><th>To</th><th class="r">Amount</th><th class="r">USD</th><th>Tx</th></tr></thead><tbody>
      ${rows.map(({ edge, tx }) => {
        const f = tr.nodes.get(edge.from), t = tr.nodes.get(edge.to);
        return `<tr><td>${timeCell(tx.time)}</td><td>${f.address ? link(f.chainId, 'address', f.address, f.entity ? f.label : null) : esc(f.label)}</td><td class="muted">→</td>
          <td>${t.address ? link(t.chainId, 'address', t.address, t.entity ? t.label : null) : esc(t.label)}</td>
          <td class="r">${tx.amount != null ? amount(tx.amount) : '—'} ${esc(tx.symbol || '')}</td><td class="r muted">${tx.usd ? usd(tx.usd) : ''}</td>
          <td>${tx.chainId && tx.hash ? link(tx.chainId, 'tx', tx.hash) : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No transfers.</td></tr>'}</tbody></table></div>`;
  }

  el.addEventListener('click', async e => {
    const dirBtn = e.target.closest('[data-dir]');
    if (dirBtn) {
      el.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('on', b === dirBtn));
      state.direction = dirBtn.dataset.dir;
      return build();
    }
    const ex = e.target.closest('[data-expand]');
    if (ex) {
      e.stopPropagation();
      state.selected = ex.dataset.expand;
      const added = await state.trace.expand(ex.dataset.expand);
      if (!added.length && state.trace.nodes.get(ex.dataset.expand)?.status === 'done') toast('No further transfers found for this hop');
      state.view = null; render();
      return;
    }
    const w = e.target.closest('[data-watch]');
    if (w) {
      const n = state.trace.nodes.get(w.dataset.watch);
      try { await addWatch(n.chainId, n.address, n.entity ? n.label : ''); toast('Added to your watchlist'); } catch (err) { toast(err.message); }
      return;
    }
    const node = e.target.closest('[data-node]');
    if (node && !state.dragged) { state.selected = node.dataset.node; render(); return; }
    const edge = e.target.closest('[data-edge]');
    if (edge && !state.dragged) {
      const ed = state.trace.edges.get(edge.dataset.edge);
      state.selected = ed.to; render();
    }
  });
  el.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-node]')) { e.preventDefault(); state.selected = e.target.closest('[data-node]').dataset.node; render(); }
  });
  el.querySelector('#tr-depth').onchange = e => { state.depth = Number(e.target.value); build(); };
  el.querySelector('#tr-min').onchange = e => { state.minUsd = Number(e.target.value); build(); };

  const zoom = (f, cx, cy) => {
    state.userMoved = true;
    const v = state.view;
    cx ??= v.x + v.w / 2; cy ??= v.y + v.h / 2;
    const nw = Math.min(state.full.w * 3, Math.max(200, v.w * f)), k = nw / v.w;
    state.view = { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w: nw, h: v.h * k };
    canvas.querySelector('svg').setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
  };
  const toView = (svg, ex, ey) => { const r = svg.getBoundingClientRect(), v = state.view, s = Math.max(v.w / r.width, v.h / r.height);
    return [v.x + (ex - r.left) * s - (r.width * s - v.w) / 2, v.y + (ey - r.top) * s - (r.height * s - v.h) / 2]; };
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const svg = canvas.querySelector('svg');
    const [cx, cy] = toView(svg, e.clientX, e.clientY);
    zoom(e.deltaY > 0 ? 1.15 : 0.87, cx, cy);
  }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('[data-expand]')) return;
    drag = { x: e.clientX, y: e.clientY, v: { ...state.view } };
    state.dragged = false;
  });
  window.addEventListener('pointermove', e => {
    if (!drag || !canvas.isConnected) return;
    const svg = canvas.querySelector('svg'), r = svg.getBoundingClientRect();
    const s = Math.max(drag.v.w / r.width, drag.v.h / r.height);
    const dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
    if (Math.abs(dx) + Math.abs(dy) > 4) { state.dragged = true; state.userMoved = true; canvas.classList.add('grabbing'); }
    state.view = { ...drag.v, x: drag.v.x - dx, y: drag.v.y - dy };
    svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
  });
  window.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('grabbing'); setTimeout(() => { state.dragged = false; }, 0); });
  el.querySelector('#tr-zin').onclick = () => zoom(0.8);
  el.querySelector('#tr-zout').onclick = () => zoom(1.25);
  el.querySelector('#tr-fit').onclick = () => { state.userMoved = false; state.view = { ...state.full }; canvas.querySelector('svg').setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`); };

  const playBtn = el.querySelector('#tr-play');
  function stopPlay() {
    if (!state.playing) return;
    clearInterval(state.playing.timer);
    state.playing = null;
    playBtn.textContent = '▶ Playback';
    canvas.querySelector('svg')?.classList.remove('playing');
    canvas.querySelectorAll('.edge.active, .node.active').forEach(x => x.classList.remove('active'));
    renderPanel();
  }
  playBtn.onclick = () => {
    if (state.playing) return stopPlay();
    const events = state.trace.events().filter(ev => ev.time);
    if (!events.length) return toast('No dated transfers to replay');
    state.playing = { i: 0, events };
    playBtn.textContent = '■ Stop';
    canvas.querySelector('svg').classList.add('playing');
    const step = () => {
      const p = state.playing;
      if (!p || !canvas.isConnected) return stopPlay();
      if (p.i >= p.events.length) { stopPlay(); toast('Playback finished'); return; }
      const { edge, tx } = p.events[p.i];
      const svg = canvas.querySelector('svg');
      svg.querySelectorAll('.edge.current, .node.current').forEach(x => x.classList.remove('current'));
      const eg = svg.querySelector(`[data-edge="${CSS.escape(edge.id)}"]`);
      eg?.classList.add('active', 'current');
      [edge.from, edge.to].forEach(id => svg.querySelector(`[data-node="${CSS.escape(id)}"]`)?.classList.add('active', 'current'));
      const f = state.trace.nodes.get(edge.from), t = state.trace.nodes.get(edge.to);
      panel.innerHTML = `<div class="play-card">
        <div class="small muted">Transfer ${p.i + 1} of ${p.events.length}</div>
        <div class="play-time">${new Date(tx.time).toLocaleString()}</div>
        <div class="play-flow"><b>${esc(f.label)}</b><span class="play-arrow">→ ${tx.amount != null ? `${amount(tx.amount)} ${esc(tx.symbol || '')}` : ''}${tx.usd ? ` (${usd(tx.usd)})` : ''} →</span><b>${esc(t.label)}</b></div>
        ${tx.cross ? `<div class="small">${chainLabel(tx.cross.srcChain)} → ${chainLabel(tx.cross.dstChain)} via ${esc(tx.cross.protocol)}</div>` : ''}
        ${t.kind === 'exchange' ? `<div class="notice flag ex small">🏦 Money reaches ${esc(t.entity ? t.entity.name : t.label)}</div>` : ''}
        <div class="small">${tx.chainId && tx.hash ? link(tx.chainId, 'tx', tx.hash) : ''}</div>
        <input type="range" min="0" max="${p.events.length - 1}" value="${p.i}" class="play-scrub" aria-label="Playback position">
      </div>`;
      panel.querySelector('.play-scrub').oninput = ev => { p.i = Number(ev.target.value); };
      p.i++;
    };
    step();
    state.playing.timer = setInterval(step, 900);
  };

  const liveBtn = el.querySelector('#tr-live');
  function stopLive() {
    if (!state.live) return;
    clearInterval(state.live);
    state.live = null;
    liveBtn.classList.remove('on');
    liveBtn.textContent = '● Live';
  }
  liveBtn.onclick = () => {
    if (state.live) return stopLive();
    liveBtn.classList.add('on');
    liveBtn.innerHTML = '<span class="live-dot"></span> Live';
    toast('Live tracking on: new transfers from traced wallets appear on the graph');
    const tick = async () => {
      if (!canvas.isConnected || opts.stale()) return stopLive();
      if (document.hidden) return;
      const tr = state.trace;
      const watchIds = [...tr.nodes.values()].filter(n => (n.kind === 'root' || (n.kind === 'wallet' && n.expanded)) && n.address).slice(0, 6).map(n => n.id);
      for (const id of watchIds) {
        const n = tr.nodes.get(id);
        const wasExpanded = n.expanded;
        n.expanded = false; n.status = 'idle';
        const added = await tr.expand(id, { live: true });
        n.expanded = wasExpanded || n.expanded;
        for (const { edge, tx } of added) {
          edge.fresh = true;
          setTimeout(() => { edge.fresh = false; }, 8000);
          const to = tr.nodes.get(edge.to), from = tr.nodes.get(edge.from);
          const msg = `${from.label} → ${to.label}: ${amount(tx.value)} ${tx.symbol}`;
          state.feed.unshift(`${new Date().toLocaleTimeString()} · ${msg}`);
          toast(to.kind === 'exchange' ? `🏦 ${from.label} is sending to ${to.entity ? to.entity.name : to.label}` : `New transfer: ${msg}`, to.kind === 'exchange' ? 'high' : '');
        }
      }
      render();
    };
    tick();
    state.live = setInterval(tick, 25000);
  };

  build();
  return {
    rebuild: build,
    fit() { state.userMoved = false; state.view = null; render(); },
    highlightPath(ids) { state.path = ids ? new Set(ids) : null; if (ids) state.selected = ids[ids.length - 1]; render(); },
  };
}
