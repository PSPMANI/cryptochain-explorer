// Per-user data: watchlist, saved investigations, alert feed.
// Kept in the visitor's browser (localStorage).
// The alert feed is always local: it is derived from public chain data and rebuilt by the monitor.
import { auth } from './auth.js';

const lsKey = name => `cc_${name}_${auth.user ? auth.user.id : 'anon'}`;
const lsGet = name => { try { return JSON.parse(localStorage.getItem(lsKey(name)) || '[]'); } catch { return []; } };
const lsSet = (name, v) => { try { localStorage.setItem(lsKey(name), JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function requireUser() {}

// ---------------------------------------------------------------- watchlist
// item: { id, chain_id, address, label, created_at }
export async function listWatch() {
  if (!auth.user) return [];
  return lsGet('watch');
}
export async function addWatch(chainId, address, label = '') {
  requireUser();
  const existing = (await listWatch()).find(w => w.chain_id === chainId && w.address.toLowerCase() === address.toLowerCase());
  if (existing) return existing;
  const row = { chain_id: chainId, address, label: label.slice(0, 80) };
  const item = { id: uid(), ...row, created_at: new Date().toISOString() };
  lsSet('watch', [item, ...lsGet('watch')]);
  return item;
}
export async function removeWatch(id) {
  requireUser();
  lsSet('watch', lsGet('watch').filter(w => w.id !== id));
}
export async function isWatched(chainId, address) {
  return (await listWatch()).find(w => w.chain_id === chainId && w.address.toLowerCase() === address.toLowerCase()) || null;
}

// ---------------------------------------------------------------- investigations
// item: { id, address, chain_ids[], params, summary, created_at }
export async function listInvestigations() {
  if (!auth.user) return [];
  return lsGet('inv');
}
export async function saveInvestigation({ address, chain_ids, params, summary }) {
  requireUser();
  const row = { address, chain_ids, params, summary };
  const item = { id: uid(), ...row, created_at: new Date().toISOString() };
  lsSet('inv', [item, ...lsGet('inv')].slice(0, 50));
  return item;
}
export async function removeInvestigation(id) {
  requireUser();
  lsSet('inv', lsGet('inv').filter(i => i.id !== id));
}

// ---------------------------------------------------------------- custom labels
// label: { id, chain_id, address, name, category, country, created_at }  (EVM labels use chain_id 'evm': all EVM networks)
export async function listLabels() {
  if (!auth.user) return [];
  return lsGet('labels');
}
export async function saveLabel({ chain_id, address, name, category = 'exchange', country = null }) {
  requireUser();
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('Enter a name for this address.');
  const row = { chain_id, address, name, category, country };
  const existing = (await listLabels()).find(l => l.chain_id === chain_id && l.address.toLowerCase() === address.toLowerCase());
  const item = { id: existing ? existing.id : uid(), ...row, created_at: new Date().toISOString() };
  lsSet('labels', [item, ...lsGet('labels').filter(l => l.id !== item.id)]);
  return item;
}
export async function removeLabel(id) {
  requireUser();
  lsSet('labels', lsGet('labels').filter(l => l.id !== id));
}

// ---------------------------------------------------------------- alert feed (local)
// alert: { id, level, kind, title, detail, chainId, hash, address, time, read }
export function listAlerts() { return auth.user ? lsGet('alerts') : []; }
export function pushAlerts(alerts) {
  if (!auth.user || !alerts.length) return [];
  const cur = lsGet('alerts');
  const keys = new Set(cur.map(a => a.kind + a.hash));
  const fresh = alerts.filter(a => !keys.has(a.kind + a.hash)).map(a => ({ id: uid(), read: false, ...a }));
  lsSet('alerts', [...fresh, ...cur].slice(0, 200));
  return fresh;
}
export function markAlertsRead() { lsSet('alerts', lsGet('alerts').map(a => ({ ...a, read: true }))); }
export const unreadAlerts = () => listAlerts().filter(a => !a.read).length;
