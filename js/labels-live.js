// Live identity labels for chains without a bulk label source (all keyless, browser-friendly):
//   bitcoin → WalletExplorer   address-lookup: the named wallet cluster ("Binance.com", "Kraken.com", …)
//   tron    → TronScan         account: addressTag ("Binance-Hot 4", "OKX", …)
// Results are cached in memory and localStorage (7 days), requests are throttled per source, and
// failures return null so the app simply falls back to the deposit-address check.
import { fetchJSON, sleep } from './utils.js';
import { fromName, countryOf, loadNonEvmLabels, known } from './entities.js';
import { CHAIN } from './chains.js';
import { cashToLegacy } from './cashaddr.js';

const TTL = 7 * 86400000;
const mem = new Map();
const inflight = new Map();
const LS = 'cc_ll_';

const SOURCES = {
  bitcoin: {
    gap: 350,
    url: a => `https://www.walletexplorer.com/api/1/address-lookup?address=${encodeURIComponent(a)}&caller=cryptchain`,
    parse: j => (j && j.found && j.label ? j.label : null),
  },
  tron: {
    gap: 300,
    url: a => `https://apilist.tronscanapi.com/api/account?address=${encodeURIComponent(a)}`,
    parse: j => (j && (j.addressTag || '').trim()) || null,
  },
  // Bitcoin Cash: same key as the Bitcoin legacy address → ask WalletExplorer about that Bitcoin twin
  'bitcoin-cash': {
    gap: 350,
    prepare: async a => (/^(bitcoincash:)?[qp]/i.test(a) ? cashToLegacy(a) : a),
    url: a => `https://www.walletexplorer.com/api/1/address-lookup?address=${encodeURIComponent(a)}&caller=cryptchain`,
    parse: j => (j && j.found && j.label ? `${j.label} (same key as its Bitcoin wallet)` : null),
  },
  xrp: {
    gap: 350,
    url: a => `https://api.xrpscan.com/api/v1/account/${encodeURIComponent(a)}`,
    // accountName = XRPScan's name; advisory = scam / phishing warnings
    parse: j => j && j.advisory && (j.advisory.type || j.advisory.name || j.advisory.description)
      ? { label: `Flagged: ${j.advisory.description || j.advisory.type || j.advisory.name}`, scam: true }
      : j && j.accountName && j.accountName.name ? [j.accountName.name, j.accountName.desc].filter(Boolean).join(' ') : null,
  },
  ton: {
    gap: 1100,                                   // TonAPI without a key allows about one request per second
    url: a => `https://tonapi.io/v2/accounts/${encodeURIComponent(a)}`,
    parse: j => j && j.is_scam ? { label: `Flagged as scam${j.name ? `: ${j.name}` : ''}`, scam: true } : (j && j.name) || null,
  },
};
export const hasLiveLabels = chainId => !!SOURCES[chainId];

// One request at a time per source, spaced by `gap` ms
const queues = {};
function throttled(chainId, fn) {
  const q = (queues[chainId] ||= { last: Promise.resolve() });
  const run = q.last.then(async () => { try { return await fn(); } finally { await sleep(SOURCES[chainId].gap); } });
  q.last = run.catch(() => {});
  return run;
}

/** Turn a raw label into an entity: known exchanges/institutions by name, otherwise a generic labeled service. */
function toEntity(chainId, raw) {
  if (!raw) return null;
  const source = { bitcoin: 'WalletExplorer', 'bitcoin-cash': 'WalletExplorer (Bitcoin twin)', tron: 'TronScan', xrp: 'XRPScan', ton: 'TonAPI' }[chainId];
  if (typeof raw === 'object') return raw.scam ? { name: 'Flagged account', category: 'exploit', label: raw.label, country: null, source } : null;
  const clean = raw.replace(/ \(same key as its Bitcoin wallet\)$/, '').replace(/\.(com|net|org|io|co|exchange|de|jp|kr)$/i, '').trim();
  const known = fromName(raw) || fromName(clean);
  if (known) return { ...known, label: `${raw}`, source };
  return { name: clean, category: 'other', label: raw, country: countryOf(clean), source };
}

/** Cached-only lookup (sync): what we already know about this address. */
export function peekLive(chainId, address) {
  if (!SOURCES[chainId] || !address) return undefined;
  const k = `${chainId}:${address}`;
  if (mem.has(k)) return mem.get(k);
  try {
    const v = JSON.parse(localStorage.getItem(LS + k) || 'null');
    if (v && v.exp > Date.now()) { mem.set(k, v.e); return v.e; }
  } catch { /* storage unavailable */ }
  return undefined;
}

/** Look up (and cache) the live label of an address. Resolves to an entity or null. */
export async function liveLabel(chainId, address) {
  if (!SOURCES[chainId] || !address) return null;
  await loadNonEvmLabels();                                     // static Spellbook labels first: no network call needed
  const stat = known(CHAIN[chainId], address);
  if (stat) return stat;
  const cached = peekLive(chainId, address);
  if (cached !== undefined) return cached;
  const k = `${chainId}:${address}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = throttled(chainId, async () => {
    const s = SOURCES[chainId];
    const target = s.prepare ? await s.prepare(address) : address;
    if (!target) return null;
    const j = await fetchJSON(s.url(target), { timeout: 15000 }).catch(() => undefined);
    if (j === undefined) return null;                     // network error: don't cache, try again later
    const e = toEntity(chainId, s.parse(j));
    mem.set(k, e);
    try { localStorage.setItem(LS + k, JSON.stringify({ e, exp: Date.now() + TTL })); } catch { /* ignore */ }
    return e;
  }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Warm the cache for many addresses (most valuable first), limited to `max` lookups. */
export async function prefetchLabels(chainId, addresses, max = 30) {
  await loadNonEvmLabels();
  if (!SOURCES[chainId]) return;
  addresses = addresses.filter(a => a && !known(CHAIN[chainId], a));
  const todo = [...new Set(addresses.filter(Boolean))].filter(a => peekLive(chainId, a) === undefined).slice(0, max);
  await Promise.all(todo.map(a => liveLabel(chainId, a).catch(() => null)));
}

/** Best entity for an address, including a live lookup on Bitcoin / TRON when nothing is known locally. */
export async function resolveEntity(chain, address, hint = null, name = null) {
  const { entityOf } = await import('./entities.js');
  return entityOf(chain, address, hint, name) || (hasLiveLabels(chain.id) ? await liveLabel(chain.id, address) : null);
}
