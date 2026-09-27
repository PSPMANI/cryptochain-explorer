// No sign-in: every visitor gets every feature. Their watchlist, alerts, labels and saved investigations
// are kept in their own browser under a fixed local profile.
const LOCAL = { id: 'local', name: 'You' };

// Keep data saved under earlier browser profiles (cc_<store>_<profile-id>) by moving it to the local profile once.
try {
  for (const store of ['watch', 'inv', 'labels', 'alerts']) {
    const target = `cc_${store}_local`;
    if (localStorage.getItem(target)) continue;
    const old = Object.keys(localStorage).find(k => k.startsWith(`cc_${store}_`) && k !== target);
    if (old) localStorage.setItem(target, localStorage.getItem(old));
  }
} catch { /* storage unavailable (private mode, Node tests) */ }

export const auth = {
  user: LOCAL,
  ready: Promise.resolve(LOCAL),
  onChange() { return () => {}; },
};
