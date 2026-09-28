import { CHAIN } from '../chains.js';
import { chainName } from '../crosschain.js';
import { esc, link, timeCell } from '../ui.js';

const ICON = { 'exchange-deposit': '🏦', 'exchange-withdrawal': '🏦', 'exchange-internal': '🔁', institution: '🏢', 'bridge-out': '🌉', 'bridge-in': '🌉', exploit: '⚠️', activity: '•' };

export function alertItem(a) {
  const b = a.bridge;
  const bridgeLine = b ? `<div class="alert-bridge">
      ${chainLabel(b.srcChain)} ${b.srcTx && CHAIN[b.srcChain] ? link(b.srcChain, 'tx', b.srcTx) : ''}
      <span class="muted">→</span> ${chainLabel(b.dstChain)} ${b.dstTx && CHAIN[b.dstChain] ? link(b.dstChain, 'tx', b.dstTx) : b.dstTx ? '' : '<span class="chip pend">in flight</span>'}
      ${b.recipient && CHAIN[b.dstChain] ? `· to ${link(b.dstChain, 'address', b.recipient, a.entity && a.entity.category === 'exchange' ? a.entity.label : null)}` : ''}</div>` : '';
  return `<div class="alert ${esc(a.level)} ${a.read === false ? 'unread' : ''}">
    <div class="alert-icon">${ICON[a.kind] || '•'}</div>
    <div class="grow">
      <div class="alert-title">${esc(a.title)}</div>
      <div class="muted small">${esc(a.detail || '')}</div>
      ${bridgeLine}
      <div class="small alert-meta">${a.chainId && CHAIN[a.chainId] ? `<span class="dot" style="background:${CHAIN[a.chainId].color}"></span> ${esc(CHAIN[a.chainId].name)} · ` : ''}
        ${a.hash && a.chainId ? link(a.chainId, 'tx', a.hash) + ' · ' : ''}${a.address && a.chainId ? 'wallet ' + link(a.chainId, 'address', a.address) + ' · ' : ''}${timeCell(a.time)}</div>
    </div></div>`;
}

const chainLabel = id => CHAIN[id]
  ? `<span class="chip chain" style="--c:${CHAIN[id].color}"><span class="dot" style="background:${CHAIN[id].color}"></span>${esc(CHAIN[id].name)}</span>`
  : `<span class="chip">${esc(chainName(id))}</span>`;
export { chainLabel };

export function notificationsButton() {
  if (!('Notification' in window)) return '';
  if (Notification.permission === 'granted') return '<span class="chip ok">Notifications on</span>';
  if (Notification.permission === 'denied') return '<span class="chip" title="Allow notifications for this site in your browser settings">Notifications blocked</span>';
  return `<button class="btn ghost small-btn" onclick="Notification.requestPermission().then(()=>dispatchEvent(new Event('hashchange')))">Enable notifications</button>`;
}
