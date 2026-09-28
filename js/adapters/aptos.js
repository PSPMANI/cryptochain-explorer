import { fetchJSON, fromUnits, NotFound } from '../utils.js';

const ADDR_RE = /^(0x)?[0-9a-fA-F]{1,64}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const PAGE = 20;
const APT_COIN = '0x1::aptos_coin::AptosCoin';
const APT_FA = '0x000000000000000000000000000000000000000000000000000000000000000a';
const ARCHIVE = 'https://archive.mainnet.aptoslabs.com/v1';

const canon = a => '0x' + String(a).replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const lastSeg = t => String(t || '').split('::').pop() || t;
const usToMs = us => (us == null || us === '' || us === '0' ? null : Math.floor(Number(us) / 1000));
const isApt = asset => asset === APT_COIN || asset === APT_FA;
const shortFn = f => (f ? f.split('::').slice(-2).join('::') : null);
const abs = x => (x < 0n ? -x : x);

const KNOWN = {
  '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b': { symbol: 'USDt', name: 'Tether USD', decimals: 6 },
  '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b': { symbol: 'USDC', name: 'USDC', decimals: 6 },
};

export default function create(chain) {
  const api = chain.api.replace(/\/$/, '');
  const graphql = api + '/graphql';
  const apt = v => fromUnits(v, chain.decimals);

  async function get(path, opts = {}) {
    try {
      return await fetchJSON(api + path, opts);
    } catch (e) {
      if (!(e instanceof NotFound) && /410/.test(e.message) && api.includes('mainnet.aptoslabs.com')) return fetchJSON(ARCHIVE + path, opts);
      throw e;
    }
  }

  const view = (fn, typeArgs, args) =>
    fetchJSON(api + '/view', { method: 'POST', body: { function: fn, type_arguments: typeArgs, arguments: args } });

  async function gql(query, variables) {
    const r = await fetchJSON(graphql, { method: 'POST', body: { query, variables }, timeout: 8000 });
    if (!r || r.errors || !r.data) throw new Error(r?.errors?.[0]?.message || 'Indexer error');
    return r.data;
  }

  function checkAddr(a) {
    a = String(a || '').trim();
    if (!ADDR_RE.test(a)) throw new NotFound('Not an Aptos address');
    return canon(a);
  }

  const metaCache = new Map();
  function assetMeta(asset) {
    if (isApt(asset)) return Promise.resolve({ symbol: chain.symbol, name: 'Aptos Coin', decimals: chain.decimals });
    if (KNOWN[asset]) return Promise.resolve(KNOWN[asset]);
    if (!metaCache.has(asset)) {
      const isCoin = asset.includes('::');
      const path = isCoin
        ? `/accounts/${asset.split('::')[0]}/resource/${encodeURIComponent(`0x1::coin::CoinInfo<${asset}>`)}`
        : `/accounts/${asset}/resource/0x1::fungible_asset::Metadata`;
      metaCache.set(asset, get(path, { ttl: 3600e3 })
        .then(r => ({ symbol: r?.data?.symbol || lastSeg(asset), name: r?.data?.name || null, decimals: Number(r?.data?.decimals ?? 8) }))
        .catch(() => {
          metaCache.delete(asset);
          return { symbol: isCoin ? lastSeg(asset) : `${asset.slice(0, 6)}…`, name: null, decimals: 8 };
        }));
    }
    return metaCache.get(asset);
  }

  async function aptBalance(address) {
    try { const [v] = await view('0x1::coin::balance', [APT_COIN], [address]); return BigInt(v); } catch { }
    try { const [v] = await view('0x1::primary_fungible_store::balance', ['0x1::fungible_asset::Metadata'], [address, '0xa']); return BigInt(v); } catch { }
    try {
      const r = await get(`/accounts/${address}/resource/${encodeURIComponent(`0x1::coin::CoinStore<${APT_COIN}>`)}`);
      return BigInt(r?.data?.coin?.value || 0);
    } catch { return 0n; }
  }

  async function getAddress(address) {
    address = checkAddr(address);
    const [acct, bal, resources, modules, idx] = await Promise.all([
      get(`/accounts/${address}`),
      aptBalance(address),
      get(`/accounts/${address}/resources?limit=200`).catch(() => []),
      get(`/accounts/${address}/modules?limit=1`).catch(() => []),
      gql(`query($a:String!){
        current_fungible_asset_balances(where:{owner_address:{_eq:$a},amount:{_gt:"0"}},order_by:{amount:desc},limit:50){ asset_type amount metadata{ symbol name decimals } }
      }`, { a: address }).catch(() => null),
    ]);
    const seq = Number(acct?.sequence_number || 0);
    const types = (Array.isArray(resources) ? resources : []).map(r => r.type || '');

    let kind = 'Wallet';
    if (Array.isArray(modules) && modules.length) kind = 'Contract';
    else if (types.includes('0x1::multisig_account::MultisigAccount')) kind = 'Multisig';
    else if (types.includes('0x1::object::ObjectCore')) kind = types.includes('0x1::fungible_asset::Metadata') ? 'Token' : 'Object';
    let name = null;
    if (/^0x0{63}[134]$/.test(address)) name = { 1: 'Aptos Framework', 3: 'Aptos Token (legacy)', 4: 'Aptos Token Objects' }[address.slice(-1)];

    let tokens = [];
    if (idx?.current_fungible_asset_balances) {
      tokens = idx.current_fungible_asset_balances.filter(b => !isApt(b.asset_type)).map(b => ({
        symbol: b.metadata?.symbol || lastSeg(b.asset_type),
        name: b.metadata?.name || null,
        balance: fromUnits(BigInt(b.amount ?? 0), b.metadata?.decimals ?? 8),
        contract: b.asset_type,
      }));
    } else {
      const stores = (resources || []).filter(r => /^0x1::coin::CoinStore<(.+)>$/.test(r.type || '') && !r.type.includes(APT_COIN));
      tokens = (await Promise.all(stores.slice(0, 30).map(async r => {
        const coin = r.type.match(/^0x1::coin::CoinStore<(.+)>$/)[1];
        const m = await assetMeta(coin);
        return { symbol: m.symbol, name: m.name, balance: fromUnits(r.data?.coin?.value || 0, m.decimals), contract: coin };
      }))).filter(t => t.balance > 0);
    }

    const stats = [{ label: 'Sequence number (txs sent)', value: String(seq) }];
    if (acct?.authentication_key && acct.authentication_key !== address) stats.push({ label: 'Authentication key', value: acct.authentication_key });
    if (types.length) stats.push({ label: 'Resources', value: types.length >= 200 ? '200+' : String(types.length) });

    return {
      address,
      active: seq > 0 || bal > 0n || tokens.length > 0 || types.length > 0,
      name,
      labels: [],
      kind,
      balance: apt(bal),
      txCount: seq,
      stats,
      tokens,
    };
  }

  function flows(tx) {
    const stores = new Map();
    for (const c of tx.changes || []) {
      const t = c.data?.type;
      if (!c.address || !t) continue;
      const s = stores.get(c.address) || {};
      if (t === '0x1::fungible_asset::FungibleStore') s.asset = c.data.data?.metadata?.inner;
      if (t === '0x1::object::ObjectCore') s.owner = c.data.data?.owner;
      stores.set(c.address, s);
    }
    const out = [];
    const push = (owner, asset, amt, sign) => {
      if (!owner || !asset) return;
      let v; try { v = BigInt(amt); } catch { return; }
      if (v) out.push({ owner: canon(owner), asset: asset.includes('::') ? asset : canon(asset), amount: sign * v });
    };
    for (const e of tx.events || []) {
      const t = e.type || '', d = e.data || {};
      if (t === '0x1::fungible_asset::Deposit' || t === '0x1::fungible_asset::Withdraw') {
        const s = stores.get(d.store) || stores.get(canon(d.store || '0')) || {};
        push(s.owner, s.asset, d.amount, t.endsWith('Deposit') ? 1n : -1n);
      } else if (t === '0x1::coin::CoinDeposit' || t === '0x1::coin::CoinWithdraw') {
        push(d.account, d.coin_type, d.amount, t.endsWith('Deposit') ? 1n : -1n);
      } else if (t === '0x1::coin::DepositEvent' || t === '0x1::coin::WithdrawEvent') {
        push(e.guid?.account_address, APT_COIN, d.amount, t.endsWith('DepositEvent') ? 1n : -1n);
      }
    }
    const merged = new Map();
    for (const f of out) {
      const asset = isApt(f.asset) ? APT_COIN : f.asset;
      const k = f.owner + '|' + asset;
      merged.set(k, { owner: f.owner, asset, amount: (merged.get(k)?.amount || 0n) + f.amount });
    }
    let list = [...merged.values()].filter(f => f.amount !== 0n);

    if (!list.length && tx.success !== false) {
      const fn = tx.payload?.function || '';
      const args = tx.payload?.arguments || [];
      if (/^0x0*1::(aptos_account::transfer|aptos_account::transfer_coins|coin::transfer)$/.test(fn) && args.length >= 2) {
        const asset = tx.payload.type_arguments?.[0] || APT_COIN;
        try {
          const v = BigInt(args[1]);
          list = [{ owner: canon(tx.sender), asset, amount: -v }, { owner: canon(args[0]), asset, amount: v }];
        } catch { }
      }
    }
    return list;
  }

  const feeOf = tx => {
    try { return apt(BigInt(tx.gas_used || 0) * BigInt(tx.gas_unit_price || 0)); } catch { return null; }
  };
  const methodOf = tx => (tx.type === 'user_transaction'
    ? shortFn(tx.payload?.function) || tx.payload?.type?.replace(/_payload$/, '') || null
    : tx.type?.replace(/_transaction$/, '') || null);
  const statusOf = tx => (tx.type === 'pending_transaction' ? 'pending' : tx.success === false ? 'failed' : 'success');

  async function summaryFrom(base, fl, address) {
    const sender = base.from;
    const s = { fromName: null, to: null, toName: null, direction: null, value: 0, symbol: chain.symbol, ...base };
    const mine = fl.filter(f => f.owner === address);
    const pick = mine.find(f => isApt(f.asset)) || mine.sort((a, b) => (abs(b.amount) > abs(a.amount) ? 1 : -1))[0];
    if (pick) {
      const m = await assetMeta(pick.asset);
      const out = pick.amount < 0n;
      s.value = fromUnits(abs(pick.amount), m.decimals);
      s.symbol = m.symbol;
      const other = fl.filter(f => f.asset === pick.asset && f.owner !== address && (f.amount < 0n) !== out)
        .sort((a, b) => (abs(b.amount) > abs(a.amount) ? 1 : -1))[0];
      if (out) { s.direction = 'out'; s.from = address; s.to = other?.owner || null; }
      else { s.direction = 'in'; s.to = address; s.from = sender && sender !== address ? sender : other?.owner || null; }
    } else if (sender === address) {
      s.direction = 'self';
    }
    return s;
  }

  const summarize = (tx, address) => summaryFrom({
    hash: tx.hash || String(tx.version),
    time: usToMs(tx.timestamp),
    status: statusOf(tx),
    from: tx.sender ? canon(tx.sender) : null,
    fee: feeOf(tx),
    method: methodOf(tx),
  }, flows(tx), address);

  function summarizeIndexed(row, address) {
    const ut = row.user_transaction;
    const acts = row.fungible_asset_activities || [];
    let fee = null;
    const merged = new Map();
    for (const a of acts) {
      if (a.metadata && !isApt(a.asset_type) && !metaCache.has(a.asset_type)) {
        metaCache.set(a.asset_type, Promise.resolve({ symbol: a.metadata.symbol || lastSeg(a.asset_type), name: a.metadata.name || null, decimals: a.metadata.decimals ?? 8 }));
      }
      let v; try { v = BigInt(a.amount ?? 0); } catch { continue; }
      if (a.is_gas_fee) { fee = (fee ?? 0n) + v; continue; }
      const sign = /Withdraw/.test(a.type || '') ? -1n : /Deposit/.test(a.type || '') ? 1n : 0n;
      if (!sign || !a.owner_address || !a.asset_type) continue;
      const asset = isApt(a.asset_type) || a.asset_type === '0xa' ? APT_COIN : a.asset_type;
      const owner = canon(a.owner_address);
      const k = owner + '|' + asset;
      merged.set(k, { owner, asset, amount: (merged.get(k)?.amount || 0n) + sign * v });
    }
    const failed = acts.some(a => a.is_transaction_success === false);
    return summaryFrom({
      hash: String(row.transaction_version),
      time: ut?.timestamp ? Date.parse(ut.timestamp.endsWith('Z') ? ut.timestamp : ut.timestamp + 'Z') || null : null,
      status: failed ? 'failed' : 'success',
      from: ut?.sender ? canon(ut.sender) : null,
      fee: fee != null ? apt(fee) : null,
      method: shortFn(ut?.entry_function_id_str) || (ut ? null : 'system'),
    }, [...merged.values()].filter(f => f.amount !== 0n), address);
  }

  async function getTxs(address, cursor = null) {
    address = checkAddr(address);
    if (!cursor || cursor.mode === 'gql') {
      const offset = cursor?.offset || 0;
      let rows = null;
      try {
        const d = await gql(`query($a:String!,$o:Int!,$l:Int!){
          account_transactions(where:{account_address:{_eq:$a}},order_by:{transaction_version:desc},offset:$o,limit:$l){
            transaction_version
            user_transaction{ sender entry_function_id_str timestamp }
            fungible_asset_activities{ amount type asset_type owner_address is_gas_fee is_transaction_success metadata{ symbol name decimals } }
          } }`, { a: address, o: offset, l: PAGE });
        rows = d.account_transactions || [];
      } catch { if (cursor) throw new Error('Aptos indexer unavailable, try again shortly'); }
      if (rows) {
        const items = await Promise.all(rows.map(r => summarizeIndexed(r, address)));
        return { items, next: rows.length >= PAGE ? { mode: 'gql', offset: offset + PAGE } : null };
      }
    }

    let end = cursor?.mode === 'rest' ? cursor.start : null;
    if (end == null) end = Number((await get(`/accounts/${address}`))?.sequence_number || 0);
    if (end <= 0) return { items: [], next: null };
    const start = Math.max(0, end - PAGE);
    const txs = await get(`/accounts/${address}/transactions?start=${start}&limit=${end - start}`).catch(e => {
      if (e instanceof NotFound) return [];
      throw e;
    });
    const items = await Promise.all((txs || []).slice().reverse().map(t => summarize(t, address)));
    return { items, next: start > 0 ? { mode: 'rest', start } : null };
  }

  async function getTx(hash) {
    hash = String(hash || '').trim();
    let path;
    if (HASH_RE.test(hash)) path = `/transactions/by_hash/${hash.toLowerCase()}`;
    else if (/^\d+$/.test(hash)) path = `/transactions/by_version/${hash}`;
    else throw new NotFound('Not an Aptos transaction hash');

    let tx;
    try { tx = await get(path); } catch (e) {
      if (!(e instanceof NotFound) || !api.includes('mainnet.aptoslabs.com')) throw e;
      tx = await fetchJSON(ARCHIVE + path);
    }
    if (!tx || !tx.hash) throw new NotFound('Transaction not found');

    const [block, ledger] = await Promise.all([
      tx.version ? get(`/blocks/by_version/${tx.version}`, { ttl: 600e3 }).catch(() => null) : null,
      fetchJSON(api + '/', { ttl: 3000 }).catch(() => null),
    ]);
    const height = block?.block_height != null ? Number(block.block_height) : null;

    const fl = flows(tx);
    const sender = tx.sender ? canon(tx.sender) : null;
    const inputs = [], outputs = [], transfers = [];
    let moved = 0n;
    for (const f of fl.filter(f => isApt(f.asset))) {
      if (f.amount < 0n) inputs.push({ address: f.owner, name: null, value: apt(-f.amount) });
      else { outputs.push({ address: f.owner, name: null, value: apt(f.amount), note: null }); moved += f.amount; }
    }
    if (sender && !inputs.some(i => i.address === sender)) inputs.unshift({ address: sender, name: null, value: 0 });
    const tok = fl.filter(f => !isApt(f.asset));
    for (const f of tok) {
      const m = await assetMeta(f.asset);
      if (f.amount > 0n) {
        const from = tok.filter(x => x.asset === f.asset && x.amount < 0n).sort((a, b) => (a.amount < b.amount ? -1 : 1))[0];
        transfers.push({ from: from?.owner || null, to: f.owner, amount: fromUnits(f.amount, m.decimals), symbol: m.symbol });
      } else if (!tok.some(x => x.asset === f.asset && x.amount > 0n)) {
        transfers.push({ from: f.owner, to: null, amount: fromUnits(-f.amount, m.decimals), symbol: m.symbol });
      }
    }

    const extra = [
      { label: 'Version', value: String(tx.version ?? '-') },
      { label: 'Type', value: tx.type || '-' },
    ];
    if (sender) extra.push({ label: 'Sender', value: sender });
    if (tx.sequence_number != null) extra.push({ label: 'Sequence number', value: String(tx.sequence_number) });
    if (tx.gas_unit_price != null) extra.push({ label: 'Gas used', value: `${tx.gas_used} × ${tx.gas_unit_price} octas` });
    if (tx.max_gas_amount) extra.push({ label: 'Max gas', value: String(tx.max_gas_amount) });
    if (tx.payload?.function) extra.push({ label: 'Function', value: tx.payload.function });
    if (tx.vm_status) extra.push({ label: 'VM status', value: tx.vm_status });
    if (tx.events?.length) extra.push({ label: 'Events', value: String(tx.events.length) });

    return {
      hash: tx.hash,
      status: statusOf(tx),
      time: usToMs(tx.timestamp),
      block: height,
      confirmations: height != null && ledger?.block_height != null ? Math.max(0, Number(ledger.block_height) - height) : null,
      fee: feeOf(tx),
      value: apt(moved),
      method: methodOf(tx),
      inputs, outputs, transfers, extra,
    };
  }

  async function getStats() {
    const [ledger, gas] = await Promise.all([
      fetchJSON(api + '/', { ttl: 3000 }),
      fetchJSON(api + '/estimate_gas_price', { ttl: 30000 }).catch(() => null),
    ]);
    const extra = [];
    if (ledger?.ledger_version) extra.push({ label: 'Ledger version', value: Number(ledger.ledger_version).toLocaleString('en-US') });
    if (ledger?.epoch) extra.push({ label: 'Epoch', value: String(ledger.epoch) });
    if (gas?.gas_estimate != null) extra.push({ label: 'Gas price', value: `${gas.gas_estimate} octas/unit` });
    return { height: ledger?.block_height != null ? Number(ledger.block_height) : null, extra };
  }

  return { getAddress, getTxs, getTx, getStats };
}
