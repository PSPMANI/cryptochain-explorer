// Shared runtime helpers for pages: adapter loading, concurrency, page shell helpers, toasts.
import { CHAIN } from './chains.js';
import { esc } from './ui.js';

export const main = typeof document !== 'undefined' ? document.getElementById('main') : null; // null in Node tests

const adapters = new Map();
const load = (chain, spec) => import(`./adapters/${spec.adapter}.js`).then(m => m.default({ ...chain, ...spec }));

/**
 * Adapter for a chain. When the chain lists `fallback: { adapter, api }`, every call that fails with
 * anything other than NotFound (rate limit, outage, CORS error) is retried on the fallback provider.
 */
export async function adapter(chainId) {
  if (!adapters.has(chainId)) {
    const chain = CHAIN[chainId];
    adapters.set(chainId, (async () => {
      const primary = await load(chain, { adapter: chain.adapter, api: chain.api });
      if (!chain.fallback) return primary;
      let backup = null;
      const wrapped = {};
      for (const [name, fn] of Object.entries(primary)) {
        if (typeof fn !== 'function') continue;
        wrapped[name] = async (...args) => {
          try { return await fn(...args); } catch (e) {
            if (e.name === 'NotFound') throw e;
            backup ||= await load(chain, chain.fallback);
            if (typeof backup[name] !== 'function') throw e;
            return backup[name](...args);
          }
        };
      }
      return wrapped;
    })());
  }
  return adapters.get(chainId);
}

/** Resolve with the promise's value, or reject after `ms`. */
export const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out')), ms))]);

/** Run async tasks with limited concurrency. */
export async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export function showError(msg) {
  main.innerHTML = `<div class="card error"><strong>Something went wrong.</strong><p>${esc(msg)}</p>
    <button class="btn" onclick="location.reload()">Retry</button> <a class="btn ghost" href="#/">Home</a></div>`;
}
export const loading = msg => { main.innerHTML = `<div class="card loading"><div class="spinner"></div>${esc(msg)}</div>`; };

export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
}

export function setQuery(q) {
  document.querySelectorAll('input[name=q]').forEach(i => { if (document.activeElement !== i) i.value = q; });
}

/** Trigger a file download of `text`. */
export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
