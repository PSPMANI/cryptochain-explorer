
const bs = (id, name, host, symbol, cg, color, extra = {}) =>
  ({ id, name, family: 'evm', adapter: 'blockscout', api: `https://${host}`, symbol, decimals: 18, coingeckoId: cg, color, ...extra });
const rpcChain = (id, name, host, symbol, cg, color, chainId, extra = {}) =>
  ({ id, name, family: 'evm', adapter: 'evmrpc', api: `https://${host}`, symbol, decimals: 18, coingeckoId: cg, color, chainId, ...extra });

export const CHAINS = [
  bs('ethereum', 'Ethereum', 'eth.blockscout.com', 'ETH', 'ethereum', '#627EEA', { ens: true, chainId: 1 }),
  bs('base', 'Base', 'base.blockscout.com', 'ETH', 'ethereum', '#0052FF', { chainId: 8453 }),
  bs('arbitrum', 'Arbitrum One', 'arbitrum.blockscout.com', 'ETH', 'ethereum', '#28A0F0', { chainId: 42161 }),
  bs('optimism', 'OP Mainnet', 'explorer.optimism.io', 'ETH', 'ethereum', '#FF0420', { chainId: 10 }),
  bs('polygon', 'Polygon PoS', 'polygon.blockscout.com', 'POL', 'polygon-ecosystem-token', '#8247E5', { chainId: 137 }),
  bs('zksync', 'zkSync Era', 'zksync.blockscout.com', 'ETH', 'ethereum', '#8C8DFC', { chainId: 324 }),
  bs('unichain', 'Unichain', 'unichain.blockscout.com', 'ETH', 'ethereum', '#F50DB4', { chainId: 130 }),
  bs('celo', 'Celo', 'celo.blockscout.com', 'CELO', 'celo', '#FCFF52', { chainId: 42220 }),
  bs('worldchain', 'World Chain', 'worldchain-mainnet.explorer.alchemy.com', 'ETH', 'ethereum', '#B8B8B8', { chainId: 480 }),
  bs('soneium', 'Soneium', 'soneium.blockscout.com', 'ETH', 'ethereum', '#9B8CFF', { chainId: 1868 }),
  bs('ink', 'Ink', 'explorer.inkonchain.com', 'ETH', 'ethereum', '#7132F5', { chainId: 57073 }),
  bs('mode', 'Mode', 'explorer.mode.network', 'ETH', 'ethereum', '#DFFE00', { chainId: 34443 }),
  bs('lisk', 'Lisk', 'blockscout.lisk.com', 'ETH', 'ethereum', '#4070F4', { chainId: 1135 }),
  bs('manta', 'Manta Pacific', 'pacific-explorer.manta.network', 'ETH', 'ethereum', '#1BD6CF', { chainId: 169 }),
  bs('immutable', 'Immutable zkEVM', 'explorer.immutable.com', 'IMX', 'immutable-x', '#17B5CB', { chainId: 13371 }),
  bs('rootstock', 'Rootstock', 'rootstock.blockscout.com', 'RBTC', 'rootstock', '#FF9931', { chainId: 30 }),
  bs('flare', 'Flare', 'flare-explorer.flare.network', 'FLR', 'flare-networks', '#E62058', { chainId: 14 }),
  bs('lukso', 'LUKSO', 'explorer.execution.mainnet.lukso.network', 'LYX', 'lukso-token-2', '#FE005B', { chainId: 42 }),

  rpcChain('avalanche', 'Avalanche C-Chain', 'avalanche-c-chain-rpc.publicnode.com', 'AVAX', 'avalanche-2', '#E84142', 43114,
    { historyApi: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api' }),

  rpcChain('bsc', 'BNB Smart Chain', 'bsc-dataseed.bnbchain.org', 'BNB', 'binancecoin', '#F0B90B', 56, { logsRpc: 'https://bsc-rpc.publicnode.com', logsSpan: 3000 }),
  rpcChain('opbnb', 'opBNB', 'opbnb-rpc.publicnode.com', 'BNB', 'binancecoin', '#F0B90B', 204),
  rpcChain('linea', 'Linea', 'linea-rpc.publicnode.com', 'ETH', 'ethereum', '#61DFFF', 59144, { logsRpc: 'https://rpc.linea.build' }),
  rpcChain('blast', 'Blast', 'blast-rpc.publicnode.com', 'ETH', 'ethereum', '#FCFC03', 81457, { historyApi: 'https://api.routescan.io/v2/network/mainnet/evm/81457/etherscan/api' }),
  rpcChain('mantle', 'Mantle', 'mantle-rpc.publicnode.com', 'MNT', 'mantle', '#65B3AE', 5000, { historyApi: 'https://api.routescan.io/v2/network/mainnet/evm/5000/etherscan/api' }),
  rpcChain('zora', 'Zora', 'rpc.zora.energy', 'ETH', 'ethereum', '#A1A1FF', 7777777),
  rpcChain('sonic', 'Sonic', 'sonic-rpc.publicnode.com', 'S', 'sonic-3', '#FE9A4D', 146),
  rpcChain('berachain', 'Berachain', 'berachain-rpc.publicnode.com', 'BERA', 'berachain-bera', '#F5A35C', 80094),
  rpcChain('cronos', 'Cronos', 'cronos-evm-rpc.publicnode.com', 'CRO', 'crypto-com-chain', '#1199FA', 25),
  rpcChain('hyperevm', 'HyperEVM', 'rpc.hyperliquid.xyz/evm', 'HYPE', 'hyperliquid', '#97FCE4', 999, { logsSpan: 1000, logsMaxBack: 3000 }),
  rpcChain('sei', 'Sei EVM', 'sei-evm-rpc.publicnode.com', 'SEI', 'sei-network', '#9E1F19', 1329),
  rpcChain('metis', 'Metis', 'metis-rpc.publicnode.com', 'METIS', 'metis-token', '#00DACC', 1088, { historyApi: 'https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan/api' }),
  rpcChain('taiko', 'Taiko', 'taiko-rpc.publicnode.com', 'ETH', 'ethereum', '#E81899', 167000),
  rpcChain('gnosis', 'Gnosis', 'gnosis-rpc.publicnode.com', 'xDAI', 'xdai', '#3E6957', 100),
  rpcChain('scroll', 'Scroll', 'scroll-rpc.publicnode.com', 'ETH', 'ethereum', '#FFEEDA', 534352),
  rpcChain('kava', 'Kava EVM', 'kava-evm-rpc.publicnode.com', 'KAVA', 'kava', '#FF433E', 2222),

  { id: 'bitcoin', name: 'Bitcoin', family: 'utxo', adapter: 'esplora', api: 'https://mempool.space/api',
    symbol: 'BTC', decimals: 8, coingeckoId: 'bitcoin', color: '#F7931A' },
  { id: 'litecoin', name: 'Litecoin', family: 'utxo', adapter: 'blockcypher', api: 'https://api.blockcypher.com/v1/ltc/main',
    symbol: 'LTC', decimals: 8, coingeckoId: 'litecoin', color: '#345D9D', statsEvery: 300000, fallback: { adapter: 'blockchair', api: 'https://api.blockchair.com/litecoin' } },
  { id: 'dogecoin', name: 'Dogecoin', family: 'utxo', adapter: 'blockcypher', api: 'https://api.blockcypher.com/v1/doge/main',
    symbol: 'DOGE', decimals: 8, coingeckoId: 'dogecoin', color: '#C2A633', statsEvery: 300000, fallback: { adapter: 'blockchair', api: 'https://api.blockchair.com/dogecoin' } },
  { id: 'dash', name: 'Dash', family: 'utxo', adapter: 'blockcypher', api: 'https://api.blockcypher.com/v1/dash/main',
    symbol: 'DASH', decimals: 8, coingeckoId: 'dash', color: '#008CE7', statsEvery: 300000, fallback: { adapter: 'blockchair', api: 'https://api.blockchair.com/dash' } },
  { id: 'bitcoin-cash', name: 'Bitcoin Cash', family: 'utxo', adapter: 'haskoin', api: 'https://api.haskoin.com/bch',
    symbol: 'BCH', decimals: 8, coingeckoId: 'bitcoin-cash', color: '#8DC351', statsEvery: 30000,
    fallback: { adapter: 'blockchair', api: 'https://api.blockchair.com/bitcoin-cash' } },

  { id: 'solana', name: 'Solana', family: 'solana', adapter: 'solana', api: 'https://solana-rpc.publicnode.com',
    symbol: 'SOL', decimals: 9, coingeckoId: 'solana', color: '#14F195' },
  { id: 'tron', name: 'TRON', family: 'tron', adapter: 'tron', api: 'https://api.trongrid.io',
    symbol: 'TRX', decimals: 6, coingeckoId: 'tron', color: '#FF060A' },
  { id: 'xrp', name: 'XRP Ledger', family: 'xrp', adapter: 'xrp', api: 'https://xrplcluster.com',
    symbol: 'XRP', decimals: 6, coingeckoId: 'ripple', color: '#3AA8E8' },
  { id: 'ton', name: 'TON', family: 'ton', adapter: 'ton', api: 'https://toncenter.com/api/v3',
    symbol: 'TON', decimals: 9, coingeckoId: 'the-open-network', color: '#0098EA', statsEvery: 30000 },
  { id: 'near', name: 'NEAR', family: 'near', adapter: 'near', api: 'https://rpc.mainnet.near.org',
    indexer: 'https://api.nearblocks.io/v1', symbol: 'NEAR', decimals: 24, coingeckoId: 'near', color: '#00EC97' },
  { id: 'aptos', name: 'Aptos', family: 'move', adapter: 'aptos', api: 'https://api.mainnet.aptoslabs.com/v1',
    symbol: 'APT', decimals: 8, coingeckoId: 'aptos', color: '#2ED8A7' },
  { id: 'sui', name: 'Sui', family: 'move', adapter: 'sui', api: 'https://sui-rpc.publicnode.com',
    symbol: 'SUI', decimals: 9, coingeckoId: 'sui', color: '#4DA2FF' },
  { id: 'cosmos', name: 'Cosmos Hub', family: 'cosmos', adapter: 'cosmos', api: 'https://cosmos-rest.publicnode.com',
    symbol: 'ATOM', decimals: 6, coingeckoId: 'cosmos', color: '#8A8FB5' },

  bs('sepolia', 'Sepolia (testnet)', 'eth-sepolia.blockscout.com', 'ETH', null, '#9CA3AF', { testnet: true, chainId: 11155111 }),
];

export const CHAIN = Object.fromEntries(CHAINS.map(c => [c.id, c]));
export const EVM_CHAINS = CHAINS.filter(c => c.family === 'evm');
