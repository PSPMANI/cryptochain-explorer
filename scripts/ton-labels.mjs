// Import TON exchange wallets from TonAPI's curated account names (tonapi.io/v2/accounts/search).
// Only curated names that start with the exchange's name are kept ("OKX 5", "Bybit 1", "Binance Hot Wallet").
// User-registered domains ("coinbase-web.ton", "bingxdeposit.t.me") are rejected: anyone can register them.
// Writes js/data/ton-names.js with raw addresses ("0:<hex>"). Run: node scripts/ton-labels.mjs
import { writeFileSync } from 'node:fs';
import { ENTITIES } from '../js/data/entity-directory.js';
import { EXCHANGES } from '../js/entities.js';

const terms = [...new Map([
  ...ENTITIES.filter(([, , cat]) => cat === 'exchange').map(([term, name]) => [term, name]),
  ...Object.keys(EXCHANGES).map(n => [n, n]),
])];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rows = [];
const seen = new Set();
for (const [term, name] of terms) {
  let j = null;
  for (let attempt = 0; attempt < 3 && !j; attempt++) {
    const r = await fetch(`https://tonapi.io/v2/accounts/search?name=${encodeURIComponent(term)}`).catch(() => null);
    j = r && r.ok ? await r.json() : null;
    await new Promise(z => setTimeout(z, 1300));            // ~1 request / second without a key
  }
  const starts = new RegExp(`^${esc(term)}(?![a-z])`, 'i');
  for (const a of (j && j.addresses) || []) {
    const label = a.name.replace(/\s*·\s*account$/i, '').trim();
    if (!/·\s*account$/i.test(a.name)) continue;             // accounts only (not jettons / NFT collections)
    if (/\.(ton|t\.me)\b/i.test(label)) continue;            // user-registered domains are not exchange labels
    if (!starts.test(label)) continue;
    const raw = a.address.toLowerCase();
    if (!/^-?\d:[0-9a-f]{64}$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    rows.push([raw, name, label]);
  }
}
writeFileSync(new URL('../js/data/ton-names.js', import.meta.url), `// TON exchange wallets from TonAPI's curated account names, imported ${new Date().toISOString().slice(0, 10)} by
// scripts/ton-labels.mjs. Raw addresses ("0:<hex>"); user-registered .ton / .t.me domains are excluded.
// [rawAddress, exchange, label]
export const TON_NAMES = ${JSON.stringify(rows)};
`);
const counts = {};
for (const r of rows) counts[r[1]] = (counts[r[1]] || 0) + 1;
console.log(`wrote ${rows.length} TON exchange wallets:`, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
