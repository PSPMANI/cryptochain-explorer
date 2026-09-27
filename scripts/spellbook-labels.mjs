// Import exchange (CEX) wallet labels for non-EVM chains from Dune Spellbook, the community-maintained
// label set at github.com/duneanalytics/spellbook (dbt_subprojects/hourly_spellbook/models/_sector/cex/addresses/chains/).
// Writes js/data/cex-nonevm.js. Every address is validated against its chain's format; exchange names are
// mapped to CryptChain's canonical names. Run: node scripts/spellbook-labels.mjs
import { writeFileSync } from 'node:fs';
import { ENTITIES } from '../js/data/entity-directory.js';

const BASE = 'https://raw.githubusercontent.com/duneanalytics/spellbook/main/dbt_subprojects/hourly_spellbook/models/_sector/cex/addresses/chains/';
const B58 = '[1-9A-HJ-NP-Za-km-z]';
// Spellbook chain → [CryptChain chain id, address validator, normalizer]
const CHAINS = {
  solana: ['solana', new RegExp(`^${B58}{32,44}$`), a => a],
  bitcoin: ['bitcoin', /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, a => (/^bc1/i.test(a) ? a.toLowerCase() : a)],
  litecoin: ['litecoin', /^(ltc1[02-9ac-hj-np-z]{11,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/, a => (/^ltc1/i.test(a) ? a.toLowerCase() : a)],
  ripple: ['xrp', /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, a => a],
  tron: ['tron', new RegExp(`^T${B58}{33}$`), a => a],
  aptos: ['aptos', /^0x[0-9a-fA-F]{1,64}$/, a => '0x' + a.slice(2).toLowerCase().padStart(64, '0')],
  sui: ['sui', /^0x[0-9a-fA-F]{1,64}$/, a => '0x' + a.slice(2).toLowerCase().padStart(64, '0')],
  near: ['near', /^([a-z0-9_-]+\.)*[a-z0-9_-]+$|^[0-9a-f]{64}$/, a => a.toLowerCase()],
  cosmos: ['cosmos', /^cosmos1[02-9ac-hj-np-z]{38,58}$/, a => a],
};

// Canonical names: our directory terms first ("Huobi" → "HTX", "Gate.io" → "Gate", "OKEx" → "OKX")
const TERM = Object.fromEntries(ENTITIES.map(([term, name]) => [term.toLowerCase(), name]));
const titled = n => (n === n.toLowerCase() ? n.replace(/(^|\s)\S/g, c => c.toUpperCase()) : n);   // "swissborg" → "Swissborg"
const canon = n => TERM[n.toLowerCase().replace(/_/g, '.')] || TERM[n.toLowerCase()] || TERM[n.toLowerCase().replace(/\.(com|io|net)$/, '')] || titled(n.replace(/_/g, ' '));
const ROW = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/;

const out = {};
const stats = [];
for (const [sb, [chainId, valid, norm]] of Object.entries(CHAINS)) {
  const sql = await fetch(`${BASE}${sb}/cex_${sb}_addresses.sql`).then(r => r.text());
  const seen = new Set();
  let bad = 0;
  out[chainId] = [];
  for (const line of sql.split('\n')) {
    const m = line.match(ROW);
    if (!m || m[1] !== sb) continue;
    const addr = m[2].trim();
    if (!valid.test(addr)) { bad++; continue; }
    const a = norm(addr);
    if (seen.has(a)) continue;
    seen.add(a);
    out[chainId].push([a, canon(m[3].trim()), m[4].trim() || m[3].trim()]);
  }
  stats.push(`${chainId} ${out[chainId].length}${bad ? ` (${bad} invalid skipped)` : ''}`);
}

writeFileSync(new URL('../js/data/cex-nonevm.js', import.meta.url), `// Exchange (CEX) wallets on non-EVM chains, from Dune Spellbook's community-maintained CEX address labels
// (github.com/duneanalytics/spellbook), imported ${new Date().toISOString().slice(0, 10)} by scripts/spellbook-labels.mjs.
// Addresses validated per chain. { chainId: [[address, exchange, label]] }
export const CEX_NONEVM = ${JSON.stringify(out)};
`);
console.log(stats.join(' · '));
const names = {};
for (const rows of Object.values(out)) for (const r of rows) names[r[1]] = (names[r[1]] || 0) + 1;
console.log(Object.keys(names).length, 'exchanges:', Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k} ${v}`).join(' · '));

// EVM exchange wallets (one file for all EVM chains; its rows start with a bare 0x literal)
{
  const sql = await fetch(`${BASE}cex_evms_addresses.sql`).then(r => r.text());
  const rows = [];
  const seenEvm = new Set();
  for (const m of sql.matchAll(/\(\s*(0x[0-9a-fA-F]{40})\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
    const a = m[1].toLowerCase();
    if (seenEvm.has(a)) continue;
    seenEvm.add(a);
    rows.push([a, canon(m[2].trim()), m[3].trim() || m[2].trim()]);
  }
  writeFileSync(new URL('../js/data/cex-evm-spellbook.js', import.meta.url), `// EVM exchange wallets from Dune Spellbook's cex_evms list (github.com/duneanalytics/spellbook), imported
// ${new Date().toISOString().slice(0, 10)} by scripts/spellbook-labels.mjs. Apply on every EVM network. [address, exchange, label]
export const CEX_EVM_SPELLBOOK = ${JSON.stringify(rows)};
`);
  console.log(`EVM: ${rows.length} exchange wallets`);
}
