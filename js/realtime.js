const EVM_WS = {
  ethereum: 'wss://ethereum-rpc.publicnode.com', base: 'wss://base-rpc.publicnode.com', arbitrum: 'wss://arbitrum-one-rpc.publicnode.com',
  optimism: 'wss://optimism-rpc.publicnode.com', polygon: 'wss://polygon-bor-rpc.publicnode.com', bsc: 'wss://bsc-rpc.publicnode.com',
  avalanche: 'wss://avalanche-c-chain-rpc.publicnode.com', linea: 'wss://linea-rpc.publicnode.com', gnosis: 'wss://gnosis-rpc.publicnode.com',
  scroll: 'wss://scroll-rpc.publicnode.com', sonic: 'wss://sonic-rpc.publicnode.com', mantle: 'wss://mantle-rpc.publicnode.com',
  unichain: 'wss://unichain-rpc.publicnode.com', opbnb: 'wss://opbnb-rpc.publicnode.com', berachain: 'wss://berachain-rpc.publicnode.com',
  taiko: 'wss://taiko-rpc.publicnode.com', sei: 'wss://sei-evm-rpc.publicnode.com', cronos: 'wss://cronos-evm-rpc.publicnode.com',
  kava: 'wss://kava-evm-rpc.publicnode.com', metis: 'wss://metis-rpc.publicnode.com', celo: 'wss://celo-rpc.publicnode.com',
};
const OTHER_WS = {
  solana: { url: 'wss://solana-rpc.publicnode.com', sub: { jsonrpc: '2.0', id: 1, method: 'slotSubscribe' }, parse: m => (m.method === 'slotNotification' ? m.params.result.slot : null), throttle: 4000 },
  bitcoin: { url: 'wss://mempool.space/api/v1/ws', sub: [{ action: 'init' }, { action: 'want', data: ['blocks'] }], parse: m => (m.block ? m.block.height : m.blocks && m.blocks.length ? m.blocks[m.blocks.length - 1].height : null) },
};

const conns = new Map();
export const hasRealtime = chainId => !!(EVM_WS[chainId] || OTHER_WS[chainId]) && typeof WebSocket !== 'undefined';

function connect(chainId) {
  const spec = EVM_WS[chainId] ? { url: EVM_WS[chainId], sub: { jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }, parse: m => (m.method === 'eth_subscription' ? parseInt(m.params.result.number, 16) : null) } : OTHER_WS[chainId];
  const c = { subs: new Set(), ws: null, retry: 0, last: 0, height: null, live: false, closed: false, timer: null };
  const open = () => {
    if (c.closed) return;
    let ws;
    try { ws = new WebSocket(spec.url); } catch { return schedule(); }
    c.ws = ws;
    ws.onopen = () => {
      c.retry = 0;
      for (const m of [].concat(spec.sub)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      const h = spec.parse(m);
      if (h == null) return;
      c.live = true;
      const now = Date.now();
      if (spec.throttle && now - c.last < spec.throttle) { c.height = h; return; }
      c.last = now; c.height = h;
      for (const fn of c.subs) { try { fn(h); } catch {} }
    };
    ws.onclose = () => { c.live = false; if (!c.closed && c.subs.size) schedule(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  const schedule = () => { clearTimeout(c.timer); c.timer = setTimeout(open, Math.min(30000, 2000 * 2 ** c.retry++)); };
  c.stop = () => { c.closed = true; clearTimeout(c.timer); try { c.ws && c.ws.close(); } catch {} conns.delete(chainId); };
  open();
  return c;
}

export function onBlock(chainId, fn) {
  if (!hasRealtime(chainId)) return null;
  let c = conns.get(chainId);
  if (!c) { c = connect(chainId); conns.set(chainId, c); }
  c.subs.add(fn);
  return () => { c.subs.delete(fn); if (!c.subs.size) setTimeout(() => { if (!c.subs.size) c.stop(); }, 15000); };
}

export const isLive = chainId => !!(conns.get(chainId) && conns.get(chainId).live);
export const liveHeight = chainId => (conns.get(chainId) ? conns.get(chainId).height : null);
