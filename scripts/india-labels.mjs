const names = ['WazirX', 'CoinDCX', 'CoinSwitch', 'ZebPay', 'Mudrex', 'Giottus', 'Bitbns', 'Unocoin', 'BuyUcoin', 'Pi42', 'Delta Exchange', 'Koinbazar', 'Flitpay', 'Vauld', 'Colodax', 'Bitget India'];
const hosts = { ethereum: 'eth.blockscout.com', polygon: 'polygon.blockscout.com', base: 'base.blockscout.com', arbitrum: 'arbitrum.blockscout.com', optimism: 'explorer.optimism.io', bsc_none: null };
const rows = new Map();
const tasks = [];
for (const n of names) for (const [chain, h] of Object.entries(hosts)) if (h) tasks.push(async () => {
  let url = `https://${h}/api/v2/search?q=${encodeURIComponent(n)}`, pages = 0;
  while (url && pages < 8) {
    const j = await fetch(url, { signal: AbortSignal.timeout(20000) }).then(r => r.json()).catch(() => null);
    if (!j) break;
    for (const i of j.items || []) {
      if (i.type !== 'metadata_tag') continue;
      const a = (i.address_hash || i.address || '').toLowerCase();
      if (!a) continue;
      const tag = (i.metadata && i.metadata.name) || i.name || '';
      const r = rows.get(a) || { a, tags: new Set(), chains: new Set(), q: n, contract: i.is_smart_contract_verified ?? null };
      r.tags.add(tag); r.chains.add(chain); rows.set(a, r);
    }
    url = j.next_page_params ? `https://${h}/api/v2/search?q=${encodeURIComponent(n)}&${new URLSearchParams(j.next_page_params)}` : null;
    pages++;
  }
});
const queue = [...tasks];
await Promise.all(Array.from({ length: 10 }, async () => { while (queue.length) await queue.shift()(); }));
const out = [...rows.values()].map(r => ({ a: r.a, q: r.q, tags: [...r.tags], chains: [...r.chains] })).sort((x, y) => x.q.localeCompare(y.q));
const TOKENS = new Set(['0x695106ad73f506f9d0a9650a78019a93149ae07c', '0x19e2a43fbbc643c3b2d9667d858d49cad17bc2b5', '0xab93df617f51e1e415b5b4f8111f122d6b48e55c']);
const best = tags => {
  return tags.find(t => /:/.test(t)) || tags.find(t => /\d/.test(t)) || tags[0];
};
const entries = [];
for (const r of out) {
  if (TOKENS.has(r.a)) continue;
  const label = best(r.tags);
  const exploit = /exploit|hacker/i.test(r.tags.join(' '));
  entries.push([r.a, r.q, exploit ? 'exploit' : 'exchange', exploit ? `⚠ ${label}` : label]);
}
const fs = await import('node:fs');
const body = `export const INDIA_WALLETS = [
${entries.map(e => '  ' + JSON.stringify(e) + ',').join('\n')}
];
`;
fs.writeFileSync('C:/Users/Welcome/Downloads/cryptochain-explorer/js/data/india-wallets.js', body);
console.log('wrote', entries.length, 'wallets;', entries.filter(e => e[2] === 'exploit').length, 'exploit');
