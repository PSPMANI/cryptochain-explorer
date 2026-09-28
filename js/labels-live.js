import { fetchJSON, sleep } from './utils.js';
import { fromName, countryOf, loadLabels, known } from './entities.js';
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
  'bitcoin-cash': {
    gap: 350,
    prepare: async a => (/^(bitcoincash:)?[qp]/i.test(a) ? cashToLegacy(a) : a),
    url: a => `https://www.walletexplorer.com/api/1/address-lookup?address=${encodeURIComponent(a)}&caller=cryptchain`,
    parse: j => (j && j.found && j.label ? `${j.label} (same key as its Bitcoin wallet)` : null),
  },
  xrp: {
    gap: 350,
    url: a => `https://api.xrpscan.com/api/v1/account/${encodeURIComponent(a)}`,
    parse: j => j && j.advisory && (j.advisory.type || j.advisory.name || j.advisory.description)
      ? { label: `Flagged: ${j.advisory.description || j.advisory.type || j.advisory.name}`, scam: true }
      : j && j.accountName && j.accountName.name ? [j.accountName.name, j.accountName.desc].filter(Boolean).join(' ') : null,
  },
  ton: {
    gap: 1100,
    url: a => `https://tonapi.io/v2/accounts/${encodeURIComponent(a)}`,
    parse: j => j && j.is_scam ? { label: `Flagged as scam${j.name ? `: ${j.name}` : ''}`, scam: true } : (j && j.name) || null,
  },
};
export const hasLiveLabels = chainId => !!SOURCES[chainId];

const queues = {};
function throttled(chainId, fn) {
  const q = (queues[chainId] ||= { last: Promise.resolve() });
  const run = q.last.then(async () => { try { return await fn(); } finally { await sleep(SOURCES[chainId].gap); } });
  q.last = run.catch(() => {});
  return run;
}

function toEntity(chainId, raw) {
  if (!raw) return null;
  const source = { bitcoin: 'WalletExplorer', 'bitcoin-cash': 'WalletExplorer (Bitcoin twin)', tron: 'TronScan', xrp: 'XRPScan', ton: 'TonAPI' }[chainId];
  if (typeof raw === 'object') return raw.scam ? { name: 'Flagged account', category: 'exploit', label: raw.label, country: null, source } : null;
  const clean = raw.replace(/ \(same key as its Bitcoin wallet\)$/, '').replace(/\.(com|net|org|io|co|exchange|de|jp|kr)$/i, '').trim();
  const known = fromName(raw) || fromName(clean);
  if (known) return { ...known, label: `${raw}`, source };
  return { name: clean, category: 'other', label: raw, country: countryOf(clean), source };
}

export function peekLive(chainId, address) {
  if (!SOURCES[chainId] || !address) return undefined;
  const k = `${chainId}:${address}`;
  if (mem.has(k)) return mem.get(k);
  try {
    const v = JSON.parse(localStorage.getItem(LS + k) || 'null');
    if (v && v.exp > Date.now()) { mem.set(k, v.e); return v.e; }
  } catch { }
  return undefined;
}

export async function liveLabel(chainId, address) {
  if (!SOURCES[chainId] || !address) return null;
  await loadLabels();
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
    if (j === undefined) return null;
    const e = toEntity(chainId, s.parse(j));
    mem.set(k, e);
    try { localStorage.setItem(LS + k, JSON.stringify({ e, exp: Date.now() + TTL })); } catch { }
    return e;
  }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

export async function prefetchLabels(chainId, addresses, max = 30) {
  await loadLabels();
  if (!SOURCES[chainId]) return;
  addresses = addresses.filter(a => a && !known(CHAIN[chainId], a));
  const todo = [...new Set(addresses.filter(Boolean))].filter(a => peekLive(chainId, a) === undefined).slice(0, max);
  await Promise.all(todo.map(a => liveLabel(chainId, a).catch(() => null)));
}

