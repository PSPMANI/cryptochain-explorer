// Bitcoin legacy (Base58Check 1…/3…) ⇄ Bitcoin Cash CashAddr (bitcoincash:q…/p…).
// Both encode the same hash160, so a Bitcoin address and its Bitcoin Cash twin are controlled by the same key/script.
// DOM-free (uses globalThis.crypto.subtle), works in the browser and Node.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
async function sha256d(bytes) {
  const a = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', a));
}
function polymod(values) {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i];
  }
  return c ^ 1n;
}
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [], max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  return out;
}
const prefixData = p => [...p].map(c => c.charCodeAt(0) & 31).concat([0]);

/** "1BvBM…" / "3J98…" → "bitcoincash:q…" / "bitcoincash:p…" (null if not a valid legacy address). */
export async function legacyToCash(addr) {
  let raw;
  try { raw = b58decode(addr); } catch { return null; }
  if (raw.length !== 25) return null;
  const check = await sha256d(raw.slice(0, 21));
  if (check.slice(0, 4).some((b, i) => b !== raw[21 + i])) return null;
  const type = raw[0] === 0x00 ? 0 : raw[0] === 0x05 ? 1 : null;
  if (type === null) return null;
  const payload = convertBits([type << 3, ...raw.slice(1, 21)], 8, 5, true);
  const mod = polymod([...prefixData('bitcoincash'), ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return 'bitcoincash:' + [...payload, ...checksum].map(v => CHARSET[v]).join('');
}

/** "bitcoincash:q…" or bare "q…" → legacy "1…" / "3…" (null if invalid). */
export async function cashToLegacy(addr) {
  const s = addr.toLowerCase().replace(/^bitcoincash:/, '');
  const vals = [...s].map(c => CHARSET.indexOf(c));
  if (vals.some(v => v < 0) || vals.length < 9) return null;
  if (polymod([...prefixData('bitcoincash'), ...vals]) !== 0n) return null;
  const bytes = convertBits(vals.slice(0, -8), 5, 8, false);
  if (bytes.length < 21) return null;
  const ver = bytes[0] >> 3 === 0 ? 0x00 : bytes[0] >> 3 === 1 ? 0x05 : null;
  if (ver === null) return null;
  const body = Uint8Array.from([ver, ...bytes.slice(1, 21)]);
  const check = await sha256d(body);
  return b58encode(Uint8Array.from([...body, ...check.slice(0, 4)]));
}
