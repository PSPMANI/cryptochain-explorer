// Plain EVM JSON-RPC adapter. Balance, contract detection and full tx lookup work on any chain.
// History needs an indexer: an Etherscan-compatible `chain.historyApi`, or an Etherscan V2 key in config.js.
import { rpc, fetchJSON, fromUnits, hexToNum, NotFound } from '../utils.js';
import { ETHERSCAN_API_KEY } from '../config.js';
import { WATCH_TOKENS } from '../data/watch-tokens.js';

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// 4-byte selectors of common methods, so txs read "Swap" instead of "0x3593564c".
const SELECTORS = {
  a9059cbb: 'transfer', '23b872dd': 'transferFrom', '095ea7b3': 'approve', a22cb465: 'setApprovalForAll',
  '42842e0e': 'safeTransferFrom', b88d4fde: 'safeTransferFrom', f242432a: 'safeTransferFrom',
  '3593564c': 'execute (Uniswap)', '24856bc3': 'execute (Uniswap)', '5ae401dc': 'multicall', ac9650d8: 'multicall',
  '7ff36ab5': 'swapExactETHForTokens', '18cbafe5': 'swapExactTokensForETH', '38ed1739': 'swapExactTokensForTokens',
  fb3bdb41: 'swapETHForExactTokens', '414bf389': 'exactInputSingle', c04b8d59: 'exactInput', '12aa3caf': 'swap (1inch)',
  d0e30db0: 'deposit', '2e1a7d4d': 'withdraw', '40c10f19': 'mint', '1249c58b': 'mint', a0712d68: 'mint',
  '42966c68': 'burn', '6a761202': 'execTransaction (Safe)', e9e05c42: 'depositTransaction', b61d27f6: 'execute',
  '1fad948c': 'handleOps (ERC-4337)', '765e827f': 'handleOps (ERC-4337)',
};

export const methodName = input => {
  if (!input || input === '0x') return 'Transfer';
  const sel = input.slice(2, 10).toLowerCase();
  return SELECTORS[sel] || '0x' + sel;
};

// Decode an ABI `string` (or bytes32) return value from eth_call.
function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const h = hex.slice(2);
  try {
    if (h.length === 64) return new TextDecoder().decode(hexBytes(h)).replace(/\0+$/, '') || null; // bytes32
    const len = parseInt(h.slice(64, 128), 16);
    return new TextDecoder().decode(hexBytes(h.slice(128, 128 + len * 2))) || null;
  } catch { return null; }
}
const hexBytes = h => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));

export default function create(chain) {
  const call = (m, p) => rpc(chain.api, m, p);
  const history = chain.historyApi
    || (ETHERSCAN_API_KEY && chain.chainId ? `https://api.etherscan.io/v2/api?chainid=${chain.chainId}&apikey=${ETHERSCAN_API_KEY}` : null);
  const tokenMeta = new Map();

  async function getAddress(addr) {
    if (!EVM_ADDR.test(addr)) throw new NotFound('Invalid EVM address');
    const [bal, nonce, code] = await Promise.all([
      call('eth_getBalance', [addr, 'latest']),
      call('eth_getTransactionCount', [addr, 'latest']),
      call('eth_getCode', [addr, 'latest']),
    ]);
    const balance = fromUnits(bal, chain.decimals);
    const sent = hexToNum(nonce);
    let kind = 'Wallet';
    const stats = [{ label: 'Sent txs (nonce)', value: sent.toLocaleString() }];
    if (code && code.startsWith('0xef0100')) {
      kind = 'Smart wallet (EIP-7702)';
      stats.push({ label: 'Delegates to', value: '0x' + code.slice(8, 48), link: 'address' });
    } else if (code && code !== '0x') {
      kind = 'Contract';
      stats.push({ label: 'Bytecode size', value: `${((code.length - 2) / 2).toLocaleString()} bytes` });
    }
    return {
      address: addr,
      active: balance > 0 || sent > 0 || kind !== 'Wallet',
      name: null, labels: [], kind, balance,
      txCount: null, // RPC only knows how many txs were *sent* (nonce), shown in stats
      stats, tokens: [],
    };
  }

  // ---- Recent token transfers straight from event logs (networks without a free indexer) ----
  // Public nodes only allow log queries for named contracts and recent blocks, so we watch the chain's
  // main stablecoins / wrapped coin (js/data/watch-tokens.js) over the last `logsMaxBack` blocks.
  const watch = WATCH_TOKENS[chain.id] || [];
  const logsCall = (m, p) => rpc(chain.logsRpc || chain.api, m, p);
  const pad = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
  const blockTimes = new Map();
  async function blockTime(n, head) {
    if (!blockTimes.has(n)) blockTimes.set(n, logsCall('eth_getBlockByNumber', ['0x' + n.toString(16), false]).then(b => hexToNum(b.timestamp) * 1000).catch(() => null));
    return blockTimes.get(n);
  }

  async function logsHistory(addr, cursor) {
    const head = hexToNum(await logsCall('eth_blockNumber', []));
    const span = chain.logsSpan || 5000, maxBack = chain.logsMaxBack || 9000;
    const floor = head - maxBack;
    const to = cursor ? cursor.to : head;
    if (to <= floor) return { items: [], next: null };
    const from = Math.max(floor, to - span + 1);
    const range = { address: watch.map(w => w[0]), fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) };
    const [outs, ins] = await Promise.all([
      logsCall('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, pad(addr)] }]),
      logsCall('eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, pad(addr)] }]),
    ]);
    const meta = Object.fromEntries(watch.map(([a, sym, dec]) => [a.toLowerCase(), { sym, dec }]));
    const me = addr.toLowerCase();
    const logs = [...outs, ...ins].filter(l => l.topics.length === 3);
    const seen = new Set();
    const uniq = logs.filter(l => { const k = l.transactionHash + l.logIndex; return !seen.has(k) && seen.add(k); });
    // Timestamps: exact for up to 15 blocks, interpolated from those for the rest
    const blocks = [...new Set(uniq.map(l => hexToNum(l.blockNumber)))].sort((a, b) => b - a);
    const exact = new Map(await Promise.all(blocks.slice(0, 15).map(async b => [b, await blockTime(b)])));
    const ref = [...exact.entries()].filter(([, t]) => t);
    const timeOf = b => exact.get(b) || (ref.length >= 2 ? ref[0][1] - (ref[0][0] - b) * ((ref[0][1] - ref[ref.length - 1][1]) / Math.max(1, ref[0][0] - ref[ref.length - 1][0])) : null);
    const items = uniq.map(l => {
      const m = meta[l.address.toLowerCase()] || { sym: '?', dec: 18 };
      const from = '0x' + l.topics[1].slice(26), toA = '0x' + l.topics[2].slice(26);
      const out = from.toLowerCase() === me, inc = toA.toLowerCase() === me;
      return {
        hash: l.transactionHash, time: timeOf(hexToNum(l.blockNumber)), status: 'success',
        from, fromName: null, to: toA, toName: null,
        direction: out && inc ? 'self' : out ? 'out' : 'in',
        value: fromUnits(l.data === '0x' ? 0 : l.data, m.dec), symbol: m.sym, token: l.address,
        fee: null, method: 'Token transfer',
      };
    }).sort((a, b) => (b.time || 0) - (a.time || 0) || hexToNum(0));
    // Busy wallets: keep a page to the newest 100 transfers; the next page resumes below the oldest block shown
    const blockOf = new Map(uniq.map(l => [l.transactionHash, hexToNum(l.blockNumber)]));
    let page = items, nextTo = from > floor ? from - 1 : null;
    if (items.length > 100) {
      page = items.slice(0, 100);
      nextTo = Math.min(...page.map(t => blockOf.get(t.hash))) - 1;
    }
    return {
      items: page,
      next: nextTo != null && nextTo > floor ? { to: nextTo } : null,
      note: `${chain.name} has no free history indexer, so this shows ${watch.map(w => w[1]).join(', ')} transfers from the last ~${maxBack.toLocaleString()} blocks, read directly from the chain. Native ${chain.symbol} transfers need an Etherscan V2 key (see README).`,
    };
  }

  async function getTxs(addr, cursor = null) {
    if (!history && watch.length) return logsHistory(addr, cursor);
    if (!history) {
      const err = new Error(`Full transaction history for ${chain.name} needs an indexer API key (see README → "Etherscan V2 key"). Balance and transaction lookup by hash still work.`);
      err.code = 'NO_HISTORY';
      throw err;
    }
    const page = cursor || 1;
    const sep = history.includes('?') ? '&' : '?';
    const r = await fetchJSON(`${history}${sep}module=account&action=txlist&address=${addr}&page=${page}&offset=25&sort=desc`);
    if (r.status !== '1' && !/no transactions/i.test(r.message || '')) throw new Error(`History API: ${typeof r.result === 'string' ? r.result : r.message}`);
    const list = Array.isArray(r.result) ? r.result : [];
    const me = addr.toLowerCase();
    return {
      items: list.map(t => {
        const out = t.from.toLowerCase() === me, inc = (t.to || '').toLowerCase() === me;
        return {
          hash: t.hash,
          time: Number(t.timeStamp) * 1000,
          status: t.isError === '1' || t.txreceipt_status === '0' ? 'failed' : 'success',
          from: t.from, fromName: null,
          to: t.to || t.contractAddress || null, toName: t.to ? null : 'Contract creation',
          direction: out && inc ? 'self' : out ? 'out' : inc ? 'in' : null,
          value: fromUnits(t.value, chain.decimals),
          symbol: chain.symbol,
          fee: t.gasUsed && t.gasPrice ? fromUnits(BigInt(t.gasUsed) * BigInt(t.gasPrice), chain.decimals) : null,
          method: t.functionName ? t.functionName.split('(')[0] : methodName(t.input),
        };
      }),
      next: list.length === 25 ? page + 1 : null,
    };
  }

  async function getToken(address) {
    if (!tokenMeta.has(address)) {
      tokenMeta.set(address, Promise.all([
        call('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest']).then(decodeString).catch(() => null), // symbol()
        call('eth_call', [{ to: address, data: '0x313ce567' }, 'latest']).then(hexToNum).catch(() => null),   // decimals()
      ]).then(([symbol, decimals]) => ({ symbol, decimals })));
    }
    return tokenMeta.get(address);
  }

  async function getTx(hash) {
    if (!EVM_HASH.test(hash)) throw new NotFound('Invalid tx hash');
    const t = await call('eth_getTransactionByHash', [hash]);
    if (!t) throw new NotFound();
    // Some public nodes refuse receipts of older txs ("archive" requests); degrade gracefully.
    const [rc, head] = await Promise.all([
      call('eth_getTransactionReceipt', [hash]).catch(() => undefined),
      call('eth_blockNumber', []),
    ]);
    const block = t.blockNumber ? await call('eth_getBlockByNumber', [t.blockNumber, false]) : null;
    const value = fromUnits(t.value, chain.decimals);
    const gasPrice = rc && (rc.effectiveGasPrice || t.gasPrice);
    const fee = rc && gasPrice ? fromUnits(BigInt(rc.gasUsed) * BigInt(gasPrice), chain.decimals) : null;

    // ERC-20 / ERC-721 Transfer events
    const logs = (rc && rc.logs || []).filter(l => l.topics[0] === TRANSFER_TOPIC && l.topics.length >= 3).slice(0, 50);
    const metas = await Promise.all([...new Set(logs.map(l => l.address))].slice(0, 8).map(async a => [a, await getToken(a)]));
    const meta = Object.fromEntries(metas);
    const topicAddr = t => '0x' + t.slice(26);
    const transfers = logs.map(l => {
      const m = meta[l.address] || {};
      const nft = l.topics.length === 4;
      return {
        from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]),
        amount: nft ? 1 : fromUnits(l.data === '0x' ? 0 : l.data, m.decimals ?? 18),
        symbol: (m.symbol || l.address.slice(0, 8) + '…') + (nft ? ` #${hexToNum(l.topics[3])}` : ''),
      };
    });

    const to = t.to || (rc && rc.contractAddress);
    const extra = [
      rc && { label: 'Gas used / limit', value: `${hexToNum(rc.gasUsed).toLocaleString()} / ${hexToNum(t.gas).toLocaleString()}` },
      gasPrice && { label: 'Gas price', value: `${fromUnits(gasPrice, 9).toLocaleString(undefined, { maximumFractionDigits: 4 })} Gwei` },
      { label: 'Nonce', value: String(hexToNum(t.nonce)) },
      t.type && { label: 'Tx type', value: String(hexToNum(t.type)) },
      rc === undefined && t.blockNumber && { label: 'Receipt', value: 'Not available from this public node (status and fee unknown)' },
    ].filter(Boolean);

    return {
      hash: t.hash,
      status: !t.blockNumber ? 'pending' : !rc ? 'unknown' : rc.status === '0x1' ? 'success' : 'failed',
      time: block ? hexToNum(block.timestamp) * 1000 : null,
      block: t.blockNumber ? hexToNum(t.blockNumber) : null,
      confirmations: t.blockNumber ? hexToNum(head) - hexToNum(t.blockNumber) + 1 : 0,
      fee, value,
      method: t.to ? methodName(t.input) : 'Contract creation',
      inputs: [{ address: t.from, name: null, value }],
      outputs: to ? [{ address: to, name: null, value, note: t.to ? null : 'New contract' }] : [],
      transfers,
      extra,
    };
  }

  async function getStats() {
    const [h, gp] = await Promise.all([call('eth_blockNumber', []), call('eth_gasPrice', []).catch(() => null)]);
    return {
      height: hexToNum(h),
      extra: gp ? [{ label: 'Gas', value: `${fromUnits(gp, 9).toLocaleString(undefined, { maximumFractionDigits: 3 })} Gwei` }] : [],
    };
  }

  return { getAddress, getTxs, getTx, getStats };
}
