// Named accounts from official / open explorer data for chains with thin coverage:
//   Aptos → aptos-labs/explorer  app/data/mainnet/knownAddresses.ts   (the official Aptos Explorer's known addresses)
//   TON   → tonkeeper/ton-assets accounts.json                         (the names TonAPI / Tonkeeper show)
// Exchanges get category 'exchange' (CryptChain canonical names); other named accounts keep their name as an identity
// label ('other'); bridge names become 'bridge'. Products of an exchange (marketplaces, wallets, launchpads) are not the
// exchange itself. Writes js/data/extra-labels.js. Run: node scripts/extra-chain-labels.mjs
import { writeFileSync } from 'node:fs';
import { fromName } from '../js/entities.js';

const raw = (repo, path) => fetch(`https://raw.githubusercontent.com/${repo}/main/${path}`).then(r => (r.ok ? r.text() : ''));
const NOT_EXCHANGE = /marketplace|nft|launchpad|wallet bot|web3 wallet|bridge|staking pool|validator/i;
const classify = name => {
  const e = fromName(name);
  if (e && e.category === 'exchange' && !NOT_EXCHANGE.test(name)) return ['exchange', e.name];
  if (e && ['fund', 'custodian', 'issuer', 'exploit', 'bridge', 'dex'].includes(e.category)) return [e.category, e.name];
  if (/bridge/i.test(name)) return ['bridge', name];
  return ['other', name];
};

const out = { aptos: [], ton: [] };

// Aptos Explorer known addresses: "0x…": "Name"
const apt = await raw('aptos-labs/explorer', 'app/data/mainnet/knownAddresses.ts');
for (const m of apt.matchAll(/["'](0x[0-9a-fA-F]{1,64})["']\s*:\s*["']([^"']+)["']/g)) {
  const a = '0x' + m[1].slice(2).toLowerCase().padStart(64, '0');
  const [category, name] = classify(m[2]);
  out.aptos.push([a, name, category, m[2]]);
}

// Tonkeeper ton-assets: [{ address: "0:<hex>", name }]
const ton = JSON.parse((await raw('tonkeeper/ton-assets', 'accounts.json')) || '[]');
for (const x of ton) {
  if (!/^-?\d:[0-9a-fA-F]{64}$/.test(x.address || '') || !x.name) continue;
  const [category, name] = classify(x.name);
  out.ton.push([x.address.toLowerCase(), name, category, x.name]);
}

writeFileSync(new URL('../js/data/extra-labels.js', import.meta.url), `// Named accounts from the official Aptos Explorer (aptos-labs/explorer) and Tonkeeper's ton-assets (accounts.json),
// imported ${new Date().toISOString().slice(0, 10)} by scripts/extra-chain-labels.mjs. { chainId: [[address, name, category, label]] }
export const EXTRA_LABELS = ${JSON.stringify(out)};
`);
for (const [c, rows] of Object.entries(out)) {
  const ex = rows.filter(r => r[2] === 'exchange');
  console.log(`${c}: ${rows.length} named accounts, ${ex.length} exchange wallets (${[...new Set(ex.map(r => r[1]))].join(', ')})`);
}
