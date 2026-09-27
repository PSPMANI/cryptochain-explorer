// Transaction inspection: where is this money going?
//   • straight to a labeled exchange wallet            → "Sending to Binance"
//   • to an unlabeled address that sweeps to an exchange → "Likely Binance deposit address" (1-hop lookahead)
//   • into a bridge                                    → resolve destination chain + recipient, then check
//                                                          whether *that* recipient is an exchange
//   • incoming from an exchange / bridge               → withdrawal / bridged-in notices
// Alert: { level: 'high' | 'medium' | 'info', kind, title, detail, chainId, hash, address, time,
//          entity?, bridge?, counterparty? }
import { CHAIN } from './chains.js';
import { entityOf, known, CATEGORY_LABEL, flag, COUNTRY } from './entities.js';
import { resolveBridgeTx, chainName } from './crosschain.js';
import { liveLabel, prefetchLabels, hasLiveLabels } from './labels-live.js';
import { adapter, withTimeout } from './core.js';
import { amount, short } from './ui.js';

const BRIDGE_METHOD = /^(depositV3|depositV3Now|deposit(ETH|ERC20)(To)?|bridge\w*|outboundTransfer\w*|sendToL2|depositForBurn\w*|transferTokens\w*|wrapAndTransfer\w*|sendFrom|send(OFT|Token)\w*|startBridgeTokens\w*|swapAndStartBridgeTokens\w*|swapAndBridge|initiateWithdrawal|withdrawTo|depositTransaction)$/;

// 1-hop lookahead cache: `${chainId}:${address}` → Promise<entity|null>
const depositCache = new Map();

/**
 * Is `address` an exchange deposit address? Exchanges give each customer a unique address and
 * periodically sweep it into a labeled hot wallet, so we check where its outgoing txs go.
 */
export function depositCheck(chainId, address) {
  const key = `${chainId}:${address.toLowerCase()}`;
  if (!depositCache.has(key)) {
    depositCache.set(key, (async () => {
      const chain = CHAIN[chainId];
      const a = await adapter(chainId);
      const page = await withTimeout(a.getTxs(address), 15000);
      const outs = page.items.filter(t => t.direction === 'out' && t.to).slice(0, 10);
      if (!outs.length) return null;
      if (hasLiveLabels(chainId)) await prefetchLabels(chainId, outs.map(t => t.to), 6);
      const ents = outs.map(t => entityOf(chain, t.to, t.toEntity, t.toName)).filter(e => e && e.category === 'exchange');
      if (!ents.length || ents.length < outs.length / 2) return null;
      const counts = {};
      ents.forEach(e => { counts[e.name] = (counts[e.name] || 0) + 1; });
      const name = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
      const sweep = outs.find(t => { const e = entityOf(chain, t.to, t.toEntity, t.toName); return e && e.name === name; });
      return { name, category: 'exchange', label: `Likely ${name} deposit address`, inferred: true, sweepTo: sweep && sweep.to, sweepToLabel: sweep && (entityOf(chain, sweep.to, sweep.toEntity, sweep.toName) || {}).label };
    })().catch(() => null));
  }
  return depositCache.get(key);
}

/**
 * Inspect one transaction summary relative to `address`.
 * opts.deep – allow network lookups (bridge resolution, deposit-address lookahead)
 */
export async function inspectTx(chainId, address, tx, { deep = true } = {}) {
  // A token send's "to" is the token contract: inspect each real token recipient instead
  if (tx.direction === 'out' && tx.tokenTransfers && tx.tokenTransfers.length) {
    const each = await Promise.all(tx.tokenTransfers.map(k => inspectTx(chainId, address,
      { ...tx, tokenTransfers: null, to: k.to, toName: k.toName, toEntity: k.toEntity, value: k.value, symbol: k.symbol }, { deep })));
    return each.flat();
  }
  const chain = CHAIN[chainId];
  const base = { chainId, hash: tx.hash, address, time: tx.time || Date.now() };
  // Zero native value usually means a token transfer / contract call; the amount isn't in the summary
  // Dust (< 1 gwei) is usually address-poisoning spam; treat it like a zero-value call
  const real = tx.value && tx.value >= 1e-9;
  const amt = real ? `${amount(tx.value)} ${tx.symbol || chain.symbol}` : (tx.value ? 'a dust amount' : `a ${tx.method || 'contract'} call`);
  const alerts = [];
  // Who is the watched wallet itself? (to spot an exchange moving funds between its own wallets)
  const selfEnt = known(chain, address) || (tx.direction === 'out' ? tx.fromEntity : tx.toEntity) || null;

  if (tx.direction === 'out' && tx.to) {
    const ent = entityOf(chain, tx.to, tx.toEntity, tx.toName) || (hasLiveLabels(chainId) ? await liveLabel(chainId, tx.to) : null);
    const looksBridge = (ent && ent.category === 'bridge') || BRIDGE_METHOD.test(tx.method || '');

    if (ent && ent.category === 'exploit') {
      alerts.push({ ...base, level: 'high', kind: 'exploit', entity: ent, counterparty: tx.to,
        title: real ? `⚠ Sending ${amt} to ${ent.name}` : `⚠ Interaction with ${ent.name} (${tx.method || 'contract call'})`, detail: `${ent.label} (${short(tx.to)}): a wallet publicly flagged for a hack/exploit` });
    } else if (ent && ['fund', 'custodian', 'issuer'].includes(ent.category)) {
      alerts.push({ ...base, level: 'medium', kind: 'institution', entity: ent, counterparty: tx.to,
        title: real ? `Sending ${amt} to ${ent.name}${flagOf(ent)}` : `Transaction to ${ent.name}${flagOf(ent)} (${tx.method || 'contract call'})`,
        detail: `${ent.label} · ${CATEGORY_LABEL[ent.category]} (${short(tx.to)})` });
    } else if (ent && ent.category === 'exchange' && selfEnt && selfEnt.category === 'exchange' && selfEnt.name === ent.name) {
      alerts.push({ ...base, level: 'info', kind: 'exchange-internal', entity: ent, counterparty: tx.to,
        title: `Internal ${ent.name} transfer${tx.value ? `: ${amt}` : ` (${tx.method || 'contract call'})`}`, detail: `${selfEnt.label} → ${ent.label}` });
    } else if (ent && ent.category === 'exchange') {
      alerts.push({ ...base, level: 'high', kind: 'exchange-deposit', entity: ent, counterparty: tx.to,
        title: real ? `Sending ${amt} to ${ent.name}${flagOf(ent)}` : `Transaction to ${ent.name}${flagOf(ent)} (${tx.method || 'contract call'})`,
        detail: `${ent.label} (${short(tx.to)}) on ${chain.name}` });
    } else if (looksBridge) {
      const b = deep ? await withTimeout(resolveBridgeTx(chainId, tx.hash, address), 20000).catch(() => null) : null;
      if (b) {
        const dst = CHAIN[b.dstChain];
        let destEnt = dst && b.recipient ? known(dst, b.recipient) : null;
        if (!destEnt && deep && dst && b.recipient && b.recipient.toLowerCase() !== address.toLowerCase()) {
          destEnt = await depositCheck(dst.id, b.recipient).catch(() => null);
        }
        const what = b.amount != null ? `${amount(b.amount)} ${b.symbol || ''}`.trim() : amt;
        alerts.push({ ...base, level: destEnt && destEnt.category === 'exchange' ? 'high' : 'medium', kind: 'bridge-out', bridge: b, entity: destEnt,
          counterparty: b.recipient,
          title: destEnt && destEnt.category === 'exchange'
            ? `Bridging ${what} to ${chainName(b.dstChain)} → ${destEnt.name}`
            : `Bridging ${what} to ${chainName(b.dstChain)} via ${b.app || b.protocol}`,
          detail: `${b.protocol} · ${b.status}${b.recipient ? ` · recipient ${short(b.recipient)}` : ''}${destEnt ? ` (${destEnt.label})` : ''}` });
      } else {
        alerts.push({ ...base, level: 'medium', kind: 'bridge-out', entity: ent, counterparty: tx.to,
          title: `Bridge transfer of ${amt} via ${ent ? ent.name : tx.method}`,
          detail: deep ? 'Destination not indexed yet; it will be checked again.' : 'Open to resolve the destination chain.', pending: true });
      }
    } else if (deep && !ent) {
      const dep = await depositCheck(chainId, tx.to);
      if (dep) {
        alerts.push({ ...base, level: 'high', kind: 'exchange-deposit', entity: dep, counterparty: tx.to,
          title: `Sending ${amt} to ${dep.name}${flagOf(dep)} (deposit address)`,
          detail: `${short(tx.to)} forwards funds to ${dep.sweepToLabel || dep.name}` });
      }
    }
  } else if (tx.direction === 'in' && tx.from) {
    const ent = entityOf(chain, tx.from, tx.fromEntity, tx.fromName) || (hasLiveLabels(chainId) ? await liveLabel(chainId, tx.from) : null);
    if (ent && ent.category === 'exploit') {
      alerts.push({ ...base, level: 'high', kind: 'exploit', entity: ent, counterparty: tx.from,
        title: real ? `⚠ Received ${amt} from ${ent.name}` : `⚠ Interaction with ${ent.name} (${tx.method || 'contract call'})`, detail: `${ent.label} (${short(tx.from)}): funds from a wallet publicly flagged for a hack/exploit` });
    } else if (ent && ent.category === 'exchange') {
      alerts.push({ ...base, level: 'info', kind: 'exchange-withdrawal', entity: ent, counterparty: tx.from,
        title: `Received ${amt} from ${ent.name}${flagOf(ent)}`, detail: `Withdrawal from ${ent.label}` });
    } else if (ent && ent.category === 'bridge') {
      alerts.push({ ...base, level: 'info', kind: 'bridge-in', entity: ent, counterparty: tx.from,
        title: `Received ${amt} via ${ent.name}`, detail: `Bridged in on ${chain.name}` });
    }
  }
  return alerts;
}

/**
 * Verify where a transfer is going. Returns
 *   { verdict: 'exchange' | 'deposit' | 'bridge' | 'exploit' | 'dex' | 'contract' | 'wallet',
 *     entity, text, bridge?, final? }   (final = the verified end on the other chain for bridges)
 * `tx` (optional) lets bridge transfers be resolved to their destination chain.
 */
export async function verifyDestination(chainId, address, { tx = null, hint = null, name = null, from = null } = {}) {
  const chain = CHAIN[chainId];
  const place = e => (e && e.country && COUNTRY[e.country] ? ` · ${flag(e.country)} ${COUNTRY[e.country].name}` : '');
  const ent = entityOf(chain, address, hint, name) || (hasLiveLabels(chainId) ? await liveLabel(chainId, address) : null);
  if (ent && ent.category === 'exchange') return { verdict: 'exchange', entity: ent, text: `🏦 ${ent.label}${place(ent)} · exchange wallet` };
  if (ent && ent.category === 'exploit') return { verdict: 'exploit', entity: ent, text: `⚠ ${ent.label}: publicly flagged hack/exploit wallet` };
  const bridgeLike = (ent && ent.category === 'bridge') || (tx && BRIDGE_METHOD.test(tx.method || ''));
  if (bridgeLike && tx) {
    const b = await withTimeout(resolveBridgeTx(chainId, tx.hash, from), 20000).catch(() => null);
    if (b) {
      const dst = CHAIN[b.dstChain];
      let final = null;
      if (dst && b.recipient) final = await verifyDestination(dst.id, b.recipient).catch(() => null);
      return { verdict: 'bridge', entity: ent, bridge: b, final,
        text: `🌉 ${b.protocol} bridge → ${chainName(b.dstChain)}${b.recipient ? `, recipient ${short(b.recipient)}` : ''}${final ? `: ${final.text}` : ''}${b.status === 'pending' ? ' (in flight)' : ''}` };
    }
    return { verdict: 'bridge', entity: ent, text: `🌉 ${ent ? ent.label : 'Bridge'}: destination not indexed yet` };
  }
  if (ent && ['fund', 'custodian', 'issuer'].includes(ent.category)) return { verdict: 'service', entity: ent, text: `🏢 ${ent.label}${place(ent)} · ${CATEGORY_LABEL[ent.category]}` };
  if (ent && ent.category === 'dex') return { verdict: 'dex', entity: ent, text: `🔁 ${ent.label} · DEX swap` };
  if (ent && ent.category !== 'person') return { verdict: 'contract', entity: ent, text: `📄 ${ent.label}` };
  const dep = await depositCheck(chainId, address).catch(() => null);
  if (dep) return { verdict: 'deposit', entity: dep, text: `🏦 ${dep.label}${place(dep)}: forwards funds to ${dep.sweepToLabel || dep.name}` };
  return { verdict: 'wallet', entity: ent, text: ent ? `👤 ${ent.label}: not an exchange` : '👛 Private wallet: not an exchange (checked where it sends its funds)' };
}

/** Short badge text for a counterparty, used in tx tables. */
export function entityBadge(ent) {
  if (!ent) return '';
  const cls = ent.category === 'exchange' ? 'ex' : ent.category === 'bridge' ? 'br' : ent.category === 'dex' ? 'dx' : ent.category === 'exploit' ? 'danger' : '';
  const fl = ent.country ? flag(ent.country) + ' ' : '';
  const title = `${ent.label || ent.name}${ent.country && COUNTRY[ent.country] ? ' · ' + COUNTRY[ent.country].name : ''}`.replace(/"/g, '&quot;');
  return `<span class="ent ${cls}" title="${title}">${ent.category === 'exploit' ? '⚠ ' : ''}${fl}${ent.inferred ? '≈ ' : ''}${ent.name.replace(/</g, '&lt;')}${ent.category !== 'other' && ent.category !== 'exploit' ? ' · ' + CATEGORY_LABEL[ent.category] : ''}</span>`;
}

const flagOf = ent => (ent && ent.country ? ' ' + flag(ent.country) : '');
