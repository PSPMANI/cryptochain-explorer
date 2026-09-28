import { writeFileSync } from 'node:fs';
import { fromName } from '../js/entities.js';

const list = await fetch('https://api.xrpscan.com/api/v1/names/well-known').then(r => r.json());
const VALID = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const rows = [];
const seen = new Set();
let bad = 0;
for (const x of list) {
  const a = (x.account || '').trim();
  if (!VALID.test(a)) { bad++; continue; }
  if (seen.has(a)) continue;
  seen.add(a);
  const label = [x.name, x.desc].filter(Boolean).join(' ').trim();
  const ex = fromName(x.name) || (x.domain ? fromName(x.domain.replace(/\.[a-z]+$/, '')) : null);
  if (ex && ex.category === 'exchange') rows.push([a, ex.name, 'exchange', label]);
  else if (ex && ['fund', 'custodian', 'issuer', 'exploit'].includes(ex.category)) rows.push([a, ex.name, ex.category, label]);
  else rows.push([a, x.name, 'other', label]);
}
writeFileSync(new URL('../js/data/xrp-names.js', import.meta.url), `export const XRP_NAMES = ${JSON.stringify(rows)};
`);
const ex = rows.filter(r => r[2] === 'exchange');
const names = {};
for (const r of ex) names[r[1]] = (names[r[1]] || 0) + 1;
console.log(`wrote ${rows.length} accounts (${ex.length} exchange wallets, ${Object.keys(names).length} exchanges)${bad ? `, ${bad} invalid skipped` : ''}`);
