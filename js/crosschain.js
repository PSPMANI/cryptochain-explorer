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

const MIDGARDS = [['THORChain', 'https://midgard.ninerealms.com/v2'], ['THORChain', 'https://midgard.thorchain.liquify.com/v2'], ['Maya Protocol', 'https://midgard.mayachain.info/v2']];
const THOR_CHAINS = { ARB: 'arbitrum', DASH: 'dash', ZEC: 'zcash', KUJI: 'kujira', BTC: 'bitcoin', ETH: 'ethereum', BSC: 'bsc', AVAX: 'avalanche', BASE: 'base', LTC: 'litecoin', DOGE: 'dogecoin', BCH: 'bitcoin-cash', XRP: 'xrp', TRON: 'tron', GAIA: 'cosmos' };
const COW_NET = { ethereum: 'mainnet', arbitrum: 'arbitrum_one', base: 'base', gnosis: 'xdai' };
const COW_ETHFLOW = '0xba3cb449bd2b4adddbc894d8697f5170800eadec';
const DECIMALS = { USDC: 6, USDT: 6, 'USDC.E': 6, USDT0: 6, DAI: 18, WETH: 18, WBTC: 8, XAUT: 6 };
const STABLE_SYMS = ['USDC', 'USDT', 'DAI', 'USDT0', 'USDC.E'];

async function thorchain(hash) {
  const id = String(hash).replace(/^0x/i, '').toUpperCase();
  let act = null, proto = 'THORChain';
  let thorAnswered = false;
  for (const [name, base] of MIDGARDS) {
    if (name === 'THORChain' && thorAnswered) continue;
    const r = await fetchJSON(`${base}/actions?txid=${id}`, { ttl: 30000, timeout: 8000 }).catch(() => null);
    if (r && name === 'THORChain') thorAnswered = true;
    if (r && r.actions && r.actions[0]) { act = r.actions[0]; proto = name; break; }
  }
  if (!act) return [];
  const outs = act.out || [];
  const out = outs.find(o => o.address && !/^thor1/.test(o.address)) || outs[0];
  const inCoin = act.in && act.in[0] && act.in[0].coins && act.in[0].coins[0];
  const outCoin = out && out.coins && out.coins[0];
  const prefix = outCoin ? outCoin.asset.split(/[.~-]/)[0] : null;
  const dstChain = prefix ? THOR_CHAINS[prefix] || prefix.toLowerCase() : null;
  const evmDst = dstChain && CHAIN[dstChain] && CHAIN[dstChain].family === 'evm';
  return [{
    protocol: proto, app: `${proto} swap`,
    status: act.status === 'success' ? 'completed' : act.status === 'refund' ? 'refunded' : 'pending',
    time: act.date ? Math.round(Number(act.date) / 1e6) : null,
    srcChain: inCoin ? THOR_CHAINS[inCoin.asset.split('.')[0]] || null : null, srcTx: hash,
    dstChain, dstTx: out && out.txID ? (evmDst ? '0x' + out.txID.toLowerCase() : out.txID.toLowerCase()) : null,
    sender: act.in && act.in[0] ? act.in[0].address : null, recipient: out ? out.address : null,
    amount: outCoin ? Number(outCoin.amount) / 1e8 : null,
    symbol: outCoin ? (outCoin.asset.split(/[.~]/)[1] || '').split('-')[0] : null, usd: null,
  }];
}

async function cowSwap(chainId, sender, hint) {
  const net = COW_NET[chainId];
  if (!net || !sender || hint.value == null) return [];
  const orders = await fetchJSON(`https://api.cow.fi/${net}/api/v1/account/${sender}/orders?limit=100`, { ttl: 60000 });
  const want = Number(hint.value);
  const o = (orders || []).find(x => {
    const dt = hint.time ? Math.abs(Date.parse(x.creationDate) - hint.time) : 0;
    const sell = Number(x.sellAmount || 0) / 1e18;
    return dt < 10 * 60000 && want > 0 && Math.abs(sell - want) / want < 0.01;
  });
  if (!o) return [];
  const official = (await import('./scam.js')).OFFICIAL_TOKENS[chainId] || {};
  const sym = official[o.buyToken.toLowerCase()] || 'token';
  const dec = DECIMALS[sym] ?? 18;
  const amt = Number(o.executedBuyAmount && o.executedBuyAmount !== '0' ? o.executedBuyAmount : o.buyAmount) / 10 ** dec;
  return [{
    protocol: 'CoW Swap', app: `CoW Swap (${CHAIN[chainId] ? CHAIN[chainId].symbol : ''} → ${sym})`,
    status: o.status === 'fulfilled' ? 'completed' : /open|presignature/i.test(o.status) ? 'pending' : 'failed',
    time: Date.parse(o.creationDate), srcChain: chainId, srcTx: hint.hash || null,
    dstChain: chainId, dstTx: null, sender, recipient: o.receiver || sender,
    amount: amt, symbol: sym, usd: STABLE_SYMS.includes(sym) ? amt : null, orderUid: o.uid,
  }];
}

async function lzRecipient(b) {
  const dst = CHAIN[b.dstChain];
  if (!b.dstTx || !dst || dst.adapter !== 'blockscout') return b;
  const tt = await fetchJSON(`${dst.api}/api/v2/transactions/${b.dstTx}/token-transfers`, { ttl: 300000 }).catch(() => null);
  const val = x => Number(x.total.value) / 10 ** Number(x.total.decimals || 0);
  const items = ((tt && tt.items) || []).filter(x => x.to && x.to.hash && !/^0x0{40}$/i.test(x.to.hash) && x.total && x.total.value);
  const best = items.sort((x, y) => val(y) - val(x))[0];
  if (!best) return b;
  const amt = val(best);
  const sym = best.token && best.token.symbol;
  return { ...b, recipient: best.to.hash, amount: amt, symbol: sym, usd: /^(USDC|USDT|USDT0|DAI)/i.test(sym || '') ? amt : b.usd };
}

export async function chainflipChannel(chainId, address) {
  const { serviceOf } = await import('./scam.js');
  const s = await serviceOf(chainId, address);
  return s && s.channel ? s : null;
}

export async function resolveBridgeTx(chainId, hash, sender = null, hint = {}) {
  const chain = CHAIN[chainId];
  const acrossFull = async s => {
    const list = sender ? await fetchJSON(`${ACROSS}/deposits?depositor=${sender}&limit=25`).catch(() => []) : [];
    const d = (list || []).find(x => (x.depositTxnRef || x.depositTxHash || '').toLowerCase() === hash.toLowerCase());
    return [await normAcross({ ...s, ...(d || {}) })];
  };
  const toCow = hint.to && hint.to.toLowerCase() === COW_ETHFLOW;
  if (toCow) {
    const c = await cowSwap(chainId, sender, { ...hint, hash }).catch(() => []);
    if (c[0]) return c[0];
  }
  const hits = await settle([
    chain && chain.chainId
      ? fetchJSON(`${ACROSS}/deposit/status?originChainId=${chain.chainId}&depositTxnRef=${hash}`).then(s => s && s.status ? acrossFull(s) : [])
      : [],
    fetchJSON(`${LZ}/messages/tx/${hash}`).then(r => Promise.all((r.data || []).slice(0, 1).map(normLz).map(b => lzRecipient(b).catch(() => b)))),
    fetchJSON(`${WH}/operations?txHash=${hash}`).then(r => (r.operations || []).slice(0, 1).map(normWh)),
    thorchain(hash).catch(() => []),
  ]);
  if (hits[0]) return hits[0];
  if (hint.to) {
    const ch = await chainflipChannel(chainId, hint.to).catch(() => null);
    if (ch) {
      return {
        protocol: 'Chainflip', app: 'Chainflip swap', status: 'pending', time: hint.time || null, srcChain: chainId, srcTx: hash,
        dstChain: null, dstTx: null, sender, recipient: null, amount: null, symbol: null, usd: null,
        link: 'https://scan.chainflip.io/',
        note: `Chainflip swap channel ${hint.to}. Search this address on scan.chainflip.io to see the payout chain and address.`,
      };
    }
  }
  return null;
}

const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const chainName = id => (CHAIN[id] ? CHAIN[id].name : id);
