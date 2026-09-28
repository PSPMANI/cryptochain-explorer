import { rpc, fromUnits, toMs, NotFound } from '../utils.js';

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const PAGE = 20;

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const PROGRAMS = {
  [SYSTEM]: 'System Program',
  [TOKEN]: 'Token Program',
  [TOKEN22]: 'Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  Vote111111111111111111111111111111111111111: 'Vote Program',
  Stake11111111111111111111111111111111111111: 'Stake Program',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: 'Memo v1',
  BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
  AddressLookupTab1e1111111111111111111111111: 'Address Lookup Table',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter v6',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpool',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Metaplex Token Metadata',
};

const MINTS = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  So11111111111111111111111111111111111111112: 'wSOL',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'mSOL',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JitoSOL',
};

const short = s => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const mintSymbol = m => MINTS[m] || short(m);
const title = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function create(chain) {
  const call = (method, params, opts) => rpc(chain.api, method, params, opts);
  const sol = lamports => fromUnits(lamports, chain.decimals);

  function checkAddr(a) {
    a = String(a || '').trim();
    if (!ADDR_RE.test(a)) throw new NotFound('Not a Solana address');
    return a;
  }

  async function pooledTxs(sigs, limit = 5, budgetMs = 12000) {
    const out = new Array(sigs.length).fill(null);
    const deadline = Date.now() + budgetMs;
    let next = 0;
    const worker = async () => {
      while (next < sigs.length && Date.now() < deadline) {
        const i = next++;
        try { out[i] = await fetchTx(sigs[i], { timeout: Math.max(1000, deadline - Date.now()) }); } catch { out[i] = null; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, sigs.length) }, worker));
    return out;
  }

  const fetchTx = (sig, opts) => call('getTransaction', [sig,
    { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed' }], opts);

  async function getAddress(address) {
    address = checkAddr(address);
    const tokenLists = Promise.all([TOKEN, TOKEN22].map(pid =>
      call('getTokenAccountsByOwner', [address, { programId: pid }, { encoding: 'jsonParsed' }], { timeout: 6000 }).catch(() => null)));
    const [info, sigs] = await Promise.all([
      call('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      call('getSignaturesForAddress', [address, { limit: 1 }]).catch(() => []),
    ]);
    const acct = info && info.value;
    const balance = sol(acct ? acct.lamports : 0);
    const owner = acct && acct.owner;
    const parsed = acct && acct.data && acct.data.parsed;

    let kind = 'Wallet', name = null;
    const stats = [];
    if (acct) {
      if (acct.executable) { kind = 'Program'; name = PROGRAMS[address] || null; }
      else if ((owner === TOKEN || owner === TOKEN22) && parsed) {
        if (parsed.type === 'mint') {
          kind = 'Token';
          name = MINTS[address] || null;
          const p = parsed.info || {};
          if (p.supply != null) stats.push({ label: 'Supply', value: fromUnits(p.supply, p.decimals || 0).toLocaleString('en-US') });
          if (p.decimals != null) stats.push({ label: 'Decimals', value: String(p.decimals) });
          if (p.mintAuthority) stats.push({ label: 'Mint authority', value: p.mintAuthority });
        } else if (parsed.type === 'account') {
          kind = 'Token Account';
          const p = parsed.info || {};
          if (p.owner) stats.push({ label: 'Token owner', value: p.owner });
          if (p.mint) stats.push({ label: 'Mint', value: p.mint });
          if (p.tokenAmount) stats.push({ label: 'Token balance', value: `${p.tokenAmount.uiAmountString ?? p.tokenAmount.uiAmount} ${mintSymbol(p.mint)}` });
        }
      } else if (owner && owner !== SYSTEM) {
        kind = 'Account';
      }
      if (!name && PROGRAMS[address]) name = PROGRAMS[address];
      if (owner) stats.push({ label: 'Owner program', value: PROGRAMS[owner] ? `${PROGRAMS[owner]} (${owner})` : owner });
      if (acct.space != null) stats.push({ label: 'Data size', value: `${acct.space} bytes` });
    }
    if (sigs && sigs[0]) stats.push({ label: 'Last activity', value: new Date(toMs(sigs[0].blockTime) || 0).toISOString() });

    let tokens = [];
    const lists = await Promise.race([tokenLists, new Promise(r => setTimeout(() => r([]), 3000))]);
    if (kind === 'Wallet') {
      for (const l of lists) for (const t of (l && l.value) || []) {
        const p = t.account?.data?.parsed?.info;
        const amt = p?.tokenAmount;
        if (!p || !amt || !Number(amt.amount)) continue;
        tokens.push({ symbol: mintSymbol(p.mint), name: MINTS[p.mint] || null, balance: Number(amt.uiAmountString ?? amt.uiAmount ?? 0), contract: p.mint });
      }
      tokens = tokens.sort((a, b) => b.balance - a.balance).slice(0, 100);
    }

    return {
      address,
      active: !!acct || !!(sigs && sigs.length),
      name,
      labels: [],
      kind,
      balance,
      txCount: null,
      stats,
      tokens,
    };
  }

  const keysOf = tx => (tx?.transaction?.message?.accountKeys || []).map(k => (typeof k === 'string' ? k : k.pubkey));

  function methodOf(tx) {
    const ixs = tx?.transaction?.message?.instructions || [];
    const names = [];
    for (const ix of ixs) {
      const pid = ix.programId;
      if (pid === 'ComputeBudget111111111111111111111111111111') continue;
      let n;
      if (ix.parsed && typeof ix.parsed === 'object' && ix.parsed.type) n = title(ix.parsed.type);
      else if (ix.parsed && typeof ix.parsed === 'string') n = 'Memo';
      else n = PROGRAMS[pid] || (ix.program ? title(ix.program) : short(pid));
      if (n && !names.includes(n)) names.push(n);
    }
    return names.length ? names.slice(0, 2).join(', ') : null;
  }

  function tokenDeltas(meta) {
    const map = new Map();
    const add = (b, sign) => {
      const owner = b.owner || null;
      const key = `${owner}|${b.mint}`;
      const cur = map.get(key) || { owner, mint: b.mint, raw: 0n, decimals: b.uiTokenAmount?.decimals ?? 0 };
      try { cur.raw += sign * BigInt(b.uiTokenAmount?.amount ?? 0); } catch { }
      map.set(key, cur);
    };
    for (const b of meta?.preTokenBalances || []) add(b, -1n);
    for (const b of meta?.postTokenBalances || []) add(b, 1n);
    return [...map.values()].filter(d => d.raw !== 0n).map(d => ({ ...d, delta: fromUnits(d.raw, d.decimals) }));
  }

  const counterpart = (tds, d) => tds
    .filter(x => x.mint === d.mint && x.owner !== d.owner && Math.sign(x.delta) === -Math.sign(d.delta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null;

  function summarize(sigInfo, tx, address) {
    const base = {
      hash: sigInfo.signature,
      time: toMs(sigInfo.blockTime ?? tx?.blockTime),
      status: sigInfo.err ? 'failed' : 'success',
      from: null, fromName: null, to: null, toName: null,
      direction: null, value: 0, symbol: chain.symbol, fee: null, method: null,
    };
    if (!tx || !tx.meta) return base;
    const meta = tx.meta;
    const keys = keysOf(tx);
    const fee = Number(meta.fee || 0);
    base.fee = sol(fee);
    base.method = methodOf(tx);
    base.status = meta.err ? 'failed' : 'success';

    const pre = meta.preBalances || [], post = meta.postBalances || [];
    const deltas = keys.map((k, i) => (post[i] ?? 0) - (pre[i] ?? 0));
    const idx = keys.indexOf(address);
    const net = idx >= 0 ? deltas[idx] + (idx === 0 ? fee : 0) : 0;
    const biggest = sign => {
      let best = -1;
      deltas.forEach((d, i) => { if (i !== idx && d * sign > 0 && (best < 0 || d * sign > deltas[best] * sign)) best = i; });
      return best >= 0 ? keys[best] : null;
    };

    if (net !== 0) {
      base.value = sol(Math.abs(net));
      if (net < 0) { base.direction = 'out'; base.from = address; base.to = biggest(+1); }
      else { base.direction = 'in'; base.to = address; base.from = keys[0] !== address ? keys[0] : biggest(-1); }
      return base;
    }

    const tds = tokenDeltas(meta);
    const mine = tds.filter(d => d.owner === address).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (mine) {
      const other = counterpart(tds, mine);
      base.value = Math.abs(mine.delta);
      base.symbol = mintSymbol(mine.mint);
      if (mine.delta < 0) { base.direction = 'out'; base.from = address; base.to = other?.owner || null; }
      else { base.direction = 'in'; base.to = address; base.from = other?.owner || keys[0] || null; }
      return base;
    }

    base.from = keys[0] || null;
    if (keys[0] === address) base.direction = 'self';
    return base;
  }

  async function getTxs(address, cursor = null) {
    address = checkAddr(address);
    const opts = { limit: PAGE };
    if (cursor) opts.before = cursor;
    const sigs = (await call('getSignaturesForAddress', [address, opts])) || [];
    if (!sigs.length) return { items: [], next: null };

    const txs = await pooledTxs(sigs.map(s => s.signature), 5);

    const items = sigs.map((s, i) => summarize(s, txs[i], address));
    return { items, next: sigs.length >= PAGE ? sigs[sigs.length - 1].signature : null };
  }

  async function getTx(hash) {
    hash = String(hash || '').trim();
    if (!SIG_RE.test(hash)) throw new NotFound('Not a Solana signature');
    const [tx, slot] = await Promise.all([fetchTx(hash), call('getSlot', [{ commitment: 'confirmed' }]).catch(() => null)]);
    if (!tx) throw new NotFound('Transaction not found');
    const meta = tx.meta || {};
    const keys = keysOf(tx);
    const fee = Number(meta.fee || 0);
    const pre = meta.preBalances || [], post = meta.postBalances || [];

    const inputs = [], outputs = [];
    let moved = 0;
    keys.forEach((k, i) => {
      const d = (post[i] ?? 0) - (pre[i] ?? 0) + (i === 0 ? fee : 0);
      if (d < 0) inputs.push({ address: k, name: PROGRAMS[k] || null, value: sol(-d) });
      else if (d > 0) { outputs.push({ address: k, name: PROGRAMS[k] || null, value: sol(d), note: null }); moved += d; }
    });
    if (keys[0] && !inputs.some(x => x.address === keys[0])) inputs.unshift({ address: keys[0], name: null, value: 0 });

    const transfers = [];
    const tds = tokenDeltas(meta);
    for (const up of tds.filter(d => d.delta > 0)) {
      transfers.push({ from: counterpart(tds, up)?.owner || null, to: up.owner, amount: up.delta, symbol: mintSymbol(up.mint) });
    }
    for (const down of tds.filter(d => d.delta < 0 && !counterpart(tds, d))) {
      transfers.push({ from: down.owner, to: null, amount: -down.delta, symbol: mintSymbol(down.mint) });
    }

    const memo = (tx.transaction?.message?.instructions || []).find(ix => ix.program === 'spl-memo' || PROGRAMS[ix.programId]?.startsWith('Memo'));
    const programs = [...new Set((tx.transaction?.message?.instructions || []).map(ix => PROGRAMS[ix.programId] || ix.programId))];
    const extra = [
      { label: 'Slot', value: String(tx.slot) },
      { label: 'Signer', value: keys[0] || '-' },
      { label: 'Version', value: String(tx.version ?? 'legacy') },
      { label: 'Programs', value: programs.join(', ') },
    ];
    if (meta.computeUnitsConsumed != null) extra.push({ label: 'Compute units', value: String(meta.computeUnitsConsumed) });
    if (memo && typeof memo.parsed === 'string') extra.push({ label: 'Memo', value: memo.parsed });
    if (meta.err) extra.push({ label: 'Error', value: JSON.stringify(meta.err) });

    return {
      hash,
      status: meta.err ? 'failed' : 'success',
      time: toMs(tx.blockTime),
      block: tx.slot ?? null,
      confirmations: slot != null && tx.slot != null ? Math.max(0, slot - tx.slot) : null,
      fee: sol(fee),
      value: sol(moved),
      method: methodOf(tx),
      inputs,
      outputs,
      transfers,
      extra,
    };
  }

  async function getStats() {
    const [slot, epoch, perf] = await Promise.all([
      call('getSlot', [], { ttl: 3000 }),
      call('getEpochInfo', [], { ttl: 10000 }).catch(() => null),
      call('getRecentPerformanceSamples', [4], { ttl: 30000 }).catch(() => null),
    ]);
    const extra = [];
    if (epoch) {
      extra.push({ label: 'Epoch', value: String(epoch.epoch) });
      extra.push({ label: 'Epoch progress', value: `${((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(1)}%` });
    }
    if (perf && perf.length) {
      const txs = perf.reduce((s, p) => s + (p.numTransactions || 0), 0);
      const nonVote = perf.reduce((s, p) => s + (p.numNonVoteTransactions || 0), 0);
      const secs = perf.reduce((s, p) => s + (p.samplePeriodSecs || 0), 0) || 1;
      extra.push({ label: 'TPS', value: Math.round(txs / secs).toLocaleString('en-US') });
      if (nonVote) extra.push({ label: 'TPS (non-vote)', value: Math.round(nonVote / secs).toLocaleString('en-US') });
    }
    return { height: slot ?? null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
