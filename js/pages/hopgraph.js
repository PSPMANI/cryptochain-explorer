import { CHAIN } from '../chains.js';
import { CATEGORY_LABEL, flag } from '../entities.js';
import { toast, download } from '../core.js';
import { esc, short, usd, link, chainDot, copyBtn } from '../ui.js';
import { CAT_VAR, INK } from './flowgraph.js';

const DAY = 86400000;
const KIND_LABEL = { exchange: '🏦 Exchange', bridge: '🌉 Bridge', dex: '🔁 DEX', contract: '📄 Contract / service', wallet: '👛 Wallet' };
const dateVal = ms => new Date(ms).toISOString().slice(0, 10);
const catOf = n => (n.entity && n.entity.category === 'exploit' ? 'exploit' : n.kind === 'wallet' ? (n.entity ? n.entity.category : null) : n.kind === 'contract' ? 'other' : n.kind);
const flowOf = e => e.traced || e.usd || 0;

export function mountHopGraph(el, ctx, getTrace) {
  const st = { a: 1, b: 1, min: 0, chain: '', type: '', top: 12, q: '', focus: null, from: '', to: '', shown: 60 };
  el.innerHTML = `
    <div class="fg-filters">
      <div class="fg-presets" id="hg-hops"></div>
      <label>From hop<select id="hg-a"></select></label>
      <label>To hop<select id="hg-b"></select></label>
      <label>From (UTC)<input type="date" id="hg-from"></label>
      <label>To (UTC)<input type="date" id="hg-to"></label>
      <label>Min USD<input type="number" id="hg-min" min="0" step="1" value="0" inputmode="decimal"></label>
      <label>Network<select id="hg-chain"><option value="">All networks</option></select></label>
      <label>Show<select id="hg-type"><option value="">All wallets</option><option value="exchange">Routes ending at exchanges</option><option value="bridge">Routes into bridges</option><option value="wallet">Private wallets only</option></select></label>
      <label>Wallets per hop<select id="hg-top">${[8, 12, 20, 30, 50].map(n => `<option ${n === st.top ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="wide">Find a wallet<input id="hg-q" placeholder="Address or name in the trail" autocomplete="off" spellcheck="false"></label>
      <button class="btn ghost small-btn" id="hg-reset">Reset</button>
    </div>
    <div class="small muted" id="hg-status"></div>
    <div class="fg-kpis" id="hg-kpis"></div>
    <div class="fg-canvas" id="hg-canvas"></div>
    <div id="hg-detail"></div>
    <p class="muted small">Hop 1 = wallets this wallet paid directly, hop 2 = wallets those paid next, and so on. Amounts are the part of this wallet's money that moved along each line (proportional tracing). Click a wallet to see its route and focus on it. Need deeper hops? Raise <b>Max hops</b> in <a href="#" id="hg-deeper">Where it ended up</a>.</p>
    <div class="section-head"><h3>Hop transfers in this view <span class="muted" id="hg-count"></span></h3><button class="btn ghost small-btn" id="hg-csv">⬇ CSV of this view</button></div>
    <div class="table-scroll"><table><thead><tr><th>Hop</th><th>From</th><th></th><th>To</th><th class="r">Traced amount</th><th class="r">Transfers</th><th>First seen</th><th>Tx</th></tr></thead><tbody id="hg-rows"></tbody></table></div>
    <div class="more" id="hg-more"></div>`;

  const $ = id => el.querySelector('#' + id);
  let tr = null, maxHop = 0, lastSig = '', datesSet = false, chainsSeen = new Set();

  function snapshot() {
    const latest = getTrace();
    tr = latest && latest.tr;
    if (!tr) return false;
    const nodes = [...tr.nodes.values()];
    maxHop = Math.max(1, ...nodes.map(n => n.hop || 0));
    const hopsHtml = [...Array(maxHop).keys()].map(i => i + 1).map(h => `<button class="chip-btn ${st.a === h && st.b === h ? 'on' : ''}" data-hop="${h}">Hop ${h}</button>`).join('')
      + `<button class="chip-btn ${st.a === 1 && st.b === maxHop ? 'on' : ''}" data-hop="all">All hops</button>`;
    if ($('hg-hops').innerHTML !== hopsHtml) $('hg-hops').innerHTML = hopsHtml;
    const opts = (sel) => [...Array(maxHop).keys()].map(i => `<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>Hop ${i + 1}</option>`).join('');
    $('hg-a').innerHTML = opts(st.a); $('hg-b').innerHTML = opts(st.b);
    for (const n of nodes) if (!chainsSeen.has(n.chainId) && CHAIN[n.chainId]) { chainsSeen.add(n.chainId); $('hg-chain').insertAdjacentHTML('beforeend', `<option value="${n.chainId}">${esc(CHAIN[n.chainId].name)}</option>`); }
    const times = [...tr.edges.values()].map(e => e.first).filter(Boolean);
    if (times.length && !datesSet) {
      const lo = dateVal(Math.min(...times)), hi = dateVal(Math.max(...times));
      $('hg-from').value = lo; $('hg-to').value = hi; st.from = lo; st.to = hi;
      datesSet = true;
    }
    return true;
  }

  function descendants(id) {
    const out = new Set([id]), queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      for (const e of tr.edges.values()) if (e.from === cur && !out.has(e.to) && !e.aggregate) { out.add(e.to); queue.push(e.to); }
    }
    return out;
  }

  function model() {
    const nodes = tr.nodes;
    const from = st.from ? Date.parse(st.from + 'T00:00:00Z') : -Infinity, to = st.to ? Date.parse(st.to + 'T00:00:00Z') + DAY : Infinity;
    const focusSet = st.focus && nodes.has(st.focus) ? new Set([...tr.pathTo(st.focus), ...descendants(st.focus)]) : null;
    const q = st.q.trim().toLowerCase();
    const edges = [...tr.edges.values()].filter(e => {
      if (e.aggregate) return false;
      const a = nodes.get(e.from), b = nodes.get(e.to);
      if (!a || !b || b.hop !== a.hop + 1) return false;
      if (b.hop < st.a || b.hop > st.b) return false;
      if (flowOf(e) < st.min) return false;
      if (e.first && (e.first < from || e.first >= to)) return false;
      if (st.chain && b.chainId !== st.chain) return false;
      if (focusSet && !(focusSet.has(e.from) && focusSet.has(e.to))) return false;
      return true;
    });
    let kept = edges;
    if (st.type) {
      const ends = new Set([...nodes.values()].filter(n => (st.type === 'wallet' ? n.kind === 'wallet' : n.kind === st.type)).map(n => n.id));
      const onRoute = new Set();
      for (const id of ends) for (const p of tr.pathTo(id)) onRoute.add(p);
      kept = edges.filter(e => onRoute.has(e.to) && (st.type !== 'wallet' || nodes.get(e.to).kind === 'wallet'));
    }
    if (q) {
      const hits = [...nodes.values()].filter(n => n.address.toLowerCase().includes(q) || (n.label || '').toLowerCase().includes(q));
      const onRoute = new Set();
      for (const n of hits) { for (const p of tr.pathTo(n.id)) onRoute.add(p); for (const d of descendants(n.id)) onRoute.add(d); }
      kept = kept.filter(e => onRoute.has(e.from) && onRoute.has(e.to));
    }
    return kept;
  }

  function graph(edges) {
    const nodes = tr.nodes;
    const cols = [];
    for (let h = st.a - 1; h <= st.b; h++) cols.push(h);
    const val = new Map(), outVal = new Map();
    for (const e of edges) { val.set(e.to, (val.get(e.to) || 0) + flowOf(e)); outVal.set(e.from, (outVal.get(e.from) || 0) + flowOf(e)); }
    const colNodes = cols.map((h, i) => {
      const ids = new Set(edges.flatMap(e => [e.from, e.to]).filter(id => nodes.get(id).hop === h));
      if (i === 0) for (const e of edges) if (nodes.get(e.from).hop === h) ids.add(e.from);
      const list = [...ids].map(id => nodes.get(id)).sort((x, y) => ((i ? val.get(y.id) : outVal.get(y.id)) || 0) - ((i ? val.get(x.id) : outVal.get(x.id)) || 0));
      return { h, list: list.slice(0, st.top), hidden: list.slice(st.top) };
    });
    if (!edges.length) return '<p class="muted center fg-empty">No hop transfers match these filters yet.</p>';
    const NW = 250, GAP = 120, rowH = 50, gap = 8, top = 34;
    const W = cols.length * NW + (cols.length - 1) * GAP;
    const H = Math.max(180, Math.max(...colNodes.map(c => c.list.length + (c.hidden.length ? 1 : 0))) * (rowH + gap) + top + 10);
    const pos = new Map();
    colNodes.forEach((c, i) => {
      const n = c.list.length + (c.hidden.length ? 1 : 0);
      const y0 = top + (H - top - n * (rowH + gap)) / 2;
      c.list.forEach((node, j) => pos.set(node.id, { x: i * (NW + GAP), y: y0 + j * (rowH + gap) }));
      c.moreY = y0 + c.list.length * (rowH + gap);
    });
    const maxF = Math.max(1e-9, ...edges.map(flowOf));
    let links = '';
    for (const e of edges) {
      const p = pos.get(e.from), q = pos.get(e.to);
      if (!p || !q) continue;
      const b = nodes.get(e.to);
      const x1 = p.x + NW, y1 = p.y + rowH / 2, x2 = q.x, y2 = q.y + rowH / 2, mx = (x1 + x2) / 2;
      const w = 2 + 20 * Math.sqrt(flowOf(e) / maxF);
      const onFocus = st.focus && (e.to === st.focus || e.from === st.focus);
      links += `<path class="fg-link" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" style="fill:none;stroke:${CAT_VAR(catOf(b))};stroke-opacity:${onFocus ? .85 : .4}" stroke-width="${w.toFixed(1)}"><title>${esc(`${nodes.get(e.from).label} → ${b.label}: ${usd(flowOf(e)) || '<$1'} · ${e.count} transfer(s)`)}</title></path>`;
    }
    let boxes = '';
    colNodes.forEach((c, i) => {
      const x = i * (NW + GAP);
      const sum = i ? c.list.concat(c.hidden).reduce((s, n) => s + (val.get(n.id) || 0), 0) : 0;
      boxes += `<text x="${x}" y="14" style="${INK.h}">${c.h === 0 ? 'START' : `HOP ${c.h}`} · ${c.list.length + c.hidden.length} ${c.list.length + c.hidden.length === 1 ? 'WALLET' : 'WALLETS'}${sum ? ' · ' + esc(usd(sum)) : ''}</text>`;
      for (const n of c.list) {
        const p = pos.get(n.id), cat = catOf(n), root = n.id === tr.rootId, sel = n.id === st.focus;
        const fl = n.entity && n.entity.country ? flag(n.entity.country) + ' ' : '';
        const label = `${fl}${n.label || short(n.address)}`;
        const v = i ? val.get(n.id) : outVal.get(n.id);
        const kind = n.entity && n.entity.category === 'exploit' ? '⚠ Scam / hacker' : KIND_LABEL[n.kind] || '👛 Wallet';
        const end = n.kind === 'exchange' ? ' · end' : n.status === 'done' && ![...tr.edges.values()].some(e => e.from === n.id) ? ' · held' : '';
        boxes += `<g class="fg-node" data-id="${esc(n.id)}" tabindex="0"><title>${esc(`${n.label}\n${n.address}\n${CHAIN[n.chainId] ? CHAIN[n.chainId].name : n.chainId} · hop ${n.hop}`)}</title>
          <rect x="${p.x}" y="${p.y}" width="${NW}" height="${rowH}" rx="10" style="fill:${root ? 'color-mix(in srgb, var(--accent,#6366f1) 16%, var(--panel-solid,#fff))' : 'var(--panel-solid,#fff)'};stroke:${sel || root ? 'var(--accent,#6366f1)' : 'var(--line2,#cbd5e1)'};stroke-width:${sel || root ? 2 : 1}"/>
          <rect x="${p.x}" y="${p.y}" width="5" height="${rowH}" rx="2" style="fill:${CAT_VAR(cat)}"/>
          <text x="${p.x + 14}" y="${p.y + 20}" style="${INK.t}">${esc(label.length > 24 ? label.slice(0, 23) + '…' : label)}</text>
          <text x="${p.x + 14}" y="${p.y + 38}" style="${INK.s}">${esc(`${kind}${end} · ${CHAIN[n.chainId] ? CHAIN[n.chainId].name : ''}`)}</text>
          <text x="${p.x + NW - 10}" y="${p.y + 20}" text-anchor="end" style="${INK.v}">${esc(usd(v) || '')}</text></g>`;
      }
      if (c.hidden.length) boxes += `<text x="${x + 14}" y="${c.moreY + 20}" style="${INK.s}">+ ${c.hidden.length} more wallets (see table)</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="fg-svg" style="${cols.length > 4 ? `width:${W * 0.85}px;max-width:none` : ''}" role="img" aria-label="Hop by hop money flow">${links}${boxes}</svg>`;
  }

  function detail() {
    const box = $('hg-detail');
    const n = st.focus && tr.nodes.get(st.focus);
    if (!n) { box.innerHTML = ''; return; }
    const inc = [...tr.edges.values()].filter(e => e.to === n.id && !e.aggregate).reduce((s, e) => s + flowOf(e), 0);
    const out = [...tr.edges.values()].filter(e => e.from === n.id && !e.aggregate).reduce((s, e) => s + flowOf(e), 0);
    const path = tr.pathTo(n.id).map(id => tr.nodes.get(id)).filter(Boolean);
    box.innerHTML = `<div class="hg-detail">
      <div class="section-head"><div><b>${esc(n.label || short(n.address))}</b> <span class="muted small">hop ${n.hop} · ${esc(CHAIN[n.chainId] ? CHAIN[n.chainId].name : n.chainId)}${n.entity ? ' · ' + esc(CATEGORY_LABEL[n.entity.category] || '') : ''}</span>
        <div class="mono small break">${esc(n.address)} ${copyBtn(n.address)}</div></div>
        <div class="row-gap"><a class="btn ghost small-btn" href="#/${n.chainId}/address/${encodeURIComponent(n.address)}">Open wallet</a>
        <a class="btn small-btn" href="#/investigate/${n.chainId}/${encodeURIComponent(n.address)}">Investigate this wallet</a>
        <button class="btn ghost small-btn" id="hg-unfocus">✕ Clear focus</button></div></div>
      <div class="hg-path">${path.map((p, i) => `<span class="hg-step ${p.id === n.id ? 'on' : ''}">${i ? '→ ' : ''}${esc(p.label || short(p.address))}</span>`).join('')}</div>
      <div class="small muted">Received along the trail: <b>${esc(usd(inc) || '$0')}</b> · passed on: <b>${esc(usd(out) || '$0')}</b>${n.kind === 'exchange' ? ' · reached an exchange (trail ends here)' : ''}</div></div>`;
    $('hg-unfocus').onclick = () => { st.focus = null; render(true); };
  }

  function table(edges) {
    const rows = [...edges].sort((x, y) => tr.nodes.get(x.to).hop - tr.nodes.get(y.to).hop || flowOf(y) - flowOf(x));
    $('hg-count').textContent = `(${rows.length.toLocaleString()})`;
    const nm = id => { const n = tr.nodes.get(id); return link(n.chainId, 'address', n.address, n.label || null); };
    $('hg-rows').innerHTML = rows.slice(0, st.shown).map(e => {
      const b = tr.nodes.get(e.to), tx = e.txs && e.txs[0];
      return `<tr><td><span class="chip">Hop ${b.hop}</span></td><td>${nm(e.from)}</td><td>→</td><td>${nm(e.to)} ${b.kind === 'exchange' ? '<span class="ent ex"><span class="ent-i">🏦</span>Exchange</span>' : ''}</td>
        <td class="r">${esc(usd(flowOf(e)) || '<$1')}</td><td class="r">${e.count}</td><td>${e.first ? esc(new Date(e.first).toLocaleString()) : '—'}</td>
        <td>${tx && tx.hash && (tx.chainId || b.chainId) && CHAIN[tx.chainId || b.chainId] ? link(tx.chainId || b.chainId, 'tx', tx.hash) : ''} ${chainDot(CHAIN[b.chainId])}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No hop transfers in this view.</td></tr>';
    $('hg-more').innerHTML = rows.length > st.shown ? `<button class="btn ghost">Show more (${rows.length - st.shown})</button>` : '';
    if ($('hg-more').firstChild) $('hg-more').firstChild.onclick = () => { st.shown += 100; table(edges); };
    return rows;
  }

  let current = [];
  function render(force = false) {
    if (!snapshot()) { $('hg-status').textContent = 'The money trace is starting… the hop graph fills in as wallets are followed.'; return; }
    const latest = getTrace();
    const p = tr.progress ? tr.progress() : null;
    $('hg-status').innerHTML = latest.running ? `<span class="spinner tiny"></span> Following the money… ${p ? `hop ${p.hop}, ${p.wallets} wallets followed` : ''}. The graph updates automatically.` : `Trace complete: ${maxHop} hop${maxHop > 1 ? 's' : ''}, ${tr.nodes.size} wallets.`;
    if (st.b > maxHop) st.b = maxHop;
    const edges = model();
    const sig = `${edges.length}:${edges.reduce((s, e) => s + flowOf(e), 0).toFixed(0)}:${JSON.stringify(st)}`;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const reached = edges.filter(e => tr.nodes.get(e.to).kind === 'exchange').reduce((s, e) => s + flowOf(e), 0);
    const wallets = new Set(edges.map(e => e.to)).size;
    $('hg-kpis').innerHTML = `
      <div class="kpi"><div class="k">Hops shown</div><div class="v">${st.a === st.b ? `Hop ${st.a}` : `${st.a} → ${st.b}`}</div><div class="sub">of ${maxHop} traced</div></div>
      <div class="kpi"><div class="k">Money moved</div><div class="v">${esc(usd(edges.filter(e => tr.nodes.get(e.to).hop === st.a).reduce((s, e) => s + flowOf(e), 0)) || '$0')}</div><div class="sub">into hop ${st.a}</div></div>
      <div class="kpi"><div class="k">Wallets reached</div><div class="v">${wallets.toLocaleString()}</div><div class="sub">${edges.length} transfers</div></div>
      <div class="kpi"><div class="k">🏦 Reached exchanges</div><div class="v out">${esc(usd(reached) || '$0')}</div><div class="sub">in these hops</div></div>`;
    $('hg-canvas').innerHTML = graph(edges);
    detail();
    current = table(edges);
  }

  const read = () => {
    st.a = Number($('hg-a').value) || 1; st.b = Math.max(st.a, Number($('hg-b').value) || st.a);
    st.min = Number($('hg-min').value) || 0; st.chain = $('hg-chain').value; st.type = $('hg-type').value;
    st.top = Number($('hg-top').value) || 12; st.q = $('hg-q').value; st.from = $('hg-from').value; st.to = $('hg-to').value; st.shown = 60;
    render(true);
  };
  let t = 0;
  el.querySelector('.fg-filters').addEventListener('input', e => { if (e.target.id === 'hg-q' || e.target.id === 'hg-min') { clearTimeout(t); t = setTimeout(read, 250); } });
  el.querySelector('.fg-filters').addEventListener('change', e => { if (e.target.id !== 'hg-q') read(); });
  $('hg-hops').addEventListener('click', e => {
    const b = e.target.closest('[data-hop]');
    if (!b) return;
    if (b.dataset.hop === 'all') { st.a = 1; st.b = maxHop; } else { st.a = st.b = Number(b.dataset.hop); }
    st.shown = 60;
    render(true);
  });
  $('hg-reset').onclick = () => {
    Object.assign(st, { a: 1, b: 1, min: 0, chain: '', type: '', top: 12, q: '', focus: null, shown: 60 });
    ['hg-min', 'hg-q'].forEach(id => { $(id).value = id === 'hg-min' ? 0 : ''; });
    $('hg-chain').value = ''; $('hg-type').value = ''; $('hg-top').value = '12';
    datesSet = false;
    render(true);
  };
  $('hg-canvas').addEventListener('click', e => {
    const g = e.target.closest('.fg-node[data-id]');
    if (!g) return;
    st.focus = st.focus === g.dataset.id ? null : g.dataset.id;
    render(true);
    if (st.focus) $('hg-detail').scrollIntoView({ block: 'nearest' });
  });
  $('hg-deeper').onclick = e => { e.preventDefault(); document.getElementById('sec-final')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('hg-csv').onclick = () => {
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
    const lines = [['hop', 'from', 'from_label', 'to', 'to_label', 'to_type', 'network', 'traced_usd', 'transfers', 'first_seen_utc', 'tx_hash'].join(',')];
    for (const e of current) {
      const a = tr.nodes.get(e.from), b = tr.nodes.get(e.to);
      lines.push([b.hop, a.address, a.label, b.address, b.label, b.kind, b.chainId, flowOf(e).toFixed(2), e.count, e.first ? new Date(e.first).toISOString() : '', e.txs && e.txs[0] ? e.txs[0].hash : ''].map(q).join(','));
    }
    download(`cryptchain-hops-${short(ctx.address, 4).replace('…', '-')}-hop${st.a}-${st.b}.csv`, lines.join('\n'));
    toast('Hop transfers downloaded');
  };

  render(true);
  const timer = setInterval(() => {
    if (!document.body.contains(el)) return clearInterval(timer);
    if (el.hidden || el.offsetParent === null) return;
    render();
    const latest = getTrace();
    if (latest && !latest.running && lastSig) clearInterval(timer);
  }, 3000);
}
