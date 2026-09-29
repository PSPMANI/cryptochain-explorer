# CryptChain Explorer

A multichain block explorer in the browser. Paste any wallet address, transaction hash, or name
(`vitalik.eth`, `root.near`) and CryptChain works out which network it belongs to. It then shows the
address's public identity, balance, tokens and transactions, updating live.

- **48 networks**: Bitcoin, Ethereum and 35 other EVM chains, Solana, TRON, XRP, TON, NEAR, Aptos, Sui, Cosmos, Litecoin, Dogecoin, Dash, Bitcoin Cash
- **Smart search**: detects the chain from the input format. An EVM address is checked on every EVM chain at once, with a portfolio total.
- **Identity**: ENS / .ton / NEAR names, contract names, public labels (exchanges, bridges, tokens) and scam flags
- **Real time**: live dashboard of every network (block height, gas/fees, price), live transaction feed on address pages, live confirmations on tx pages
- **No backend, no API keys**: a static site that calls free public APIs straight from the visitor's browser
- **Private by design**: no accounts and no server database. Each visitor's searches, watchlist, alerts, labels and saved investigations stay in their own browser; other visitors never see them. My workspace → 🗑 Clear all my data removes everything
- **Fast**: the page shell loads about 145 KB of code; the 1.7 MB label database and the investigation tools load in the background or only when opened

### 🎯 Hack tracker (`#/cases`)

Open a case, paste the attacker's addresses (any chain) or import a tracker's JSON address list, and press ▶ Start live tracking:
- every outgoing movement is recorded and classified: exchange deposit, swap/bridge, new wallet, or internal move between attacker wallets
- swaps and bridges are followed to the next chain (THORChain / Maya, CoW Swap, Across, Stargate/LayerZero, Wormhole; Chainflip channels are detected)
- new wallets receiving money are added to the case automatically, so the trail keeps growing on its own
- 🟢 strong leads: money reaching an exchange, or USDT/USDC that Tether/Circle can freeze. 🟡 other leads: new attacker wallets
- one-click "Copy for report", a downloadable case report (Markdown) and CSV of every movement
- cases are stored only in your browser

### ⚡ Real-time feed

Block heights and address pages update the moment a block is produced (WebSocket feeds for 21 EVM networks, Solana and Bitcoin), with polling as a fallback.

### 🛡 Scam detection

Fake lookalike tokens (e.g. `ÚSDС`, fake "ETH"), tokens that are not the official contract, and address-poisoning lookalike addresses are flagged and kept out of totals. Swap and bridge contracts (THORChain, CoW Swap, LayerZero, Across, Chainflip deposit channels) are labeled.

### 📄 Report (Investigate → 📄 Report)

One click produces an easy-to-understand report anyone can read, as a single HTML file that opens in any browser and prints or
saves as PDF: **In short** (auto-written summary), **Key findings** (exchanges reached, Indian exchanges, bridges, scam warnings in plain
words), **Where the money ended up** (100% breakdown + exchanges with locations), **Money trail** (hop-by-hop table and the main routes
step by step, each step with its UTC timestamp and transaction link), **Cross-chain transfers**, **Main counterparties**, the **complete
transaction log** (every transfer, oldest first, with date & time), an appendix of address-poisoning lookalikes, and a glossary.
Also: all transactions as CSV, and the money trail (every traced wallet-to-wallet transfer with timestamps) as CSV.

### 🏷 Exchange wallet coverage (≈15,700 labeled wallets, 14 chains)

| Source | What it adds |
|---|---|
| Open Labels Initiative (via Blockscout) | 5,464 EVM wallets of 71 exchanges/institutions + 89 Indian exchange wallets |
| DefiLlama CEX adapters + Binance proof of reserves | 4,942 exchange-owned reserve wallets on Bitcoin, EVM, TRON, Solana, XRP, Litecoin, TON, **Dogecoin**, Aptos, NEAR, Sui, Cosmos, Bitcoin Cash, Dash |
| Dune Spellbook CEX labels | 4,957 EVM + ≈1,800 Solana/Bitcoin/Litecoin/XRP/TRON/Aptos/NEAR wallets |
| XRPScan well-known names / TonAPI curated names | 2,772 XRP accounts (895 exchange) / 65 TON exchange wallets |
| Official Aptos Explorer (aptos-labs/explorer) / Tonkeeper ton-assets | 175 Aptos + 535 TON named accounts (exchanges, bridges, services) |
| Derived | 484 Bitcoin Cash twins of Bitcoin exchange wallets (same key holder) |
| Live lookups | WalletExplorer (Bitcoin, Bitcoin Cash), TronScan (TRON), XRPScan (XRP), TonAPI (TON) |

No open label source exists yet for **Sui, Cosmos, Dash and NEAR** beyond the few reserve wallets above (their explorers' label APIs need keys);
use 🏷 custom labels and the automatic deposit-address check there.

Refresh everything with: `node scripts/extra-chain-labels.mjs && node scripts/global-labels.mjs && node scripts/global-labels-extra.mjs && node scripts/clean-labels.mjs &&
node scripts/spellbook-labels.mjs && node scripts/xrp-labels.mjs && node scripts/ton-labels.mjs && node scripts/defillama-cex.mjs`.
GitHub shows no explicit license for the Spellbook and DefiLlama repositories; check their terms before commercial use.

### 🌐 Exchanges & institutions worldwide

- **5,464 publicly labeled wallets of 71 international entities**, recognized on every EVM network in alerts, live destination checks,
  investigations and money trails. They include exchanges (Binance, Coinbase, OKX, Kraken, Bybit, Upbit, Bitfinex, MEXC, Bitget, KuCoin,
  HTX, Gemini, bitFlyer, Bitso, BtcTurk, Luno, …), market makers (Wintermute, Jump, Amber, GSR, …), custodians (BitGo, Coinbase Prime,
  Copper, Ceffu, Anchorage) and stablecoin issuers (Paxos), each with its location (🇺🇸 🇰🇷 🇯🇵 🇬🇧 🇲🇽 … or 🌐 offshore).
- **849 hack / exploit wallets** (Upbit 2019, Poloniex, Bitfinex 2016 seized funds, BitMart, AscendEX, Indodax, Wintermute exploit) are flagged
  ⚠ Exploiter and raise a high alert, never counted as the exchange.
- Directory page `#/exchanges/all`: filter by country or type, open an entity to see its wallets by role (hot, cold, deposit, …),
  load live balances, and watch its main wallets.
- Source: Blockscout / Open Labels Initiative tags. Refresh with `node scripts/global-labels.mjs && node scripts/global-labels-extra.mjs && node scripts/clean-labels.mjs`.
  Ownership rule: "Client: Exchange Deposit" and "Exchange Client Deposit" labels belong to the exchange that holds the money.
- **Bitcoin and TRON exchange wallets** are identified live, worldwide: Bitcoin through WalletExplorer's named wallet clusters
  ("Binance.com", "Kraken.com", …) and TRON through TronScan address tags ("Binance-Hot 4", "OKX", …). Both are keyless; lookups are
  throttled and cached for 7 days (`js/labels-live.js`). They appear in transaction lists, identity, alerts, destination checks,
  investigations and the full money trace.
- **Solana, Bitcoin, Litecoin, XRP, TRON, Aptos and NEAR exchange wallets** (≈2,000, 70 exchanges incl. Binance, OKX, Coinbase, Kraken,
  KuCoin, Bitstamp, HTX, Bybit, CoinDCX) from Dune Spellbook's community-maintained CEX labels (github.com/duneanalytics/spellbook),
  imported by `node scripts/spellbook-labels.mjs` into `js/data/cex-nonevm.js` (loaded in the background). Every address is validated
  against its chain's format; malformed entries in the source are skipped. Check Spellbook's terms before commercial use.
- **XRP**: 2,772 named accounts from XRPScan's public well-known list (895 exchange wallets across 67 exchanges incl. Coinbase,
  Binance, GateHub, Upbit, Bithumb, WazirX, ZebPay, CoinDCX; the rest are named services), imported by `node scripts/xrp-labels.mjs`.
  Unknown XRP addresses are also looked up live on XRPScan, including its scam / phishing advisories.
- **TON**: 65 exchange wallets from TonAPI's curated account names (Bitget, OKX, Bybit, Binance, KuCoin, MEXC, EXMO, …), imported by
  `node scripts/ton-labels.mjs`. User-registered `.ton` / `.t.me` domains are deliberately excluded (anyone can register them).
  Unknown TON addresses are looked up live on TonAPI (about one request per second without a key), including its scam flag.
- **Bitcoin Cash**: exchange wallets are derived from the Bitcoin ones. A legacy Bitcoin address and its CashAddr twin share the same
  hash160, i.e. the same key holder (484 wallets; `js/cashaddr.js`, verified against the CashAddr spec vectors). Most are dormant,
  since only exchanges that reused their Bitcoin keys on Bitcoin Cash use them. Unknown Bitcoin Cash addresses are converted and looked
  up live on WalletExplorer. Bitcoin Cash data now comes from Haskoin (keyless) with Blockchair as fallback.
- **Dogecoin**: exchange wallets come from the exchanges' published reserve wallets (DefiLlama); there is no other free label source.
  Use **custom labels** instead.
- **🏷 Custom labels**: name any address on any chain from its page (exchange, market maker, custodian, issuer,
  scam or other, plus location). Your labels win over all other sources and appear in alerts, connections, investigations and money
  trails. EVM labels apply to every EVM network. Saved in your browser; manage them under My workspace → My labels.
- **Automatic deposit-address detection on every address page**: the biggest unlabeled outgoing destinations are checked right away
  (does the address forward its funds into an exchange?), so a transfer to your personal exchange deposit address shows the exchange name.
- **🔗 Exchange connections** card on every address page: which exchanges / institutions the wallet sent to or received from,
  how often and how much, with locations, on any network.

### 🇮🇳 Indian exchanges

- 15 India-focused exchanges recognized: WazirX, CoinDCX, CoinSwitch, ZebPay, Mudrex, Giottus, Bitbns, Unocoin, BuyUcoin, Pi42,
  Delta Exchange, Koinbazar, Flitpay, Colodax, Vauld. They're marked 🇮🇳 in badges, alerts, investigations and money trails.
- 89 publicly labeled exchange wallets are included (CoinDCX 58, WazirX 17, Delta Exchange 6, Vauld 5, CoinSwitch 2, Bitbns 1),
  taken from Blockscout / Open Labels Initiative tags. They're in [`js/data/india-wallets.js`](js/data/india-wallets.js); regenerate with `node scripts/india-labels.mjs`.
- The WazirX 2024 hack exploiter wallets are flagged as ⚠ **Exploiter**, never as the exchange. Any transfer to or from them raises a high alert.
- Directory page `#/exchanges/india`: each exchange's wallets grouped by role, live balances, and one click to watch its main wallets.
- Exchanges without public labels (ZebPay, Mudrex, Giottus, Unocoin, BuyUcoin, Pi42, Koinbazar, Flitpay, Colodax) are still detected
  whenever an explorer label names them. You can add official addresses to the data file.
- Investigations show "Sent to Indian exchanges", a per-exchange chart, and 🇮🇳 India / ⚠ Exploiters filters.
- TRON labels (much Indian USDT volume runs on TRON) need a free TronScan API key. Not included yet.

### Investigation, alerts and tracing (no sign-in needed)

- **Live flow alerts**: every outgoing transaction is checked the moment it appears:
  - 🏦 **to an exchange**, via public exchange labels, or a **deposit address**, found by looking one hop ahead to see whether the address sweeps funds into an exchange hot wallet
  - 🌉 **to a bridge / another chain**. The destination chain, arrival tx and recipient are resolved through Across, LayerZero and Wormhole, and the recipient is checked for exchange ownership too
  - 🔁 internal exchange movements are recognised and kept low-priority
- **Where did all the money end up?** (runs automatically in Investigate): follows **every dollar** the wallet sent, hop after
  hop and across bridges, until it reaches an end point. You get a 100% breakdown: cashed in at exchanges (with each exchange's
  location), bridged out, swapped on DEXs, into contracts, busy unlabeled services, still held, and not followed (limits). Also a map
  of exchange locations, the route graph (every hop, every wallet), a **hop-by-hop table** (money arriving / ending / passed on per hop),
  and every end point with **Show path**. The biggest money is followed first at any depth; defaults are 10 hops / 150 wallets
  (up to 20 / 500), and **Continue tracing deeper** resumes exactly where the limits stopped. Model: proportional (haircut) taint with
  time ordering. Anything not followed is reported, never dropped. Prices fall back to Coinbase rates if CoinGecko is rate-limited.
- **Live outgoing transfers** on every address page: the moment a wallet sends (including **pending** transactions), a card shows
  the real destination address (token recipients decoded from the call, not the token contract) and verifies it automatically:
  exchange + location, deposit address (1-hop lookahead), bridge → destination chain + recipient (also verified), or private wallet.
- **Automatic exchange checks** in investigations: the biggest unlabeled destinations and bridge recipients are checked without clicking.
- **Locations**: graph nodes show the network (● Ethereum…) and, for exchanges, where the exchange is based (🇮🇳 India, 🇺🇸 United States,
  🌐 Global…). Private wallets have no location. Blockchains don't record where owners are.
- **Explore hop by hop** (inside Investigate): an interactive hop-by-hop graph of where funds went next
  - columns = hops; line thickness = value; moving dots show direction; exchanges 🏦 end a trail, bridges 🌉 continue on the destination chain
  - click a 👛 wallet (or its **+**) to follow the next hop; pan by dragging, zoom with the wheel or the +/−/⤢ buttons
  - **▶ Playback** replays every traced transfer in time order; **● Live** keeps polling traced wallets and adds new transfers as they happen
  - switch to **← Trace sources** to follow money backwards; filter by hops and minimum value; a table view lists every traced transfer
  - spam tokens and address-poisoning lookalikes are kept out of the trail
- **Charts**: balance over time (with crosshair), volume per day/week (received ↑ / sent ↓), where money went / came from by category,
  top destinations and sources, money-flow diagram, and an activity heatmap (weekday × hour, UTC). Every chart has hover tooltips.
  Colors use a colorblind-validated palette in both light and dark themes.
- **Investigate workflow** (`🔎 Investigate` on any address): *Target → Collect → Classify → Money flow → Cross-chain → Report*
  - full history across all EVM networks the wallet uses (native coins and tokens), up to 2,500 transfers per network
  - money-flow diagram (sources → wallet → destinations, colored by exchange / bridge / DEX)
  - totals per asset, counterparties with labels, per-category in/out, timeline
  - cross-chain table of every bridge transfer in or out, including where it landed
  - scam checks: **address-poisoning lookalikes** and **fake tokens** (e.g. an ERC-20 pretending to be ETH)
  - CSV export, save to My workspace
- **Watchlist**: wallets checked every 30 s in the background, with an alert feed, a 🔔 unread badge and browser notifications
- **My workspace**: watchlist, alert feed, custom labels and saved investigations, all kept in your browser

### Interface

- **Sidebar** (Dashboard, Investigate, Exchanges, Indian exchanges, My workspace) with live network status; a bottom tab bar on phones
- **Command palette**: press `Ctrl K` / `⌘ K` or `/` anywhere, paste a wallet or transaction, or type an exchange or page name.
  It shows what the input is (e.g. "Address · 36 networks"), offers to investigate it, and lists recent searches
- **Live price ticker** in the top bar, refreshed every minute
- Dark and light themes follow the system setting

## Run locally

Any static file server works. It must be served over HTTP; opening `index.html` as a file won't work because ES modules need HTTP.

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Deploy (free)

The site is plain static files, with no build step.

| Host | How |
|---|---|
| **GitHub Pages** | Push this folder to a repo → Settings → Pages → Deploy from branch → `main` / root |
| **Netlify** | Drag the folder onto app.netlify.com/drop, or connect the repo (publish directory: `/`) |
| **Vercel** | `npx vercel` in this folder, or import the repo (framework: Other) |
| **Cloudflare Pages** | Connect the repo, build command empty, output directory `/` |

Because every visitor's browser calls the public APIs directly, rate limits apply per visitor, not to your site as a whole.

## Project layout

```
index.html            app shell: sidebar, top bar, ticker, command palette
css/styles.css        component styles
css/theme.css         theme tokens, app shell and home page (dark + light, responsive)
js/shell.js           navigation state, price ticker, command palette
js/app.js             router and pages: dashboard, search, address, tx
js/chains.js          chain registry (add networks here)
js/detect.js          input → candidate chains
js/adapters/*.js      one module per API family, all returning the same shapes
js/entities.js        who's behind an address: exchange / bridge / DEX labels (API tags + curated list)
js/alerts.js          transaction inspection: exchange deposits, deposit-address lookahead, bridge resolution
js/crosschain.js      Across / LayerZero / Wormhole bridge indexers → normalized cross-chain transfers
js/investigate.js     investigation engine: collect → classify → aggregate (+ scam checks, CSV)
js/monitor.js         background watchlist monitor
js/store.js           watchlist, labels, alerts and saved investigations (browser storage)
js/pages/*.js         workspace, Investigate, exchanges and trace pages
js/prices.js          CoinGecko prices (cached)
js/live.js            polling for live views (pauses in background tabs)
js/config.js          optional Etherscan key, refresh intervals
```

### Add a network

1. If an existing adapter fits (Blockscout instance, EVM RPC, Esplora, Blockcypher, …), add one entry to `js/chains.js`.
2. Otherwise write `js/adapters/<name>.js` modeled on an existing one (it must export `getAddress`, `getTxs`, `getTx` and `getStats`), and add its address and tx formats to `js/detect.js`.

### Network coverage for history, alerts and investigations

| Coverage | Networks |
|---|---|
| Full history + public labels (Blockscout) | Ethereum, Base, Arbitrum, OP, Polygon, zkSync, Unichain, Celo, World Chain, Soneium, Ink, Mode, Lisk, Manta, Immutable, Rootstock, Flare, LUKSO, Sepolia |
| Full history (Routescan, keyless) | Avalanche, **Blast**, **Mantle**, **Metis** |
| Recent stablecoin / wrapped-coin transfers read from chain logs (last ~9,000 blocks) | **BNB Chain**, opBNB, Linea, **Gnosis**, **Scroll**, Sonic, Berachain, Cronos, Sei, Taiko, Kava, HyperEVM, Zora |
| Full history (own adapters) | Bitcoin, Litecoin, Dogecoin, Dash, Bitcoin Cash, Solana, TRON, XRP, TON, NEAR, Aptos, Sui, Cosmos |

The watched tokens for the log-based networks are verified on-chain and listed in `js/data/watch-tokens.js`. An Etherscan V2
key (below) upgrades those networks to full history, including native-coin transfers.

### Etherscan V2 key (optional)

Some EVM chains here only have public RPC nodes (BNB Chain, Gnosis, Scroll, Linea, Blast, Mantle, …). On those chains
balances and transaction lookups work, but an address's **transaction history** needs an indexer. Set `ETHERSCAN_API_KEY` in
`js/config.js` (free key from etherscan.io) to enable it. For a public site, put the key behind a small
proxy (for example a Cloudflare Worker) rather than in client code, where anyone can read it.

## Data sources

Blockscout · mempool.space · Blockcypher · Blockchair · Routescan · PublicNode & BNB Chain RPC · TronGrid ·
XRPL Cluster · Toncenter · NEAR RPC & NearBlocks · Aptos Labs · Sui RPC · Cosmos REST · CoinGecko

All data is public blockchain data. Blockchains don't record real names; "identity" means publicly known labels only.

---

Created by **Manikanta**.
