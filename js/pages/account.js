import { CHAIN } from '../chains.js';
import { detect } from '../detect.js';
import { listWatch, addWatch, removeWatch, listInvestigations, removeInvestigation, listAlerts, markAlertsRead, listLabels, removeLabel, clearAll } from '../store.js';
import { setCustomLabels, CATEGORY_LABEL, flag } from '../entities.js';
import { main, adapter, withTimeout, toast } from '../core.js';
import { getPrices, priceOf } from '../prices.js';
import { esc, short, amount, usd, chainDot, link, timeCell } from '../ui.js';
import { alertItem, notificationsButton } from './shared.js';

let accountAlertsHandler = () => {};

export async function accountPage(stale) {
  document.title = 'My workspace · CryptChain';
  main.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">📋 My workspace</h1>
        <p class="muted">Your searches, alerts, watched wallets, labels and saved investigations.</p></div>
      <button class="btn ghost small-btn" id="wipe">🗑 Clear all my data</button>
    </div>
    <div class="privacy"><span style="font-size:20px">🔒</span><div><b>Private to you.</b> <span class="muted">Everything on this page is saved only in this browser on this device. CryptChain has no accounts and no server database, so other visitors never see what you search, watch or label.</span></div></div>
    <div class="card">
      <div class="section-head"><h2>🕘 Recent searches</h2><button class="btn ghost small-btn" id="clear-recent">Clear</button></div>
      <div id="recent-list"></div>
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

  const renderRecent = () => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('recent') || '[]').filter(r => CHAIN[r.chainId]); } catch {}
    document.getElementById('recent-list').innerHTML = list.length
      ? `<div class="quick">${list.map(r => `<a href="${esc(r.href)}">${chainDot(CHAIN[r.chainId])}${esc(r.label)}</a>`).join('')}</div>`
      : '<p class="muted">No searches yet.</p>';
  };
  renderRecent();
  document.getElementById('clear-recent').onclick = () => { try { localStorage.removeItem('recent'); } catch {} renderRecent(); toast('Recent searches cleared'); };
  document.getElementById('wipe').onclick = () => {
    if (!confirm('Delete your searches, watchlist, alerts, labels and saved investigations from this browser?')) return;
    clearAll();
    setCustomLabels([]);
    window.dispatchEvent(new Event('alerts-changed'));
    toast('All your data was removed from this browser');
    accountPage(stale);
  };

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
