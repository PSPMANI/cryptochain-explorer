import { fetchJSON, fromUnits, NotFound } from '../utils.js';

const PAGE = 25;
const CASHADDR = /^(?:bitcoincash:)?([qp][02-9ac-hj-np-z]{41})$/i;
const LEGACY = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const HASH = /^[0-9a-fA-F]{64}$/;

const utcMs = t => {
  if (!t) return null;
  const d = Date.parse(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z'));
  return isNaN(d) ? null : d;
};

function opReturnText(hex) {
  if (!hex || !/^6a/i.test(hex)) return null;
  const parts = [];
  let i = 2;
  while (i < hex.length) {
    let op = parseInt(hex.slice(i, i + 2), 16), len; i += 2;
    if (op >= 1 && op <= 75) len = op;
    else if (op === 76) { len = parseInt(hex.slice(i, i + 2), 16); i += 2; }
    else if (op === 77) { len = parseInt(hex.slice(i + 2, i + 4) + hex.slice(i, i + 2), 16); i += 4; }
    else continue;
    const chunk = hex.slice(i, i + len * 2); i += len * 2;
    const bytes = chunk.match(/../g)?.map(h => parseInt(h, 16)) || [];
    const printable = bytes.length && bytes.every(b => b === 10 || b === 13 || (b >= 32 && b < 127));
    parts.push(printable ? String.fromCharCode(...bytes) : `0x${chunk}`);
  }
  return parts.join(' ') || 'OP_RETURN';
}

export default function create(chain) {
  const api = chain.api.replace(/\/$/, '');
  const dec = chain.decimals ?? 8;
  const amt = v => Number(fromUnits(v ?? 0, dec).toFixed(dec));

  async function get(url, ttl) {
    try {
      return await fetchJSON(url, { ttl });
    } catch (e) {
      if (/API error (402|43\d)/.test(e.message)) throw new Error('Blockchair rate limit reached (free tier). Try again in a few minutes.');
      throw e;
    }
  }

  function checkAddress(address) {
    const a = String(address || '').trim();
    if (chain.id !== 'bitcoin-cash') {
      if (/^[a-zA-Z0-9]{25,90}$/.test(a)) return a;
      throw new NotFound('Invalid address');
    }
    const m = CASHADDR.exec(a);
    if (m) return `bitcoincash:${m[1].toLowerCase()}`;
    if (LEGACY.test(a)) return a;
    throw new NotFound('Not a valid Bitcoin Cash address');
  }

  const canon = a => (chain.id === 'bitcoin-cash' && a && CASHADDR.test(a) ? `bitcoincash:${CASHADDR.exec(a)[1].toLowerCase()}` : a || null);

  async function addressDashboard(a, offset, details) {
    const q = `limit=${PAGE},0&offset=${offset},0` + (details ? '&transaction_details=true' : '');
    const r = await get(`${api}/dashboards/address/${a}?${q}`, 30000);
    const key = r?.data && Object.keys(r.data)[0];
    const d = key && r.data[key];
    if (!d?.address) throw new NotFound('Address not found');
    return { key, d, state: r.context?.state ?? null };
  }

  async function getAddress(address) {
    const a = checkAddress(address);
    const { key, d } = await addressDashboard(a, 0, true);
    const x = d.address;
    const txCount = Number(x.transaction_count ?? 0);
    const balance = amt(x.balance);
    const fmt = v => `${amt(v).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${chain.symbol}`;
    const stats = [
      { label: 'Total received', value: fmt(x.received) },
      { label: 'Total spent', value: fmt(x.spent) },
    ];
    if (x.unspent_output_count != null) stats.push({ label: 'Unspent outputs', value: String(x.unspent_output_count) });
    if (x.first_seen_receiving) stats.push({ label: 'First seen', value: x.first_seen_receiving + ' UTC' });
    const legacy = x.formats?.legacy;
    const cash = x.formats?.cashaddr;
    if (legacy && legacy !== key) stats.push({ label: 'Legacy format', value: legacy });

    return {
      address: canon(cash || key) || a,
      active: txCount > 0 || balance > 0,
      name: null,
      labels: [],
      kind: x.type === 'scripthash' ? 'Script (P2SH)' : x.type === 'multisig' ? 'Multisig' : 'Wallet',
      balance,
      txCount,
      stats,
      tokens: [],
    };
  }

  async function getTxs(address, cursor = null) {
    const a = checkAddress(address);
    const offset = Number(cursor) || 0;
    const { key, d } = await addressDashboard(a, offset, true);
    const self = canon(d.address?.formats?.cashaddr || key) || a;
    const list = Array.isArray(d.transactions) ? d.transactions : [];

    const items = list.map(t => {
      const tx = typeof t === 'string' ? { hash: t } : { ...t, hash: t.hash ?? t.transaction_hash };
      const change = Number(tx.balance_change ?? 0);
      const pending = tx.block_id === -1 || tx.block_id == null && typeof t !== 'string';
      const direction = typeof t === 'string' ? null : change > 0 ? 'in' : change < 0 ? 'out' : 'self';
      return {
        hash: tx.hash,
        time: pending ? null : utcMs(tx.time),
        status: pending ? 'pending' : 'success',
        from: direction === 'out' || direction === 'self' ? self : null, fromName: null,
        to: direction === 'in' || direction === 'self' ? self : null, toName: null,
        direction,
        value: amt(Math.abs(change)),
        symbol: chain.symbol,
        fee: null,
        method: 'Transfer',
      };
    });
    const total = Number(d.address?.transaction_count ?? 0);
    const next = list.length && offset + list.length < total ? offset + list.length : null;
    return { items, next };
  }

  async function getTx(hash) {
    const h = String(hash || '').trim().replace(/^0x/i, '').toLowerCase();
    if (!HASH.test(h)) throw new NotFound('Not a valid Bitcoin Cash transaction hash');
    const r = await get(`${api}/dashboards/transaction/${h}`, 15000);
    const d = r?.data?.[h] || (r?.data && !Array.isArray(r.data) ? Object.values(r.data)[0] : null);
    const t = d?.transaction;
    if (!t) throw new NotFound('Transaction not found');

    const pending = t.block_id == null || t.block_id < 0;
    const tip = Number(r.context?.state) || null;
    const inputs = (d.inputs || []).map(i => ({
      address: canon(i.recipient),
      name: t.is_coinbase ? 'Coinbase (block reward)' : null,
      value: i.value != null ? amt(i.value) : null,
    }));
    if (!inputs.length && t.is_coinbase) inputs.push({ address: null, name: 'Coinbase (block reward)', value: null });
    const outputs = (d.outputs || []).map(o => {
      const nulldata = o.type === 'nulldata' || /^6a/i.test(o.script_hex || '');
      return {
        address: nulldata ? null : canon(o.recipient),
        name: nulldata ? 'OP_RETURN' : null,
        value: amt(o.value),
        note: nulldata ? opReturnText(o.script_hex) : null,
      };
    });

    const extra = [
      { label: 'Size', value: `${t.size ?? '?'} bytes` },
      { label: 'Inputs / outputs', value: `${t.input_count ?? inputs.length} / ${t.output_count ?? outputs.length}` },
    ];
    if (t.fee_per_kb != null) extra.push({ label: 'Fee rate', value: `${(t.fee_per_kb / 1000).toFixed(2)} sat/B` });
    if ((t.input_count || 0) > inputs.length || (t.output_count || 0) > outputs.length) {
      extra.push({ label: 'Note', value: 'Input/output list truncated by the API' });
    }

    return {
      hash: t.hash || h,
      status: pending ? 'pending' : 'success',
      time: pending ? null : utcMs(t.time),
      block: pending ? null : t.block_id,
      confirmations: pending ? 0 : tip ? Math.max(tip - t.block_id + 1, 1) : null,
      fee: t.fee != null ? amt(t.fee) : null,
      value: t.output_total != null ? amt(t.output_total) : null,
      method: t.is_coinbase ? 'Coinbase' : 'Transfer',
      inputs,
      outputs,
      transfers: [],
      extra,
    };
  }

  async function getStats() {
    const r = await get(`${api}/stats`, 60000);
    const s = r?.data || {};
    const extra = [];
    if (s.suggested_transaction_fee_per_byte_sat != null) extra.push({ label: 'Suggested fee', value: `${s.suggested_transaction_fee_per_byte_sat} sat/B` });
    if (s.median_transaction_fee_24h != null) extra.push({ label: 'Median fee (24h)', value: `${amt(s.median_transaction_fee_24h)} ${chain.symbol}` });
    if (s.mempool_transactions != null) extra.push({ label: 'Mempool', value: `${s.mempool_transactions} txs` });
    if (s.transactions_24h != null) extra.push({ label: 'Txs (24h)', value: Number(s.transactions_24h).toLocaleString('en-US') });
    const height = s.best_block_height ?? (s.blocks != null ? s.blocks - 1 : null) ?? r?.context?.state ?? null;
    return { height, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
