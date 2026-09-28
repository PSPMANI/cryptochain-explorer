
import { ENTITIES } from './data/entity-directory.js';
import { peekLive } from './labels-live.js';
import { legacyToCash } from './cashaddr.js';

export const CATEGORY_LABEL = {
  exchange: 'Exchange', bridge: 'Bridge', dex: 'DEX', token: 'Token', burn: 'Burn address',
  staking: 'Staking', person: 'Public figure', exploit: 'Exploiter', fund: 'Market maker / fund', custodian: 'Custodian',
  issuer: 'Stablecoin issuer', other: 'Labeled',
};

const EXCHANGES = {
  WazirX: { country: 'IN', site: 'wazirx.com', note: 'Hacked July 2024 (~$230M); exploiter wallets are flagged separately' },
  CoinDCX: { country: 'IN', site: 'coindcx.com' },
  CoinSwitch: { country: 'IN', site: 'coinswitch.co', aka: ['CoinSwitch Kuber'] },
  ZebPay: { country: 'IN', site: 'zebpay.com' },
  Mudrex: { country: 'IN', site: 'mudrex.com' },
  Giottus: { country: 'IN', site: 'giottus.com' },
  Bitbns: { country: 'IN', site: 'bitbns.com' },
  Unocoin: { country: 'IN', site: 'unocoin.com' },
  BuyUcoin: { country: 'IN', site: 'buyucoin.com' },
  Pi42: { country: 'IN', site: 'pi42.com' },
  'Delta Exchange': { country: 'IN', site: 'delta.exchange' },
  Koinbazar: { country: 'IN', site: 'koinbazar.com' },
  Flitpay: { country: 'IN', site: 'flitpay.com' },
  Colodax: { country: 'IN', site: 'colodax.com' },
  Vauld: { country: 'IN', site: 'vauld.com', note: 'India-focused lender/exchange; Singapore-registered, halted withdrawals in 2022' },
};
export const INDIAN_EXCHANGES = Object.keys(EXCHANGES).filter(k => EXCHANGES[k].country === 'IN');

const GLOBAL_LOCATION = { GateHub: 'GLOBAL' };
const ENTITY_CATEGORY = {};
for (const [, name, category, country] of ENTITIES) { GLOBAL_LOCATION[name] ??= country; ENTITY_CATEGORY[name] ??= category; }
for (const n of Object.keys(EXCHANGES)) ENTITY_CATEGORY[n] = 'exchange';
export const DIRECTORY = [
  ...Object.entries(EXCHANGES).map(([name, x]) => ({ name, category: 'exchange', country: x.country, site: x.site, note: x.note })),
  ...[...new Map(ENTITIES.map(([, name, category, country]) => [name, { name, category, country }])).values()],
];
export const countryOf = name => (name && ((EXCHANGES[name] && EXCHANGES[name].country) || GLOBAL_LOCATION[name])) || null;

export const COUNTRY = {
  IN: { name: 'India', lat: 21, lon: 78 }, GB: { name: 'United Kingdom', lat: 54, lon: -2 }, US: { name: 'United States', lat: 39, lon: -98 }, LU: { name: 'Luxembourg', lat: 49.6, lon: 6.1 },
  NL: { name: 'Netherlands', lat: 52.1, lon: 5.3 }, KR: { name: 'South Korea', lat: 36.5, lon: 127.9 }, SG: { name: 'Singapore', lat: 1.35, lon: 103.8 },
  AE: { name: 'United Arab Emirates', lat: 24, lon: 54 }, JP: { name: 'Japan', lat: 36, lon: 138 }, MX: { name: 'Mexico', lat: 23, lon: -102 },
  BR: { name: 'Brazil', lat: -10, lon: -55 }, TR: { name: 'Türkiye', lat: 39, lon: 35 }, ID: { name: 'Indonesia', lat: -2, lon: 118 },
  AT: { name: 'Austria', lat: 47.5, lon: 14.5 }, CH: { name: 'Switzerland', lat: 46.8, lon: 8.2 }, TW: { name: 'Taiwan', lat: 23.7, lon: 121 },
  TH: { name: 'Thailand', lat: 15, lon: 101 }, AU: { name: 'Australia', lat: -25, lon: 134 }, BH: { name: 'Bahrain', lat: 26, lon: 50.5 },
  GLOBAL: { name: 'Global / offshore', lat: null, lon: null },
};
export const flag = cc => !cc ? '' : cc === 'GLOBAL' ? '🌐' : String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
const placeOf = cc => (cc && COUNTRY[cc] ? `${flag(cc)} ${COUNTRY[cc].name}` : '');

const E = (name, category, label = name) => ({ name, category, label });
const EVM = {
  '0x0000000000000000000000000000000000000000': E('Null address', 'burn'),
  '0x000000000000000000000000000000000000dead': E('Dead address', 'burn'),
  '0x00000000219ab540356cbb839cbe05303d7705fa': E('Beacon Deposit Contract', 'staking'),
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': E('WETH', 'token', 'Wrapped Ether (WETH)'),
  '0xdac17f958d2ee523a2206206994597c13d831ec7': E('Tether', 'token', 'Tether USD (USDT)'),
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': E('Circle', 'token', 'USD Coin (USDC)'),
  '0x28c6c06298d514db089934071355e5743bf21d60': E('Binance', 'exchange', 'Binance 14 (hot wallet)'),
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': E('Binance', 'exchange', 'Binance 15'),
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': E('Binance', 'exchange', 'Binance 16'),
  '0xf977814e90da44bfa03b6295a0616a897441acec': E('Binance', 'exchange', 'Binance 8'),
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': E('Coinbase', 'exchange', 'Coinbase 1'),
  '0x503828976d22510aad0201ac7ec88293211d23da': E('Coinbase', 'exchange', 'Coinbase 2'),
  '0xd8da6bf26964af9d7eed9e03e53415d37aa96045': E('vitalik.eth', 'person', 'Vitalik Buterin'),
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': E('Uniswap', 'dex', 'Uniswap Universal Router'),
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': E('Uniswap', 'dex', 'Uniswap V2 Router'),
  '0xe592427a0aece92de3edee1f18e0157c05861564': E('Uniswap', 'dex', 'Uniswap V3 Router'),
  '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f': E('Arbitrum Bridge', 'bridge', 'Arbitrum One: Delayed Inbox'),
  '0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef': E('Arbitrum Bridge', 'bridge', 'Arbitrum: L1 Gateway Router'),
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': E('Optimism Bridge', 'bridge', 'OP Mainnet: L1 Standard Bridge'),
  '0xbeb5fc579115071764c7423a4f12edde41f106ed': E('Optimism Bridge', 'bridge', 'OP Mainnet: Optimism Portal'),
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35': E('Base Bridge', 'bridge', 'Base: L1 Standard Bridge'),
  '0x49048044d57e1c92a77f79988d21fa8faf74e97e': E('Base Bridge', 'bridge', 'Base: Optimism Portal'),
  '0x32400084c286cf3e17e7b677ea9583e60a000324': E('zkSync Bridge', 'bridge', 'zkSync Era: Diamond Proxy'),
  '0xa0c68c638235ee32657e8f720a23cec1bfc77c77': E('Polygon Bridge', 'bridge', 'Polygon PoS: RootChainManager'),
  '0x3ee18b2214aff97000d974cf647e7c347e8fa585': E('Wormhole', 'bridge', 'Wormhole: Portal Token Bridge'),
  '0x8731d54e9d02c286767d56ac03e8037c07e01e98': E('Stargate', 'bridge', 'Stargate: Router'),
  '0xbd3fa81b58ba92a82136038b25adec7066af3155': E('Circle CCTP', 'bridge', 'Circle CCTP: TokenMessenger'),
  '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d': E('Circle CCTP', 'bridge', 'Circle CCTP V2: TokenMessenger'),
  '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5': E('Across', 'bridge', 'Across: Ethereum SpokePool'),
  '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64': E('Across', 'bridge', 'Across: Base SpokePool'),
  '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a': E('Across', 'bridge', 'Across: Arbitrum SpokePool'),
  '0x6f26bf09b1c792e3228e5467807a900a503c0281': E('Across', 'bridge', 'Across: OP SpokePool'),
  '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096': E('Across', 'bridge', 'Across: Polygon SpokePool'),
  '0x4200000000000000000000000000000000000010': E('OP Stack Bridge', 'bridge', 'L2 Standard Bridge (withdraw to Ethereum)'),
  '0x4200000000000000000000000000000000000016': E('OP Stack Bridge', 'bridge', 'L2→L1 Message Passer (withdraw to Ethereum)'),
  '0x0000000000000000000000000000000000000064': E('Arbitrum Bridge', 'bridge', 'ArbSys (withdraw to Ethereum)'),
};

const OTHER = {
  bitcoin: {
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': E('Satoshi Nakamoto', 'person', 'Genesis block address'),
    'bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt': E('Bitfinex hack', 'other', 'Bitfinex 2016 hack wallet (seized funds)'),
    '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': E('Binance', 'exchange', 'Binance cold wallet'),
  },
  tron: {
    TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: E('Tether', 'token', 'Tether USD (USDT) contract'),
  },
};


const GLOBAL_EXCHANGES = ['Binance', 'Revolut', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitfinex', 'KuCoin', 'Gate', 'HTX', 'Huobi', 'Gemini',
  'Crypto.com', 'Bitstamp', 'Upbit', 'Bithumb', 'MEXC', 'Bitget', 'Robinhood', 'Bitvavo', 'Poloniex', 'HitBTC', 'Deribit', 'WhiteBIT', 'GateHub'];
const NO_NAME_MATCH = new Set(['Rain', 'Copper', 'Circle', 'Tether', 'Paxos', 'Gate', 'Bullish', 'Backpack', 'GSR', 'Anchorage', 'Anchorage Digital', 'Luno', 'MAX', 'Cumberland', 'Galaxy Digital', 'Flow Traders']);
const TERM_TO_NAME = Object.fromEntries(ENTITIES.map(([term, name]) => [term.toLowerCase(), name]));
const ALL_EXCHANGE_NAMES = [...new Set([...GLOBAL_EXCHANGES, ...Object.keys(EXCHANGES), ...Object.values(EXCHANGES).flatMap(e => e.aka || []), ...ENTITIES.flatMap(([term, name]) => [term, name])])]
  .filter(n => !NO_NAME_MATCH.has(n))
  .sort((a, b) => b.length - a.length);
const EXCHANGE_RE = new RegExp(`\\b(${ALL_EXCHANGE_NAMES.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|OKEx)\\b`, 'i');
const EXPLOIT_RE = /exploit|hacker|drainer|phish|heist|stolen/i;
const canonicalExchange = m => {
  const hit = ALL_EXCHANGE_NAMES.find(x => x.toLowerCase() === m.toLowerCase());
  const parent = Object.keys(EXCHANGES).find(k => (EXCHANGES[k].aka || []).some(a => a.toLowerCase() === m.toLowerCase()));
  return parent || TERM_TO_NAME[m.toLowerCase()] || (/^okex$/i.test(m) ? 'OKX' : hit || m);
};
const BRIDGE_RE = /bridge|spoke ?pool|portal|inbox|messenger|gateway router|stargate|wormhole|layerzero|tokenmessenger|cctp|\bhop\b|synapse|celer|debridge|orbiter|relay\.link|relayreceiver|axelar|allbridge|multichain|lifi|li\.fi|socket|bungee|squid|rango|mayan|symbiosis|rhino|owlto|butter|meson/i;
const DEX_RE = /uniswap|sushiswap|pancakeswap|curve|balancer|1inch|0x: exchange|paraswap|cowswap|aerodrome|velodrome|jupiter|raydium|router/i;

export function fromBlockscout(p) {
  if (!p) return null;
  const tags = (p.metadata && p.metadata.tags) || [];
  const generic = tags.filter(t => t.tagType === 'generic').map(t => t.slug);
  const nameTag = tags.find(t => t.tagType === 'name');
  const protocol = tags.find(t => t.tagType === 'protocol');
  const main = tags.map(t => t.meta && t.meta.main_entity).find(Boolean);
  const label = nameTag ? nameTag.name : p.name || null;
  let category = generic.includes('exchange') || generic.includes('cex') ? 'exchange'
    : generic.some(g => /bridge/.test(g)) ? 'bridge'
    : generic.some(g => /dex|amm/.test(g)) ? 'dex' : null;
  const guessed = label ? fromName(label) : null;
  if (guessed && guessed.category === 'exploit') return guessed;
  if (!category && guessed) category = guessed.category;
  if (!category && !label) return null;
  const name = category === 'exchange' && guessed && guessed.category === 'exchange' ? guessed.name
    : main || (protocol && protocol.name) || (guessed && guessed.name) || label;
  return { name, category: category || 'other', label: label || main, country: countryOf(name) };
}

export function fromName(name) {
  if (!name) return null;
  const ex = name.match(EXCHANGE_RE);
  if (ex && EXPLOIT_RE.test(name)) { const n = canonicalExchange(ex[1]); return { name: `${n} exploiter`, category: 'exploit', label: name, country: countryOf(n) }; }
  if (EXPLOIT_RE.test(name)) return { name, category: 'exploit', label: name };
  if (ex) { const n = canonicalExchange(ex[1]); return { name: n, category: ENTITY_CATEGORY[n] || 'exchange', label: name, country: countryOf(n) }; }
  if (BRIDGE_RE.test(name)) return { name, category: 'bridge', label: name };
  if (DEX_RE.test(name)) return { name, category: 'dex', label: name };
  return null;
}

let nonEvmLoading = null;
export function loadLabels() {
  return nonEvmLoading ||= Promise.all([import('./data/global-wallets.js'), import('./data/india-wallets.js'), import('./data/cex-nonevm.js'), import('./data/xrp-names.js'), import('./data/ton-names.js'), import('./data/cex-reserves.js'), import('./data/cex-evm-spellbook.js'), import('./data/extra-labels.js')]).then(async ([{ GLOBAL_WALLETS }, { INDIA_WALLETS }, { CEX_NONEVM }, { XRP_NAMES }, { TON_NAMES }, { CEX_RESERVES }, { CEX_EVM_SPELLBOOK }, { EXTRA_LABELS }]) => {
    for (const [addr, name, category, label] of GLOBAL_WALLETS) {
      const country = countryOf(name);
      if (!EVM[addr]) EVM[addr] = category === 'exploit' ? { name: `${name} exploiter`, category: 'exploit', label, country } : { name, category, label, country };
    }
    for (const [addr, name, category, rawLabel] of INDIA_WALLETS) {
      const label = rawLabel.replace(/^⚠\s*/, '');
      if (!EVM[addr]) EVM[addr] = category === 'exploit' ? { name: `${name} exploiter`, category: 'exploit', label, country: 'IN' } : { name, category, label, country: 'IN' };
    }
    for (const [chainId, rows] of Object.entries(EXTRA_LABELS)) {
      const m = (OTHER[chainId] ||= {});
      for (const [a, name, category, label] of rows) {
        const k = chainId === 'ton' ? tonRaw(a) || a : a;
        if (!m[k]) m[k] = { name, category, label, country: category === 'exchange' ? countryOf(name) : null };
      }
    }
    const extraEx = c => (EXTRA_LABELS[c] || []).filter(r => r[2] === 'exchange').map(([a, n, , l]) => [a, n, l]);
    for (const [a, name, label] of CEX_EVM_SPELLBOOK) if (!EVM[a]) EVM[a] = { name, category: ENTITY_CATEGORY[name] || 'exchange', label, country: countryOf(name) };
    const reserveKey = (chainId, a) => chainId === 'ton' ? tonRaw(a) || a
      : chainId === 'aptos' || chainId === 'sui' ? '0x' + a.slice(2).toLowerCase().padStart(64, '0')
      : chainId === 'bitcoin-cash' ? (/^[qp]/i.test(a) ? `bitcoincash:${a.toLowerCase()}` : a) : a;
    for (const [chainId, rows] of Object.entries(CEX_RESERVES)) {
      const m = chainId === 'evm' ? EVM : (OTHER[chainId] ||= {});
      for (const [a, name, label] of rows) {
        const k = chainId === 'evm' ? a.toLowerCase() : reserveKey(chainId, a);
        if (!m[k]) m[k] = { name, category: ENTITY_CATEGORY[name] || 'exchange', label, country: countryOf(name) };
      }
    }
    const ton = (OTHER.ton ||= {});
    for (const [raw, name, label] of TON_NAMES) if (!ton[raw]) ton[raw] = { name, category: ENTITY_CATEGORY[name] || 'exchange', label, country: countryOf(name) };
    const xrp = (OTHER.xrp ||= {});
    for (const [a, name, category, label] of XRP_NAMES) if (!xrp[a]) xrp[a] = { name, category, label, country: category === 'other' ? null : countryOf(name) };
    for (const [chainId, rows] of Object.entries(CEX_NONEVM)) {
      const m = (OTHER[chainId] ||= {});
      for (const [a, name, label] of rows) if (!m[a]) m[a] = { name, category: ENTITY_CATEGORY[name] || 'exchange', label, country: countryOf(name) };
    }
    const bch = (OTHER['bitcoin-cash'] ||= {});
    const bchRows = [];
    for (const [a, name, label] of CEX_NONEVM.bitcoin || []) {
      if (!/^[13]/.test(a)) continue;
      const cash = await legacyToCash(a);
      if (!cash) continue;
      const e = { name, category: ENTITY_CATEGORY[name] || 'exchange', label: `${label} (same key as its Bitcoin wallet)`, country: countryOf(name) };
      bch[cash] ||= e; bch[cash.replace('bitcoincash:', '')] ||= e; bch[a] ||= e;
      bchRows.push([cash, name, e.label]);
    }
    const reserves = (c, extra = []) => [...extra, ...((CEX_RESERVES[c] || []).map(([a, n, l]) => [reserveKey(c, a), n, l]))];
    return {
      curated: [...INDIA_WALLETS, ...GLOBAL_WALLETS],
      ethereum: [...(CEX_RESERVES.evm || []), ...CEX_EVM_SPELLBOOK],
      dogecoin: reserves('dogecoin'), dash: reserves('dash'), sui: reserves('sui'), cosmos: reserves('cosmos'),
      solana: reserves('solana', CEX_NONEVM.solana), bitcoin: reserves('bitcoin', CEX_NONEVM.bitcoin), litecoin: reserves('litecoin', CEX_NONEVM.litecoin),
      tron: reserves('tron', CEX_NONEVM.tron), aptos: reserves('aptos', [...(CEX_NONEVM.aptos || []), ...extraEx('aptos')]), near: reserves('near', CEX_NONEVM.near),
      'bitcoin-cash': reserves('bitcoin-cash', bchRows),
      xrp: reserves('xrp', [...(CEX_NONEVM.xrp || []), ...XRP_NAMES.filter(r => r[2] === 'exchange').map(([a, n, , l]) => [a, n, l])]),
      ton: reserves('ton', [...TON_NAMES, ...extraEx('ton')]),
    };
  }).catch(() => ({}));
}

function tonRaw(a) {
  if (/^-?\d:[0-9a-f]{64}$/i.test(a)) return a.toLowerCase();
  try {
    const bin = atob(a.replace(/-/g, '+').replace(/_/g, '/'));
    if (bin.length !== 36) return null;
    const wc = (bin.charCodeAt(1) << 24) >> 24;
    let hex = '';
    for (let i = 2; i < 34; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return `${wc}:${hex}`;
  } catch { return null; }
}

const CUSTOM = new Map();
const customKey = (chain, address) => `${chain.family === 'evm' ? 'evm' : chain.id}:${chain.family === 'evm' || /^0x/i.test(address) ? address.toLowerCase() : address}`;
export function setCustomLabels(list) {
  CUSTOM.clear();
  for (const l of list || []) {
    const chain = l.chain_id === 'evm' ? { family: 'evm', id: 'evm' } : { family: 'other', id: l.chain_id };
    CUSTOM.set(customKey(chain, l.address), { name: l.name, category: l.category || 'exchange', label: `${l.name} (your label)`, country: l.country || null, custom: true, id: l.id });
  }
}
export const customLabelOf = (chain, address) => (address ? CUSTOM.get(customKey(chain, address)) || null : null);

export function known(chain, address) {
  if (!address) return null;
  const mine = customLabelOf(chain, address);
  if (mine) return mine;
  const key = chain.id === 'ton' ? tonRaw(address) || address
    : /^0x/i.test(address) && chain.family !== 'evm' ? '0x' + address.slice(2).toLowerCase().padStart(64, '0') : address;
  const e = chain.family === 'evm' ? EVM[address.toLowerCase()] || null : (OTHER[chain.id] && (OTHER[chain.id][key] || OTHER[chain.id][address])) || null;
  if (e && e.category === 'exchange' && !e.country) e.country = countryOf(e.name);
  return e;
}

export function entityOf(chain, address, hint = null, name = null) {
  return known(chain, address) || hint || fromName(name) || (chain && peekLive(chain.id, address)) || null;
}

export function knownLabel(chain, address) {
  const e = known(chain, address);
  return e ? { name: e.label, tags: [CATEGORY_LABEL[e.category], e.country ? placeOf(e.country) : null].filter(Boolean) } : null;
}
