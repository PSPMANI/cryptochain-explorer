// Sui adapter: fullnode JSON-RPC (suix_* / sui_* methods).
import { rpc, fromUnits, toMs, NotFound } from '../utils.js';

const ADDR_RE = /^0x[0-9a-fA-F]{1,64}$/;
const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUI = '0x2::sui::SUI';
const PAGE = 20;
const TX_OPTS = { showInput: true, showEffects: true, showBalanceChanges: true };

/** Canonical 0x + 64 hex, lowercase. */
const canon = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
/** Coin type → short symbol (last `::` segment). */
const lastSeg = t => String(t || '').split('::').pop() || t;
const isSui = t => t === SUI || /^0x0*2::sui::SUI$/.test(t || '');
const ownerOf = o => (o && (o.AddressOwner || o.ObjectOwner)) || null;
const shortPkg = p => (p ? `${p.slice(0, 6)}…${p.slice(-4)}` : p);

export default function create(chain) {
  const call = (method, params, opts) => rpc(chain.api, method, params, opts);
  const sui = v => fromUnits(v, chain.decimals);

  function checkAddr(a) {
    a = String(a || '').trim();
    if (!ADDR_RE.test(a)) throw new NotFound('Not a Sui address');
    return canon(a);
  }

  // Coin metadata (symbol/decimals) cache; unknown coins fall back to the type's last segment and 9 decimals.
  const metaCache = new Map();
  function coinMeta(type) {
    if (isSui(type)) return Promise.resolve({ symbol: chain.symbol, name: 'Sui', decimals: chain.decimals });
    if (!metaCache.has(type)) {
      metaCache.set(type, call('suix_getCoinMetadata', [type], { ttl: 3600e3 })
        .then(m => ({ symbol: m?.symbol || lastSeg(type), name: m?.name || null, decimals: m?.decimals ?? 9 }))
        .catch(() => ({ symbol: lastSeg(type), name: null, decimals: 9 })));
    }
    return metaCache.get(type);
  }

  /** Gas fee in MIST (can be negative when the storage rebate exceeds costs). */
  function feeMist(effects) {
    const g = effects?.gasUsed;
    if (!g) return null;
    try { return BigInt(g.computationCost || 0) + BigInt(g.storageCost || 0) - BigInt(g.storageRebate || 0); } catch { return null; }
  }

  /** Human method: first MoveCall as module::function, else the first command / tx kind. */
  function methodOf(tx) {
    const t = tx?.transaction?.data?.transaction;
    if (!t) return null;
    if (t.kind !== 'ProgrammableTransaction') return t.kind || null;
    const cmds = t.transactions || [];
    const mc = cmds.find(c => c.MoveCall);
    if (mc) return `${mc.MoveCall.module}::${mc.MoveCall.function}`;
    const first = cmds.find(c => !c.SplitCoins && !c.MergeCoins) || cmds[0];
    const k = first && Object.keys(first)[0];
    return k === 'TransferObjects' ? 'Transfer' : k || 'ProgrammableTransaction';
  }

  const statusOf = tx => {
    const s = tx?.effects?.status?.status;
    return s === 'success' ? 'success' : s === 'failure' ? 'failed' : tx?.effects ? 'success' : 'pending';
  };

  /**
   * Net balance changes grouped by (owner, coinType), with the sender's gas added back
   * so SUI values reflect the amount moved rather than amount + fee.
   */
  function changes(tx) {
    const sender = tx?.transaction?.data?.sender || null;
    const fee = feeMist(tx.effects) ?? 0n;
    return (tx.balanceChanges || []).map(b => {
      const owner = ownerOf(b.owner);
      let raw = 0n;
      try { raw = BigInt(b.amount); } catch { /* ignore */ }
      if (owner === sender && isSui(b.coinType)) raw += fee;
      return { owner, coinType: b.coinType, raw };
    }).filter(c => c.raw !== 0n);
  }

  async function getAddress(address) {
    address = checkAddr(address);
    const [bal, all, obj] = await Promise.all([
      call('suix_getBalance', [address, SUI]),
      call('suix_getAllBalances', [address]).catch(() => []),
      call('sui_getObject', [address, { showType: true, showOwner: true }]).catch(() => null),
    ]);

    // An address that is also an object ID is a package or an object, not a wallet.
    let kind = 'Wallet', name = null;
    const stats = [];
    const od = obj && obj.data;
    if (od) {
      if (od.type === 'package') { kind = 'Package'; if (/^0x0{63}[1-3]$/.test(address)) name = ['Move stdlib', 'Sui framework', 'Sui system'][Number(address.slice(-1)) - 1]; }
      else { kind = 'Object'; stats.push({ label: 'Object type', value: od.type || '-' }); }
      if (od.version) stats.push({ label: 'Version', value: String(od.version) });
      const ow = od.owner;
      if (ow && typeof ow === 'object') stats.push({ label: 'Owner', value: ow.AddressOwner || ow.ObjectOwner || (ow.Shared ? 'Shared' : JSON.stringify(ow)) });
      else if (ow) stats.push({ label: 'Owner', value: String(ow) });
    }
    if (bal?.coinObjectCount != null) stats.push({ label: 'SUI coin objects', value: String(bal.coinObjectCount) });

    // Other coin balances (resolved through coin metadata; capped to keep request count sane).
    const others = (all || []).filter(b => !isSui(b.coinType) && b.totalBalance !== '0').slice(0, 30);
    const tokens = await Promise.all(others.map(async b => {
      const m = await coinMeta(b.coinType);
      return { symbol: m.symbol, name: m.name, balance: fromUnits(b.totalBalance, m.decimals), contract: b.coinType };
    }));

    // Activity check only when there's no balance to go on.
    let active = !!od || BigInt(bal?.totalBalance || 0) > 0n || tokens.length > 0;
    if (!active) {
      const q = await call('suix_queryTransactionBlocks', [{ filter: { ToAddress: address }, options: {} }, null, 1, true]).catch(() => null);
      const q2 = q?.data?.length ? q : await call('suix_queryTransactionBlocks', [{ filter: { FromAddress: address }, options: {} }, null, 1, true]).catch(() => null);
      active = !!q2?.data?.length;
    }

    return {
      address, active, name, labels: [], kind,
      balance: sui(bal?.totalBalance || 0),
      txCount: null, // no cheap counter on the fullnode RPC
      stats, tokens,
    };
  }

  /** Build a TxSummary relative to `address`. */
  async function summarize(tx, address) {
    const sender = tx?.transaction?.data?.sender || null;
    const fee = feeMist(tx.effects);
    const out = {
      hash: tx.digest,
      time: toMs(tx.timestampMs),
      status: statusOf(tx),
      from: sender, fromName: null, to: null, toName: null,
      direction: null, value: 0, symbol: chain.symbol,
      fee: fee == null ? null : sui(fee),
      method: methodOf(tx),
    };
    const cs = changes(tx);
    const mine = cs.filter(c => c.owner === address);
    // Prefer the SUI change; otherwise the largest token change of the address.
    const pick = mine.find(c => isSui(c.coinType)) || mine.sort((a, b) => (b.raw < 0n ? -b.raw : b.raw) > (a.raw < 0n ? -a.raw : a.raw) ? 1 : -1)[0];
    if (pick) {
      const m = await coinMeta(pick.coinType);
      const neg = pick.raw < 0n;
      out.value = fromUnits(neg ? -pick.raw : pick.raw, m.decimals);
      out.symbol = m.symbol;
      // Counterparty: the biggest opposite-signed change of the same coin.
      const other = cs.filter(c => c.coinType === pick.coinType && c.owner !== address && (c.raw < 0n) !== neg)
        .sort((a, b) => ((b.raw < 0n ? -b.raw : b.raw) > (a.raw < 0n ? -a.raw : a.raw) ? 1 : -1))[0];
      if (neg) { out.direction = 'out'; out.from = address; out.to = other?.owner || null; }
      else { out.direction = 'in'; out.to = address; out.from = sender !== address ? sender : other?.owner || null; }
    } else if (sender === address) {
      out.direction = 'self';
    } else {
      out.to = address;
    }
    return out;
  }

  /**
   * Newest-first history merging two server-side streams (sent: FromAddress, received: ToAddress).
   * Cursor = { from, to } holding each stream's native cursor (null = start, false = exhausted).
   */
  async function getTxs(address, cursor = null) {
    address = checkAddr(address);
    const cur = cursor || { from: null, to: null };
    const query = (filter, c) => (c === false
      ? Promise.resolve({ data: [], hasNextPage: false })
      : call('suix_queryTransactionBlocks', [{ filter, options: TX_OPTS }, c, PAGE, true]));
    const [sent, recv] = await Promise.all([
      query({ FromAddress: address }, cur.from),
      query({ ToAddress: address }, cur.to),
    ]);

    // Merge, dedupe by digest, newest first, and take one page.
    const byDigest = new Map();
    for (const t of [...(sent?.data || []), ...(recv?.data || [])]) if (t?.digest && !byDigest.has(t.digest)) byDigest.set(t.digest, t);
    const merged = [...byDigest.values()].sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0));
    const page = merged.slice(0, PAGE);
    const taken = new Set(page.map(t => t.digest));

    // Advance each stream to the last of its items that made it onto this page.
    const advance = (res, c) => {
      if (c === false || !res) return false;
      const data = res.data || [];
      let last = -1;
      data.forEach((t, i) => { if (taken.has(t.digest)) last = i; });
      if (last === data.length - 1) return res.hasNextPage ? (res.nextCursor || data[last].digest) : false;
      return last >= 0 ? data[last].digest : c;
    };
    const next = { from: advance(sent, cur.from), to: advance(recv, cur.to) };

    const items = await Promise.all(page.map(t => summarize(t, address)));
    return { items, next: next.from === false && next.to === false ? null : next };
  }

  async function getTx(hash) {
    hash = String(hash || '').trim();
    if (!DIGEST_RE.test(hash)) throw new NotFound('Not a Sui transaction digest');
    const [tx, latest] = await Promise.all([
      // The node answers "Could not find the referenced transaction", which rpc() doesn't map.
      call('sui_getTransactionBlock', [hash, { ...TX_OPTS, showEvents: true }]).catch(e => {
        if (e instanceof NotFound || /could not find|deserializ/i.test(e.message)) throw new NotFound('Transaction not found');
        throw e;
      }),
      call('sui_getLatestCheckpointSequenceNumber', [], { ttl: 3000 }).catch(() => null),
    ]);
    if (!tx || !tx.digest) throw new NotFound('Transaction not found');

    const sender = tx.transaction?.data?.sender || null;
    const fee = feeMist(tx.effects);
    const cs = changes(tx);

    // SUI movement → inputs/outputs; other coins → token transfers.
    const inputs = [], outputs = [];
    let moved = 0n;
    for (const c of cs.filter(c => isSui(c.coinType))) {
      if (c.raw < 0n) inputs.push({ address: c.owner, name: null, value: sui(-c.raw) });
      else { outputs.push({ address: c.owner, name: null, value: sui(c.raw), note: null }); moved += c.raw; }
    }
    if (sender && !inputs.some(i => i.address === sender)) inputs.unshift({ address: sender, name: null, value: 0 });

    const transfers = [];
    const tokenCs = cs.filter(c => !isSui(c.coinType));
    for (const up of tokenCs.filter(c => c.raw > 0n)) {
      const m = await coinMeta(up.coinType);
      const down = tokenCs.filter(c => c.coinType === up.coinType && c.raw < 0n).sort((a, b) => (a.raw < b.raw ? -1 : 1))[0];
      transfers.push({ from: down?.owner || null, to: up.owner, amount: fromUnits(up.raw, m.decimals), symbol: m.symbol });
    }
    for (const down of tokenCs.filter(c => c.raw < 0n && !tokenCs.some(x => x.coinType === c.coinType && x.raw > 0n))) {
      const m = await coinMeta(down.coinType);
      transfers.push({ from: down.owner, to: null, amount: fromUnits(-down.raw, m.decimals), symbol: m.symbol });
    }

    const g = tx.effects?.gasUsed || {};
    const gd = tx.transaction?.data?.gasData || {};
    const cp = tx.checkpoint != null ? Number(tx.checkpoint) : null;
    const extra = [
      { label: 'Sender', value: sender || '-' },
      { label: 'Kind', value: tx.transaction?.data?.transaction?.kind || '-' },
      { label: 'Gas (computation / storage / rebate)', value: `${sui(g.computationCost)} / ${sui(g.storageCost)} / ${sui(g.storageRebate)} SUI` },
    ];
    if (gd.price) extra.push({ label: 'Gas price', value: `${gd.price} MIST` });
    if (gd.budget) extra.push({ label: 'Gas budget', value: `${sui(gd.budget)} SUI` });
    if (tx.effects?.executedEpoch) extra.push({ label: 'Epoch', value: String(tx.effects.executedEpoch) });
    if (tx.events?.length) extra.push({ label: 'Events', value: String(tx.events.length) });
    if (tx.effects?.status?.error) extra.push({ label: 'Error', value: tx.effects.status.error });
    const calls = (tx.transaction?.data?.transaction?.transactions || []).filter(c => c.MoveCall)
      .map(c => `${shortPkg(c.MoveCall.package)}::${c.MoveCall.module}::${c.MoveCall.function}`);
    if (calls.length) extra.push({ label: 'Move calls', value: [...new Set(calls)].slice(0, 6).join(', ') });

    return {
      hash: tx.digest,
      status: statusOf(tx),
      time: toMs(tx.timestampMs),
      block: cp,
      confirmations: cp != null && latest != null ? Math.max(0, Number(latest) - cp) : null,
      fee: fee == null ? null : sui(fee),
      value: sui(moved),
      method: methodOf(tx),
      inputs, outputs, transfers, extra,
    };
  }

  async function getStats() {
    const [cp, gas] = await Promise.all([
      call('sui_getLatestCheckpointSequenceNumber', [], { ttl: 3000 }),
      call('suix_getReferenceGasPrice', [], { ttl: 60000 }).catch(() => null),
    ]);
    // The checkpoint itself is small and carries epoch + cumulative tx count.
    const ck = cp != null ? await call('sui_getCheckpoint', [String(cp)], { ttl: 3000 }).catch(() => null) : null;
    const extra = [];
    if (gas != null) extra.push({ label: 'Reference gas price', value: `${gas} MIST` });
    if (ck?.epoch != null) extra.push({ label: 'Epoch', value: String(ck.epoch) });
    if (ck?.networkTotalTransactions) extra.push({ label: 'Total transactions', value: Number(ck.networkTotalTransactions).toLocaleString('en-US') });
    return { height: cp != null ? Number(cp) : null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
