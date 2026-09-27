# Adapter contract

Every file in `js/adapters/` exports a default factory:

```js
export default function create(chain) {
  return { getAddress, getTxs, getTx, getStats };
}
```

`chain` is the entry from `js/chains.js` (`{ id, name, symbol, decimals, api, ... }`).
Adapters must be pure ES modules with no DOM access, so they run in both the browser and Node 18+.
Use `fetchJSON` / `rpc` / `fromUnits` / `toMs` / `NotFound` from `../utils.js`.

All amounts are **JS numbers in whole coins** (for example `1.5` ETH, not wei). All times are **epoch milliseconds**.

## `getAddress(address) → Promise<AddressInfo>`
Throws `NotFound` if the address is invalid for this chain or does not exist.

```js
{
  address: string,          // canonical form
  active: boolean,          // false if the address has never been used (0 balance, 0 txs)
  name: string | null,      // best human identity: ENS / domain / contract name / public label
  labels: string[],         // public tags, for example ['Binance', 'Exchange']
  kind: string,             // 'Wallet' | 'Contract' | 'Multisig' | 'Token' | ...
  balance: number,          // native coin balance
  txCount: number | null,
  stats: [{ label, value }],          // extra facts, value is a display string
  tokens: [{ symbol, name, balance, contract }] // optional, may be []
}
```

## `getTxs(address, cursor = null) → Promise<{ items: TxSummary[], next: any | null }>`
Newest first. `next` is an opaque cursor to pass back for the next page, `null` when done.

```js
{
  hash: string,
  time: number | null,          // null = pending
  status: 'success' | 'failed' | 'pending',
  from: string | null, fromName: string | null,
  to: string | null,   toName: string | null,
  direction: 'in' | 'out' | 'self' | null,   // relative to the queried address
  value: number,                // absolute amount moved, in `symbol` units
  symbol: string,               // usually chain.symbol; token symbol for token transfers
  fee: number | null,           // native coin
  method: string | null,        // 'Transfer', contract method, tx type, ...
}
```

## `getTx(hash) → Promise<TxDetail>`
Throws `NotFound` when the hash does not exist on this chain.

```js
{
  hash, status, time,
  block: number | string | null,
  confirmations: number | null,
  fee: number | null,
  value: number | null,          // total native value moved
  method: string | null,
  inputs:  [{ address, name, value }],   // senders   (value may be null)
  outputs: [{ address, name, value, note }], // receivers (note for OP_RETURN, memo, ...)
  transfers: [{ from, to, amount, symbol }], // token transfers, may be []
  extra: [{ label, value }]      // chain-specific facts (gas, memo, ledger, ...), display strings
}
```

## `getStats() → Promise<{ height: number | null, extra: [{ label, value }] }>`
Cheap call for the live dashboard (latest block/slot/ledger, fee or gas, TPS if easy).

## Optional extras

These are used by the flow alerts and the Investigate workflow when an adapter provides them.

- **Entity hints** on `TxSummary` and on `getTx` inputs/outputs/transfers: `fromEntity`, `toEntity` (or `entity` on a party),
  shaped like `{ name: 'Binance', category: 'exchange' | 'bridge' | 'dex' | 'token' | 'other', label: 'Binance: Hot Wallet' }`.
  Use `fromBlockscout()` / `fromName()` from `../entities.js` to build them from API labels.
- **Token metadata** on `TxSummary`: `token` (contract address), `usd` (value if the API prices it), `scam` (API flagged it).
- `getTokenTransfers(address, cursor)` returns the same shape as `getTxs`, but for token transfers. Implement it
  when the API lists token transfers separately from native transactions (Blockscout does).
- `resolveName(name) → address` for name services (ENS on the `ethereum` chain).

## Fallback providers

A chain entry may declare `fallback: { adapter, api }`. `core.adapter()` retries any call that fails with
something other than `NotFound` (rate limit, outage, CORS error) on the fallback provider.
