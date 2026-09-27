// Background watchlist monitor for signed-in users. Runs across page navigation while the site is open:
// checks each watched wallet for new transactions, inspects them (exchange / bridge / deposit address),
// stores alerts, and notifies via toast + browser notification.
import { auth } from './auth.js';
import { listWatch, pushAlerts } from './store.js';
import { adapter, withTimeout, toast } from './core.js';
import { inspectTx } from './alerts.js';
import { CHAIN } from './chains.js';
import { amount } from './ui.js';
import { LIVE_INTERVAL } from './config.js';

let timer = null, running = false;
const SEEN = 'cc_seen_';

const seenKey = (w) => `${SEEN}${auth.user.id}_${w.chain_id}_${w.address.toLowerCase()}`;
const loadSeen = k => { try { const v = localStorage.getItem(k); return v ? new Set(JSON.parse(v)) : null; } catch { return null; } };
const saveSeen = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set].slice(-300))); } catch { /* ignore */ } };

export function startMonitor() {
  auth.onChange(u => { stop(); if (u) schedule(3000); });
  auth.ready.then(() => { if (auth.user) schedule(3000); });
}
function stop() { clearTimeout(timer); timer = null; }
function schedule(ms) { stop(); timer = setTimeout(tick, ms); }

async function tick() {
  if (!auth.user || running) return schedule(LIVE_INTERVAL.watchlist);
  if (document.hidden) return schedule(5000);
  running = true;
  try {
    const list = (await listWatch()).slice(0, 20);
    for (const w of list) {
      if (!auth.user || !CHAIN[w.chain_id]) break;
      await checkWallet(w).catch(e => console.warn('watch check failed', w.address, e.message));
    }
  } finally {
    running = false;
    schedule(LIVE_INTERVAL.watchlist);
  }
}

/** Check one watched wallet. First run only records a baseline, so old txs never alert. */
export async function checkWallet(w) {
  const a = await adapter(w.chain_id);
  const page = await withTimeout(a.getTxs(w.address), 30000);
  const key = seenKey(w);
  const seen = loadSeen(key);
  const hashes = page.items.map(t => t.hash);
  if (!seen) { saveSeen(key, new Set(hashes)); return []; }
  const fresh = page.items.filter(t => !seen.has(t.hash));
  if (!fresh.length) return [];
  hashes.forEach(h => seen.add(h));
  saveSeen(key, seen);

  // Exchange / bridge findings become individual alerts; plain activity is summarized in one alert per check
  const alerts = [];
  const plain = [];
  for (const t of fresh.slice(0, 10)) {
    const found = await inspectTx(w.chain_id, w.address, t).catch(() => []);
    const important = found.filter(x => x.kind !== 'exchange-internal');
    if (important.length) alerts.push(...important);
    else plain.push(t);
  }
  if (plain.length) {
    const t = plain[0];
    alerts.push({ level: 'info', kind: 'activity', chainId: w.chain_id, hash: t.hash, address: w.address, time: t.time || Date.now(),
      title: plain.length === 1
        ? (t.value ? `${t.direction === 'in' ? 'Received' : t.direction === 'out' ? 'Sent' : 'Moved'} ${amount(t.value)} ${t.symbol}` : `New transaction (${t.method || 'contract call'})`)
        : `${fresh.length > 10 ? `${fresh.length}+` : plain.length} new transactions`,
      detail: plain.length === 1 ? (t.method || '') : 'No exchange or bridge activity among them' });
  }
  const stored = pushAlerts(alerts.map(x => ({ ...x, title: w.label ? `${w.label}: ${x.title}` : x.title })));
  if (stored.length) notify(stored);
  return stored;
}

function notify(alerts) {
  window.dispatchEvent(new Event('alerts-changed'));
  const top = alerts.find(a => a.level === 'high') || alerts.find(a => a.level === 'medium') || alerts[0];
  toast(`${top.title}${alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}`, top.level);
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const a of alerts.filter(x => x.level !== 'info').slice(0, 3)) {
      try {
        const n = new Notification(a.title, { body: a.detail || '', tag: a.kind + a.hash });
        n.onclick = () => { window.focus(); location.hash = `#/${a.chainId}/tx/${a.hash}`; };
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }
}
