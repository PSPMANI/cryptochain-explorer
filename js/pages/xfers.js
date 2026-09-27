// Live outgoing transfers on an address page: the moment the wallet sends (pending or confirmed),
// a card shows the real destination address (token recipients, not token contracts) and verifies it
// automatically: exchange? deposit address? bridge → which chain / recipient? plain wallet?
import { CHAIN } from '../chains.js';
import { verifyDestination } from '../alerts.js';
import { toast } from '../core.js';
import { esc, short, amount, link, copyBtn, timeCell } from '../ui.js';

const VERDICT_CLASS = { service: 'v-other', exchange: 'v-ex', deposit: 'v-ex', bridge: 'v-br', exploit: 'v-danger', dex: 'v-dx', contract: 'v-other', wallet: 'v-wallet' };

/**
 * Outgoing transfers from native tx summaries + token transfers.
 * For a tx that moved tokens, the destination is the token recipient (tx.to is just the token contract).
 */
export function outgoingTransfers(addr, txItems, tokItems = []) {
  const me = addr.toLowerCase();
  const tokOut = tokItems.filter(t => t.from && t.from.toLowerCase() === me && t.to);
  const byHash = new Map();
  for (const t of tokOut) (byHash.get(t.hash) || byHash.set(t.hash, []).get(t.hash)).push(t);
  const out = [];
  for (const t of txItems) {
    if (t.direction !== 'out' && !(t.from && t.from.toLowerCase() === me)) continue;
    const key = to => `${t.hash}:${String(to).toLowerCase()}`;
    const toks = byHash.get(t.hash);
    if (t.tokenTransfers && t.tokenTransfers.length) {
      // Adapter already knows the real token recipients (decoded even while the tx is pending)
      t.tokenTransfers.forEach(k => out.push({ key: key(k.to), hash: t.hash, time: t.time, status: t.status, to: k.to, toName: k.toName, toEntity: k.toEntity, amount: k.value, symbol: k.symbol, method: t.method, via: t.to }));
      byHash.delete(t.hash);
    } else if (toks) {
      toks.forEach(k => out.push({ key: key(k.to), hash: t.hash, time: t.time || k.time, status: t.status, to: k.to, toName: k.toName, toEntity: k.toEntity, amount: k.value, symbol: k.symbol, method: t.method, via: t.to }));
      byHash.delete(t.hash);
    } else if (t.to && (t.value || t.direction === 'out')) {
      out.push({ key: key(t.to), hash: t.hash, time: t.time, status: t.status, to: t.to, toName: t.toName, toEntity: t.toEntity, amount: t.value, symbol: t.symbol, method: t.method });
    }
  }
  // Token moves initiated by someone else (router / transferFrom): still money leaving this wallet
  for (const [hash, toks] of byHash) toks.forEach(k => out.push({ key: `${hash}:${String(k.to).toLowerCase()}`, hash, time: k.time, status: k.status || 'success', to: k.to, toName: k.toName, toEntity: k.toEntity, amount: k.value, symbol: k.symbol, method: k.method }));
  return out.sort((a, b) => (b.time || Infinity) - (a.time || Infinity)); // pending (no time) first
}

export function mountOutgoing(el, { chainId, address }) {
  const shown = new Map();
  el.innerHTML = '<div class="muted small">Looking for recent outgoing transfers…</div>';

  const card = x => `<div class="xfer ${x.fresh ? 'new' : ''}" data-key="${esc(x.key)}">
      <div class="xfer-top"><span class="chip ${x.status === 'pending' ? 'pend' : x.status === 'failed' ? 'fail' : 'ok'}">${x.status === 'pending' ? '⏳ Pending' : x.status === 'failed' ? 'Failed' : 'Confirmed'}</span>
        <b class="xfer-amt">${x.amount ? `${amount(x.amount)} ${esc(x.symbol || '')}` : esc(x.method || 'Contract call')}</b>
        <span class="muted small">${timeCell(x.time)}</span><span class="grow"></span>${link(chainId, 'tx', x.hash)}</div>
      <div class="xfer-to"><span class="muted small">To</span> <span class="mono break">${esc(x.to)}</span> ${copyBtn(x.to)}
        <a class="small" href="#/${chainId}/address/${encodeURIComponent(x.to)}">open →</a>
        <span class="small muted"><span class="dot" style="background:${CHAIN[chainId].color}"></span> ${esc(CHAIN[chainId].name)}</span></div>
      <div class="xfer-verdict ${x.v ? VERDICT_CLASS[x.v.verdict] || '' : 'checking'}">${x.v ? esc(x.v.text) : '<span class="spinner tiny"></span> Verifying destination…'}</div>
      ${x.v && x.v.bridge && x.v.bridge.recipient && CHAIN[x.v.bridge.dstChain] ? `<div class="small">On ${esc(CHAIN[x.v.bridge.dstChain].name)}: ${link(x.v.bridge.dstChain, 'address', x.v.bridge.recipient, short(x.v.bridge.recipient))}${x.v.bridge.dstTx ? ' · ' + link(x.v.bridge.dstChain, 'tx', x.v.bridge.dstTx) : ''}</div>` : ''}
    </div>`;

  const paint = () => {
    const list = [...shown.values()].sort((a, b) => (b.time || Infinity) - (a.time || Infinity)).slice(0, 8);
    el.innerHTML = list.length ? list.map(card).join('') : '<div class="muted small">No outgoing transfers yet. New ones appear here the moment they are sent.</div>';
  };

  async function verify(x, { notify = false } = {}) {
    x.v = await verifyDestination(chainId, x.to, { tx: { hash: x.hash, method: x.method }, hint: x.toEntity, name: x.toName, from: address }).catch(() => ({ verdict: 'wallet', text: 'Could not verify destination' }));
    paint();
    if (notify && ['exchange', 'deposit', 'bridge', 'exploit', 'service'].includes(x.v.verdict)) toast(`${x.amount ? `${amount(x.amount)} ${x.symbol} ` : ''}→ ${x.v.text}`, x.v.verdict === 'bridge' ? 'medium' : 'high');
  }

  return {
    /** Feed the latest page(s). initial = first load (show the 3 most recent, no toasts). */
    update(txItems, tokItems, { initial = false } = {}) {
      const list = outgoingTransfers(address, txItems, tokItems);
      const fresh = [];
      for (const x of (initial ? list.slice(0, 3) : list)) {
        const cur = shown.get(x.key);
        if (cur) { if (cur.status !== x.status) { cur.status = x.status; cur.time = x.time; if (x.status !== 'pending') toast(`Transfer confirmed: ${cur.amount ? amount(cur.amount) + ' ' + cur.symbol : cur.method}`); } continue; }
        if (!initial && !x.time && x.status !== 'pending') continue;
        x.fresh = !initial;
        shown.set(x.key, x);
        fresh.push(x);
      }
      paint();
      for (const x of fresh) {
        if (!initial) toast(`📤 Transfer sent: ${x.amount ? `${amount(x.amount)} ${x.symbol}` : x.method} → ${short(x.to)} · verifying…`);
        verify(x, { notify: !initial });
      }
      return fresh;
    },
  };
}
