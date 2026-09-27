// TON adapter (toncenter API v3). Unauthenticated toncenter allows ~1 request/second,
// so every call goes through a sequential throttle and 429s are retried with backoff.

import { fetchJSON, fromUnits, toMs, NotFound, sleep } from '../utils.js';

const RAW_RE = /^-?\d+:[0-9a-fA-F]{64}$/;
const FRIENDLY_RE = /^[A-Za-z0-9_\-+/]{48}$/;
const HEX_HASH_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const B64_HASH_RE = /^[A-Za-z0-9_\-+/]{43}=?$/;

const nano = v => fromUnits(v || 0, 9);
const short = a => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : '');

// ---- encoding helpers ----

const b64ToHex = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(44, '='));
  return [...bin].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
};

function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Raw "wc:hex" -> user-friendly base64url (bounceable EQ... by default, UQ... if !bounceable). */
function rawToFriendly(raw, bounceable = true) {
  if (!raw || !RAW_RE.test(raw)) return raw || null;
  const [wc, hex] = raw.split(':');
  const bytes = new Uint8Array(36);
  bytes[0] = bounceable ? 0x11 : 0x51;
  bytes[1] = Number(wc) & 0xff;
  for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(hex.substr(i * 2, 2), 16);
  const crc = crc16(bytes.subarray(0, 34));
  bytes[34] = crc >> 8; bytes[35] = crc & 0xff;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

/** addr_std object from a decoded message body -> raw form. */
const addrStd = a => (a && a.address ? `${a.workchain_id ?? 0}:${a.address}` : null);

// ---- HTTP with throttle ----

let queue = Promise.resolve();
let lastCall = 0;
const MIN_GAP = 1100;

function tc(chain, path) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + MIN_GAP - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try {
        return await fetchJSON(chain.api + path, { timeout: 20000 });
      } catch (e) {
        if (e instanceof NotFound) throw e;
        if (/busy|429/.test(e.message) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
        if (/busy|429/.test(e.message)) throw new Error('toncenter rate limit (1 req/s without API key). Try again in a moment.');
        throw e;
      }
    }
  };
  // Serialize all toncenter calls from this module.
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

function checkAddress(address) {
  const a = String(address || '').trim();
  if (!RAW_RE.test(a) && !FRIENDLY_RE.test(a)) throw new NotFound('Not a TON address');
  return a;
}

/** Normalize a tx hash (hex, base64 or base64url) to lowercase hex. */
function hashToHex(hash) {
  const h = String(hash || '').trim();
  if (HEX_HASH_RE.test(h)) return h.replace(/^0x/, '').toLowerCase();
  if (B64_HASH_RE.test(h)) {
    try { const hex = b64ToHex(h); if (hex.length === 64) return hex; } catch { /* fall through */ }
  }
  throw new NotFound('Not a TON transaction hash');
}

// ---- tx mapping ----

function friendly(book, raw) {
  if (!raw) return null;
  return book?.[raw]?.user_friendly || rawToFriendly(raw);
}

const comment = msg => {
  const d = msg?.message_content?.decoded;
  return d && (d['@type'] === 'text_comment' || d.type === 'text_comment') ? d.comment || null : null;
};

function msgMethod(msg) {
  if (!msg) return null;
  const op = msg.decoded_opcode;
  if (!op || op === 'text_comment' || msg.opcode === '0x00000000' || !msg.opcode) return 'Transfer';
  return op.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

function txStatus(tx) {
  if (tx.emulated) return 'pending';
  const d = tx.description || {};
  const compute = d.compute_ph || {};
  // A skipped compute phase (e.g. plain transfer to an uninit wallet) still credits the value.
  if (!compute.skipped && compute.success === false) return 'failed';
  if (d.action_ph && d.action_ph.success === false) return 'failed';
  return 'success';
}

/**
 * Summarize a tx relative to its own account. If the inbound message is external (wallet signing),
 * it's an outgoing tx whose value is the sum of outbound messages; otherwise it's incoming.
 */
function summarize(tx, book) {
  const me = friendly(book, tx.account);
  const inMsg = tx.in_msg || null;
  const outs = (tx.out_msgs || []).filter(m => m.destination);
  const external = !inMsg || !inMsg.source;
  let from, to, value, method, note;
  if (external) {
    from = me;
    to = outs[0] ? friendly(book, outs[0].destination) : null;
    value = outs.reduce((s, m) => s + nano(m.value), 0);
    method = outs.length ? msgMethod(outs[0]) : inMsg ? 'External message' : 'Tick-tock';
    note = outs.map(comment).filter(Boolean).join(' | ') || null;
  } else {
    from = friendly(book, inMsg.source);
    to = me;
    value = nano(inMsg.value);
    method = inMsg.bounced ? 'Bounce' : msgMethod(inMsg);
    note = comment(inMsg);
  }
  return { me, inMsg, outs, external, from, to, value, method, note };
}

export default function create(chain) {
  async function getAddress(address) {
    const a = checkAddress(address);
    const bookRes = await tc(chain, `/addressBook?address=${encodeURIComponent(a)}`);
    const entry = bookRes?.[a] || Object.values(bookRes || {})[0];
    if (!entry || !entry.user_friendly) throw new NotFound('Invalid TON address');
    const canonical = entry.user_friendly;
    const ifaces = entry.interfaces || [];

    // Wallet info gives type/seqno; non-wallet contracts answer 409 "not a wallet" -> use /account.
    let info;
    const isWalletLike = !ifaces.length || ifaces.some(i => /^wallet/.test(i));
    if (isWalletLike) info = await tc(chain, `/walletInformation?address=${encodeURIComponent(canonical)}&use_v2=false`).catch(() => null);
    if (!info) info = await tc(chain, `/account?address=${encodeURIComponent(canonical)}`).catch(e => {
      if (e instanceof NotFound) return { balance: '0', status: 'nonexist' };
      throw e;
    });

    const balance = nano(info.balance);
    const neverUsed = (!info.last_transaction_lt || info.last_transaction_lt === '0') && balance === 0;
    const status = info.status || 'unknown';

    let kind = 'Wallet';
    if (ifaces.includes('jetton_master')) kind = 'Token';
    else if (ifaces.some(i => /^jetton_wallet/.test(i))) kind = 'Jetton Wallet';
    else if (ifaces.some(i => /^nft_item/.test(i))) kind = 'NFT';
    else if (ifaces.some(i => /^nft_collection/.test(i))) kind = 'NFT Collection';
    else if (!info.wallet_type && status === 'active' && !ifaces.some(i => /^wallet/.test(i))) kind = 'Contract';

    const stats = [{ label: 'Status', value: status }];
    if (info.wallet_type) stats.push({ label: 'Wallet type', value: info.wallet_type });
    if (info.seqno != null) stats.push({ label: 'Seqno', value: String(info.seqno) });
    if (ifaces.length) stats.push({ label: 'Interfaces', value: ifaces.join(', ') });

    // Jetton balances (one call; metadata comes along in the same response).
    let tokens = [];
    if (!neverUsed && kind !== 'Jetton Wallet') {
      try {
        const j = await tc(chain, `/jetton/wallets?owner_address=${encodeURIComponent(canonical)}&limit=30&exclude_zero_balance=true`);
        const meta = j?.metadata || {};
        tokens = (j?.jetton_wallets || []).map(w => {
          const info = (meta[w.jetton]?.token_info || []).find(t => t.type === 'jetton_masters') || {};
          const decimals = Number(info.extra?.decimals ?? 9);
          return {
            symbol: info.symbol || short(friendly(j.address_book, w.jetton)),
            name: info.is_scam ? `${info.name || 'Unknown'} (flagged scam)` : info.name || null,
            balance: fromUnits(w.balance, decimals),
            contract: friendly(j.address_book, w.jetton),
            _scam: !!info.is_scam,
          };
        }).filter(t => t.balance > 0)
          .sort((x, y) => x._scam - y._scam)
          .map(({ _scam, ...t }) => t);
      } catch { /* jettons are optional */ }
    }

    return {
      address: canonical,
      active: !neverUsed,
      name: entry.domain || null,
      labels: [],
      kind,
      balance,
      txCount: neverUsed ? 0 : null,
      stats,
      tokens,
    };
  }

  /** Cursor is the logical time (lt) just below the last item returned, so pages stay stable. */
  async function getTxs(address, cursor = null) {
    const a = checkAddress(address);
    const qs = `account=${encodeURIComponent(a)}&limit=20&sort=desc${cursor ? `&end_lt=${encodeURIComponent(cursor)}` : ''}`;
    const r = await tc(chain, `/transactions?${qs}`);
    const txs = r?.transactions || [];
    const book = r?.address_book || {};
    const items = txs.map(tx => {
      const s = summarize(tx, book);
      const selfSend = s.external && s.outs.length && s.outs.every(m => m.destination === tx.account);
      return {
        hash: b64ToHex(tx.hash),
        time: toMs(tx.now) ?? null,
        status: txStatus(tx),
        from: s.from, fromName: book[s.external ? tx.account : s.inMsg?.source]?.domain || null,
        to: s.to, toName: book[s.external ? s.outs[0]?.destination : tx.account]?.domain || null,
        direction: selfSend ? 'self' : s.external ? (s.outs.length ? 'out' : null) : 'in',
        value: s.value,
        symbol: chain.symbol,
        fee: nano(tx.total_fees),
        method: s.method,
      };
    });
    const last = txs[txs.length - 1];
    const next = txs.length === 20 && last?.lt ? (BigInt(last.lt) - 1n).toString() : null;
    return { items, next };
  }

  async function getTx(hash) {
    const hex = hashToHex(hash);
    let r = await tc(chain, `/transactions?hash=${hex}&limit=1`);
    let tx = r?.transactions?.[0];
    if (!tx) {
      // Maybe it's a message hash (what many wallets show): find the tx that received it.
      r = await tc(chain, `/transactionsByMessage?msg_hash=${hex}&direction=in&limit=1`).catch(() => null);
      tx = r?.transactions?.[0];
    }
    if (!tx) throw new NotFound('Transaction not found');
    const book = r.address_book || {};
    const s = summarize(tx, book);

    const inputs = s.external
      ? [{ address: s.me, name: book[tx.account]?.domain || null, value: null }]
      : [{ address: s.from, name: book[s.inMsg.source]?.domain || null, value: s.value }];
    const outputs = s.external
      ? s.outs.map(m => ({ address: friendly(book, m.destination), name: book[m.destination]?.domain || null, value: nano(m.value), note: comment(m) }))
      : [{ address: s.me, name: book[tx.account]?.domain || null, value: s.value, note: s.note }];

    // Jetton movements from decoded bodies. Symbol/decimals need one lookup of the jetton wallet involved.
    const transfers = [];
    const jettonMsgs = [s.inMsg, ...s.outs].filter(m => /^jetton_(notify|transfer)$/.test(m?.message_content?.decoded?.['@type'] || ''));
    for (const m of jettonMsgs.slice(0, 2)) {
      const d = m.message_content.decoded;
      const notify = d['@type'] === 'jetton_notify';
      // notify: source = receiver's jetton wallet; transfer: destination = sender's jetton wallet.
      const jw = notify ? m.source : m.destination;
      let symbol = 'Jetton', decimals = 9;
      try {
        const j = await tc(chain, `/jetton/wallets?address=${encodeURIComponent(jw)}&limit=1`);
        const master = j?.jetton_wallets?.[0]?.jetton;
        const info = (j?.metadata?.[master]?.token_info || []).find(t => t.type === 'jetton_masters');
        if (info) { symbol = info.symbol || symbol; decimals = Number(info.extra?.decimals ?? 9); }
      } catch { /* keep defaults */ }
      const other = friendly(book, addrStd(notify ? d.sender : d.destination));
      transfers.push({
        from: notify ? other : s.me,
        to: notify ? s.me : other,
        amount: fromUnits(d.amount?.value ?? d.amount ?? 0, decimals),
        symbol,
      });
    }

    const d = tx.description || {};
    const extra = [
      { label: 'Logical time', value: String(tx.lt) },
      { label: 'Finality', value: tx.finality || (tx.emulated ? 'pending' : 'finalized') },
    ];
    if (tx.block_ref) extra.push({ label: 'Shard block', value: `${tx.block_ref.workchain}:${tx.block_ref.shard}:${tx.block_ref.seqno}` });
    if (d.compute_ph && !d.compute_ph.skipped) extra.push({ label: 'Exit code', value: String(d.compute_ph.exit_code ?? '—') });
    if (d.compute_ph?.skipped) extra.push({ label: 'Compute phase', value: `skipped (${d.compute_ph.reason || '—'})` });
    if (d.aborted) extra.push({ label: 'Aborted', value: 'yes' });
    if (s.note) extra.push({ label: 'Comment', value: s.note });
    const op = (s.external ? s.outs[0] : s.inMsg)?.opcode;
    if (op && op !== '0x00000000') extra.push({ label: 'Opcode', value: op });
    if (tx.orig_status !== tx.end_status) extra.push({ label: 'Account status', value: `${tx.orig_status} → ${tx.end_status}` });
    extra.push({ label: 'Hash (base64)', value: tx.hash });

    return {
      hash: b64ToHex(tx.hash),
      status: txStatus(tx),
      time: toMs(tx.now) ?? null,
      block: tx.mc_block_seqno ?? tx.block_ref?.seqno ?? null,
      confirmations: null,
      fee: nano(tx.total_fees),
      value: s.value,
      method: s.method,
      inputs,
      outputs,
      transfers,
      extra,
    };
  }

  async function getStats() {
    const r = await tc(chain, '/masterchainInfo');
    const last = r?.last || {};
    const extra = [];
    if (last.gen_utime) extra.push({ label: 'Block time', value: new Date(toMs(last.gen_utime)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' });
    if (last.tx_count != null) extra.push({ label: 'Txs in last masterchain block', value: String(last.tx_count) });
    return { height: last.seqno ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
