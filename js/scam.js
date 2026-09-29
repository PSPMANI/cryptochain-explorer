import { CHAIN } from './chains.js';
import { fetchJSON } from './utils.js';

export const OFFICIAL_TOKENS = {
  ethereum: {
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
    '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI', '0x68749665ff8d2d112fa859aa293f07a622782f38': 'XAUT',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
    '0x4c9edd5852cd905f086c759e8383e09bff1e68b3': 'USDE', '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409': 'FDUSD',
    '0x6c3ea9036406852006290770bedfcaba0e23a0e8': 'PYUSD', '0xdc035d45d973e3ec169d2276ddab16f1e407384f': 'USDS',
  },
  arbitrum: {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 'USDC.E',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT0', '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH',
  },
  base: {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDBC',
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI', '0x4200000000000000000000000000000000000006': 'WETH',
  },
  optimism: {
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 'USDT',
    '0x01bff41798a0bcf287b996046ca68b395dbc1071': 'USDT0', '0x4200000000000000000000000000000000000006': 'WETH',
  },
  polygon: {
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC.E',
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT0',
  },
  bsc: {
    '0x55d398326f99059ff775485246999027b3197955': 'USDT', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
    '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409': 'FDUSD', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
  },
  avalanche: {
    '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 'USDT', '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC',
  },
  tron: { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: 'USDT', TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: 'USDC' },
};

const PROTECTED = new Set(['USDT', 'USDC', 'USDT0', 'DAI', 'XAUT', 'WETH', 'WBTC', 'USDE', 'FDUSD', 'PYUSD', 'USDS', 'ETH', 'BTC', 'BNB', 'WBNB', 'TUSD', 'USDBC']);
const FREEZABLE = { USDT: 'Tether', USDT0: 'Tether', XAUT: 'Tether', USDC: 'Circle', 'USDC.E': 'Circle', PYUSD: 'Paxos', FDUSD: 'First Digital' };

const LOOKALIKE_CHARS = {
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'Ү': 'Y',
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y', 'ѕ': 's', 'і': 'i', 'ј': 'j', 'Ѕ': 'S', 'Ԁ': 'D',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  '₮': 'T', 'Ⓤ': 'U', '＄': '$', 'Ꮪ': 'S', 'Ꭰ': 'D', 'Ꮯ': 'C', 'ꓴ': 'U', 'ꓢ': 'S', 'ꓓ': 'D', 'ꓚ': 'C', 'ꓔ': 'T',
};

export function asciiFold(s) {
  return [...String(s || '')].map(c => LOOKALIKE_CHARS[c] || c).join('').normalize('NFKD').replace(/[̀-ͯ​-‏⁠﻿]/g, '');
}

export function tokenVerdict(chainId, symbol, contract) {
  if (!contract) return null;
  const raw = String(symbol || '');
  const folded = asciiFold(raw).toUpperCase().replace(/\s+/g, '');
  const official = OFFICIAL_TOKENS[chainId];
  const key = CHAIN[chainId] && CHAIN[chainId].family === 'evm' ? String(contract).toLowerCase() : contract;
  if (official && official[key]) return { ok: true, official: official[key], freezable: FREEZABLE[official[key]] || null };
  if (/[^\x20-\x7E]/.test(raw) && PROTECTED.has(folded)) return { fake: true, reason: `Lookalike letters imitating ${folded}` };
  if (PROTECTED.has(folded) && official) return { fake: true, reason: `Not the official ${folded} contract on ${CHAIN[chainId] ? CHAIN[chainId].name : chainId}` };
  if (CHAIN[chainId] && folded === String(CHAIN[chainId].symbol).toUpperCase()) return { fake: true, reason: `Token pretending to be native ${folded}` };
  if (/[^\x20-\x7E]/.test(raw)) return { suspicious: true, reason: 'Unusual characters in token name' };
  return null;
}

export function isFakeToken(t) {
  if (!t || !t.token) return false;
  if (t.scam) return true;
  const v = tokenVerdict(t.chainId, t.symbol, t.token);
  return !!(v && (v.fake || v.suspicious));
}

export function freezableIssuer(chainId, symbol, contract) {
  const v = tokenVerdict(chainId, symbol, contract);
  return v && v.ok ? v.freezable : null;
}

export function lookalike(a, b) {
  if (!a || !b || a === b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y || x.length !== y.length) return false;
  const p = x.startsWith('0x') ? 2 : 0;
  return x.slice(p, p + 4) === y.slice(p, p + 4) && x.slice(-4) === y.slice(-4);
}

export function poisoningPairs(addresses) {
  const list = [...new Set(addresses.filter(Boolean))];
  const out = [];
  const bySig = new Map();
  for (const a of list) {
    const x = a.toLowerCase(), p = x.startsWith('0x') ? 2 : 0;
    const sig = x.slice(p, p + 4) + ':' + x.slice(-4) + ':' + x.length;
    (bySig.get(sig) || bySig.set(sig, []).get(sig)).push(a);
  }
  for (const group of bySig.values()) if (group.length > 1) out.push(group);
  return out;
}

export const SERVICE_ADDRESSES = {
  '0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146': { name: 'THORChain', category: 'bridge', label: 'THORChain Router' },
  '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5': { name: 'Across', category: 'bridge', label: 'Across: Ethereum SpokePool' },
  '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a': { name: 'Across', category: 'bridge', label: 'Across: Arbitrum SpokePool' },
  '0xacddac6c77318b615f7f6fb9bb67c6833e9c05f1': { name: 'LayerZero', category: 'bridge', label: 'LayerZero MultiCall' },
  '0xba3cb449bd2b4adddbc894d8697f5170800eadec': { name: 'CoW Swap', category: 'dex', label: 'CoW Swap: ETH Flow' },
  '0x9008d19f58aabd9ed0d60971565aa8510560ab41': { name: 'CoW Swap', category: 'dex', label: 'CoW Protocol: Settlement' },
  '0xf5e10380213880111522dd0efd3dbb45b9f62bcc': { name: 'Chainflip', category: 'bridge', label: 'Chainflip: Ethereum Vault' },
  '0x79001a5e762f3befc8e5871b42f6734e00498920': { name: 'Chainflip', category: 'bridge', label: 'Chainflip: Arbitrum Vault' },
};

const CHANNEL_FACTORIES = {
  '0xf5e10380213880111522dd0efd3dbb45b9f62bcc': { name: 'Chainflip', label: 'Chainflip swap deposit channel' },
  '0x79001a5e762f3befc8e5871b42f6734e00498920': { name: 'Chainflip', label: 'Chainflip swap deposit channel' },
};

const BLOCKSCOUT = { ethereum: 'https://eth.blockscout.com', arbitrum: 'https://arbitrum.blockscout.com', base: 'https://base.blockscout.com', optimism: 'https://explorer.optimism.io' };
const channelCache = new Map();

export async function serviceOf(chainId, address) {
  if (!address) return null;
  const k = address.toLowerCase();
  if (SERVICE_ADDRESSES[k]) return { ...SERVICE_ADDRESSES[k], service: true };
  const host = BLOCKSCOUT[chainId];
  if (!host || !/^0x[0-9a-f]{40}$/i.test(address)) return null;
  const key = chainId + ':' + k;
  if (!channelCache.has(key)) {
    channelCache.set(key, fetchJSON(`${host}/api/v2/addresses/${address}`, { ttl: 3600000 }).then(d => {
      const f = d && d.is_contract && d.creator_address_hash && CHANNEL_FACTORIES[d.creator_address_hash.toLowerCase()];
      return f ? { name: f.name, category: 'bridge', label: f.label, service: true, channel: true } : null;
    }).catch(() => null));
  }
  return channelCache.get(key);
}
