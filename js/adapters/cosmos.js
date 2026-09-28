
import { fetchJSON, fromUnits, toMs, NotFound } from '../utils.js';

const PAGE = 10;
const NATIVE = 'uatom';
const ADDR = /^cosmos1[02-9ac-hj-np-z]{38,58}$/;
const HASH = /^[0-9A-Fa-f]{64}$/;

const ibcCache = new Map();

function baseInfo(base) {
  const b = String(base);
  if (b.startsWith('factory/')) { const i = baseInfo(b.split('/').pop()); return { ...i, symbol: `f:${i.symbol}` }; }
  if (b.startsWith('cw20:')) return { symbol: `CW20:${b.slice(-6).toUpperCase()}`, decimals: 6 };
  const last = b.split('/').pop();
  const st = /^st([ua])([a-z]{2,})$/.exec(last);
  if (st) return { symbol: `st${st[2].toUpperCase()}`, decimals: st[1] === 'a' ? 18 : 6 };
  if (/^u[a-z]{2,}$/.test(last)) return { symbol: last.slice(1).toUpperCase(), decimals: 6 };
  if (/^a[a-z]{3,}$/.test(last)) return { symbol: last.slice(1).toUpperCase(), decimals: 18 };
  if (/^(inj|wei)$/.test(last)) return { symbol: last.toUpperCase(), decimals: 18 };
  return { symbol: last.toUpperCase().slice(0, 12), decimals: 6 };
}

const coins = v => (Array.isArray(v) ? v : v && v.denom ? [v] : []);

const fromOf = m => m.from_address || m.sender || m.delegator_address || m.granter || m.depositor || m.voter || m.proposer || m.signer || null;
const toOf = m => m.to_address || m.receiver || m.validator_dst_address || m.validator_address || m.grantee || m.contract || null;
const typeName = m => String(m?.['@type'] || '').split('.').pop() || null;

const inner = m => (typeName(m) === 'MsgExec' && Array.isArray(m.msgs) && m.msgs.length ? m.msgs[0] : m);

export default function create(chain) {
  const api = chain.api.replace(/\/$/, '');
  const dec = chain.decimals ?? 6;
  const sym = chain.symbol;
  const clean = n => Number(n.toFixed(dec));

  function checkAddress(address) {
    const a = String(address || '').trim().toLowerCase();
    if (!ADDR.test(a)) throw new NotFound('Not a valid Cosmos Hub address (expected cosmos1…)');
    return a;
  }

  function denomInfo(denom) {
    if (denom === NATIVE) return { symbol: sym, decimals: dec };
    if (denom.startsWith('ibc/')) {
      const hit = ibcCache.get(denom);
      return hit || { symbol: `IBC/${denom.slice(4, 10)}`, decimals: 6 };
    }
    if (denom.includes('/')) return { symbol: denom.split('/').pop().slice(0, 16), decimals: 0 };
    return baseInfo(denom);
  }

  async function resolveIbc(denoms, max = 20) {
    const todo = [...new Set(denoms)].filter(d => d.startsWith('ibc/') && !ibcCache.has(d)).slice(0, max);
    await Promise.all(todo.map(async d => {
      try {
        const r = await fetchJSON(`${api}/ibc/apps/transfer/v1/denoms/${d.slice(4)}`, { ttl: 86400000, timeout: 8000 });
        const base = r?.denom?.base;
        if (base) ibcCache.set(d, { base, ...baseInfo(base) });
      } catch { }
    }));
  }

  const coinAmt = c => {
    const i = denomInfo(c.denom);
    return { symbol: i.symbol, amount: fromUnits(c.amount, i.decimals) };
  };
  const nativeSum = list => clean(list.filter(c => c.denom === NATIVE).reduce((s, c) => s + fromUnits(c.amount, dec), 0));
  const feeOf = tx => nativeSum(coins(tx?.auth_info?.fee?.amount));

  function eventReceived(resp, addr) {
    let total = 0;
    for (const ev of resp?.events || []) {
      if (ev.type !== 'transfer') continue;
      const at = Object.fromEntries((ev.attributes || []).map(a => [a.key, a.value]));
      if (at.recipient !== addr || !at.amount) continue;
      for (const part of String(at.amount).split(',')) {
        const m = /^(\d+)(.+)$/.exec(part.trim());
        if (m && m[2] === NATIVE) total += fromUnits(m[1], dec);
      }
    }
    return clean(total);
  }

  function summarize(resp, addr) {
    const msgs = resp?.tx?.body?.messages || [];
    const first = inner(msgs[0] || {});
    let method = typeName(first);
    if (method && msgs.length > 1) method += ` +${msgs.length - 1}`;

    const m = msgs.map(inner).find(x => fromOf(x) === addr || toOf(x) === addr) || first;
    let from = fromOf(m), to = toOf(m);
    if (/^Msg(WithdrawDelegatorReward|WithdrawValidatorCommission|Undelegate)$/.test(typeName(m))) {
      [from, to] = [m.validator_address || from, m.delegator_address || to];
    }
    let direction = from === addr && to === addr ? 'self' : from === addr ? 'out' : to === addr ? 'in' : null;

    const c = coins(m.amount).concat(coins(m.token));
    let value = 0, symbol = sym;
    if (c.length) {
      const native = c.find(x => x.denom === NATIVE);
      const pick = native ? { amount: nativeSum(c), symbol: sym } : coinAmt(c[0]);
      value = pick.amount; symbol = pick.symbol;
    }
    if ((!value || direction === null) && from !== addr) {
      const got = eventReceived(resp, addr);
      if (got > 0) { value = got; symbol = sym; direction = direction || 'in'; }
    }
    return {
      hash: resp.txhash,
      time: toMs(resp.timestamp),
      status: resp.code ? 'failed' : 'success',
      from, fromName: null,
      to, toName: null,
      direction,
      value,
      symbol,
      fee: feeOf(resp.tx),
      method,
    };
  }

  async function search(cond, page) {
    const common = `order_by=ORDER_BY_DESC&page=${page}&limit=${PAGE}&pagination.limit=${PAGE}`;
    try {
      return await fetchJSON(`${api}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(cond)}&${common}`, { ttl: 20000, timeout: 25000 });
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      return fetchJSON(`${api}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(cond)}&${common}`, { ttl: 20000, timeout: 25000 });
    }
  }

  async function getAddress(address) {
    const a = checkAddress(address);
    const [auth, bal, del, rew] = await Promise.all([
      fetchJSON(`${api}/cosmos/auth/v1beta1/accounts/${a}`, { ttl: 30000 }).catch(e => { if (e instanceof NotFound) return null; throw e; }),
      fetchJSON(`${api}/cosmos/bank/v1beta1/balances/${a}?pagination.limit=200`, { ttl: 30000 }),
      fetchJSON(`${api}/cosmos/staking/v1beta1/delegations/${a}?pagination.limit=200`, { ttl: 30000 }).catch(() => null),
      fetchJSON(`${api}/cosmos/distribution/v1beta1/delegators/${a}/rewards`, { ttl: 30000 }).catch(() => null),
    ]);

    const balances = bal?.balances || [];
    const balance = nativeSum(balances);
    await resolveIbc(balances.map(b => b.denom));
    const tokens = balances.filter(b => b.denom !== NATIVE).map(b => {
      const i = denomInfo(b.denom);
      return { symbol: i.symbol, name: i.base ? `${i.base} (${b.denom.slice(0, 14)}…)` : b.denom, balance: fromUnits(b.amount, i.decimals), contract: b.denom };
    });

    const dels = del?.delegation_responses || [];
    const staked = clean(dels.reduce((s, d) => s + (d.balance?.denom === NATIVE ? fromUnits(d.balance.amount, dec) : 0), 0));
    const rewards = clean(coins(rew?.total).filter(c => c.denom === NATIVE).reduce((s, c) => s + Number(c.amount || 0), 0) / 10 ** dec);

    const acc = auth?.account || null;
    const t = String(acc?.['@type'] || '');
    const kind = /ModuleAccount/.test(t) ? 'Module' : /Vesting/.test(t) ? 'Vesting' : /InterchainAccount/.test(t) ? 'Interchain account' : 'Wallet';
    const base = acc?.base_account || acc?.base_vesting_account?.base_account || acc;
    const fmt = n => `${n.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${sym}`;

    const stats = [
      { label: 'Staked', value: `${fmt(staked)} (${dels.length} validator${dels.length === 1 ? '' : 's'})` },
    ];
    if (rewards > 0) stats.push({ label: 'Pending rewards', value: fmt(rewards) });
    if (base?.sequence != null) stats.push({ label: 'Txs signed (sequence)', value: String(base.sequence) });
    if (acc?.name) stats.push({ label: 'Module name', value: acc.name });

    return {
      address: a,
      active: !!acc || balances.length > 0 || dels.length > 0,
      name: acc?.name || null,
      labels: kind === 'Module' ? ['Module account'] : [],
      kind,
      balance,
      txCount: null,
      stats,
      tokens,
    };
  }

  async function getTxs(address, cursor = null) {
    const a = checkAddress(address);
    const page = Number(cursor) || 1;
    const res = await Promise.allSettled([
      search(`message.sender='${a}'`, page),
      search(`transfer.recipient='${a}'`, page),
    ]);
    if (res.every(x => x.status === 'rejected')) throw res[0].reason;
    const [sent, recv] = res.map(x => (x.status === 'fulfilled' ? x.value : null));
    const byHash = new Map();
    for (const r of [...(sent?.tx_responses || []), ...(recv?.tx_responses || [])]) {
      if (r?.txhash && !byHash.has(r.txhash)) byHash.set(r.txhash, r);
    }
    const all = [...byHash.values()].sort((x, y) => Number(y.height) - Number(x.height));
    await resolveIbc(all.flatMap(r => (r.tx?.body?.messages || []).flatMap(m => coins(inner(m).amount).concat(coins(inner(m).token)).map(c => c.denom))), 10);

    const total = x => Number(x?.total ?? x?.pagination?.total ?? 0);
    const more = page * PAGE < total(sent) || page * PAGE < total(recv);
    return { items: all.map(r => summarize(r, a)), next: more ? page + 1 : null };
  }

  async function getTx(hash) {
    const h = String(hash || '').trim().replace(/^0x/i, '');
    if (!HASH.test(h)) throw new NotFound('Not a valid Cosmos tx hash');
    const [r, latest] = await Promise.all([
      fetchJSON(`${api}/cosmos/tx/v1beta1/txs/${h.toUpperCase()}`, { ttl: 15000 }),
      fetchJSON(`${api}/cosmos/base/tendermint/v1beta1/blocks/latest`, { ttl: 5000 }).catch(() => null),
    ]);
    const resp = r?.tx_response;
    if (!resp?.txhash) throw new NotFound('Transaction not found');

    const body = r.tx?.body || resp.tx?.body || {};
    const msgs = (body.messages || []).map(inner);
    await resolveIbc(msgs.flatMap(m => coins(m.amount).concat(coins(m.token)).map(c => c.denom)), 10);

    const inputs = [], outputs = [], transfers = [];
    let value = 0;
    for (const m of msgs) {
      const c = coins(m.amount).concat(coins(m.token));
      const nat = nativeSum(c);
      value += nat;
      const from = fromOf(m), to = toOf(m);
      if (from) inputs.push({ address: from, name: null, value: c.length ? nat : null });
      if (to) outputs.push({ address: to, name: null, value: c.length ? nat : null, note: typeName(m) });
      for (const x of c.filter(x => x.denom !== NATIVE)) {
        const { symbol, amount } = coinAmt(x);
        transfers.push({ from, to, amount, symbol });
      }
    }
    const seen = new Set();
    const uniqInputs = inputs.filter(i => (seen.has(i.address) && i.value == null ? false : (seen.add(i.address), true)));

    const height = Number(resp.height) || null;
    const tip = Number(latest?.block?.header?.height) || null;
    const types = [...new Set(msgs.map(typeName).filter(Boolean))];
    const extra = [
      { label: 'Messages', value: `${msgs.length} (${types.join(', ') || '—'})` },
      { label: 'Gas used / wanted', value: `${Number(resp.gas_used || 0).toLocaleString('en-US')} / ${Number(resp.gas_wanted || 0).toLocaleString('en-US')}` },
    ];
    if (body.memo) extra.push({ label: 'Memo', value: body.memo });
    if (resp.code) extra.push({ label: 'Error', value: `${resp.codespace || ''} ${resp.code}: ${String(resp.raw_log || '').slice(0, 300)}`.trim() });

    return {
      hash: resp.txhash,
      status: resp.code ? 'failed' : 'success',
      time: toMs(resp.timestamp),
      block: height,
      confirmations: height && tip ? Math.max(tip - height + 1, 1) : null,
      fee: feeOf(r.tx || resp.tx),
      value: clean(value),
      method: types.length ? types[0] + (msgs.length > 1 ? ` +${msgs.length - 1}` : '') : null,
      inputs: uniqInputs,
      outputs: outputs.map((o, i) => (i === 0 && body.memo ? { ...o, note: `${o.note} · memo: ${body.memo}` } : o)),
      transfers,
      extra,
    };
  }

  async function getStats() {
    const r = await fetchJSON(`${api}/cosmos/base/tendermint/v1beta1/blocks/latest`, { ttl: 5000 });
    const hd = r?.block?.header || r?.sdk_block?.header || {};
    const extra = [];
    if (hd.chain_id) extra.push({ label: 'Chain ID', value: hd.chain_id });
    const txs = r?.block?.data?.txs || r?.sdk_block?.data?.txs;
    if (Array.isArray(txs)) extra.push({ label: 'Txs in block', value: String(txs.length) });
    if (hd.time) extra.push({ label: 'Block time', value: new Date(toMs(hd.time)).toISOString().replace('.000Z', 'Z') });
    return { height: Number(hd.height) || null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
