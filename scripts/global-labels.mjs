// Collect publicly labeled wallets of international exchanges, market makers, custodians and issuers
// from Blockscout address metadata (Open Labels Initiative tags), and write js/data/global-wallets.js.
// Run: node scripts/global-labels.mjs        (takes a few minutes; respects Blockscout with limited concurrency)
import { writeFileSync } from 'node:fs';

// [search term, canonical name, category, country]  (country = HQ / main regulator, GLOBAL = offshore / multi-entity)
import { ENTITIES } from '../js/data/entity-directory.js';
export { ENTITIES };

const HOSTS = { ethereum: 'eth.blockscout.com', base: 'base.blockscout.com', arbitrum: 'arbitrum.blockscout.com', polygon: 'polygon.blockscout.com' };
const MAX_PAGES = 12;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_TAG = /\btoken\b|stablecoin|: (usdt|usdc|tusd|eurc|pyusd|bnb|busd)\b|contract|proxy|implementation|vesting|airdrop|nft/i;
const EXPLOIT_TAG = /exploit|hacker|drainer|heist|attacker|stolen/i;

async function search(host, term) {
  const out = [];
  let url = `https://${host}/api/v2/search?q=${encodeURIComponent(term)}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      j = await fetch(url, { signal: AbortSignal.timeout(25000) }).then(r => (r.status === 429 ? null : r.json())).catch(() => null);
      if (!j) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!j) break;
    for (const i of j.items || []) if (i.type === 'metadata_tag') out.push(i);
    url = j.next_page_params ? `https://${host}/api/v2/search?q=${encodeURIComponent(term)}&${new URLSearchParams(j.next_page_params)}` : null;
  }
  return out;
}

const rows = new Map(); // address → { name, category, country, labels:Set }
const tasks = [];
for (const [term, name, category, country] of ENTITIES) for (const host of Object.values(HOSTS)) tasks.push(async () => {
  const nameRe = new RegExp(`(^|[^a-z0-9])${escRe(term)}([^a-z0-9]|$)`, 'i');
  for (const i of await search(host, term)) {
    const a = (i.address_hash || i.address || '').toLowerCase();
    const tag = (i.metadata && i.metadata.name) || i.name || '';
    if (!/^0x[0-9a-f]{40}$/.test(a) || !nameRe.test(tag)) continue;    // tag must really name this entity
    if (TOKEN_TAG.test(tag) && !EXPLOIT_TAG.test(tag)) continue;       // token contracts are not wallets
    const r = rows.get(a) || { name, category, country, labels: new Set() };
    if (EXPLOIT_TAG.test(tag)) { r.category = 'exploit'; }
    r.labels.add(tag);
    rows.set(a, r);
  }
});
let done = 0;
const queue = [...tasks];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) { await queue.shift()(); if (++done % 40 === 0) console.log(`  ${done}/${tasks.length} searches`); }
}));

const best = labels => labels.find(t => /:/.test(t)) || labels.find(t => /\d/.test(t)) || labels[0];
const entries = [...rows.entries()]
  .map(([a, r]) => [a, r.name, r.category, best([...r.labels]), r.country])
  .sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]));

const counts = {};
for (const e of entries) counts[e[1]] = (counts[e[1]] || 0) + 1;
writeFileSync(new URL('../js/data/global-wallets.js', import.meta.url), `// Publicly labeled wallets of international exchanges, market makers, custodians and stablecoin issuers.
// Source: Blockscout address metadata (Open Labels Initiative tags), collected ${new Date().toISOString().slice(0, 10)} by scripts/global-labels.mjs.
// EVM addresses (lowercase) apply on every EVM chain. Token contracts are excluded; hack/exploit wallets are category 'exploit'.
// [address, entity, category, label, country]
export const GLOBAL_WALLETS = [
${entries.map(e => '  ' + JSON.stringify(e) + ',').join('\n')}
];
`);
console.log(`wrote ${entries.length} wallets for ${Object.keys(counts).length} entities`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('exploit:', entries.filter(e => e[2] === 'exploit').map(e => `${e[1]}: ${e[3]}`).join(' | '));
