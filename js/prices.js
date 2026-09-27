// USD prices for every chain's native coin.
// Primary: one batched CoinGecko call (cached 60 s). Fallback: Coinbase public exchange rates, matched by
// symbol. Last good prices are remembered (memory + localStorage), so a rate limit never zeroes every value.
import { CHAINS } from './chains.js';
import { fetchJSON } from './utils.js';

const ids = [...new Set(CHAINS.map(c => c.coingeckoId).filter(Boolean))];
const SYMBOL_OF = Object.fromEntries(CHAINS.filter(c => c.coingeckoId).map(c => [c.coingeckoId, c.symbol === 'xDAI' ? 'DAI' : c.symbol]));
const STORE = 'cc_prices';
let last = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();

function remember(p) {
  last = { ...last, ...p };
  try { localStorage.setItem(STORE, JSON.stringify(last)); } catch { /* storage unavailable (e.g. Node tests) */ }
}

async function fromCoinbase() {
  const r = await fetchJSON('https://api.coinbase.com/v2/exchange-rates?currency=USD', { ttl: 60000 });
  const rates = (r && r.data && r.data.rates) || {};
  const out = {};
  for (const [id, sym] of Object.entries(SYMBOL_OF)) {
    const rate = Number(rates[sym]);
    if (rate > 0) out[id] = { usd: 1 / rate, change: null };
  }
  return out;
}

export async function getPrices() {
  try {
    const r = await fetchJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { ttl: 60000 });
    const p = Object.fromEntries(Object.entries(r).map(([id, v]) => [id, { usd: v.usd, change: v.usd_24h_change }]));
    if (Object.keys(p).length) { remember(p); return last; }
  } catch { /* rate-limited or down: fall back below */ }
  try {
    const p = await fromCoinbase();
    // Keep CoinGecko's 24h change where we had one
    for (const [id, v] of Object.entries(p)) if (last[id] && last[id].change != null) v.change = last[id].change;
    if (Object.keys(p).length) remember(p);
  } catch { /* keep last known prices */ }
  return last;
}

export const priceOf = (prices, chain) => (chain.coingeckoId && prices[chain.coingeckoId]) || null;
