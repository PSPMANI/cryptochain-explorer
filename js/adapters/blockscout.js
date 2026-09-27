// Blockscout v2 API: full EVM indexer with ENS names, public tags, tokens and history.
import { fetchJSON, fromUnits, toMs, NotFound } from '../utils.js';
import { fromBlockscout } from '../entities.js';

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

export default function create(chain) {
  const api = `${chain.api}/api/v2`;
  const party = p => p ? { address: p.hash, name: p.ens_domain_name || p.name || null, entity: fromBlockscout(p) } : null;
  const status = s => s === 'ok' ? 'success' : s === 'error' ? 'failed' : 'pending';

  async function getAddress(addr) {
    if (!EVM_ADDR.test(addr)) throw new NotFound('Invalid EVM address');
    let a;
    try {
      a = await fetchJSON(`${api}/addresses/${addr}`);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      // Valid address the indexer has never seen: unused on this chain.
      return { address: addr, active: false, name: null, labels: [], kind: 'Wallet', balance: 0, txCount: 0, stats: [], tokens: [] };
    }
    const [counters, tokens] = await Promise.all([
      fetchJSON(`${api}/addresses/${addr}/counters`).catch(() => ({})),
      fetchJSON(`${api}/addresses/${addr}/tokens?type=ERC-20`).catch(() => ({ items: [] })),
    ]);

    const labels = [
      ...(a.public_tags || []).map(t => t.display_name || t.label),
      ...((a.metadata && a.metadata.tags) || []).map(t => t.name),
    ].filter(Boolean);
    if (a.is_scam) labels.unshift('⚠ Flagged as scam');

    let kind = 'Wallet';
    if (a.proxy_type === 'eip7702') kind = 'Smart wallet (EIP-7702)';
    else if (a.token) kind = `Token contract (${a.token.type})`;
    else if (a.is_contract) kind = 'Contract';

    const stats = [];
    if (counters.token_transfers_count) stats.push({ label: 'Token transfers', value: Number(counters.token_transfers_count).toLocaleString() });
    if (counters.gas_usage_count) stats.push({ label: 'Gas used', value: Number(counters.gas_usage_count).toLocaleString() });
    if (a.token) {
      stats.push({ label: 'Token', value: `${a.token.name || ''} (${a.token.symbol || '?'})` });
      if (a.token.holders_count || a.token.holders) stats.push({ label: 'Holders', value: Number(a.token.holders_count || a.token.holders).toLocaleString() });
    }
    if (a.creator_address_hash) stats.push({ label: 'Created by', value: a.creator_address_hash, link: 'address' });
    if (a.creation_transaction_hash || a.creation_tx_hash) stats.push({ label: 'Creation tx', value: a.creation_transaction_hash || a.creation_tx_hash, link: 'tx' });
    if (a.is_verified) stats.push({ label: 'Source code', value: 'Verified ✓' });

    return {
      address: a.hash,
      active: true,
      name: a.ens_domain_name || a.name || (a.token && a.token.name) || null,
      labels,
      kind,
      balance: fromUnits(a.coin_balance, chain.decimals),
      // Some Blockscout instances report 0 while counters are still being computed.
      txCount: Number(counters.transactions_count) > 0 ? Number(counters.transactions_count) : null,
      stats,
      tokens: (tokens.items || [])
        .filter(t => t.token && t.value && t.value !== '0')
        .map(t => ({
          symbol: t.token.symbol || '?',
          name: t.token.name || '',
          balance: fromUnits(t.value, Number(t.token.decimals || 0)),
          contract: t.token.address_hash || t.token.address,
          usd: t.token.exchange_rate ? fromUnits(t.value, Number(t.token.decimals || 0)) * Number(t.token.exchange_rate) : null,
        }))
        .sort((x, y) => (y.usd || 0) - (x.usd || 0)),
    };
  }

  // Token metadata (symbol / decimals) for decoding pending token transfers, cached per contract
  const tokenMeta = new Map();
  const tokenInfo = contract => {
    if (!tokenMeta.has(contract)) tokenMeta.set(contract, fetchJSON(`${api}/tokens/${contract}`, { ttl: 3600000 }).catch(() => null));
    return tokenMeta.get(contract);
  };

  /**
   * Where the tokens in a tx actually went (the tx's "to" is only the token contract):
   * confirmed txs carry token_transfers; pending ones are decoded from transfer / transferFrom calldata.
   */
  async function tokenMoves(t, me) {
    if (Array.isArray(t.token_transfers) && t.token_transfers.length) {
      return t.token_transfers.filter(x => x.from && x.from.hash.toLowerCase() === me && x.to).map(x => {
        const tok = x.token || {};
        return { to: x.to.hash, toName: x.to.ens_domain_name || x.to.name || null, toEntity: fromBlockscout(x.to),
          value: x.total && x.total.value != null ? fromUnits(x.total.value, Number(x.total.decimals || tok.decimals || 0)) : 1, symbol: tok.symbol || '?' };
      });
    }
    const d = t.decoded_input;
    if (!d || !t.to || !['a9059cbb', '23b872dd'].includes(d.method_id)) return [];
    const params = d.parameters || [];
    const addrs = params.filter(p => p.type === 'address').map(p => p.value);
    const raw = (params.find(p => p.type === 'uint256') || {}).value;
    const to = d.method_id === 'a9059cbb' ? addrs[0] : addrs[1];
    if (!to || raw == null) return [];
    const meta = await tokenInfo(t.to.hash);
    return [{ to, toName: null, toEntity: null, value: fromUnits(raw, Number((meta && meta.decimals) || 18)), symbol: (meta && meta.symbol) || t.to.name || 'token', decoded: true }];
  }

  async function getTxs(addr, cursor = null) {
    const qs = cursor ? '?' + new URLSearchParams(cursor) : '';
    const page = await fetchJSON(`${api}/addresses/${addr}/transactions${qs}`);
    const me = addr.toLowerCase();
    const moves = await Promise.all((page.items || []).map(t => tokenMoves(t, me).catch(() => [])));
    return {
      items: (page.items || []).map((t, i) => {
        const from = t.from && t.from.hash, to = t.to && t.to.hash;
        const out = from && from.toLowerCase() === me, inc = to && to.toLowerCase() === me;
        return {
          hash: t.hash,
          time: toMs(t.timestamp),
          status: t.result === 'pending' || !t.block_number && !t.block ? 'pending' : status(t.status),
          from, fromName: t.from && (t.from.ens_domain_name || t.from.name) || null,
          to: to || (t.created_contract && t.created_contract.hash) || null,
          toName: t.to ? (t.to.ens_domain_name || t.to.name || null) : 'Contract creation',
          fromEntity: fromBlockscout(t.from), toEntity: fromBlockscout(t.to),
          direction: out && inc ? 'self' : out ? 'out' : inc ? 'in' : null,
          value: fromUnits(t.value, chain.decimals),
          symbol: chain.symbol,
          fee: t.fee ? fromUnits(t.fee.value, chain.decimals) : null,
          method: t.method || (t.to ? 'Transfer' : 'Create'),
          tokenTransfers: moves[i],
        };
      }),
      next: page.next_page_params || null,
    };
  }

  // Optional adapter extension used by investigations: ERC-20/721/1155 transfers as TxSummary items.
  async function getTokenTransfers(addr, cursor = null) {
    const qs = cursor ? '?' + new URLSearchParams(cursor) : '';
    const page = await fetchJSON(`${api}/addresses/${addr}/token-transfers${qs}`);
    const me = addr.toLowerCase();
    return {
      items: (page.items || []).map(t => {
        const from = t.from && t.from.hash, to = t.to && t.to.hash;
        const out = from && from.toLowerCase() === me, inc = to && to.toLowerCase() === me;
        const nft = t.total && t.total.value == null;
        const tok = t.token || {};
        const value = nft ? 1 : fromUnits(t.total && t.total.value, Number((t.total && t.total.decimals) || tok.decimals || 0));
        return {
          hash: t.transaction_hash || t.tx_hash,
          time: toMs(t.timestamp),
          status: 'success',
          from, fromName: t.from && (t.from.ens_domain_name || t.from.name) || null, fromEntity: fromBlockscout(t.from),
          to, toName: t.to && (t.to.ens_domain_name || t.to.name) || null, toEntity: fromBlockscout(t.to),
          direction: out && inc ? 'self' : out ? 'out' : inc ? 'in' : null,
          value,
          symbol: tok.symbol || tok.name || '?',
          token: tok.address_hash || tok.address || null,
          scam: tok.reputation === 'scam' || !!tok.is_scam,
          usd: !nft && tok.exchange_rate && tok.reputation !== 'scam' ? value * Number(tok.exchange_rate) : null,
          fee: null,
          method: t.method || (nft ? 'NFT transfer' : 'Token transfer'),
        };
      }),
      next: page.next_page_params || null,
    };
  }

  async function getTx(hash) {
    if (!EVM_HASH.test(hash)) throw new NotFound('Invalid tx hash');
    const t = await fetchJSON(`${api}/transactions/${hash}`);
    const extra = [];
    if (t.gas_used) extra.push({ label: 'Gas used / limit', value: `${Number(t.gas_used).toLocaleString()} / ${Number(t.gas_limit).toLocaleString()}` });
    if (t.gas_price) extra.push({ label: 'Gas price', value: `${fromUnits(t.gas_price, 9).toLocaleString(undefined, { maximumFractionDigits: 4 })} Gwei` });
    if (t.nonce != null) extra.push({ label: 'Nonce', value: String(t.nonce) });
    if (t.type != null) extra.push({ label: 'Tx type', value: String(t.type) });
    if (t.revert_reason) extra.push({ label: 'Revert reason', value: typeof t.revert_reason === 'string' ? t.revert_reason : (t.revert_reason.raw || JSON.stringify(t.revert_reason)) });
    if (t.decoded_input && t.decoded_input.method_call) extra.push({ label: 'Function', value: t.decoded_input.method_call });

    const to = t.to || t.created_contract;
    return {
      hash: t.hash,
      status: t.result === 'pending' ? 'pending' : status(t.status),
      time: toMs(t.timestamp),
      block: t.block_number ?? t.block ?? null,
      confirmations: t.confirmations ?? null,
      fee: t.fee ? fromUnits(t.fee.value, chain.decimals) : null,
      value: fromUnits(t.value, chain.decimals),
      method: t.method || (t.to ? 'Transfer' : 'Contract creation'),
      inputs: [{ ...party(t.from), value: fromUnits(t.value, chain.decimals) }],
      outputs: to ? [{ ...party(to), value: fromUnits(t.value, chain.decimals), note: t.to ? null : 'New contract' }] : [],
      transfers: (t.token_transfers || []).map(tt => {
        const sym = tt.token && (tt.token.symbol || tt.token.name) || '?';
        const nft = tt.total && tt.total.token_id != null && tt.total.value == null;
        return {
          from: tt.from && tt.from.hash, fromName: tt.from && (tt.from.ens_domain_name || tt.from.name) || null, fromEntity: fromBlockscout(tt.from),
          to: tt.to && tt.to.hash, toName: tt.to && (tt.to.ens_domain_name || tt.to.name) || null, toEntity: fromBlockscout(tt.to),
          amount: nft ? 1 : fromUnits(tt.total && tt.total.value, Number(tt.total && tt.total.decimals || tt.token && tt.token.decimals || 0)),
          symbol: nft ? `${sym} #${String(tt.total.token_id).slice(0, 10)}` : sym,
        };
      }),
      extra,
    };
  }

  async function getStats() {
    const s = await fetchJSON(`${api}/stats`, { ttl: 5000 });
    const extra = [];
    const gas = s.gas_prices && (s.gas_prices.average ?? s.gas_prices.average?.price);
    if (gas != null) extra.push({ label: 'Gas', value: `${Number(typeof gas === 'object' ? gas.price : gas).toLocaleString(undefined, { maximumFractionDigits: 3 })} Gwei` });
    if (s.transactions_today) extra.push({ label: 'Txs today', value: Number(s.transactions_today).toLocaleString() });
    if (s.average_block_time) extra.push({ label: 'Block time', value: `${(s.average_block_time / 1000).toFixed(1)}s` });
    return { height: s.total_blocks ? Number(s.total_blocks) : null, extra };
  }

  // ENS / name-service lookup (used for `vitalik.eth`-style input)
  async function resolveName(name) {
    const res = await fetchJSON(`${api}/search/quick?q=${encodeURIComponent(name)}`);
    const list = Array.isArray(res) ? res : res.items || [];
    const hit = list.find(i => (i.type === 'ens_domain' || i.ens_info) && (i.address_hash || i.address));
    if (!hit) throw new NotFound(`No address found for ${name}`);
    return hit.address_hash || hit.address;
  }

  return { getAddress, getTxs, getTx, getStats, resolveName, getTokenTransfers };
}
