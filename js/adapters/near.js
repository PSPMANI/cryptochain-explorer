
import { fetchJSON, fromUnits, NotFound } from '../utils.js';

const PAGE = 25;
const EMPTY_CODE = '11111111111111111111111111111111';

const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

const nsToMs = ns => {
  if (ns === null || ns === undefined || ns === '') return null;
  try { return Number(BigInt(String(ns).split('.')[0]) / 1000000n); } catch { return Math.round(Number(ns) / 1e6) || null; }
};

const toInt = v => (typeof v === 'number' ? BigInt(Math.round(v)).toString() : v);

const actionName = a => {
  if (!a) return null;
  if (a.method) return a.method;
  const n = String(a.action || '').toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase());
  return n ? n[0].toUpperCase() + n.slice(1) : null;
};

export default function create(chain) {
  const rpcUrl = chain.api;
  const idx = (chain.indexer || 'https://api.nearblocks.io/v1').replace(/\/$/, '');
  const dec = chain.decimals ?? 24;
  const clean = n => Number(n.toPrecision(15));
  const amt = v => clean(fromUnits(toInt(v ?? 0), dec));
  const fmt = v => `${v.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${chain.symbol}`;

  async function nearRpc(method, params, ttl = 0) {
    const r = await fetchJSON(rpcUrl, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params }, ttl });
    if (r?.error) {
      const e = new Error(r.error.data || r.error.message || 'RPC error');
      e.cause = r.error.cause?.name || r.error.name;
      throw e;
    }
    return r?.result;
  }

  function checkAccount(id) {
    const a = String(id || '').trim().toLowerCase();
    if (!(IMPLICIT.test(a) || ETH_IMPLICIT.test(a) || NAMED.test(a))) throw new NotFound('Not a valid NEAR account id');
    return a;
  }

  async function getAddress(address) {
    const id = checkAccount(address);
    const implicit = IMPLICIT.test(id) || ETH_IMPLICIT.test(id);
    let acc;
    try {
      acc = await nearRpc('query', { request_type: 'view_account', finality: 'final', account_id: id }, 15000);
    } catch (e) {
      if (e.cause === 'UNKNOWN_ACCOUNT' && implicit) {
        return {
          address: id, active: false, name: null, labels: [], kind: 'Wallet', balance: 0, txCount: 0,
          stats: [{ label: 'Account type', value: ETH_IMPLICIT.test(id) ? 'Eth-implicit (unfunded)' : 'Implicit (unfunded)' }],
          tokens: [],
        };
      }
      if (e.cause === 'UNKNOWN_ACCOUNT' || e.cause === 'INVALID_ACCOUNT' || e instanceof NotFound) throw new NotFound('Account does not exist');
      throw e;
    }

    const isContract = acc.code_hash && acc.code_hash !== EMPTY_CODE && !ETH_IMPLICIT.test(id);
    const locked = amt(acc.locked);
    const stats = [
      { label: 'Account type', value: IMPLICIT.test(id) ? 'Implicit' : ETH_IMPLICIT.test(id) ? 'Eth-implicit' : 'Named' },
      { label: 'Storage used', value: `${Number(acc.storage_usage || 0).toLocaleString('en-US')} bytes` },
    ];
    if (locked > 0) stats.push({ label: 'Locked (validator stake)', value: fmt(locked) });
    if (isContract) stats.push({ label: 'Code hash', value: acc.code_hash });

    return {
      address: id,
      active: true,
      name: null,
      labels: [],
      kind: isContract ? 'Contract' : 'Wallet',
      balance: amt(acc.amount),
      txCount: null,
      stats,
      tokens: [],
    };
  }

  async function getTxs(address, cursor = null) {
    const id = checkAccount(address);
    let url = `${idx}/account/${encodeURIComponent(id)}/txns-only?per_page=${PAGE}&order=desc`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const r = await fetchJSON(url, { ttl: 30000 });
    const txns = Array.isArray(r?.txns) ? r.txns : [];

    const items = txns.map(t => {
      const from = t.signer_account_id ?? null;
      const to = t.receiver_account_id ?? null;
      const direction = from === id && to === id ? 'self' : from === id ? 'out' : to === id ? 'in' : null;
      const st = t.outcomes?.status;
      const actions = t.actions || [];
      let method = actionName(actions[0]);
      if (method && actions.length > 1) method += ` +${actions.length - 1}`;
      const deposit = t.actions_agg?.deposit ?? actions.reduce((s, a) => s + Number(a.deposit || 0), 0);
      return {
        hash: t.transaction_hash,
        time: nsToMs(t.block_timestamp),
        status: st === true ? 'success' : st === false ? 'failed' : 'pending',
        from, fromName: null,
        to, toName: null,
        direction,
        value: amt(deposit),
        symbol: chain.symbol,
        fee: t.outcomes_agg?.transaction_fee != null ? amt(t.outcomes_agg.transaction_fee) : null,
        method,
      };
    });
    const next = r?.cursor && txns.length >= PAGE ? r.cursor : null;
    return { items, next };
  }

  async function getTx(hash) {
    const h = String(hash || '').trim();
    if (!TX_HASH.test(h)) throw new NotFound('Not a valid NEAR transaction hash');
    const [r, status] = await Promise.all([
      fetchJSON(`${idx}/txns/${h}`, { ttl: 30000 }),
      nearRpc('status', [], 5000).catch(() => null),
    ]);
    const t = r?.txns?.[0];
    if (!t || t.transaction_hash !== h) throw new NotFound('Transaction not found');

    const height = t.block?.block_height ?? null;
    const tip = status?.sync_info?.latest_block_height;
    const st = t.outcomes?.status;
    const actions = t.actions || [];
    const deposit = amt(t.actions_agg?.deposit);
    const methods = actions.map(actionName).filter(Boolean);

    const transfers = [];
    for (const rc of t.receipts || []) {
      for (const f of rc.fts || []) {
        const d = Number(f.delta_amount || 0);
        const meta = f.ft_meta || {};
        const decs = meta.decimals ?? 0;
        const amount = clean(Math.abs(d) / 10 ** decs);
        if (d > 0) transfers.push({ from: f.involved_account_id ?? null, to: f.affected_account_id, amount, symbol: meta.symbol || meta.contract || '?' });
        else if (d < 0 && !f.involved_account_id) transfers.push({ from: f.affected_account_id, to: null, amount, symbol: meta.symbol || meta.contract || '?' });
      }
      for (const n of rc.nfts || []) {
        if (Number(n.delta_amount || 0) > 0) {
          transfers.push({ from: n.involved_account_id ?? null, to: n.affected_account_id, amount: 1, symbol: n.nft_meta?.symbol || n.nft_meta?.contract || 'NFT' });
        }
      }
    }

    const extra = [
      { label: 'Actions', value: actions.map(a => a.action + (a.method ? ` (${a.method})` : '')).join(', ') || '—' },
    ];
    if (t.outcomes_agg?.gas_used != null) extra.push({ label: 'Gas used', value: `${(Number(t.outcomes_agg.gas_used) / 1e12).toFixed(2)} Tgas` });
    if (t.actions_agg?.gas_attached != null) extra.push({ label: 'Gas attached', value: `${(Number(t.actions_agg.gas_attached) / 1e12).toFixed(0)} Tgas` });
    if (t.shard_id != null) extra.push({ label: 'Shard', value: String(t.shard_id) });
    if (t.included_in_block_hash) extra.push({ label: 'Block hash', value: t.included_in_block_hash });

    return {
      hash: t.transaction_hash,
      status: st === true ? 'success' : st === false ? 'failed' : 'pending',
      time: nsToMs(t.block_timestamp),
      block: height,
      confirmations: height != null && tip ? Math.max(tip - height + 1, 1) : null,
      fee: t.outcomes_agg?.transaction_fee != null ? amt(t.outcomes_agg.transaction_fee) : null,
      value: deposit,
      method: methods.length ? methods.join(', ') : null,
      inputs: [{ address: t.signer_account_id ?? null, name: null, value: deposit }],
      outputs: [{ address: t.receiver_account_id ?? null, name: null, value: deposit, note: methods.length ? methods.join(', ') : null }],
      transfers,
      extra,
    };
  }

  async function getStats() {
    const [status, gas] = await Promise.all([
      nearRpc('status', [], 5000),
      nearRpc('gas_price', [null], 30000).catch(() => null),
    ]);
    const si = status?.sync_info || {};
    const extra = [];
    if (gas?.gas_price) {
      extra.push({ label: 'Gas price', value: `${fromUnits(BigInt(gas.gas_price) * 10n ** 12n, dec)} ${chain.symbol}/Tgas` });
    }
    if (status?.protocol_version != null) extra.push({ label: 'Protocol', value: `v${status.protocol_version}` });
    if (Array.isArray(status?.validators)) extra.push({ label: 'Validators', value: String(status.validators.length) });
    return { height: si.latest_block_height ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
