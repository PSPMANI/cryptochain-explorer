// Sign-in with two interchangeable backends:
//   supabase – real accounts (email magic link, Google) when SUPABASE_URL / SUPABASE_ANON_KEY are set
//   demo     – local-only accounts for development; nothing leaves the browser and nothing is verified
// Pages only use this API: auth.user, auth.mode, auth.ready, auth.onChange(), signInEmail(), signInGoogle(), signOut().
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const listeners = new Set();
const DEMO_KEY = 'cc_demo_user';

export const auth = {
  mode: SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'demo',
  user: null,          // { id, email, name, avatar }
  client: null,        // Supabase client (supabase mode only)
  ready: null,
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
};

function setUser(u) {
  auth.user = u;
  listeners.forEach(cb => { try { cb(u); } catch (e) { console.error(e); } });
}

const fromSupabase = u => u && {
  id: u.id,
  email: u.email,
  name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email.split('@')[0],
  avatar: u.user_metadata && u.user_metadata.avatar_url,
};

auth.ready = (async () => {
  if (auth.mode === 'supabase') {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    auth.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
    const { data } = await auth.client.auth.getSession();
    setUser(fromSupabase(data.session && data.session.user));
    auth.client.auth.onAuthStateChange((_e, session) => setUser(fromSupabase(session && session.user)));
  } else {
    try { setUser(JSON.parse(localStorage.getItem(DEMO_KEY) || 'null')); } catch { setUser(null); }
  }
})();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Supabase: sends a magic link (returns { sent: true }). Demo: signs in immediately. */
export async function signInEmail(email, name = '') {
  email = email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
  if (auth.mode === 'supabase') {
    const { error } = await auth.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return { sent: true };
  }
  const user = { id: 'demo-' + (await sha(email)).slice(0, 16), email, name: name.trim() || email.split('@')[0], avatar: null };
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(user)); } catch { /* private mode: session-only */ }
  setUser(user);
  return { sent: false };
}

export async function signInGoogle() {
  if (auth.mode !== 'supabase') throw new Error('Google sign-in needs Supabase configured (see README).');
  const { error } = await auth.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signOut() {
  if (auth.mode === 'supabase') await auth.client.auth.signOut();
  else try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
  setUser(null);
}

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
