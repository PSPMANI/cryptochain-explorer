// Login + account pages.
import { CHAIN } from '../chains.js';
import { detect } from '../detect.js';
import { auth, signInEmail, signInGoogle, signOut } from '../auth.js';
import { listWatch, addWatch, removeWatch, listInvestigations, removeInvestigation, listAlerts, markAlertsRead, listLabels, removeLabel } from '../store.js';
import { setCustomLabels, CATEGORY_LABEL, flag } from '../entities.js';
import { main, adapter, withTimeout, toast } from '../core.js';
import { getPrices, priceOf } from '../prices.js';
import { esc, short, amount, usd, identicon, chainDot, link, timeCell } from '../ui.js';
import { alertItem, notificationsButton } from './shared.js';

export const FEATURES = [
  ['🔎', 'Investigate workflow', 'Full history across chains, money-flow diagram, counterparties, CSV export'],
  ['⚡', 'Live flow alerts', 'Instantly see when a wallet sends to an exchange or bridges to another chain'],
  ['👁', 'Watchlist', 'Monitor wallets in the background with browser notifications'],
  ['💾', 'Saved investigations', 'Keep your cases and reopen them any time'],
];

export async function loginPage(stale, next = '#/account') {
  await auth.ready;
  if (auth.user) { location.replace(next); return; }
  document.title = 'Sign in · CryptChain';
  const demo = auth.mode === 'demo';
  main.innerHTML = `
    <div class="login-wrap">
      <div class="card login">
        <h1>Sign in to CryptChain</h1>
        <p class="muted">The explorer is free for everyone. Signing in unlocks the investigation tools.</p>
        ${demo ? `<div class="notice demo"><b>Demo mode.</b> Accounts are stored only in this browser and emails are not verified.
          Connect Supabase in <code>js/config.js</code> before launch (see README).</div>` : ''}
        <form id="login-form" class="stack">
          ${demo ? '<label>Name <input name="name" autocomplete="name" placeholder="Your name"></label>' : ''}
          <label>Email <input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <button class="btn">${demo ? 'Continue (demo)' : 'Email me a sign-in link'}</button>
        </form>
        ${demo ? '' : `<div class="or"><span>or</span></div><button class="btn ghost wide" id="google">Continue with Google</button>`}
        <p class="muted small" id="login-msg"></p>
      </div>
      <div class="features">${FEATURES.map(([i, t, d]) => `<div class="feature"><span class="fi">${i}</span><div><b>${t}</b><div class="muted small">${d}</div></div></div>`).join('')}</div>
    </div>`;
  const msg = document.getElementById('login-msg');
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await signInEmail(f.get('email') || '', f.get('name') || '');
      if (r.sent) msg.textContent = 'Check your inbox for the sign-in link.';
      else { toast(`Signed in as ${auth.user.name}`); location.replace(next); }
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
  document.getElementById('google')?.addEventListener('click', () => signInGoogle().catch(err => { msg.textContent = err.message; }));
}

let accountAlertsHandler = () => {};

export async function accountPage(stale) {
  await auth.ready;
  if (!auth.user) { location.replace('#/login?next=' + encodeURIComponent('#/account')); return; }
  const u = auth.user;
  document.title = 'Account · CryptChain';
  main.innerHTML = `
    <div class="card">
      <div class="identity">${identicon(u.email, 52)}
        <div class="grow"><div class="name">${esc(u.name)}</div><div class="muted">${esc(u.email)}
          ${auth.mode === 'demo' ? ' <span class="chip pend">Demo account</span>' : ''}</div></div>
        <button class="btn ghost" id="signout">Sign out</button></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>⚡ Flow alerts</h2><div class="row-gap">${notificationsButton()}<button class="btn ghost small-btn" id="markread">Mark all read</button></div></div>
      <div id="alert-feed" class="alert-list"></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>👁 Watchlist</h2><span class="muted small">Checked every 30 s while CryptChain is open</span></div>
      <form id="watch-form" class="search"><input name="addr" placeholder="Add a wallet address to watch" autocomplete="off" spellcheck="false">
        <select name="chain" aria-label="Network"></select><input name="label" placeholder="Label (optional)" class="label-in"><button class="btn">Watch</button></form>
      <div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Network</th><th class="r">Balance</th><th></th></tr></thead><tbody id="watch-rows"></tbody></table></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>🏷 My labels</h2><span class="muted small">Add one from any address page with 🏷 Label</span></div>
      <div id="label-list"></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>💾 Saved investigations</h2></div>
      <div id="inv-list"></div>
    </div>`;

  document.getElementById('signout').onclick = async () => { await signOut(); toast('Signed out'); location.hash = '#/'; };
  document.getElementById('markread').onclick = () => { markAlertsRead(); renderAlerts(); window.dispatchEvent(new Event('alerts-changed')); };
  const renderAlerts = () => {
    const list = listAlerts();
    document.getElementById('alert-feed').innerHTML = list.length ? list.slice(0, 60).map(alertItem).join('')
      : '<p class="muted">No alerts yet. Watch a wallet and CryptChain will alert you when it sends to an exchange or bridges to another chain.</p>';
  };
  renderAlerts();
  window.removeEventListener('alerts-changed', accountAlertsHandler);
  accountAlertsHandler = () => { if (!stale()) renderAlerts(); };
  window.addEventListener('alerts-changed', accountAlertsHandler);

  // Watchlist
  const form = document.getElementById('watch-form');
  const sel = form.querySelector('select');
  const fillChains = () => {
    const c = detect(form.addr.value).filter(x => x.kind === 'address');
    sel.innerHTML = c.length ? c.map(x => `<option value="${x.chainId}">${esc(CHAIN[x.chainId].name)}</option>`).join('') : '<option value="">Network</option>';
  };
  form.addr.addEventListener('input', fillChains);
  fillChains();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (!sel.value) return toast('Enter a valid address first');
    try {
      const info = await (await adapter(sel.value)).getAddress(form.addr.value.trim());
      await addWatch(sel.value, info.address, form.label.value);
      toast('Added to watchlist');
      form.reset(); fillChains();
      renderWatch();
    } catch (err) { toast(err.message || 'Address not found'); }
  });

  const renderWatch = async () => {
    const list = await listWatch();
    const tbody = document.getElementById('watch-rows');
    tbody.innerHTML = list.length ? list.map(w => `<tr data-id="${esc(w.id)}">
        <td>${link(w.chain_id, 'address', w.address, w.label || null)}${w.label ? `<div class="muted small mono">${esc(short(w.address))}</div>` : ''}</td>
        <td>${chainDot(CHAIN[w.chain_id])} ${esc(CHAIN[w.chain_id].name)}</td>
        <td class="r bal">…</td>
        <td class="r"><a class="btn ghost small-btn" href="#/investigate/${w.chain_id}/${encodeURIComponent(w.address)}">Investigate</a>
          <button class="icon-btn" data-remove="${esc(w.id)}" title="Remove">✕</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Nothing watched yet.</td></tr>';
    tbody.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => { await removeWatch(b.dataset.remove); renderWatch(); });
    const prices = await getPrices();
    for (const w of list) {
      const cell = tbody.querySelector(`tr[data-id="${CSS.escape(w.id)}"] .bal`);
      try {
        const info = await withTimeout((await adapter(w.chain_id)).getAddress(w.address), 15000);
        const p = priceOf(prices, CHAIN[w.chain_id]);
        if (cell) cell.innerHTML = `${amount(info.balance)} ${esc(CHAIN[w.chain_id].symbol)}<div class="muted small">${p ? usd(info.balance * p.usd) : ''}</div>`;
      } catch { if (cell) cell.textContent = '—'; }
    }
  };
  renderWatch();

  // My labels
  const renderLabels = async () => {
    const list = await listLabels();
    const el = document.getElementById('label-list');
    el.innerHTML = list.length ? `<div class="table-scroll"><table><thead><tr><th>Address</th><th>Network</th><th>Name</th><th>Type</th><th></th></tr></thead><tbody>
      ${list.map(l => { const cid = l.chain_id === 'evm' ? 'ethereum' : l.chain_id; return `<tr><td>${link(cid, 'address', l.address, short(l.address))}</td>
        <td>${l.chain_id === 'evm' ? 'All EVM networks' : CHAIN[l.chain_id] ? esc(CHAIN[l.chain_id].name) : esc(l.chain_id)}</td>
        <td><b>${esc(l.name)}</b> ${l.country ? flag(l.country) : ''}</td><td class="small">${esc(CATEGORY_LABEL[l.category] || l.category)}</td>
        <td class="r"><button class="icon-btn" data-dellabel="${esc(l.id)}" title="Remove">✕</button></td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="muted">No labels yet. Label your exchange deposit addresses (or any wallet you know) and CryptChain will recognize them everywhere.</p>';
    el.querySelectorAll('[data-dellabel]').forEach(b => b.onclick = async () => { await removeLabel(b.dataset.dellabel); setCustomLabels(await listLabels()); renderLabels(); });
  };
  renderLabels();

  // Saved investigations
  const renderInv = async () => {
    const list = await listInvestigations();
    const el = document.getElementById('inv-list');
    el.innerHTML = list.length ? `<div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Networks</th><th class="r">Received</th><th class="r">Sent</th><th>Saved</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr><td class="mono">${esc(i.summary && i.summary.name ? i.summary.name : short(i.address))}</td>
        <td>${(i.chain_ids || []).map(c => CHAIN[c] ? chainDot(CHAIN[c]) : '').join(' ')} <span class="muted small">${(i.chain_ids || []).length}</span></td>
        <td class="r in">${usd(i.summary && i.summary.inUsd) || '—'}</td><td class="r out">${usd(i.summary && i.summary.outUsd) || '—'}</td>
        <td>${timeCell(Date.parse(i.created_at))}</td>
        <td class="r"><a class="btn ghost small-btn" href="#/investigate/${(i.chain_ids || []).join(',')}/${encodeURIComponent(i.address)}?depth=${(i.params && i.params.depth) || 500}&run=1">Open</a>
          <button class="icon-btn" data-del="${esc(i.id)}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No saved investigations yet. Run one from any address page with <b>Investigate</b>.</p>';
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await removeInvestigation(b.dataset.del); renderInv(); });
  };
  renderInv();
}
