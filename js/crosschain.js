import { CHAINS, CHAIN } from './chains.js';
import { fetchJSON, fromUnits, toMs } from './utils.js';

const ACROSS = 'https://app.across.to/api';
const LZ = 'https://scan.layerzero-api.com/v1';
const WH = 'https://api.wormholescan.io/api/v1';

const byEvmId = Object.fromEntries(CHAINS.filter(c => c.chainId).map(c => [c.chainId, c.id]));
const evmChain = id => byEvmId[Number(id)] || `Chain ${id}`;

const LZ_NAMES = { hyperliquid: 'hyperevm', 'zksync-era': 'zksync', zksync: 'zksync', avax: 'avalanche', bnb: 'bsc', 'sei-evm': 'sei', xdai: 'gnosis' };
const lzChain = n => (n && (CHAIN[n] ? n : LZ_NAMES[n])) || n || 'unknown';

const WH_CHAINS = { 1: 'solana', 2: 'ethereum', 4: 'bsc', 5: 'polygon', 6: 'avalanche', 14: 'celo', 15: 'near', 21: 'sui',
  22: 'aptos', 23: 'arbitrum', 24: 'optimism', 25: 'gnosis', 30: 'base', 34: 'scroll', 35: 'mantle', 36: 'blast', 38: 'linea',
  39: 'berachain', 40: 'sei', 44: 'unichain', 45: 'worldchain', 46: 'ink', 47: 'hyperevm' };
const whChain = id => WH_CHAINS[id] || `Wormhole chain ${id}`;

const tokenLists = new Map();
async function acrossToken(chainId, address) {
  if (!tokenLists.has(chainId)) {
    tokenLists.set(chainId, fetchJSON(`${ACROSS}/swap/tokens?chainId=${chainId}`, { ttl: 3600000 })
      .then(list => Object.fromEntries((Array.isArray(list) ? list : []).map(t => [t.address.toLowerCase(), t])))
      .catch(() => ({})));
  }
  return (await tokenLists.get(chainId))[String(address).toLowerCase()] || null;
}

async function normAcross(d) {
  const tok = await acrossToken(d.originChainId, d.inputToken);
  const amount = tok ? fromUnits(d.inputAmount, tok.decimals) : null;
  return {
    protocol: 'Across', app: 'Across',
    status: d.status === 'filled' ? 'completed' : d.status === 'refunded' ? 'refunded' : d.status === 'expired' ? 'failed' : 'pending',
    time: toMs(d.depositBlockTimestamp || d.quoteTimestamp),
    srcChain: evmChain(d.originChainId), srcTx: d.depositTxnRef || d.depositTxHash,
    dstChain: evmChain(d.destinationChainId), dstTx: d.fillTxnRef || d.fillTx || null,
    sender: d.depositor, recipient: d.recipient,
    amount, symbol: tok ? tok.symbol : 'token',
    usd: tok && tok.priceUsd && amount != null ? amount * Number(tok.priceUsd) : null,
  };
}

function normLz(m) {
  const s = m.status && m.status.name;
  return {
    protocol: 'LayerZero', app: (m.pathway.sender && m.pathway.sender.name) || 'LayerZero app',
    status: s === 'DELIVERED' ? 'completed' : s === 'FAILED' || s === 'BLOCKED' ? 'failed' : 'pending',
    time: toMs(m.source && m.source.tx && m.source.tx.blockTimestamp) || toMs(m.created),
    srcChain: lzChain(m.pathway.sender && m.pathway.sender.chain), srcTx: m.source && m.source.tx && m.source.tx.txHash,
    dstChain: lzChain(m.pathway.receiver && m.pathway.receiver.chain), dstTx: (m.destination && m.destination.tx && m.destination.tx.txHash) || null,
    sender: m.source && m.source.tx && m.source.tx.from, recipient: null,
    amount: null, symbol: null, usd: null,
  };
}

function normWh(o) {
  const p = (o.content && o.content.standarizedProperties) || {};
  const src = o.sourceChain || {}, dst = o.targetChain || {};
  return {
    protocol: 'Wormhole', app: (p.appIds || []).join(', ').replace(/_/g, ' ') || 'Wormhole',
    status: dst.status === 'completed' || (dst.transaction && dst.transaction.txHash) ? 'completed' : dst.status === 'failed' ? 'failed' : 'pending',
    time: toMs(src.timestamp),
    srcChain: whChain(src.chainId || p.fromChain), srcTx: src.transaction && src.transaction.txHash,
    dstChain: whChain(dst.chainId || p.toChain), dstTx: (dst.transaction && dst.transaction.txHash) || null,
    sender: src.from || p.fromAddress || null, recipient: dst.to && dst.to !== dst.from ? p.toAddress || dst.to : p.toAddress || null,
    amount: o.data && o.data.tokenAmount ? Number(o.data.tokenAmount) : null,
    symbol: (o.data && o.data.symbol) || null,
    usd: o.data && o.data.usdAmount ? Number(o.data.usdAmount) : null,
  };
}

const settle = ps => Promise.allSettled(ps).then(rs => rs.flatMap(r => r.status === 'fulfilled' ? r.value : []));

export async function bridgeActivity(address, limit = 25) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
  const list = await settle([
    isEvm ? fetchJSON(`${ACROSS}/deposits?depositor=${address}&limit=${limit}`).then(r => Promise.all((r || []).map(normAcross))) : [],
    isEvm ? fetchJSON(`${ACROSS}/deposits?recipient=${address}&limit=${limit}`).then(r => Promise.all((r || []).map(normAcross))) : [],
    fetchJSON(`${LZ}/messages/wallet/${address}?limit=${limit}`).then(r => (r.data || []).map(normLz)),
    fetchJSON(`${WH}/operations?address=${address}&pageSize=${limit}`).then(r => (r.operations || []).map(normWh)),
  ]);
  const seen = new Set();
  return list
    .filter(b => b.srcTx && !seen.has(b.protocol + b.srcTx) && seen.add(b.protocol + b.srcTx))
    .map(b => ({ ...b, direction: sameAddr(b.sender, address) ? 'out' : sameAddr(b.recipient, address) ? 'in' : 'out' }))
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

export async function resolveBridgeTx(chainId, hash, sender = null) {
  const chain = CHAIN[chainId];
  const acrossFull = async s => {
    const list = sender ? await fetchJSON(`${ACROSS}/deposits?depositor=${sender}&limit=25`).catch(() => []) : [];
    const d = (list || []).find(x => (x.depositTxnRef || x.depositTxHash || '').toLowerCase() === hash.toLowerCase());
    return [await normAcross({ ...s, ...(d || {}) })];
  };
  const hits = await settle([
    chain && chain.chainId
      ? fetchJSON(`${ACROSS}/deposit/status?originChainId=${chain.chainId}&depositTxnRef=${hash}`).then(s => s && s.status ? acrossFull(s) : [])
      : [],
    fetchJSON(`${LZ}/messages/tx/${hash}`).then(r => (r.data || []).slice(0, 1).map(normLz)),
    fetchJSON(`${WH}/operations?txHash=${hash}`).then(r => (r.operations || []).slice(0, 1).map(normWh)),
  ]);
  return hits[0] || null;
}

const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const chainName = id => (CHAIN[id] ? CHAIN[id].name : id);
