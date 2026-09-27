// XRP Ledger adapter (rippled JSON-RPC, e.g. xrplcluster.com).
// Note: rippled's JSON-RPC is `{ method, params: [{...}] }`, not JSON-RPC 2.0, so `rpc()` from utils is not used.

import { fetchJSON, fromUnits, NotFound, sleep } from '../utils.js';

const RIPPLE_EPOCH = 946684800; // 2000-01-01T00:00:00Z in unix seconds
const ADDR_RE = /^r[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{24,34}$/;
const HASH_RE = /^[0-9A-Fa-f]{64}$/;
const NOT_FOUND_ERRORS = new Set(['actNotFound', 'actMalformed', 'txnNotFound', 'invalidParams', 'badTxHash', 'notFound', 'lgrNotFound']);

// A few well-known public accounts (exchanges / issuers).
const LABELS = {
  rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh: ['Binance', 'Exchange'],
  rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B: ['Bitstamp', 'Issuer'],
  rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq: ['GateHub', 'Issuer'],
  rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh: ['Genesis account'],
  rrrrrrrrrrrrrrrrrrrrrhoLvTp: ['Black hole (ACCOUNT_ZERO)'],
};

const drops = v => fromUnits(v, 6);
const rippleMs = t => (t === null || t === undefined ? null : (Number(t) + RIPPLE_EPOCH) * 1000);
const short = a => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : '');

function hexToText(h) {
  if (!h || !/^[0-9A-Fa-f]+$/.test(h) || h.length % 2) return null;
  try {
    const bytes = Uint8Array.from(h.match(/../g), b => parseInt(b, 16));
    const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0/g, '').trim();
    return s || null;
  } catch { return null; }
}

/** Currency code: 3-char ISO-like, or 40-hex (non-standard; `03...` prefix = AMM LP token). */
function currencyName(c) {
  if (!c) return '?';
  if (c.length !== 40) return c;
  if (c.startsWith('03')) return 'LP';
  return hexToText(c) || c.slice(0, 8);
}

/** Amount is a drops string (XRP), an issued-currency object, or an MPT object. */
function parseAmount(a) {
  if (a === null || a === undefined) return null;
  if (typeof a === 'string' || typeof a === 'number') return { value: drops(a), symbol: 'XRP', xrp: true };
  if (a.mpt_issuance_id) return { value: Number(a.value) || 0, symbol: 'MPT', xrp: false };
  return { value: Number(a.value) || 0, symbol: currencyName(a.currency), issuer: a.issuer, xrp: false };
}

export default function create(chain) {
  async function call(method, params = {}, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetchJSON(chain.api, { method: 'POST', body: { method, params: [params] }, ...opts });
      const res = r?.result;
      if (!res) throw new Error('Empty XRPL response');
      if (res.status === 'error' || res.error) {
        if (NOT_FOUND_ERRORS.has(res.error)) throw new NotFound(res.error_message || res.error);
        if (/slowDown|tooBusy|noNetwork|noCurrent/.test(res.error) && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        throw new Error(res.error_message || res.error);
      }
      return res;
    }
  }

  const serverInfo = () => call('server_info', {}, { ttl: 4000 }).then(r => r.info || {});

  /** Normalize account_tx entry / tx result (API v1 `tx`+`meta` or v2 `tx_json`+`hash`). */
  function unpack(e) {
    const t = e.tx_json || e.tx || e;
    return {
      t,
      meta: e.meta || t.meta || {},
      hash: e.hash || t.hash,
      ledger: e.ledger_index ?? t.ledger_index ?? t.inLedger ?? null,
      date: t.date ?? e.date ?? null,
      validated: e.validated ?? t.validated ?? true,
      closeIso: e.close_time_iso || null,
    };
  }

  const txStatus = (meta, validated) =>
    !validated ? 'pending' : meta.TransactionResult === 'tesSUCCESS' ? 'success' : 'failed';

  // Only these tx types carry a meaningful "amount moved" to a destination.
  const AMOUNT_TYPES = new Set(['Payment', 'EscrowCreate', 'CheckCreate', 'CheckCash', 'PaymentChannelCreate', 'PaymentChannelFund']);

  function movedAmount(t, meta) {
    if (!AMOUNT_TYPES.has(t.TransactionType)) return null;
    return parseAmount(meta.delivered_amount && meta.delivered_amount !== 'unavailable'
      ? meta.delivered_amount : t.DeliverMax ?? t.Amount ?? t.SendMax);
  }

  async function getAddress(address) {
    const addr = String(address || '').trim();
    if (!ADDR_RE.test(addr)) throw new NotFound('Not an XRP Ledger address');
    let info;
    try {
      info = await call('account_info', { account: addr, ledger_index: 'validated' });
    } catch (e) {
      if (e instanceof NotFound && /not found/i.test(e.message)) {
        // Syntactically valid but unfunded: the account does not exist on-ledger yet.
        return { address: addr, active: false, name: null, labels: LABELS[addr] || [], kind: 'Wallet', balance: 0, txCount: 0, stats: [], tokens: [] };
      }
      throw e;
    }
    const d = info.account_data || {};
    const flags = info.account_flags || {};

    const srv = await serverInfo().catch(() => ({}));
    const vl = srv.validated_ledger || {};
    const base = vl.reserve_base_xrp ?? 1, inc = vl.reserve_inc_xrp ?? 0.2;
    const reserve = +(base + inc * (d.OwnerCount || 0)).toFixed(6);

    // Trust lines (issued tokens). One page is enough for display.
    let tokens = [];
    try {
      const lines = await call('account_lines', { account: addr, ledger_index: 'validated', limit: 200 });
      tokens = (lines.lines || [])
        .map(l => ({ symbol: currencyName(l.currency), name: `Issuer ${short(l.account)}`, balance: Number(l.balance) || 0, contract: l.account }))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    } catch { /* trust lines are optional */ }

    const stats = [
      { label: 'Reserve', value: `${reserve} XRP (${d.OwnerCount || 0} owned objects)` },
      { label: 'Sequence', value: String(d.Sequence ?? '—') },
    ];
    if (flags.requireDestinationTag) stats.push({ label: 'Destination tag', value: 'Required' });
    if (flags.disableMasterKey) stats.push({ label: 'Master key', value: 'Disabled' });
    if (d.RegularKey) stats.push({ label: 'Regular key', value: d.RegularKey });
    if (flags.defaultRipple) stats.push({ label: 'Default ripple', value: 'On (issuer)' });

    const domain = hexToText(d.Domain);
    const labels = LABELS[addr] || [];
    return {
      address: d.Account || addr,
      active: true,
      name: labels[0] || domain || null,
      labels,
      kind: d.AMMID ? 'AMM' : flags.defaultRipple ? 'Issuer' : 'Wallet',
      balance: drops(d.Balance),
      txCount: null,
      stats: domain ? [{ label: 'Domain', value: domain }, ...stats] : stats,
      tokens,
    };
  }

  async function getTxs(address, cursor = null) {
    const addr = String(address || '').trim();
    if (!ADDR_RE.test(addr)) throw new NotFound('Not an XRP Ledger address');
    const params = { account: addr, limit: 20, forward: false, ledger_index_min: -1, ledger_index_max: -1 };
    if (cursor) params.marker = cursor;
    let r;
    try {
      r = await call('account_tx', params);
    } catch (e) {
      if (e instanceof NotFound && /not found/i.test(e.message)) return { items: [], next: null }; // unfunded
      throw e;
    }
    const items = (r.transactions || []).map(e => {
      const { t, meta, hash, date, validated } = unpack(e);
      const amt = movedAmount(t, meta);
      const from = t.Account || null, to = t.Destination || null;
      return {
        hash,
        time: rippleMs(date),
        status: txStatus(meta, validated),
        from, fromName: LABELS[from]?.[0] || null,
        to, toName: LABELS[to]?.[0] || null,
        direction: from === addr && to === addr ? 'self' : from === addr ? 'out' : to === addr ? 'in' : null,
        value: amt ? amt.value : 0,
        symbol: amt ? amt.symbol : chain.symbol,
        fee: t.Fee != null ? drops(t.Fee) : null,
        method: t.TransactionType || null,
      };
    });
    return { items, next: r.marker || null };
  }

  async function getTx(hash) {
    const h = String(hash || '').trim().replace(/^0x/i, '');
    if (!HASH_RE.test(h)) throw new NotFound('Not an XRP Ledger transaction hash');
    const r = await call('tx', { transaction: h.toUpperCase(), binary: false });
    const { t, meta, ledger, date, validated, hash: txHash } = unpack(r);
    const status = txStatus(meta, validated);

    let confirmations = null;
    if (validated && ledger) {
      const seq = (await serverInfo().catch(() => ({}))).validated_ledger?.seq;
      if (seq) confirmations = Math.max(1, seq - ledger + 1);
    }

    const amt = movedAmount(t, meta);
    const requested = parseAmount(t.DeliverMax ?? t.Amount);
    const memos = (t.Memos || []).map(m => hexToText(m.Memo?.MemoData) || m.Memo?.MemoData).filter(Boolean);
    const destTag = t.DestinationTag;
    const noteParts = [];
    if (destTag !== undefined) noteParts.push(`Destination tag ${destTag}`);
    if (memos.length) noteParts.push(memos.join(' | '));
    const note = noteParts.join(' · ') || null;

    const isXrp = amt?.xrp;
    const inputs = t.Account ? [{ address: t.Account, name: LABELS[t.Account]?.[0] || null, value: isXrp ? amt.value : null }] : [];
    const outputs = t.Destination
      ? [{ address: t.Destination, name: LABELS[t.Destination]?.[0] || null, value: isXrp ? amt.value : null, note }]
      : [];
    const transfers = amt && !amt.xrp && t.Destination
      ? [{ from: t.Account, to: t.Destination, amount: amt.value, symbol: amt.symbol }]
      : [];

    const extra = [
      { label: 'Type', value: t.TransactionType || '—' },
      { label: 'Result', value: meta.TransactionResult || '—' },
    ];
    if (ledger) extra.push({ label: 'Ledger', value: String(ledger) });
    if (t.Sequence) extra.push({ label: 'Sequence', value: String(t.Sequence) });
    if (destTag !== undefined) extra.push({ label: 'Destination tag', value: String(destTag) });
    if (t.SourceTag !== undefined) extra.push({ label: 'Source tag', value: String(t.SourceTag) });
    if (memos.length) extra.push({ label: 'Memo', value: memos.join(' | ') });
    if (amt && requested && amt.value !== requested.value) {
      extra.push({ label: 'Requested amount', value: `${requested.value} ${requested.symbol} (partial payment)` });
    }
    if (amt?.issuer) extra.push({ label: 'Issuer', value: amt.issuer });
    if (t.TakerGets !== undefined && t.TakerPays !== undefined) {
      const fmt = a => { const p = parseAmount(a); return p ? `${p.value} ${p.symbol}` : '?'; };
      extra.push({ label: 'Offer', value: `sell ${fmt(t.TakerGets)} for ${fmt(t.TakerPays)}` });
    }

    return {
      hash: txHash || h.toUpperCase(),
      status,
      time: rippleMs(date),
      block: ledger,
      confirmations,
      fee: t.Fee != null ? drops(t.Fee) : null,
      value: isXrp ? amt.value : amt ? null : 0,
      method: t.TransactionType || null,
      inputs,
      outputs,
      transfers,
      extra,
    };
  }

  async function getStats() {
    const info = await serverInfo();
    const vl = info.validated_ledger || {};
    const extra = [];
    if (vl.base_fee_xrp != null) extra.push({ label: 'Base fee', value: `${vl.base_fee_xrp} XRP` });
    if (info.load_factor != null) extra.push({ label: 'Load factor', value: String(info.load_factor) });
    if (vl.reserve_base_xrp != null) extra.push({ label: 'Reserve', value: `${vl.reserve_base_xrp} XRP + ${vl.reserve_inc_xrp} XRP/object` });
    if (info.last_close?.proposers) extra.push({ label: 'Validators (proposers)', value: String(info.last_close.proposers) });
    return { height: vl.seq ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
