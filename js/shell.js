import { CHAINS, CHAIN } from './chains.js';
import { detect } from './detect.js';
import { getPrices, priceOf } from './prices.js';
import { DIRECTORY, flag } from './entities.js';
import { esc, short, usd } from './ui.js';

const PAGES = [
  { icon: '◈', title: 'Dashboard', sub: 'Live networks and prices', href: '#/' },
  { icon: '⌖', title: 'Investigate a wallet', sub: 'Follow the money through every hop, download a report', href: '#/investigate-start' },
  { icon: '⬡', title: 'All exchanges & institutions', sub: 'Global directory of labeled wallets', href: '#/exchanges/all' },
  { icon: '🇮🇳', title: 'Indian exchanges', sub: 'WazirX, CoinDCX, CoinSwitch, …', href: '#/exchanges/india' },
  { icon: '▤', title: 'My workspace', sub: 'Watchlist, alerts, labels, saved investigations', href: '#/account' },
];

let opts = { search: () => {}, recent: () => [] };

export function initShell(o) {
  opts = { ...opts, ...o };
  window.addEventListener('hashchange', markNav);
  markNav();
  initPalette();
  ticker();
  setInterval(ticker, 60000);
}

function markNav() {
  const a = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  const b = location.hash.replace(/^#\/?/, '').split(/[/?]/)[1];
  const key = !a ? 'home'
    : a === 'investigate' || a === 'investigate-start' ? 'investigate'
    : a === 'exchanges' ? (b === 'india' ? 'india' : 'exchanges')
    : a === 'account' ? 'account' : '';
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === key));
}

async function ticker() {
  const el = document.getElementById('ticker');
  if (!el) return;
  let prices;
  try { prices = await getPrices(); } catch { return; }
  const seen = new Set(), items = [];
  for (const c of CHAINS) {
    if (c.testnet || seen.has(c.symbol)) continue;
    const p = priceOf(prices, c);
    if (!p || !p.usd) continue;
    seen.add(c.symbol);
    const chg = p.change != null ? `<span class="${p.change >= 0 ? 'up' : 'down'}">${p.change >= 0 ? '▲' : '▼'} ${Math.abs(p.change).toFixed(2)}%</span>` : '';
    items.push(`<a class="tk" href="#/" title="${esc(c.name)}"><b>${esc(c.symbol)}</b><span>${usd(p.usd)}</span>${chg}</a>`);
  }
  if (!items.length) return;
  el.innerHTML = items.join('') + items.join('');
}

function initPalette() {
  const box = document.getElementById('cmdk'), input = document.getElementById('cmdk-q'), list = document.getElementById('cmdk-list');
  if (!box) return;
  let items = [], sel = 0;

  const open = () => {
    box.hidden = false;
    input.value = '';
    render();
    requestAnimationFrame(() => input.focus());
  };
  const close = () => { box.hidden = true; };
  const go = it => {
    close();
    if (!it) return;
    if (it.search) opts.search(it.search);
    else if (it.href) { if (location.hash === it.href) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = it.href; }
  };

  function build(q) {
    const out = [];
    const t = q.trim();
    if (t) {
      const cands = detect(t);
      if (cands.length) {
        const kinds = [...new Set(cands.map(c => c.kind))];
        const kind = kinds.includes('name') ? 'Name' : kinds.includes('tx') && !kinds.includes('address') ? 'Transaction' : 'Address';
        const nets = cands.length === 1 ? CHAIN[cands[0].chainId].name : `${cands.length} networks`;
        out.push({ group: 'Search', icon: kind === 'Transaction' ? '⇄' : kind === 'Name' ? '@' : '◎', title: short(t, 14), sub: `${kind} · ${nets}`, search: t });
        if (kind === 'Address') {
          const ids = cands.filter(c => c.kind === 'address' && !CHAIN[c.chainId].testnet).map(c => c.chainId);
          if (ids.some(id => CHAIN[id].family === 'evm')) ids.splice(0, ids.length, 'ethereum');
          out.push({ group: 'Search', icon: '⌖', title: 'Investigate this wallet', sub: `Trace funds to their final destinations · ${ids.length === 1 ? CHAIN[ids[0]].name : ids.length + ' networks'}`, href: `#/investigate/${ids.join(',')}/${encodeURIComponent(t)}` });
        }
      } else {
        out.push({ group: 'Search', icon: '⌕', title: `Search "${t.length > 40 ? t.slice(0, 40) + '…' : t}"`, sub: 'Address, transaction, name or exchange', search: t });
      }
      const n = t.toLowerCase().replace(/[\s.]/g, '');
      const ex = n.length >= 2 ? DIRECTORY.filter(e => e.name.toLowerCase().replace(/[\s.]/g, '').includes(n)).slice(0, 7) : [];
      ex.forEach(e => out.push({ group: 'Exchanges & institutions', icon: flag(e.country) || '⬡', title: e.name, sub: [e.category, e.country].filter(Boolean).join(' · '), href: `#/exchanges/${e.country === 'IN' ? 'india' : 'all'}/${encodeURIComponent(e.name)}` }));
      const ch = CHAINS.filter(c => !c.testnet && (c.name.toLowerCase().includes(t.toLowerCase()) || c.symbol.toLowerCase() === t.toLowerCase())).slice(0, 4);
      ch.forEach(c => out.push({ group: 'Networks', icon: '●', title: c.name, sub: `${c.symbol} · paste an address or tx to explore`, href: '#/' , color: c.color }));
      PAGES.filter(p => (p.title + ' ' + p.sub).toLowerCase().includes(t.toLowerCase())).forEach(p => out.push({ group: 'Pages', ...p }));
    } else {
      opts.recent().slice(0, 5).forEach(r => out.push({ group: 'Recent', icon: '↺', title: r.label, sub: CHAIN[r.chainId] ? CHAIN[r.chainId].name : '', href: r.href }));
      PAGES.forEach(p => out.push({ group: 'Pages', ...p }));
    }
    return out;
  }

  function render() {
    items = build(input.value);
    sel = 0;
    let g = null;
    list.innerHTML = items.map((it, i) => {
      const head = it.group !== g ? `<div class="cmdk-group">${esc(it.group)}</div>` : '';
      g = it.group;
      const icon = it.color ? `<span style="color:${esc(it.color)}">●</span>` : esc(it.icon);
      return `${head}<div class="cmdk-item${i === sel ? ' on' : ''}" role="option" data-i="${i}"><span class="ci">${icon}</span>
        <span class="ct"><b>${esc(it.title)}</b><span>${esc(it.sub || '')}</span></span><span class="go">↵</span></div>`;
    }).join('') || '<div class="cmdk-group">No matches</div>';
  }
  const move = d => {
    if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    list.querySelectorAll('.cmdk-item').forEach(el => el.classList.toggle('on', +el.dataset.i === sel));
    const on = list.querySelector('.cmdk-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('mousemove', e => { const it = e.target.closest('.cmdk-item'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; move(0); } });
  list.addEventListener('click', e => { const it = e.target.closest('.cmdk-item'); if (it) go(items[+it.dataset.i]); });
  box.addEventListener('mousedown', e => { if (e.target === box) close(); });

  document.getElementById('cmdk-open')?.addEventListener('click', open);
  document.addEventListener('click', e => { if (e.target.closest('[data-cmdk]')) { e.preventDefault(); open(); } });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.hidden ? open() : close(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing && box.hidden) { e.preventDefault(); open(); }
  });
}
