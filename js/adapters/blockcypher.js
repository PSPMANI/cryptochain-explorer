// BlockCypher adapter (Dogecoin, Dash, Litecoin; also works for other BlockCypher UTXO coins).
// chain.api is the coin root, e.g. https://api.blockcypher.com/v1/doge/main
// Unauthenticated limits are tight (~3 req/s, 100 req/hr per IP), so every
// method does exactly one request and responses are cached briefly.

import { fetchJSON, fromUnits, toMs, NotFound } from '../utils.js';

const PAGE = 25;     // txs per getTxs page (/full allows up to 50)
const TX_IO = 50;    // max inputs/outputs returned per tx

// Address formats per chain: base58 prefixes (P2PKH + P2SH) and bech32 HRP (if any).
// Unknown chains fall back to generic base58 / bech32 checks.
const FORMATS = {
  dogecoin: { base58: /^[DA9]/, p2sh: /^[A9]/ },
  dash: { base58: /^[X7]/, p2sh: /^7/ },
  litecoin: { base58: /^[LM3]/, p2sh: /^[M3]/, hrp: 'ltc' },
  bitcoin: { base58: /^[13]/, p2sh: /^3/, hrp: 'bc' },
};
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{26,35}$/;
const BECH32 = /^([a-z]{1,4})1[02-9ac-hj-np-z]{8,87}$/;
const HASH = /^[0-9a-fA-F]{64}$/;

export default function create(chain) {
  const api = chain.api.replace(/\/$/, '');
  const dec = chain.decimals ?? 8;
  const amt = v => Number(fromUnits(v ?? 0, dec).toFixed(dec)); // toFixed trims float noise (1.6440000000000001)

  const fmt = FORMATS[chain.id] || { base58: /^/, p2sh: /^[23M]/ };

  function checkAddress(address) {
    const a = String(address || '').trim();
    if (BASE58.test(a) && fmt.base58.test(a)) return a;
    // Bech32 is case-insensitive; BlockCypher expects lowercase.
    const m = BECH32.exec(a.toLowerCase());
    if (m && (fmt.hrp ? m[1] === fmt.hrp : !FORMATS[chain.id])) return a.toLowerCase();
    throw new NotFound(`Not a valid ${chain.name} address`);
  }

  function checkHash(hash) {
    const h = String(hash || '').trim().replace(/^0x/i, '');
    if (!HASH.test(h)) throw new NotFound(`Not a valid ${chain.name} transaction hash`);
    return h.toLowerCase();
  }

  function kindOf(a) {
    if (/^[a-z]{1,4}1p/.test(a)) return 'Wallet (Taproot)';
    if (/^[a-z]{1,4}1q/.test(a)) return a.length > 50 ? 'Script (P2WSH)' : 'Wallet (SegWit)';
    return fmt.p2sh.test(a) ? 'Script (P2SH)' : 'Wallet'; // P2SH is usually multisig / wrapped script
  }

  // Sum of values in a list of inputs/outputs that belong to `addr`.
  const sumFor = (list, addr, key) =>
    (list || []).reduce((s, x) => s + ((x.addresses || []).includes(addr) ? Number(x[key] || 0) : 0), 0);

  // Sum and first address among inputs/outputs NOT belonging to `addr`.
  function others(list, addr, key) {
    let sum = 0, first = null;
    for (const x of list || []) {
      const addrs = x.addresses || [];
      if (addrs.includes(addr)) continue;
      sum += Number(x[key] || 0);
      if (!first && addrs.length) first = addrs[0];
    }
    return { sum, first };
  }

  /** Normalize a BlockCypher "full" tx into a TxSummary relative to `addr`. */
  function summarize(tx, addr) {
    const ins = tx.inputs || [], outs = tx.outputs || [];
    const sent = sumFor(ins, addr, 'output_value');
    const recv = sumFor(outs, addr, 'value');
    const otherIns = others(ins, addr, 'output_value');
    const otherOuts = others(outs, addr, 'value');
    const coinbase = ins.length > 0 && ins.every(i => !i.prev_hash || /^0{64}$/.test(i.prev_hash));

    let direction, value, from, to;
    if (sent > 0 && otherOuts.sum === 0) {
      direction = 'self'; value = recv; from = addr; to = addr;
    } else if (sent > 0) {
      direction = 'out'; value = otherOuts.sum; from = addr; to = otherOuts.first;
    } else {
      direction = 'in'; value = recv; from = coinbase ? null : otherIns.first; to = addr;
    }
    const pending = !(tx.block_height > 0) || !tx.confirmations;
    return {
      hash: tx.hash,
      time: pending ? null : toMs(tx.confirmed || tx.received),
      status: pending ? 'pending' : 'success',
      from, fromName: coinbase ? 'Coinbase (block reward)' : null,
      to, toName: null,
      direction,
      value: amt(value),
      symbol: chain.symbol,
      fee: tx.fees != null ? amt(tx.fees) : null,
      method: coinbase ? 'Coinbase' : 'Transfer',
    };
  }

  async function getAddress(address) {
    const a = checkAddress(address);
    // limit=1 keeps the payload small; we only need the totals here.
    const r = await fetchJSON(`${api}/addrs/${a}?limit=1`, { ttl: 30000 });
    if (!r || typeof r !== 'object' || r.error) throw new NotFound(r?.error || 'Address not found');
    const txCount = r.final_n_tx ?? r.n_tx ?? 0;
    const balance = amt(r.final_balance ?? r.balance);
    const stats = [
      { label: 'Total received', value: `${amt(r.total_received).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${chain.symbol}` },
      { label: 'Total sent', value: `${amt(r.total_sent).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${chain.symbol}` },
    ];
    if (r.unconfirmed_n_tx) {
      stats.push({ label: 'Unconfirmed', value: `${r.unconfirmed_n_tx} tx (${amt(r.unconfirmed_balance)} ${chain.symbol})` });
    }
    return {
      address: r.address || a,
      active: txCount > 0 || balance > 0,
      name: null,
      labels: [],
      kind: kindOf(a),
      balance,
      txCount,
      stats,
      tokens: [],
    };
  }

  /**
   * Full txs, newest first. BlockCypher pages with `before=<block height>` (exclusive),
   * which would drop the rest of a block split across pages. So the cursor is
   * { before: lastHeight + 1, skip: [hashes already shown at lastHeight] }.
   */
  async function getTxs(address, cursor = null) {
    const a = checkAddress(address);
    let url = `${api}/addrs/${a}/full?limit=${PAGE}&txlimit=${TX_IO}`;
    if (cursor?.before) url += `&before=${cursor.before}`;
    const r = await fetchJSON(url, { ttl: 30000 });
    const txs = r?.txs || [];
    const skip = new Set(cursor?.skip || []);
    const items = txs.filter(t => !skip.has(t.hash)).map(t => summarize(t, a));

    let next = null;
    const confirmed = txs.filter(t => t.block_height > 0);
    if (r?.hasMore && confirmed.length) {
      const last = confirmed[confirmed.length - 1].block_height;
      const atLast = confirmed.filter(t => t.block_height === last).map(t => t.hash);
      // If the whole page was one block we cannot make progress by re-including it; move past it.
      next = atLast.length === confirmed.length && cursor?.before === last + 1
        ? { before: last, skip: [] }
        : { before: last + 1, skip: atLast };
    }
    return { items, next };
  }

  async function getTx(hash) {
    const h = checkHash(hash);
    const tx = await fetchJSON(`${api}/txs/${h}?limit=${TX_IO}&includeHex=false`, { ttl: 15000 });
    if (!tx || typeof tx !== 'object' || tx.error || !tx.hash) throw new NotFound(tx?.error || 'Transaction not found');

    const pending = !(tx.block_height > 0);
    const coinbase = (tx.inputs || []).some(i => !i.prev_hash || /^0{64}$/.test(i.prev_hash));
    const inputs = (tx.inputs || []).map(i => ({
      address: i.addresses?.[0] ?? null,
      name: coinbase ? 'Coinbase (block reward)' : null,
      value: i.output_value != null ? amt(i.output_value) : null,
    }));
    const outputs = (tx.outputs || []).map(o => {
      const data = o.data_string ?? (o.data_hex ? `0x${o.data_hex}` : null);
      return {
        address: o.addresses?.[0] ?? null,
        name: o.script_type === 'null-data' ? 'OP_RETURN' : null,
        value: amt(o.value),
        note: o.script_type === 'null-data' ? (data || 'OP_RETURN') : null,
      };
    });

    const extra = [
      { label: 'Size', value: `${tx.vsize || tx.size || '?'} bytes` },
      { label: 'Inputs / outputs', value: `${tx.vin_sz ?? inputs.length} / ${tx.vout_sz ?? outputs.length}` },
    ];
    if ((tx.vin_sz || 0) > inputs.length || (tx.vout_sz || 0) > outputs.length) {
      extra.push({ label: 'Note', value: `Showing first ${TX_IO} inputs/outputs` });
    }
    if (tx.double_spend) extra.push({ label: 'Double spend', value: 'Yes' });
    if (pending && tx.received) extra.push({ label: 'First seen', value: new Date(toMs(tx.received)).toISOString() });

    return {
      // Use the requested id: BlockCypher reports a different `hash` for Dash special txs (DIP2 coinbase).
      hash: h,
      status: pending ? 'pending' : 'success',
      time: pending ? null : toMs(tx.confirmed || tx.received),
      block: pending ? null : tx.block_height,
      confirmations: tx.confirmations ?? (pending ? 0 : null),
      fee: tx.fees != null ? amt(tx.fees) : null,
      value: amt(tx.total),   // total output value
      method: coinbase ? 'Coinbase' : 'Transfer',
      inputs,
      outputs,
      transfers: [],
      extra,
    };
  }

  async function getStats() {
    const r = await fetchJSON(api, { ttl: 20000 });
    const perKb = v => (v != null ? `${amt(v).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${chain.symbol}/kB` : '?');
    const extra = [
      { label: 'Fee (low / med / high)', value: `${perKb(r?.low_fee_per_kb)} · ${perKb(r?.medium_fee_per_kb)} · ${perKb(r?.high_fee_per_kb)}` },
    ];
    if (r?.unconfirmed_count != null) extra.push({ label: 'Mempool', value: `${r.unconfirmed_count} txs` });
    if (r?.peer_count != null) extra.push({ label: 'Peers', value: String(r.peer_count) });
    return { height: r?.height ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
