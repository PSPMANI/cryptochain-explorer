
const lsKey = name => `cc_${name}_local`;
const lsGet = name => { try { return JSON.parse(localStorage.getItem(lsKey(name)) || '[]'); } catch { return []; } };
const lsSet = (name, v) => { try { localStorage.setItem(lsKey(name), JSON.stringify(v)); } catch { } };
export function clearAll() {
  try { Object.keys(localStorage).filter(k => k.startsWith('cc_') || k === 'recent').forEach(k => localStorage.removeItem(k)); } catch {}
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function listWatch() {
  return lsGet('watch');
}
export async function addWatch(chainId, address, label = '') {
  const existing = (await listWatch()).find(w => w.chain_id === chainId && w.address.toLowerCase() === address.toLowerCase());
  if (existing) return existing;
  const row = { chain_id: chainId, address, label: label.slice(0, 80) };
  const item = { id: uid(), ...row, created_at: new Date().toISOString() };
  lsSet('watch', [item, ...lsGet('watch')]);
  return item;
}
export async function removeWatch(id) {
  lsSet('watch', lsGet('watch').filter(w => w.id !== id));
}
export async function isWatched(chainId, address) {
  return (await listWatch()).find(w => w.chain_id === chainId && w.address.toLowerCase() === address.toLowerCase()) || null;
}

export async function listInvestigations() {
  return lsGet('inv');
}
export async function saveInvestigation({ address, chain_ids, params, summary }) {
  const row = { address, chain_ids, params, summary };
  const item = { id: uid(), ...row, created_at: new Date().toISOString() };
  lsSet('inv', [item, ...lsGet('inv')].slice(0, 50));
  return item;
}
export async function removeInvestigation(id) {
  lsSet('inv', lsGet('inv').filter(i => i.id !== id));
}

export async function listLabels() {
  return lsGet('labels');
}
export async function saveLabel({ chain_id, address, name, category = 'exchange', country = null }) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('Enter a name for this address.');
  const row = { chain_id, address, name, category, country };
  const existing = (await listLabels()).find(l => l.chain_id === chain_id && l.address.toLowerCase() === address.toLowerCase());
  const item = { id: existing ? existing.id : uid(), ...row, created_at: new Date().toISOString() };
  lsSet('labels', [item, ...lsGet('labels').filter(l => l.id !== item.id)]);
  return item;
}
export async function removeLabel(id) {
  lsSet('labels', lsGet('labels').filter(l => l.id !== id));
}

export function listAlerts() { return lsGet('alerts'); }
export function pushAlerts(alerts) {
  if (!alerts.length) return [];
  const cur = lsGet('alerts');
  const keys = new Set(cur.map(a => a.kind + a.hash));
  const fresh = alerts.filter(a => !keys.has(a.kind + a.hash)).map(a => ({ id: uid(), read: false, ...a }));
  lsSet('alerts', [...fresh, ...cur].slice(0, 200));
  return fresh;
}
export function markAlertsRead() { lsSet('alerts', lsGet('alerts').map(a => ({ ...a, read: true }))); }
export const unreadAlerts = () => listAlerts().filter(a => !a.read).length;
