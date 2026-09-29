import { onBlock } from './realtime.js';

const pollers = new Set();
const extras = new Set();

export function poll(fn, ms, { chainId = null } = {}) {
  const p = { timer: null, stopped: false, busy: false, lastRun: 0, unsub: null };
  p.tick = async () => {
    if (p.stopped) return;
    clearTimeout(p.timer);
    if (!document.hidden && !p.busy) {
      p.busy = true;
      p.lastRun = Date.now();
      try { await fn(); } catch (e) { console.warn('live update failed:', e.message); }
      p.busy = false;
    }
    if (!p.stopped) p.timer = setTimeout(p.tick, ms);
  };
  if (chainId) {
    p.unsub = onBlock(chainId, () => {
      if (p.stopped || p.busy || document.hidden) return;
      const wait = Math.max(0, 2500 - (Date.now() - p.lastRun));
      clearTimeout(p.timer);
      p.timer = setTimeout(p.tick, wait + 800);
    });
  }
  p.timer = setTimeout(p.tick, ms);
  pollers.add(p);
  p.stop = () => { p.stopped = true; clearTimeout(p.timer); if (p.unsub) p.unsub(); pollers.delete(p); };
  return p.stop;
}

export function track(unsub) {
  if (typeof unsub === 'function') extras.add(unsub);
  return unsub;
}

export function stopAll() {
  for (const p of [...pollers]) p.stop();
  pollers.clear();
  for (const u of extras) { try { u(); } catch {} }
  extras.clear();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const p of pollers) p.tick();
});
