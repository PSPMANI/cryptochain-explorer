// Optional settings. The explorer works without any keys.
//
// ETHERSCAN_API_KEY: a free key from https://etherscan.io/apis unlocks full transaction history on the
// RPC-only EVM chains (BNB Chain, Gnosis, Scroll, Linea, ...) through the Etherscan V2 multichain API.
// Note: anything in this file is public once the site is deployed. For production, put the key behind
// a small proxy (see README) instead of here.
export const ETHERSCAN_API_KEY = '';

// Sign-in. Leave empty to run in DEMO mode (accounts live only in the visitor's browser, for testing).
// For launch, create a free Supabase project, run supabase/schema.sql, and paste the project URL and
// anon key here. Both values are public by design; row-level security protects each user's data.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// How often live views refresh, in milliseconds.
export const LIVE_INTERVAL = {
  dashboard: 15000,
  address: 20000,
  tx: 10000,
  watchlist: 30000, // background monitor for signed-in users' watched wallets
};
