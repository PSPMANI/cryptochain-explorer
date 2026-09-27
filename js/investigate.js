// Investigation engine (DOM-free). The workflow the Investigate page drives:
//   1. collect()   pull many pages of history per chain (native txs + token transfers where available)
//   2. classify    every transfer: direction, asset, USD value, counterparty entity (exchange / bridge / dex / …)
//   3. analyze()   totals per asset, per counterparty, per category, daily timeline, first/last activity
//   4. cross-chain bridge activity comes from crosschain.bridgeActivity() and is merged by the page
import { CHAIN } from './chains.js';
import { adapter, withTimeout } from './core.js';
import { entityOf } from './entities.js';

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'USDS', 'USDE', 'FDUSD', 'PYUSD', 'TUSD', 'USDD', 'USDC.E', 'USDT0', 'USD₮0', 'USDBC', 'RLUSD', 'USDT.E']);

/**
 * Collect transfers for one chain.
 * onProgress({ chainId, stream, count, done }) is called after every page.
 * shouldStop() lets the page cancel when the user navigates away.
 */
export async function collect(chainId, address, { maxItems = 500, onProgress = () => {}, shouldStop = () => false } = {}) {
  const a = await adapter(chainId);
  const streams = [{ name: 'transactions', fn: (c) => a.getTxs(address, c) }];
  if (a.getTokenTransfers) streams.push({ name: 'token transfers', fn: (c) => a.getTokenTransfers(address, c) });

  const all = [];
  const errors = [];
  for (const s of streams) {
    let cursor = null, count = 0;
    do {
      if (shouldStop()) return { items: all, errors, stopped: true };
      let page;
      try { page = await withTimeout(s.fn(cursor), 30000); }
      catch (e) { errors.push(`${s.name}: ${e.message}`); break; }
      // Where token transfers come from their own stream, zero-value native txs are just contract calls:
      // the money movement is already in the token stream, so skip them to keep counterparties honest.
      const items = page.items.filter(t => !(a.getTokenTransfers && s.name === 'transactions' && !t.value));
      items.forEach(t => all.push({ ...t, chainId, stream: s.name }));
      count += page.items.length;
      cursor = page.next;
      onProgress({ chainId, stream: s.name, count, done: !cursor || count >= maxItems });
    } while (cursor && count < maxItems);
  }
  return { items: all, errors };
}

/**
 * Fake tokens: flagged by the API, symbols with invisible/lookalike characters, or a token contract
 * pretending to be the chain's native coin (e.g. an ERC-20 called "ETH").
 */
export function suspiciousToken(t) {
  if (!t.token) return false;
  const chain = CHAIN[t.chainId];
  return !!t.scam || /[^\x20-\x7E]/.test(t.symbol || '') || String(t.symbol).toUpperCase() === chain.symbol;
}

/** USD value of a transfer when we can price it: native coin via CoinGecko, stablecoins at $1, or the API's own rate. */
export function usdOf(t, prices) {
  if (suspiciousToken(t)) return null;
  if (t.usd != null) return t.usd;
  const chain = CHAIN[t.chainId];
  if (t.symbol === chain.symbol && chain.coingeckoId && prices[chain.coingeckoId]) return t.value * prices[chain.coingeckoId].usd;
  if (STABLES.has(String(t.symbol).toUpperCase())) return t.value;
  return null;
}

/** Aggregate collected transfers into the report model. */
export function analyze(items, address, prices) {
  const me = address.toLowerCase();
  const assets = new Map(), cps = new Map(), days = new Map();
  const cats = { exchange: { in: 0, out: 0, n: 0 }, bridge: { in: 0, out: 0, n: 0 }, dex: { in: 0, out: 0, n: 0 }, exploit: { in: 0, out: 0, n: 0 }, other: { in: 0, out: 0, n: 0 }, unlabeled: { in: 0, out: 0, n: 0 } };
  const india = { in: 0, out: 0, n: 0, byExchange: {} }; // Indian exchanges (subset of cats.exchange)
  let first = null, last = null, totalIn = 0, totalOut = 0;

  const rows = items
    .filter(t => t.direction === 'in' || t.direction === 'out')
    .map(t => {
      const chain = CHAIN[t.chainId];
      const cp = t.direction === 'in' ? t.from : t.to;
      const ent = entityOf(chain, cp, t.direction === 'in' ? t.fromEntity : t.toEntity, t.direction === 'in' ? t.fromName : t.toName);
      return { ...t, counterparty: cp, cpName: t.direction === 'in' ? t.fromName : t.toName, entity: ent, usdValue: usdOf(t, prices) };
    })
    .filter(t => t.counterparty && t.counterparty.toLowerCase() !== me)
    .sort((x, y) => (y.time || 0) - (x.time || 0));

  for (const t of rows) {
    const usd = t.usdValue || 0;
    const dir = t.direction;
    if (dir === 'in') totalIn += usd; else totalOut += usd;
    if (t.time) { first = Math.min(first ?? t.time, t.time); last = Math.max(last ?? t.time, t.time); }

    const ak = `${t.chainId}:${t.token || t.symbol}`;
    const asset = assets.get(ak) || { chainId: t.chainId, symbol: t.symbol, token: t.token || null, in: 0, out: 0, inUsd: 0, outUsd: 0, nIn: 0, nOut: 0 };
    asset[dir] += t.value; asset[dir + 'Usd'] += usd; asset[dir === 'in' ? 'nIn' : 'nOut']++;
    assets.set(ak, asset);

    const ck = `${t.chainId}:${t.counterparty.toLowerCase()}`;
    const cp = cps.get(ck) || { chainId: t.chainId, address: t.counterparty, name: t.cpName || null, entity: t.entity, inUsd: 0, outUsd: 0, nIn: 0, nOut: 0, first: t.time, last: t.time, assets: {} };
    cp[dir + 'Usd'] += usd; cp[dir === 'in' ? 'nIn' : 'nOut']++;
    cp.first = Math.min(cp.first ?? t.time, t.time ?? cp.first); cp.last = Math.max(cp.last ?? t.time, t.time ?? cp.last);
    cp.assets[t.symbol] = (cp.assets[t.symbol] || 0) + (dir === 'in' ? t.value : -t.value);
    if (!cp.entity && t.entity) cp.entity = t.entity;
    cps.set(ck, cp);

    const cat = t.entity ? (cats[t.entity.category] ? t.entity.category : 'other') : 'unlabeled';
    cats[cat][dir] += usd; cats[cat].n++;
    if (t.entity && t.entity.country === 'IN' && t.entity.category === 'exchange') {
      india[dir] += usd; india.n++;
      const ex = india.byExchange[t.entity.name] || (india.byExchange[t.entity.name] = { in: 0, out: 0, n: 0 });
      ex[dir] += usd; ex.n++;
    }

    if (t.time) {
      const d = new Date(t.time).toISOString().slice(0, 10);
      const day = days.get(d) || { day: d, inUsd: 0, outUsd: 0, nIn: 0, nOut: 0 };
      day[dir + 'Usd'] += usd; day[dir === 'in' ? 'nIn' : 'nOut']++;
      days.set(d, day);
    }
  }

  const byValue = (k) => (x, y) => (y[k] - x[k]) || (y[k === 'inUsd' ? 'nIn' : 'nOut'] - x[k === 'inUsd' ? 'nIn' : 'nOut']);
  const counterparties = [...cps.values()];

  // Warnings: fake tokens and address-poisoning lookalikes
  const warnings = [];
  const fakes = [...new Set(rows.filter(suspiciousToken).map(t => `${t.symbol} (${t.token})`))];
  if (fakes.length) warnings.push({ kind: 'fake-token', title: `${fakes.length} suspicious token${fakes.length > 1 ? 's' : ''} excluded from USD totals`, detail: fakes.slice(0, 5).join(', ') });
  const evm = counterparties.filter(c => /^0x[0-9a-fA-F]{40}$/.test(c.address));
  const sig = a => a.slice(2, 6).toLowerCase() + a.slice(-4).toLowerCase();
  const groups = {};
  evm.forEach(c => { (groups[sig(c.address)] ||= []).push(c); });
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    // The "real" one is the address with the most value/activity; the others imitate it
    g.sort((x, y) => (y.inUsd + y.outUsd) - (x.inUsd + x.outUsd) || (y.nIn + y.nOut) - (x.nIn + x.nOut));
    for (const fake of g.slice(1)) {
      fake.poison = g[0].address;
      warnings.push({ kind: 'address-poisoning', address: fake.address, chainId: fake.chainId, real: g[0].address,
        title: 'Address-poisoning lookalike detected',
        detail: `${fake.address} imitates ${g[0].entity ? g[0].entity.label + ' ' : ''}${g[0].address}. Never copy addresses from transaction history.` });
    }
  }

  return {
    rows,
    warnings,
    totals: { inUsd: totalIn, outUsd: totalOut, count: rows.length, counterparties: counterparties.length, first, last },
    assets: [...assets.values()].sort((x, y) => (y.inUsd + y.outUsd) - (x.inUsd + x.outUsd) || (y.nIn + y.nOut) - (x.nIn + x.nOut)),
    counterparties: counterparties.sort((x, y) => (y.inUsd + y.outUsd) - (x.inUsd + x.outUsd) || (y.nIn + y.nOut) - (x.nIn + x.nOut)),
    sources: counterparties.filter(c => c.nIn).sort(byValue('inUsd')),
    destinations: counterparties.filter(c => c.nOut).sort(byValue('outUsd')),
    categories: cats,
    india,
    timeline: [...days.values()].sort((x, y) => x.day.localeCompare(y.day)),
  };
}

/** CSV export of classified transfers. */
export function toCSV(rows) {
  const head = ['time_utc', 'chain', 'direction', 'amount', 'asset', 'usd', 'counterparty', 'counterparty_label', 'category', 'tx_hash', 'method'];
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; // CSV-injection safe
  };
  return [head.join(','), ...rows.map(t => [
    t.time ? new Date(t.time).toISOString() : '', t.chainId, t.direction, t.value, t.symbol,
    t.usdValue != null ? t.usdValue.toFixed(2) : '', t.counterparty, t.entity ? t.entity.label : t.cpName || '',
    t.entity ? t.entity.category : '', t.hash, t.method || '',
  ].map(q).join(','))].join('\n');
}
