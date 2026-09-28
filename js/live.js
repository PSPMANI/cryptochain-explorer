const pollers = new Set();

export function poll(fn, ms) {
  const p = { timer: null, stopped: false, busy: false };
  p.tick = async () => {
    if (p.stopped) return;
    clearTimeout(p.timer);
    if (!document.hidden && !p.busy) {
      p.busy = true;
      try { await fn(); } catch (e) { console.warn('live update failed:', e.message); }
      p.busy = false;
    }
    if (!p.stopped) p.timer = setTimeout(p.tick, ms);
  };
  p.timer = setTimeout(p.tick, ms);
  pollers.add(p);
  return () => { p.stopped = true; clearTimeout(p.timer); pollers.delete(p); };
}

export function stopAll() {
  for (const p of pollers) { p.stopped = true; clearTimeout(p.timer); }
  pollers.clear();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const p of pollers) p.tick();
});
