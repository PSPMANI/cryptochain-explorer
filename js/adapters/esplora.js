import { fetchJSON, fromUnits, NotFound } from '../utils.js';

const TXID = /^[0-9a-fA-F]{64}$/;

function addrType(a) {
  if (/^(bc1p|ltc1p)/i.test(a)) return 'Taproot (P2TR)';
  if (/^(bc1q|ltc1q)/i.test(a)) return a.length > 50 ? 'SegWit script (P2WSH)' : 'Native SegWit (P2WPKH)';
  if (/^[3M]/.test(a)) return 'Script hash (P2SH)';
  if (/^[1L]/.test(a)) return 'Legacy (P2PKH)';
  return 'Address';
}

export default function create(chain) {
  const api = chain.api;
  const coins = sat => fromUnits(sat, chain.decimals);
  let tip = { h: null, at: 0 };
  const tipHeight = async () => {
    if (Date.now() - tip.at > 10000) tip = { h: Number(await fetchJSON(`${api}/blocks/tip/height`)), at: Date.now() };
    return tip.h;
  };

  async function getAddress(addr) {
    const a = await fetchJSON(`${api}/address/${addr}`);
    const cs = a.chain_stats, ms = a.mempool_stats;
    const count = cs.tx_count + ms.tx_count;
    const stats = [
      { label: 'Total received', value: `${coins(cs.funded_txo_sum).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${chain.symbol}` },
      { label: 'Total sent', value: `${coins(cs.spent_txo_sum).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${chain.symbol}` },
      { label: 'Unspent outputs', value: (cs.funded_txo_count - cs.spent_txo_count).toLocaleString() },
    ];
    if (ms.tx_count) stats.push({ label: 'Unconfirmed txs', value: String(ms.tx_count) });
    return {
      address: a.address,
      active: count > 0,
      name: null, labels: [],
      kind: addrType(a.address),
      balance: coins(cs.funded_txo_sum - cs.spent_txo_sum + ms.funded_txo_sum - ms.spent_txo_sum),
      txCount: count,
      stats, tokens: [],
    };
  }

  function summarize(t, addr) {
    const recv = t.vout.filter(o => o.scriptpubkey_address === addr).reduce((s, o) => s + o.value, 0);
    const sent = t.vin.filter(i => i.prevout && i.prevout.scriptpubkey_address === addr).reduce((s, i) => s + i.prevout.value, 0);
    const delta = recv - sent;
    const firstIn = (t.vin.find(i => i.prevout && i.prevout.scriptpubkey_address !== addr) || t.vin[0]);
    const firstOut = (t.vout.find(o => o.scriptpubkey_address && o.scriptpubkey_address !== addr) || t.vout[0]);
    const coinbase = t.vin.some(i => i.is_coinbase);
    return {
      hash: t.txid,
      time: t.status.block_time ? t.status.block_time * 1000 : null,
      status: t.status.confirmed ? 'success' : 'pending',
      from: coinbase ? null : (delta < 0 ? addr : firstIn && firstIn.prevout && firstIn.prevout.scriptpubkey_address) || null,
      fromName: coinbase ? 'Coinbase (new coins)' : null,
      to: delta < 0 ? (firstOut && firstOut.scriptpubkey_address) || null : addr,
      toName: null,
      direction: sent && recv && Math.abs(delta) <= t.fee ? 'self' : delta >= 0 ? 'in' : 'out',
      value: coins(Math.abs(delta)),
      symbol: chain.symbol,
      fee: coins(t.fee),
      method: coinbase ? 'Coinbase' : `${t.vin.length} in → ${t.vout.length} out`,
    };
  }

  async function getTxs(addr, cursor = null) {
    const txs = await fetchJSON(`${api}/address/${addr}/txs${cursor ? '/chain/' + cursor : ''}`);
    const confirmed = txs.filter(t => t.status.confirmed);
    return {
      items: txs.map(t => summarize(t, addr)),
      next: confirmed.length >= 25 ? confirmed[confirmed.length - 1].txid : null,
    };
  }

  async function getTx(hash) {
    if (!TXID.test(hash)) throw new NotFound('Invalid txid');
    const [t, h] = await Promise.all([fetchJSON(`${api}/tx/${hash.toLowerCase()}`), tipHeight().catch(() => null)]);
    const vsize = Math.ceil(t.weight / 4);
    const rbf = t.vin.some(i => i.sequence < 0xfffffffe);
    const outNote = o => o.scriptpubkey_type === 'op_return'
      ? 'OP_RETURN data' + (o.scriptpubkey_asm ? ': ' + decodeOpReturn(o.scriptpubkey) : '')
      : o.scriptpubkey_address ? null : o.scriptpubkey_type;
    return {
      hash: t.txid,
      status: t.status.confirmed ? 'success' : 'pending',
      time: t.status.block_time ? t.status.block_time * 1000 : null,
      block: t.status.block_height ?? null,
      confirmations: t.status.confirmed && h ? h - t.status.block_height + 1 : 0,
      fee: coins(t.fee),
      value: coins(t.vout.reduce((s, o) => s + o.value, 0)),
      method: t.vin.some(i => i.is_coinbase) ? 'Coinbase' : null,
      inputs: t.vin.map(i => i.is_coinbase
        ? { address: null, name: 'Coinbase (newly minted)', value: null }
        : { address: i.prevout && i.prevout.scriptpubkey_address, name: null, value: i.prevout ? coins(i.prevout.value) : null }),
      outputs: t.vout.map(o => ({ address: o.scriptpubkey_address || null, name: null, value: coins(o.value), note: outNote(o) })),
      transfers: [],
      extra: [
        { label: 'Fee rate', value: `${(t.fee / vsize).toFixed(2)} sat/vB` },
        { label: 'Size / vsize', value: `${t.size.toLocaleString()} B / ${vsize.toLocaleString()} vB` },
        { label: 'Inputs / outputs', value: `${t.vin.length} / ${t.vout.length}` },
        { label: 'Replace-by-fee', value: rbf ? 'Yes' : 'No' },
        { label: 'Version / locktime', value: `${t.version} / ${t.locktime}` },
      ],
    };
  }

  async function getStats() {
    const [h, fees, mp] = await Promise.all([
      tipHeight(),
      fetchJSON(`${api}/v1/fees/recommended`, { ttl: 10000 }).catch(() => null),
      fetchJSON(`${api}/mempool`, { ttl: 10000 }).catch(() => null),
    ]);
    const extra = [];
    if (fees) extra.push({ label: 'Fee (fast)', value: `${fees.fastestFee} sat/vB` });
    if (mp && mp.count != null) extra.push({ label: 'Mempool', value: `${mp.count.toLocaleString()} txs` });
    return { height: h, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}

function decodeOpReturn(script) {
  const hex = script.replace(/^6a(4c..|4d....|..)?/, '');
  const txt = (hex.match(/../g) || []).map(b => String.fromCharCode(parseInt(b, 16))).join('');
  return /^[\x20-\x7e]+$/.test(txt) ? `"${txt.slice(0, 80)}"` : hex.slice(0, 40) + (hex.length > 40 ? '…' : '');
}
