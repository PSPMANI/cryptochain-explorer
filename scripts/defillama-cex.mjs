// Import exchange-owned wallets (proof-of-reserves / CEX TVL owners) from DefiLlama's open adapters
// (github.com/DefiLlama/DefiLlama-Adapters, protocols with category "CEX") plus Binance's official
// proof-of-reserves address list. Only `owners` wallets are taken (never token contracts); every address is
// validated against its chain's format. Writes js/data/cex-reserves.js. Run: node scripts/defillama-cex.mjs
import { writeFileSync } from 'node:fs';
import { ENTITIES } from '../js/data/entity-directory.js';
import { EXCHANGES } from '../js/entities.js';

const RAW = 'https://raw.githubusercontent.com/DefiLlama/DefiLlama-Adapters/main/projects/';
const raw = p => fetch(RAW + p).then(r => (r.ok ? r.text() : '')).catch(() => '');
const B58 = '[1-9A-HJ-NP-Za-km-z]';
// target chain id → validator
const VALID = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  bitcoin: /^(bc1[02-9ac-hj-np-z]{11,87}|[13]{1}[1-9A-HJ-NP-Za-km-z]{25,34})$/,
  litecoin: /^(ltc1[02-9ac-hj-np-z]{11,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  dogecoin: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  'bitcoin-cash': /^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$|^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  dash: /^[X7][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  tron: new RegExp(`^T${B58}{33}$`),
  solana: new RegExp(`^${B58}{32,44}$`),
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  ton: /^(EQ|UQ|Ef|Uf|kQ|0Q)[A-Za-z0-9_-]{46}$|^-?\d:[0-9a-fA-F]{64}$/,
  aptos: /^0x[0-9a-fA-F]{1,64}$/,
  sui: /^0x[0-9a-fA-F]{1,64}$/,
  near: /^([a-z0-9_-]+\.)*[a-z0-9_-]+$|^[0-9a-f]{64}$/,
  cosmos: /^cosmos1[02-9ac-hj-np-z]{38,58}$/,
};
// DefiLlama / Binance network names → CryptChain chain ids ('evm' = every EVM network)
const EVM_NAMES = /^(ethereum|eth|erc20|bsc|bep20|polygon|matic|arbitrum|arb|optimism|op|avax|avaxc|avalanche|base|era|zksync|linea|scroll|mantle|blast|celo|xdai|gnosis|fantom|ftm|op_bnb|opbnb|manta|cronos|kava|sonic|bera|berachain|unichain|world|worldchain|ink|mode|lisk|soneium|metis|taiko|hyperliquid|plasma|mtl|zora|polygon_zkevm|klaytn|kaia|core|rsk|flare|immutable|imx|chz|chz2)$/i;
const CHAIN_OF = {
  bitcoin: 'bitcoin', btc: 'bitcoin', litecoin: 'litecoin', ltc: 'litecoin', doge: 'dogecoin', dogecoin: 'dogecoin',
  bitcoin_cash: 'bitcoin-cash', bch: 'bitcoin-cash', dash: 'dash', tron: 'tron', trx: 'tron', solana: 'solana', sol: 'solana',
  ripple: 'xrp', xrp: 'xrp', ton: 'ton', aptos: 'aptos', apt: 'aptos', sui: 'sui', near: 'near', cosmos: 'cosmos', atom: 'cosmos',
};
const chainOf = n => (EVM_NAMES.test(n) ? 'evm' : CHAIN_OF[String(n).toLowerCase()] || null);

const TERM = Object.fromEntries([...ENTITIES.map(([t, n]) => [t.toLowerCase(), n]), ...Object.keys(EXCHANGES).map(n => [n.toLowerCase(), n])]);
const canon = n => {
  const s = n.replace(/\s+(CEX|Exchange|Proof of Reserves|PoR)$/i, '').trim();
  return TERM[s.toLowerCase()] || TERM[s.toLowerCase().replace(/[\s.-]/g, '')] || s;
};

const out = {};       // chainId → Map(address → [address, exchange, label])
const add = (chainId, address, exchange, label) => {
  const a = String(address).trim();
  if (!chainId || !VALID[chainId] || !VALID[chainId].test(a)) return false;
  const key = chainId === 'evm' ? a.toLowerCase() : a;
  (out[chainId] ||= new Map());
  if (!out[chainId].has(key)) out[chainId].set(key, [key, exchange, label]);
  return true;
};
const strings = s => [...s.matchAll(/["'`]([^"'`\s]{20,100})["'`]/g)].map(m => m[1]);

// Bitcoin address book shared by many adapters: `const name = [...]` in index.js and imported files
const bookIndex = await raw('helper/bitcoin-book/index.js');
const book = {};
for (const m of bookIndex.matchAll(/const\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g)) book[m[1]] = strings(m[2]);
for (const m of bookIndex.matchAll(/\[\s*"(\w+)"\s*,\s*"\.\/([\w.-]+)"\s*\]/g)) {
  const f = await raw(`helper/bitcoin-book/${m[2]}`);
  book[m[1]] = strings(f);
}

// Exchange names: DefiLlama protocol names keyed by their adapter folder ("crypto-com" → "Crypto-com" → "Crypto.com")
const protocols = (await fetch('https://api.llama.fi/protocols').then(r => r.json())).filter(p => p.category === 'CEX' && p.module);
const NORM = x => String(x).toLowerCase().replace(/[\s._-]/g, '');
const TERMN = Object.fromEntries(Object.entries(TERM).map(([k, v]) => [NORM(k), v]));
const nameOfKey = {};
for (const p of protocols) nameOfKey[NORM(p.module.split('/')[0])] = p.name;
const exchangeName = key => {
  const n = nameOfKey[NORM(key)] || nameOfKey[NORM(key.replace(/-cex$/, ''))] || key.replace(/-cex$/, '').replace(/(^|-)\w/g, m => m.replace('-', ' ').toUpperCase());
  const c = n.replace(/\s+(CEX|Exchange|Proof of Reserves|PoR)$/i, '').trim();
  return TERMN[NORM(c)] || c;
};

// Parse one exchange's config text: `<chain>: { owners: [...] | bitcoinAddressBook.x | constName }` or `<chain>: "bookName"`
const perExchange = {};
function parseSection(src, exchange, consts = {}) {
  for (const m of src.matchAll(/(\w+)\s*:\s*(?:\{\s*owners\s*:\s*(\[[\s\S]*?\]|bitcoinAddressBook\.(\w+)|(\w+))|["'](\w+)["'])/g)) {
    const chainId = chainOf(m[1]);
    if (!chainId) continue;
    const list = m[5] ? book[m[5]] || [] : m[3] ? book[m[3]] || [] : m[4] ? consts[m[4]] || [] : strings(m[2] || '');
    for (const a of list) if (add(chainId, a, exchange, `${exchange} (reserves wallet)`)) perExchange[exchange] = (perExchange[exchange] || 0) + 1;
  }
}
const constsOf = src => { const c = {}; for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\[([\s\S]*?)\]/g)) c[m[1]] = strings(m[2]); return c; };

// 1) cex/index.js: many exchanges inline, `  'key': { … },` at two-space indentation inside `const configs = {`
const CEXRAW = 'https://raw.githubusercontent.com/DefiLlama/DefiLlama-Adapters/main/cex/';
const idx = await fetch(CEXRAW + 'index.js').then(r => r.text());
const idxConsts = constsOf(idx);
const heads = [...idx.matchAll(/^  ['"]?([\w.-]+)['"]?\s*:\s*\{/gm)];
heads.forEach((h, i) => parseSection(idx.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : idx.length), exchangeName(h[1]), idxConsts));
let files = 1;
// 2) cex/<exchange>.js: one exchange per file
const tree = await fetch('https://api.github.com/repos/DefiLlama/DefiLlama-Adapters/git/trees/main?recursive=1', { headers: { 'User-Agent': 'cryptchain' } }).then(r => r.json());
for (const f of (tree.tree || []).filter(x => /^cex\/[\w.-]+\.js$/.test(x.path) && x.path !== 'cex/index.js')) {
  const src = await fetch(CEXRAW + f.path.slice(4)).then(r => r.text()).catch(() => '');
  if (!src) continue;
  files++;
  parseSection(src, exchangeName(f.path.slice(4, -3)), constsOf(src));
}
// 3) older adapters still under projects/<exchange>/index.js
for (const p of protocols) {
  const src = await raw(p.module);
  if (!src) continue;
  files++;
  parseSection(src, exchangeName(p.module.split('/')[0]), constsOf(src));
}

// Binance's official proof-of-reserves list
try {
  const j = await fetch('https://www.binance.com/bapi/apex/v1/public/apex/market/por/address', { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json());
  for (const r of j.data || []) if (add(chainOf(r.network) || chainOf(r.network.replace(/\d+$/, '')), r.address, 'Binance', 'Binance (proof-of-reserves wallet)')) perExchange.Binance = (perExchange.Binance || 0) + 1;
} catch (e) { console.log('Binance PoR unavailable:', e.message); }

const data = Object.fromEntries(Object.entries(out).map(([c, m]) => [c, [...m.values()]]));
writeFileSync(new URL('../js/data/cex-reserves.js', import.meta.url), `// Exchange-owned (proof-of-reserves) wallets from DefiLlama's open CEX adapters (github.com/DefiLlama/DefiLlama-Adapters)
// and Binance's official proof-of-reserves list, imported ${new Date().toISOString().slice(0, 10)} by scripts/defillama-cex.mjs.
// Addresses validated per chain. 'evm' entries apply on every EVM network. { chainId: [[address, exchange, label]] }
export const CEX_RESERVES = ${JSON.stringify(data)};
`);
console.log(`read ${files} adapters · ${Object.values(data).reduce((s, l) => s + l.length, 0)} wallets`);
console.log('per chain:', Object.entries(data).map(([c, l]) => `${c} ${l.length}`).join(' · '));
console.log('per exchange:', Object.entries(perExchange).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k} ${v}`).join(' · '));
