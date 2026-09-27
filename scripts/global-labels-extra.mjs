// Second pass for the largest exchanges: their names are flooded with token contracts in search results,
// so we search role-specific terms ("Binance: Hot Wallet", "Binance 14", …), merge into js/data/global-wallets.js
// and apply quality filters to the whole file.
// Run after scripts/global-labels.mjs:  node scripts/global-labels-extra.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { ENTITIES } from '../js/data/entity-directory.js';

const FILE = new URL('../js/data/global-wallets.js', import.meta.url);
const { GLOBAL_WALLETS } = await import(FILE.href);

const BIG = ['Binance', 'Coinbase', 'OKX', 'Kraken', 'Bybit', 'KuCoin', 'Gate.io', 'HTX', 'Huobi', 'Crypto.com', 'Bitget', 'MEXC', 'Gemini', 'Robinhood', 'Upbit', 'Bitfinex'];
const SUFFIXES = [': Hot Wallet', ' Hot Wallet', ': Cold Wallet', ' Cold Wallet', ': Deposit', ' Deposit', ' Withdrawal', ...Array.from({ length: 9 }, (_, i) => ` ${i + 1}`), ' 1', ' 2', ' 3'];
const HOST = 'eth.blockscout.com';
const info = Object.fromEntries(ENTITIES.map(([term, name, category, country]) => [term, { name, category, country }]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_TAG = /\btoken\b|stablecoin|: (usdt|usdc|tusd|eurc|pyusd|bnb|busd)\b|contract|proxy|implementation|vesting|airdrop|nft/i;
const EXPLOIT_TAG = /exploit|hacker|drainer|heist|attacker|stolen/i;

async function search(term) {
  const out = [];
  let url = `https://${HOST}/api/v2/search?q=${encodeURIComponent(term)}`;
  for (let page = 0; url && page < 8; page++) {
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      j = await fetch(url, { signal: AbortSignal.timeout(25000) }).then(r => (r.status === 429 ? null : r.json())).catch(() => null);
      if (!j) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!j) break;
    for (const i of j.items || []) if (i.type === 'metadata_tag') out.push(i);
    url = j.next_page_params ? `https://${HOST}/api/v2/search?q=${encodeURIComponent(term)}&${new URLSearchParams(j.next_page_params)}` : null;
  }
  return out;
}

const rows = new Map(GLOBAL_WALLETS.map(([a, name, category, label, country]) => [a, { name, category, country, labels: new Set([label]) }]));
const before = rows.size;
const tasks = BIG.flatMap(term => SUFFIXES.map(suf => async () => {
  const { name, category, country } = info[term];
  const nameRe = new RegExp(`(^|[^a-z0-9])${escRe(term)}([^a-z0-9]|$)`, 'i');
  for (const i of await search(term + suf)) {
    const a = (i.address_hash || i.address || '').toLowerCase();
    const tag = (i.metadata && i.metadata.name) || i.name || '';
    if (!/^0x[0-9a-f]{40}$/.test(a) || !nameRe.test(tag)) continue;
    if (TOKEN_TAG.test(tag) && !EXPLOIT_TAG.test(tag)) continue;
    const r = rows.get(a) || { name, category, country, labels: new Set() };
    if (EXPLOIT_TAG.test(tag)) r.category = 'exploit';
    r.labels.add(tag);
    rows.set(a, r);
  }
}));
let done = 0;
const queue = [...tasks];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) { await queue.shift()(); if (++done % 50 === 0) console.log(`  ${done}/${tasks.length}`); } }));

// Quality filters for the whole data set
const DROP_ENTITY = new Set(['Rain']);                              // generic word: matched a DeFi protocol and a person
const DROP_LABEL = /related_level|paxos gold|\bchain\b$/i;          // heuristic "related" guesses, token names, chain names
const best = labels => labels.find(t => /:/.test(t)) || labels.find(t => /\d/.test(t)) || labels[0];
const entries = [];
for (const [a, r] of rows) {
  if (DROP_ENTITY.has(r.name)) continue;
  const labels = [...r.labels].filter(l => !DROP_LABEL.test(l));
  if (!labels.length) continue;
  entries.push([a, r.name, r.category, best(labels), r.country]);
}
entries.sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]));
const src = readFileSync(FILE, 'utf8');
writeFileSync(FILE, src.slice(0, src.indexOf('export const GLOBAL_WALLETS')) + `export const GLOBAL_WALLETS = [\n${entries.map(e => '  ' + JSON.stringify(e) + ',').join('\n')}\n];\n`);
const counts = {};
for (const e of entries) counts[e[1]] = (counts[e[1]] || 0) + 1;
console.log(`before ${before} → after ${entries.length} wallets`);
console.log(BIG.map(t => info[t].name).filter((v, i, a) => a.indexOf(v) === i).map(n => `${n} ${counts[n] || 0}`).join(' · '));
