export class NotFound extends Error {
  constructor(msg = 'Not found') { super(msg); this.name = 'NotFound'; }
}

const cache = new Map();

export async function fetchJSON(url, { method = 'GET', body, headers, timeout = 15000, ttl = 0 } = {}) {
  const key = ttl ? method + url + (body ? JSON.stringify(body) : '') : null;
  if (key) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.val;
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: body ? { 'content-type': 'application/json', ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 404 || res.status === 400 || res.status === 422) throw new NotFound();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`API busy (${res.status}). Try again in a moment.`);
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const text = await res.text();
      let val;
      try { val = JSON.parse(text); } catch { val = text; }
      if (key) cache.set(key, { val, exp: Date.now() + ttl });
      return val;
    } catch (e) {
      if (e instanceof NotFound) throw e;
      lastErr = e.name === 'AbortError' ? new Error('Request timed out') : e;
      if (attempt === 0 && e.name !== 'AbortError') await sleep(500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function rpc(url, method, params = [], opts = {}) {
  const r = await fetchJSON(url, { ...opts, method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params } });
  if (r && r.error) {
    const msg = r.error.message || JSON.stringify(r.error);
    if (/not found|unknown|invalid|does not exist/i.test(msg)) throw new NotFound(msg);
    throw new Error(msg);
  }
  return r.result;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function fromUnits(v, decimals = 18) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && !Number.isInteger(v)) return v / 10 ** decimals;
  let bi;
  try { bi = BigInt(v); } catch { return Number(v) / 10 ** decimals; }
  const neg = bi < 0n; if (neg) bi = -bi;
  const base = 10n ** BigInt(decimals);
  const n = Number(bi / base) + Number(bi % base) / 10 ** decimals;
  return neg ? -n : n;
}

export function toMs(t) {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (/^\d+$/.test(t)) return toMs(Number(t));
  const d = Date.parse(t);
  return isNaN(d) ? null : d;
}

export const hexToNum = h => (h === null || h === undefined ? null : Number(BigInt(h)));
