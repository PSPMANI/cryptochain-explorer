import { fetchJSON, fromUnits, NotFound } from '../utils.js';
import { legacyToCash } from '../cashaddr.js';

const PAGE = 25;
const TXID = /^[0-9a-fA-F]{64}$/;

export default function create(chain) {
  const api = chain.api;
  const coins = sat => fromUnits(sat || 0, chain.decimals);
  let tip = { h: null, at: 0 };
  const tipHeight = async () => {
    if (Date.now() - tip.at > 15000) tip = { h: (await fetchJSON(`${api}/block/best?notx=true`)).height, at: Date.now() };
    return tip.h;
  };

  async function canon(address) {
    const a = String(address || '').trim();
    if (/^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$/i.test(a)) return a.toLowerCase().startsWith('bitcoincash:') ? a.toLowerCase() : `bitcoincash:${a.toLowerCase()}`;
    if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) { const c = await legacyToCash(a); if (c) return c; }
    throw new NotFound('Not a valid Bitcoin Cash address');
  }

  async function getAddress(address) {
    const a = await canon(address);
    const b = await fetchJSON(`${api}/address/${a}/balance`);
    const txCount = b.txs || 0;
    return {
      address: a,
      active: txCount > 0,
      name: null, labels: [], kind: /^bitcoincash:p/.test(a) ? 'Script (P2SH)' : 'Wallet',
      balance: coins((b.confirmed || 0) + (b.unconfirmed || 0)),
      txCount,
      stats: [
        { label: 'Total received', value: `${coins(b.received).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${chain.symbol}` },
        { label: 'Unspent outputs', value: String(b.utxo || 0) },
        ...(b.unconfirmed ? [{ label: 'Unconfirmed', value: `${coins(b.unconfirmed)} ${chain.symbol}` }] : []),
      ],
      tokens: [],
    };
  }

  function summarize(t, me) {
    const ins = t.inputs || [], outs = t.outputs || [];
    const sent = ins.filter(i => i.address === me).reduce((s, i) => s + (i.value || 0), 0);
    const recv = outs.filter(o => o.address === me).reduce((s, o) => s + (o.value || 0), 0);
    const delta = recv - sent;
    const coinbase = ins.some(i => i.coinbase);
    const other = delta < 0 ? outs.find(o => o.address && o.address !== me) : ins.find(i => i.address && i.address !== me);
    return {
      hash: t.txid,
      time: t.time ? t.time * 1000 : null,
      status: t.block && t.block.height ? 'success' : 'pending',
      from: coinbase ? null : delta < 0 ? me : (other && other.address) || null,
      fromName: coinbase ? 'Coinbase (new coins)' : null,
      to: delta < 0 ? (other && other.address) || null : me,
      toName: null,
      direction: sent && recv && Math.abs(delta) <= (t.fee || 0) ? 'self' : delta >= 0 ? 'in' : 'out',
      value: coins(Math.abs(delta)),
      symbol: chain.symbol,
      fee: coins(t.fee),
      method: coinbase ? 'Coinbase' : `${ins.length} in → ${outs.length} out`,
    };
  }

  async function getTxs(address, cursor = null) {
    const a = await canon(address);
    const offset = Number(cursor) || 0;
    const list = await fetchJSON(`${api}/address/${a}/transactions/full?limit=${PAGE}&offset=${offset}`);
    const items = (Array.isArray(list) ? list : []).map(t => summarize(t, a));
    return { items, next: items.length === PAGE ? offset + PAGE : null };
  }

  async function getTx(hash) {
    if (!TXID.test(hash)) throw new NotFound('Invalid transaction hash');
    const [t, h] = await Promise.all([fetchJSON(`${api}/transaction/${hash.toLowerCase()}`), tipHeight().catch(() => null)]);
    if (!t || !t.txid) throw new NotFound();
    const height = t.block && t.block.height;
    return {
      hash: t.txid,
      status: height ? 'success' : 'pending',
      time: t.time ? t.time * 1000 : null,
      block: height || null,
      confirmations: height && h ? h - height + 1 : 0,
      fee: coins(t.fee),
      value: coins((t.outputs || []).reduce((s, o) => s + (o.value || 0), 0)),
      method: (t.inputs || []).some(i => i.coinbase) ? 'Coinbase' : null,
      inputs: (t.inputs || []).map(i => (i.coinbase ? { address: null, name: 'Coinbase (newly minted)', value: null } : { address: i.address || null, name: null, value: coins(i.value) })),
      outputs: (t.outputs || []).map(o => ({ address: o.address || null, name: null, value: coins(o.value), note: o.address ? null : 'OP_RETURN / non-standard' })),
      transfers: [],
      extra: [
        { label: 'Size', value: `${(t.size || 0).toLocaleString()} bytes` },
        { label: 'Fee rate', value: t.size ? `${((t.fee || 0) / t.size).toFixed(2)} sat/byte` : '—' },
        { label: 'Inputs / outputs', value: `${(t.inputs || []).length} / ${(t.outputs || []).length}` },
      ],
    };
  }

  async function getStats() {
    const b = await fetchJSON(`${api}/block/best?notx=true`, { ttl: 10000 });
    tip = { h: b.height, at: Date.now() };
    return { height: b.height, extra: [{ label: 'Block time', value: new Date(b.time * 1000).toISOString().slice(11, 16) + ' UTC' }] };
  }

  return { getAddress, getTxs, getTx, getStats };
}
