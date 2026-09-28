import { CHAINS, EVM_CHAINS } from './chains.js';

const B58 = '[1-9A-HJ-NP-Za-km-z]';
const re = s => new RegExp(`^${s}$`);
const mainnet = list => list.filter(c => !c.testnet).map(c => c.id);

export function detect(input) {
  const q = input.trim();
  const out = [];
  const add = (ids, kind) => [].concat(ids).forEach(chainId => out.push({ chainId, kind }));

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(q)) add('ethereum', 'name');
  if (/^([a-z0-9_-]+\.)*[a-z0-9_-]+\.(near|tg)$/i.test(q)) add('near', 'address');

  if (/^0x[0-9a-fA-F]{40}$/.test(q)) add([...mainnet(EVM_CHAINS), 'sepolia'], 'address');
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    add([...mainnet(EVM_CHAINS), 'sepolia'], 'tx');
    add(['aptos', 'sui'], 'address');
    add('aptos', 'tx');
  }
  if (/^0x[0-9a-fA-F]{1,63}$/.test(q) && q.length !== 42) add(['aptos', 'sui'], 'address');

  if (/^[0-9a-fA-F]{64}$/.test(q)) {
    add(['bitcoin', 'litecoin', 'dogecoin', 'dash', 'bitcoin-cash', 'tron', 'xrp', 'ton', 'cosmos'], 'tx');
    if (/^[0-9a-f]{64}$/.test(q)) add('near', 'address');
  }

  if (/^(bc1|BC1)[02-9ac-hj-np-z]{11,87}$/i.test(q)) add('bitcoin', 'address');
  if (re(`1${B58}{25,33}`).test(q)) add(['bitcoin', 'bitcoin-cash'], 'address');
  if (re(`3${B58}{25,33}`).test(q)) add(['bitcoin', 'litecoin'], 'address');
  if (/^ltc1[02-9ac-hj-np-z]{11,87}$/i.test(q) || re(`[LM]${B58}{25,33}`).test(q)) add('litecoin', 'address');
  if (re(`D${B58}{32,33}`).test(q) || re(`[A9]${B58}{33}`).test(q)) add('dogecoin', 'address');
  if (re(`X${B58}{33}`).test(q) || re(`7${B58}{33}`).test(q)) add('dash', 'address');
  if (/^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$/i.test(q)) add('bitcoin-cash', 'address');

  if (re(`T${B58}{33}`).test(q)) add('tron', 'address');
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(q)) add('xrp', 'address');
  if (/^(EQ|UQ|Ef|Uf|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(q) || /^-?[01]:[0-9a-fA-F]{64}$/.test(q)) add('ton', 'address');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(q) && /[+/_=-]/.test(q)) add('ton', 'tx');
  if (/^cosmos1[02-9ac-hj-np-z]{38,58}$/.test(q)) add('cosmos', 'address');

  if (re(`${B58}{32,44}`).test(q) && !out.some(c => c.kind === 'address')) {
    add('solana', 'address');
    add(['sui', 'near'], 'tx');
  }
  if (re(`${B58}{64,90}`).test(q)) add('solana', 'tx');

  const known = new Set(CHAINS.map(c => c.id));
  const seen = new Set();
  return out.filter(c => known.has(c.chainId) && !seen.has(c.chainId + c.kind) && seen.add(c.chainId + c.kind));
}
