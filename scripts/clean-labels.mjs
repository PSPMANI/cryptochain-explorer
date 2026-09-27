// Ownership rules for js/data/global-wallets.js (run after global-labels*.mjs):
//   • "<Client>: <Exchange> Deposit …" / "<Exchange> <Client> Deposit …" → the EXCHANGE holds the money
//   • "<Client>: <Custodian> Custody …"                                  → the CUSTODIAN holds it
//   • otherwise the label must START with an entity name ("Kraken 13", "Coinbase: Hot Wallet")
//   • anything else ("Blue Kraken Online: Deployer") is dropped
import { readFileSync, writeFileSync } from 'node:fs';
import { ENTITIES } from '../js/data/entity-directory.js';

const FILE = new URL('../js/data/global-wallets.js', import.meta.url);
const { GLOBAL_WALLETS } = await import(FILE.href + '?t=' + Date.now());
const TERMS = ENTITIES.map(([term, name, category, country]) => ({ term, name, category, country }))
  .filter(t => t.name !== 'Rain')
  .sort((a, b) => b.term.length - a.term.length);            // longest first: "Coinbase Prime" before "Coinbase"
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startsWith = label => TERMS.find(t => new RegExp(`^${esc(t.term)}(?![a-z0-9])`, 'i').test(label.trim()));
const holderOf = label => {
  // "...: Binance Deposit 3", "Aeroswap: Binance Deposit", "Bitvavo : Coinbase Prime Custody 2"
  for (const t of TERMS) {
    if (new RegExp(`(^|[:\\s])${esc(t.term)}\\s+(Deposit|Custody)`, 'i').test(label)) return t;
  }
  return null;
};

// "Kraken_Deposit_0xab12cd" / "Kraken Dep: 0xab…12" → "Kraken: Deposit Address"; "Binance (0x12ab)" → "Binance"
const tidy = (label, name) => {
  let l = label.trim();
  if (/_Deposit_0x[0-9a-f]+$/i.test(l) || /Dep: 0x[0-9a-f.…]+$/i.test(l) || /^\S+ Dep$/i.test(l)) return `${name}: Deposit Address`;
  l = l.replace(/\s*\(0x[0-9a-f]{2,}\)$/i, '').replace(/_/g, ' ');
  return l || name;
};
const kept = [], dropped = [];
for (const [a, name, category, label] of GLOBAL_WALLETS) {
  const exploit = category === 'exploit';
  // Who holds the money?
  //   "Client: Holder Deposit/Custody …" (colon)  → the holder named after the colon
  //   "Holder Client Deposit …"          (no colon) → the leading exchange / custodian
  const lead = startsWith(label);
  const afterColon = label.includes(':') ? holderOf(label.slice(label.indexOf(':') + 1)) : null;
  const before = holderOf(label);                       // entity named right before "Deposit"/"Custody"
  const holds = e => e && ['exchange', 'custodian'].includes(e.category);
  const t = afterColon
    || (holds(before) ? before : null)                     // "Bitvavo Coinbase Prime Custody" → Coinbase Prime
    || (holds(lead) && /deposit|custody/i.test(label) ? lead : null)   // "Binance Wintermute Deposit" → Binance
    || before || lead;
  // Exploit labels ("Poloniex Hacker 12", "U.S. Government: Bitfinex Hacker Seized Funds") keep their incident name
  if (exploit) { kept.push([a, name, 'exploit', tidy(label, name)]); continue; }
  if (!t) { dropped.push(`${name}: ${label}`); continue; }
  kept.push([a, t.name, t.category, tidy(label, t.name)]);
}
kept.sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]));
const src = readFileSync(FILE, 'utf8');
writeFileSync(FILE, src.slice(0, src.indexOf('export const GLOBAL_WALLETS')) + `export const GLOBAL_WALLETS = [\n${kept.map(e => '  ' + JSON.stringify(e) + ',').join('\n')}\n];\n`);
const counts = {};
for (const e of kept) counts[e[1]] = (counts[e[1]] || 0) + 1;
console.log(`kept ${kept.length}, dropped ${dropped.length}`);
console.log('dropped sample:', dropped.slice(0, 15).join(' | '));
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k} ${v}`).join(' · '));
