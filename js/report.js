import { CHAIN } from './chains.js';
import { COUNTRY, CATEGORY_LABEL, flag } from './entities.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = x => (x == null || isNaN(x) ? '' : '$' + Number(x).toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 }));
const num = x => (x == null || isNaN(x) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) >= 1 ? 4 : 8 }));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const utc = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'pending');
const day = t => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
const short = a => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '');
const place = cc => (cc && COUNTRY[cc] ? `${flag(cc)} ${COUNTRY[cc].name}` : '');
const who = (ent, addr) => (ent ? `${ent.label || ent.name}${ent.category && ent.category !== 'other' ? ` (${CATEGORY_LABEL[ent.category] || ent.category})` : ''}` : `Unlabeled wallet ${short(addr)}`);
const FINAL = {
  exchange: 'Cashed in at exchanges', bridge: 'Bridged to another chain (destination unknown)', dex: 'Swapped on decentralized exchanges',
  contract: 'Sent into contracts / tokens', service: 'Institutions & busy services', held: 'Still held in wallets',
  small: 'Small amounts (not followed)', limit: 'Not followed yet (limit reached)', error: 'Could not be loaded',
};

export function buildReport(m, ctx, trace, site) {
  const t = m.totals;
  const sum = trace && trace.sum;
  const tr = trace && trace.tr;
  const nets = ctx.chainIds.map(c => CHAIN[c].name).join(', ');
  const title = ctx.name ? `${ctx.name} (${short(ctx.address)})` : ctx.address;
  const txLink = (chainId, hash) => (chainId && hash ? `<a href="${esc(site)}#/${chainId}/tx/${encodeURIComponent(hash)}">${esc(short(hash))}</a>` : '');

  const exch = sum ? sum.exchanges : [];
  const exchTotal = sum ? sum.byType.exchange || 0 : m.categories.exchange.out;
  const topEx = exch.slice(0, 3).map(x => `${x.name}${x.country ? ` ${flag(x.country)}` : ''} (${usd(x.usd)})`).join(', ');
  const brOut = ctx.bridges.filter(b => b.direction === 'out');
  const findings = [];
  const poison = m.warnings.filter(w => w.kind === 'address-poisoning');
  for (const w of m.warnings.filter(x => x.kind !== 'address-poisoning')) findings.push(`⚠ <b>${esc(w.title)}.</b> ${esc(w.detail)}`);
  if (poison.length) findings.push(`⚠ <b>${poison.length} address-poisoning lookalike${poison.length > 1 ? 's' : ''} found.</b> Scammers send tiny transfers from addresses that look almost identical to real counterparties, hoping someone copies the wrong address from the history. Never copy addresses from transaction history. The full list is in the appendix.`);
  if (m.categories.exploit.n) findings.push(`⚠ <b>This wallet interacted with wallets publicly flagged as hackers or exploiters</b> (${m.categories.exploit.n} transfers).`);
  if (exch.length) findings.push(`🏦 <b>${pct(exchTotal, sum.total)} of the money it sent reached exchanges</b>: ${esc(topEx)}${exch.length > 3 ? ` and ${exch.length - 3} more` : ''}.`);
  else if (m.categories.exchange.out) findings.push(`🏦 <b>${usd(m.categories.exchange.out)} was sent directly to exchanges.</b>`);
  if (m.india.n) findings.push(`🇮🇳 <b>Indian exchanges involved:</b> ${esc(Object.keys(m.india.byExchange).join(', '))} (${usd(m.india.out)} sent, ${usd(m.india.in)} received).`);
  if (brOut.length) findings.push(`🌉 <b>${brOut.length} cross-chain transfer${brOut.length > 1 ? 's' : ''}</b> moved money to ${esc([...new Set(brOut.map(b => (CHAIN[b.dstChain] ? CHAIN[b.dstChain].name : b.dstChain)))].join(', '))}.`);
  if (sum && sum.byType.held) findings.push(`👛 <b>${usd(sum.byType.held)} (${pct(sum.byType.held, sum.total)}) is still sitting in wallets</b> along the trail.`);
  if (sum && sum.notFollowed > 1) findings.push(`⋯ ${usd(sum.notFollowed)} (${pct(sum.notFollowed, sum.total)}) was not followed to the end because of the trace limits.`);

  const summaryText = `Between <b>${day(t.first)}</b> and <b>${day(t.last)}</b>, this wallet received <b>${usd(t.inUsd) || '$0'}</b>
    in ${m.rows.filter(r => r.direction === 'in').length} transfers and sent <b>${usd(t.outUsd) || '$0'}</b> in
    ${m.rows.filter(r => r.direction === 'out').length} transfers, dealing with ${t.counterparties} different counterparties on ${esc(nets)}.
    ${sum && sum.total ? `Following every dollar it sent through up to ${sum.maxHops} hops, <b>${pct(exchTotal, sum.total)} ended up at exchanges</b>${topEx ? ` (mainly ${esc(topEx)})` : ''}.` : ''}`;

  const finalRows = sum ? Object.entries(sum.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<tr><td>${esc(FINAL[k] || k)}</td><td class="r">${usd(v)}</td><td class="r">${pct(v, sum.total)}</td></tr>`).join('') : '';
  const exRows = exch.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(place(x.country))}</td><td class="r">${usd(x.usd)}</td><td class="r">${pct(x.usd, sum.total)}</td></tr>`).join('');

  const hopRows = sum ? sum.hops.map(h => `<tr><td>Hop ${h.hop}</td><td class="r">${h.wallets}</td><td class="r">${usd(h.arrived)}</td>
    <td>${Object.entries(h.ended).map(([k, v]) => `${esc(FINAL[k] || k)} ${usd(v)}`).join('; ') || '—'}</td><td class="r">${usd(h.passedOn)}</td></tr>`).join('') : '';
  const routes = sum && tr ? sum.finals.filter(f => f.nodeId && f.type !== 'small').slice(0, 12).map((f, i) => {
    const ids = tr.pathTo(f.nodeId);
    const steps = ids.slice(1).map((id, j) => {
      const e = tr.edges.get(`${ids[j]}>${id}`);
      const n = tr.nodes.get(id);
      return `<li><span class="when">${esc(utc(e && e.first))}</span> → <b>${esc(who(n.entity, n.address))}</b>
        ${n.chainId && CHAIN[n.chainId] ? `<span class="muted">on ${esc(CHAIN[n.chainId].name)}</span>` : ''}
        ${e && e.cross ? `<span class="muted">(bridged via ${esc(e.cross.protocol)})</span>` : ''}
        ${e && e.txs[0] ? `<span class="muted">· first transfer ${txLink(e.txs[0].chainId, e.txs[0].hash)}</span>` : ''}</li>`;
    }).join('');
    return `<div class="route"><div class="route-h">Route ${i + 1}: ${usd(f.usd)} (${pct(f.usd, sum.total)}) → ${esc(FINAL[f.type] || f.type)}${f.entity && f.entity.country ? ` · ${esc(place(f.entity.country))}` : ''}</div>
      <ol><li><span class="when">start</span> → <b>Investigated wallet</b> ${esc(short(ctx.address))}</li>${steps}</ol></div>`;
  }).join('') : '';

  const bridgeRows = ctx.bridges.map(b => `<tr><td>${esc(utc(b.time))}</td><td>${b.direction === 'out' ? 'Sent out' : 'Received'}</td><td>${esc(b.protocol)}</td>
    <td>${esc(CHAIN[b.srcChain] ? CHAIN[b.srcChain].name : b.srcChain)} → ${esc(CHAIN[b.dstChain] ? CHAIN[b.dstChain].name : b.dstChain)}</td>
    <td class="r">${b.amount != null ? `${num(b.amount)} ${esc(b.symbol || '')}` : '—'}</td><td class="r">${usd(b.usd)}</td>
    <td>${esc(short(b.direction === 'out' ? b.recipient : b.sender))}</td><td>${esc(b.status)}</td></tr>`).join('');
  const cpRows = m.counterparties.slice(0, 40).map(c => `<tr><td>${esc(who(c.entity, c.address))}</td><td>${esc(CHAIN[c.chainId].name)}</td>
    <td class="r">${c.nIn ? usd(c.inUsd) || '—' : ''}</td><td class="r">${c.nOut ? usd(c.outUsd) || '—' : ''}</td><td class="r">${c.nIn + c.nOut}</td>
    <td>${esc(utc(c.first))}</td><td>${esc(utc(c.last))}</td></tr>`).join('');
  const logRows = [...m.rows].sort((a, b) => (a.time || 0) - (b.time || 0)).map((r, i) => `<tr><td class="r">${i + 1}</td><td>${esc(utc(r.time))}</td>
    <td>${r.direction === 'in' ? 'Received' : 'Sent'}</td><td class="r">${num(r.value)} ${esc(r.symbol)}</td><td class="r">${r.usdValue != null ? usd(r.usdValue) : ''}</td>
    <td>${r.direction === 'in' ? 'from' : 'to'} ${esc(who(r.entity, r.counterparty))}<div class="addr">${esc(r.counterparty)}</div></td>
    <td>${esc(CHAIN[r.chainId].name)}</td><td>${txLink(r.chainId, r.hash)}</td></tr>`).join('');

  const generated = new Date();
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wallet investigation report · ${esc(short(ctx.address))}</title>
<style>
  :root { --ink: #16181d; --muted: #5b6270; --line: #dfe3ea; --soft: #f4f6f9; --accent: #2f66f0; --warn: #b3261e; }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--ink); background: #fff; margin: 0; }
  .page { max-width: 1000px; margin: 0 auto; padding: 32px 24px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 10px; border-bottom: 2px solid var(--line); padding-bottom: 6px; }
  .meta { color: var(--muted); font-size: 13px; } .muted { color: var(--muted); font-size: 12px; }
  .box { background: var(--soft); border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin: 14px 0; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; } .kpi b { display: block; font-size: 18px; }
  ul.findings { padding-left: 18px; } ul.findings li { margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: var(--soft); font-weight: 600; } .r { text-align: right; white-space: nowrap; }
  .addr { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--muted); word-break: break-all; }
  .route { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin: 10px 0; break-inside: avoid; }
  .route-h { font-weight: 700; } .route ol { margin: 6px 0 0; padding-left: 20px; } .route li { margin: 3px 0; }
  .when { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--accent); }
  a { color: var(--accent); } .toolbar { position: sticky; top: 0; background: #fff; padding: 10px 0; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
  .toolbar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--accent); color: #fff; cursor: pointer; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; } dt { font-weight: 600; }
  @media print { .toolbar { display: none; } .page { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } a { color: inherit; text-decoration: none; } }
</style></head><body><div class="page">
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
<h1>Wallet investigation report</h1>
<div class="meta">Wallet: <b>${esc(title)}</b><br>Networks: ${esc(nets)} · Transfers analyzed: ${m.rows.length.toLocaleString()} (up to ${ctx.depth} per network)<br>
Period covered: ${esc(utc(t.first))} → ${esc(utc(t.last))}<br>Report generated: ${esc(utc(generated.getTime()))} (${esc(generated.toString().slice(0, 24))} local time) · CryptChain Explorer</div>

<h2>1. In short</h2>
<div class="box">${summaryText}</div>
<div class="kpis">
  <div class="kpi">Received<b>${usd(t.inUsd) || '$0'}</b></div><div class="kpi">Sent<b>${usd(t.outUsd) || '$0'}</b></div>
  <div class="kpi">Net change<b>${t.inUsd - t.outUsd >= 0 ? '+' : '−'}${usd(Math.abs(t.inUsd - t.outUsd)) || '$0'}</b></div>
  <div class="kpi">Reached exchanges<b>${usd(exchTotal) || '$0'}</b></div><div class="kpi">Counterparties<b>${t.counterparties}</b></div>
  <div class="kpi">Cross-chain transfers<b>${ctx.bridges.length}</b></div>
</div>

<h2>2. Key findings</h2>
${findings.length ? `<ul class="findings">${findings.map(f => `<li>${f}</li>`).join('')}</ul>` : '<p>No exchange, bridge or risk signals were found in the analyzed history.</p>'}

${sum ? `<h2>3. Where the money ended up</h2>
<p>Every dollar the wallet sent was followed from wallet to wallet until it reached an end point. Totals add up to 100% of ${usd(sum.total)} sent.</p>
<table><thead><tr><th>End point</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>${finalRows}</tbody></table>
${exRows ? `<h3>Exchanges that received the money</h3><table><thead><tr><th>Exchange</th><th>Location</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>${exRows}</tbody></table>` : ''}

<h2>4. Money trail (follow-up)</h2>
<p>How the money moved hop by hop. A hop is one transfer from one wallet to the next.</p>
<table><thead><tr><th>Hop</th><th class="r">Wallets reached</th><th class="r">Money arriving</th><th>Ended at this hop</th><th class="r">Passed on</th></tr></thead><tbody>${hopRows}</tbody></table>
<h3>Main routes, step by step</h3>
<p class="muted">Each step shows when money first moved along it (UTC) and a link to that transfer.</p>
${routes || '<p class="muted">No routes to show.</p>'}` : `<h2>3. Where the money ended up</h2><p class="muted">The full money trace was still running when this report was created; re-download it once it finishes to include this section.</p>`}

<h2>${sum ? 5 : 4}. Cross-chain transfers</h2>
${bridgeRows ? `<table><thead><tr><th>Time (UTC)</th><th>Direction</th><th>Bridge</th><th>Route</th><th class="r">Amount</th><th class="r">Value</th><th>Other side</th><th>Status</th></tr></thead><tbody>${bridgeRows}</tbody></table>` : '<p>None found in Across, LayerZero or Wormhole.</p>'}

<h2>${sum ? 6 : 5}. Main counterparties</h2>
<table><thead><tr><th>Counterparty</th><th>Network</th><th class="r">Received from</th><th class="r">Sent to</th><th class="r">Transfers</th><th>First seen (UTC)</th><th>Last seen (UTC)</th></tr></thead><tbody>${cpRows}</tbody></table>

<h2>${sum ? 7 : 6}. Complete transaction log</h2>
<p class="muted">All ${m.rows.length.toLocaleString()} analyzed transfers, oldest first. Times are UTC. Values use current prices for native coins and stablecoins.</p>
<table><thead><tr><th class="r">#</th><th>Date &amp; time (UTC)</th><th>Direction</th><th class="r">Amount</th><th class="r">Value</th><th>Counterparty</th><th>Network</th><th>Transaction</th></tr></thead><tbody>${logRows}</tbody></table>

${poison.length ? `<h2>Appendix: address-poisoning lookalikes</h2>
<table><thead><tr><th>Lookalike (fake)</th><th>Imitates (real)</th></tr></thead><tbody>
${poison.map(w => `<tr><td class="addr">${esc(w.address)}</td><td class="addr">${esc(w.real)}</td></tr>`).join('')}</tbody></table>` : ''}

<h2>${sum ? 8 : 7}. How to read this report</h2>
<dl>
  <dt>Hop</dt><dd>One step of money moving from one wallet to the next.</dd>
  <dt>Exchange</dt><dd>A trading platform (e.g. Binance, CoinDCX). Money reaching an exchange is usually converted or withdrawn there.</dd>
  <dt>Deposit address</dt><dd>A personal address an exchange gives each customer; recognized by forwarding its funds into the exchange's main wallet.</dd>
  <dt>Bridge</dt><dd>A service that moves money from one blockchain to another.</dd>
  <dt>Still held</dt><dd>Money that has not moved on from a wallet on the trail.</dd>
  <dt>Exploiter</dt><dd>A wallet publicly flagged as belonging to a hacker or attacker.</dd>
  <dt>Tracing method</dt><dd>Money is followed proportionally: each wallet passes traced money on in proportion to what it sent after the money arrived (standard "haircut" method). It is an estimate, not proof of exactly which coins moved.</dd>
  <dt>Sources</dt><dd>Public blockchain data (Blockscout, mempool.space, TronGrid, Solana RPC and others) and public labels (Open Labels Initiative, Dune Spellbook, DefiLlama, WalletExplorer, TronScan, XRPScan, TonAPI). Labels identify exchanges and services, never private individuals.</dd>
</dl>
</div></body></html>`;
}

export function trailCSV(tr) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
  const head = ['time_utc', 'hop', 'from', 'from_label', 'to', 'to_label', 'to_network', 'amount', 'asset', 'traced_usd', 'tx_hash', 'bridge'];
  const rows = [];
  for (const e of tr.edges.values()) {
    const a = tr.nodes.get(e.from), b = tr.nodes.get(e.to);
    for (const t of e.txs) rows.push([t.time ? new Date(t.time).toISOString() : '', b.hop, a.address || a.label, a.entity ? a.entity.label : '', b.address || b.label,
      b.entity ? b.entity.label : '', b.chainId, t.amount, t.symbol, e.txs.length ? ((e.traced || e.usd || 0) / e.txs.length).toFixed(2) : '', t.hash, e.cross ? e.cross.protocol : '']);
  }
  rows.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  return [head.join(','), ...rows.map(r => r.map(q).join(','))].join('\n');
}
