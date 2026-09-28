
import { fetchJSON, fromUnits, toMs, NotFound, sleep } from '../utils.js';

const KNOWN = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn: { symbol: 'USDD', name: 'Decentralized USD (old)', decimals: 18 },
  TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz: { symbol: 'USDD', name: 'Decentralized USD', decimals: 18 },
  TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4: { symbol: 'TUSD', name: 'TrueUSD', decimals: 18 },
  TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR: { symbol: 'WTRX', name: 'Wrapped TRX', decimals: 6 },
  TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4: { symbol: 'BTT', name: 'BitTorrent', decimals: 18 },
  TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9: { symbol: 'JST', name: 'JUST', decimals: 18 },
  TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S: { symbol: 'SUN', name: 'SUN', decimals: 18 },
  TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7: { symbol: 'WIN', name: 'WINkLink', decimals: 6 },
};

const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SELECTORS = { a9059cbb: 'transfer', '095ea7b3': 'approve', '23b872dd': 'transferFrom', d0e30db0: 'deposit', '2e1a7d4d': 'withdraw' };
const ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const HEX_ADDR_RE = /^(?:0x)?41[0-9a-fA-F]{40}$/;
const HASH_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;


const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58cache = new Map();

async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

const hexToBytes = h => Uint8Array.from(h.match(/../g) || [], b => parseInt(b, 16));

function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}

async function toBase58(hex) {
  if (!hex || typeof hex !== 'string') return null;
  if (ADDR_RE.test(hex)) return hex;
  let h = hex.replace(/^0x/, '').toLowerCase();
  if (/^[0-9a-f]{40}$/.test(h)) h = '41' + h;
  if (!/^41[0-9a-f]{40}$/.test(h)) return hex;
  if (b58cache.has(h)) return b58cache.get(h);
  const payload = hexToBytes(h);
  const check = (await sha256(await sha256(payload))).slice(0, 4);
  const out = b58encode(new Uint8Array([...payload, ...check]));
  b58cache.set(h, out);
  return out;
}

const short = a => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : '');
const sunToTrx = v => fromUnits(v || 0, 6);


let lastCall = 0;
async function tron(chain, path, body) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + 400 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let r;
    try {
      r = await fetchJSON(chain.api + path, body ? { method: 'POST', body } : {});
    } catch (e) {
      if (e instanceof NotFound || attempt >= 2) throw e;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const err = r && (r.Error || (r.success === false && r.error));
    if (err) {
      if (/rate|suspend/i.test(err) && attempt < 2) { await sleep(2500 * (attempt + 1)); continue; }
      if (/rate|suspend/i.test(err)) throw new Error('TronGrid rate limit hit. Try again in a few seconds.');
      if (/valid|not ?found|invalid/i.test(err)) throw new NotFound(err);
      throw new Error(err);
    }
    return r;
  }
}

async function normalizeAddress(address) {
  const a = String(address || '').trim();
  if (ADDR_RE.test(a)) return a;
  if (HEX_ADDR_RE.test(a)) return toBase58(a);
  throw new NotFound('Not a TRON address');
}

function decodeHexText(h) {
  if (!h || !/^[0-9a-fA-F]+$/.test(h) || h.length % 2) return h || null;
  try { return new TextDecoder().decode(hexToBytes(h)).replace(/\0/g, '') || null; } catch { return null; }
}

function abiString(hex) {
  if (!hex || hex.length < 128) return decodeHexText((hex || '').replace(/(00)+$/, ''));
  const len = parseInt(hex.slice(64, 128), 16);
  return decodeHexText(hex.slice(128, 128 + len * 2));
}

const metaCache = new Map();
async function tokenMeta(chain, contract) {
  if (KNOWN[contract]) return KNOWN[contract];
  if (metaCache.has(contract)) return metaCache.get(contract);
  const call = sel => tron(chain, '/wallet/triggerconstantcontract', {
    owner_address: contract, contract_address: contract, function_selector: sel, visible: true,
  }).then(r => r?.constant_result?.[0] || null).catch(() => null);
  const symHex = await call('symbol()');
  const decHex = await call('decimals()');
  const meta = {
    symbol: abiString(symHex) || short(contract),
    name: null,
    decimals: decHex ? parseInt(decHex, 16) || 0 : 0,
  };
  metaCache.set(contract, meta);
  return meta;
}


const CONTRACT_NAMES = {
  TransferContract: 'Transfer',
  TransferAssetContract: 'TRC10 Transfer',
  TriggerSmartContract: 'Contract Call',
  FreezeBalanceV2Contract: 'Stake',
  UnfreezeBalanceV2Contract: 'Unstake',
  DelegateResourceContract: 'Delegate Resource',
  UnDelegateResourceContract: 'Undelegate Resource',
  VoteWitnessContract: 'Vote',
  WithdrawBalanceContract: 'Claim Rewards',
  WithdrawExpireUnfreezeContract: 'Withdraw Unstaked',
  AccountCreateContract: 'Create Account',
  CreateSmartContract: 'Deploy Contract',
};

function parseContract(c) {
  const type = c?.type || '';
  const v = c?.parameter?.value || {};
  let method = CONTRACT_NAMES[type] || type.replace(/Contract$/, '') || null;
  let to = v.to_address || v.receiver_address || v.contract_address || null;
  let value = 0, symbol = null;
  if (type === 'TransferContract') value = sunToTrx(v.amount);
  else if (type === 'TransferAssetContract') { value = Number(v.amount) || 0; symbol = `TRC10 ${decodeHexText(v.asset_name) || v.asset_name}`; }
  else if (type === 'TriggerSmartContract') {
    value = sunToTrx(v.call_value);
    const sel = (v.data || '').slice(0, 8);
    if (SELECTORS[sel]) method = SELECTORS[sel];
  } else if (v.frozen_balance || v.unfreeze_balance || v.balance) {
    value = sunToTrx(v.frozen_balance || v.unfreeze_balance || v.balance);
  }
  return { type, from: v.owner_address || null, to, value, symbol, method };
}

function dirOf(me, from, to) {
  if (from === me && to === me) return 'self';
  if (from === me) return 'out';
  if (to === me) return 'in';
  return null;
}

async function nativeSummary(tx, me, chain) {
  const c = parseContract(tx.raw_data?.contract?.[0]);
  const from = await toBase58(c.from), to = await toBase58(c.to);
  const ret = tx.ret?.[0] || {};
  const feeSun = ret.fee ?? ((tx.energy_fee || 0) + (tx.net_fee || 0));
  return {
    hash: tx.txID,
    time: toMs(tx.block_timestamp) ?? null,
    status: !ret.contractRet || ret.contractRet === 'SUCCESS' ? 'success' : 'failed',
    from, fromName: null, to, toName: KNOWN[to] ? KNOWN[to].symbol + ' contract' : null,
    direction: dirOf(me, from, to),
    value: c.value,
    symbol: c.symbol || chain.symbol,
    fee: sunToTrx(feeSun),
    method: c.method,
    _type: c.type,
  };
}

function trc20Summary(t, me) {
  const ti = t.token_info || {};
  return {
    hash: t.transaction_id,
    time: toMs(t.block_timestamp) ?? null,
    status: 'success',
    from: t.from || null, fromName: null, to: t.to || null, toName: null,
    direction: dirOf(me, t.from, t.to),
    value: fromUnits(t.value, Number(ti.decimals) || 0),
    symbol: ti.symbol || short(ti.address),
    fee: null,
    method: t.type || 'Transfer',
  };
}

export default function create(chain) {
  async function getAddress(address) {
    const addr = await normalizeAddress(address);
    const r = await tron(chain, `/v1/accounts/${addr}`);
    const acct = r?.data?.[0];
    if (!acct) {
      return { address: addr, active: false, name: null, labels: [], kind: 'Wallet', balance: 0, txCount: 0, stats: [], tokens: [] };
    }

    let kind = 'Wallet', name = decodeHexText(acct.account_name);
    if (acct.type === 'Contract') {
      kind = 'Contract';
      const c = await tron(chain, '/wallet/getcontract', { value: addr, visible: true }).catch(() => null);
      if (c?.name) name = c.name;
      if (KNOWN[addr]) { kind = 'Token'; name = name || KNOWN[addr].name; }
    }

    const known = [], unknown = [];
    for (const entry of acct.trc20 || []) {
      const [contract, raw] = Object.entries(entry)[0] || [];
      if (!contract || !raw || raw === '0') continue;
      const k = KNOWN[contract];
      if (k) known.push({ symbol: k.symbol, name: k.name, balance: fromUnits(raw, k.decimals), contract });
      else unknown.push({ symbol: short(contract), name: null, balance: fromUnits(raw, String(raw).length > 18 ? 18 : 6), contract });
    }
    known.sort((a, b) => b.balance - a.balance);
    const tokens = [...known, ...unknown.slice(0, 15)];

    const staked = (acct.frozenV2 || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const stats = [];
    if (acct.create_time) stats.push({ label: 'Created', value: new Date(acct.create_time).toISOString().slice(0, 10) });
    if (staked) stats.push({ label: 'Staked (TRX)', value: sunToTrx(staked).toLocaleString('en-US') });
    const last = acct.latest_opration_time || acct.latest_consume_time;
    if (last) stats.push({ label: 'Last activity', value: new Date(last).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' });
    if (acct.trc20?.length) stats.push({ label: 'TRC20 tokens held', value: String(acct.trc20.length) });

    return {
      address: addr,
      active: true,
      name: name || null,
      labels: [],
      kind,
      balance: sunToTrx(acct.balance),
      txCount: null,
      stats,
      tokens,
    };
  }

  async function getTxs(address, cursor = null) {
    const me = await normalizeAddress(address);
    const st = cursor ? structuredClone(cursor) : {
      n: { fp: null, done: false, oldest: null }, t: { fp: null, done: false, oldest: null }, buf: [], seen: [],
    };
    const has = src => st.buf.some(i => i._src === src);
    const seen = new Set(st.seen);
    const emit = [];

    for (let round = 0; round < 3 && emit.length < 10; round++) {
      let fetched = false;
      for (const [src, path] of [['t', '/transactions/trc20'], ['n', '/transactions']]) {
        const f = st[src];
        if (f.done || has(src)) continue;
        const qs = `?limit=20${f.fp ? `&fingerprint=${encodeURIComponent(f.fp)}` : ''}`;
        const r = await tron(chain, `/v1/accounts/${me}${path}${qs}`);
        const data = (r?.data || []).filter(x => (src === 't' ? x.transaction_id : x.txID));
        for (const x of data) {
          const item = src === 't' ? trc20Summary(x, me) : await nativeSummary(x, me, chain);
          item._src = src;
          st.buf.push(item);
          if (item.time != null) f.oldest = f.oldest == null ? item.time : Math.min(f.oldest, item.time);
        }
        f.fp = r?.meta?.fingerprint || null;
        f.done = !f.fp || data.length === 0;
        fetched = true;
      }

      const tokenRows = new Map(st.buf.filter(i => i._src === 't').map(i => [i.hash, i]));
      st.buf = st.buf.filter(i => {
        if (i._src !== 'n' || i._type !== 'TriggerSmartContract') return true;
        const tok = tokenRows.get(i.hash);
        if (tok) { tok.fee = i.fee; tok.status = i.status; return false; }
        return !seen.has(i.hash);
      });

      const boundary = Math.max(...['n', 't'].filter(s => !st[s].done).map(s => st[s].oldest ?? -Infinity), -Infinity);
      st.buf.sort((a, b) => (b.time ?? Infinity) - (a.time ?? Infinity));
      for (const i of st.buf) if ((i.time ?? Infinity) >= boundary) { emit.push(i); if (i._src === 't') seen.add(i.hash); }
      st.buf = st.buf.filter(i => (i.time ?? Infinity) < boundary);
      if (!fetched) break;
    }
    st.seen = [...seen].slice(-100);

    const items = emit.map(({ _src, _type, ...rest }) => rest);
    const more = st.buf.length || !st.n.done || !st.t.done;
    return { items, next: more ? st : null };
  }

  async function getTx(hash) {
    const h = String(hash || '').trim().replace(/^0x/, '').toLowerCase();
    if (!HASH_RE.test(h)) throw new NotFound('Not a TRON transaction hash');
    const tx = await tron(chain, '/wallet/gettransactionbyid', { value: h, visible: true });
    if (!tx || !tx.txID) throw new NotFound('Transaction not found');
    const info = await tron(chain, '/wallet/gettransactioninfobyid', { value: h }).catch(() => ({}));
    const confirmed = !!info?.blockNumber;

    const c = parseContract(tx.raw_data?.contract?.[0]);
    const from = await toBase58(c.from), to = await toBase58(c.to);
    const receipt = info?.receipt || {};
    const ret = tx.ret?.[0]?.contractRet;
    let status = 'success';
    if (!confirmed) status = 'pending';
    else if (info.result === 'FAILED' || (receipt.result && receipt.result !== 'SUCCESS') || (ret && ret !== 'SUCCESS')) status = 'failed';

    const transfers = [];
    for (const log of info?.log || []) {
      if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      const contract = await toBase58(log.address);
      const meta = await tokenMeta(chain, contract);
      const nft = log.topics.length === 4;
      transfers.push({
        from: await toBase58(log.topics[1].slice(-40)),
        to: await toBase58(log.topics[2].slice(-40)),
        amount: nft ? 1 : fromUnits('0x' + (log.data || '0'), meta.decimals),
        symbol: meta.symbol,
      });
    }

    let confirmations = null;
    if (confirmed) {
      const head = await tron(chain, '/wallet/getblock', { detail: false }).catch(() => null);
      const n = head?.block_header?.raw_data?.number;
      if (n) confirmations = Math.max(0, n - info.blockNumber + 1);
    }

    const memo = decodeHexText(tx.raw_data?.data);
    const extra = [{ label: 'Type', value: c.type || '—' }];
    if (receipt.energy_usage_total) extra.push({ label: 'Energy used', value: String(receipt.energy_usage_total) });
    if (receipt.net_usage) extra.push({ label: 'Bandwidth used', value: String(receipt.net_usage) });
    if (receipt.result && receipt.result !== 'SUCCESS') extra.push({ label: 'Result', value: receipt.result });
    if (info?.resMessage) extra.push({ label: 'Error', value: decodeHexText(info.resMessage) || info.resMessage });
    if (tx.raw_data?.fee_limit) extra.push({ label: 'Fee limit', value: `${sunToTrx(tx.raw_data.fee_limit)} TRX` });
    if (memo) extra.push({ label: 'Memo', value: memo });

    return {
      hash: tx.txID,
      status,
      time: confirmed ? toMs(info.blockTimeStamp) : null,
      block: info?.blockNumber ?? null,
      confirmations,
      fee: confirmed ? sunToTrx(info.fee) : null,
      value: c.symbol ? 0 : c.value,
      method: c.method,
      inputs: from ? [{ address: from, name: null, value: c.symbol ? null : c.value }] : [],
      outputs: to ? [{ address: to, name: KNOWN[to] ? KNOWN[to].name : null, value: c.symbol ? null : c.value, note: memo }] : [],
      transfers,
      extra,
    };
  }

  async function getStats() {
    const b = await tron(chain, '/wallet/getblock', { detail: false });
    const raw = b?.block_header?.raw_data || {};
    const extra = [];
    if (raw.timestamp) extra.push({ label: 'Block time', value: new Date(raw.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' });
    if (raw.witness_address) extra.push({ label: 'Produced by', value: await toBase58(raw.witness_address) });
    const params = await tron(chain, '/wallet/getchainparameters', {}).catch(() => null);
    const p = Object.fromEntries((params?.chainParameter || []).map(x => [x.key, x.value]));
    if (p.getEnergyFee) extra.push({ label: 'Energy price', value: `${p.getEnergyFee} sun` });
    if (p.getTransactionFee) extra.push({ label: 'Bandwidth price', value: `${p.getTransactionFee} sun/byte` });
    return { height: raw.number ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
