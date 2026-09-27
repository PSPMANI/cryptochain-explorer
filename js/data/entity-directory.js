// International exchanges and other named entities CryptChain recognizes.
// Used by the app (names, categories, locations) and by scripts/global-labels.mjs (which collects their labeled wallets).
// [search term, canonical name, category, country]  country = HQ / main regulator; GLOBAL = offshore / multi-entity
export const ENTITIES = [
  // exchanges
  ['Binance', 'Binance', 'exchange', 'GLOBAL'], ['Coinbase', 'Coinbase', 'exchange', 'US'], ['Kraken', 'Kraken', 'exchange', 'US'],
  ['OKX', 'OKX', 'exchange', 'GLOBAL'], ['OKEx', 'OKX', 'exchange', 'GLOBAL'], ['Bybit', 'Bybit', 'exchange', 'AE'],
  ['Bitfinex', 'Bitfinex', 'exchange', 'GLOBAL'], ['KuCoin', 'KuCoin', 'exchange', 'GLOBAL'], ['Gate.io', 'Gate', 'exchange', 'GLOBAL'],
  ['Gate', 'Gate', 'exchange', 'GLOBAL'], ['HTX', 'HTX', 'exchange', 'GLOBAL'], ['Huobi', 'HTX', 'exchange', 'GLOBAL'],
  ['Gemini', 'Gemini', 'exchange', 'US'], ['Crypto.com', 'Crypto.com', 'exchange', 'SG'], ['Bitstamp', 'Bitstamp', 'exchange', 'LU'],
  ['Upbit', 'Upbit', 'exchange', 'KR'], ['Bithumb', 'Bithumb', 'exchange', 'KR'], ['Korbit', 'Korbit', 'exchange', 'KR'], ['Coinone', 'Coinone', 'exchange', 'KR'],
  ['MEXC', 'MEXC', 'exchange', 'GLOBAL'], ['Bitget', 'Bitget', 'exchange', 'GLOBAL'], ['Robinhood', 'Robinhood', 'exchange', 'US'],
  ['Bitvavo', 'Bitvavo', 'exchange', 'NL'], ['Revolut', 'Revolut', 'exchange', 'GB'], ['bitFlyer', 'bitFlyer', 'exchange', 'JP'],
  ['Coincheck', 'Coincheck', 'exchange', 'JP'], ['Bitbank', 'bitbank', 'exchange', 'JP'], ['Zaif', 'Zaif', 'exchange', 'JP'],
  ['Poloniex', 'Poloniex', 'exchange', 'GLOBAL'], ['HitBTC', 'HitBTC', 'exchange', 'GLOBAL'], ['Deribit', 'Deribit', 'exchange', 'GLOBAL'],
  ['WhiteBIT', 'WhiteBIT', 'exchange', 'GLOBAL'], ['BingX', 'BingX', 'exchange', 'GLOBAL'], ['LBank', 'LBank', 'exchange', 'GLOBAL'],
  ['BitMart', 'BitMart', 'exchange', 'GLOBAL'], ['Phemex', 'Phemex', 'exchange', 'GLOBAL'], ['CoinEx', 'CoinEx', 'exchange', 'GLOBAL'],
  ['BitMEX', 'BitMEX', 'exchange', 'GLOBAL'], ['Bullish', 'Bullish', 'exchange', 'GLOBAL'], ['Bitso', 'Bitso', 'exchange', 'MX'],
  ['Mercado Bitcoin', 'Mercado Bitcoin', 'exchange', 'BR'], ['Luno', 'Luno', 'exchange', 'GB'], ['BtcTurk', 'BtcTurk', 'exchange', 'TR'],
  ['Paribu', 'Paribu', 'exchange', 'TR'], ['Indodax', 'Indodax', 'exchange', 'ID'], ['Tokocrypto', 'Tokocrypto', 'exchange', 'ID'],
  ['Bitpanda', 'Bitpanda', 'exchange', 'AT'], ['Uphold', 'Uphold', 'exchange', 'US'], ['CEX.IO', 'CEX.IO', 'exchange', 'GB'],
  ['EXMO', 'EXMO', 'exchange', 'GB'], ['BitoPro', 'BitoPro', 'exchange', 'TW'], ['MAX Exchange', 'MAX', 'exchange', 'TW'],
  ['Swissquote', 'Swissquote', 'exchange', 'CH'], ['Binance US', 'Binance.US', 'exchange', 'US'], ['Backpack', 'Backpack', 'exchange', 'GLOBAL'],
  ['Bitkub', 'Bitkub', 'exchange', 'TH'], ['Independent Reserve', 'Independent Reserve', 'exchange', 'AU'], ['BTC Markets', 'BTC Markets', 'exchange', 'AU'],
  ['Bitazza', 'Bitazza', 'exchange', 'TH'], ['Rain', 'Rain', 'exchange', 'BH'], ['BitoEX', 'BitoEX', 'exchange', 'TW'], ['ProBit', 'ProBit', 'exchange', 'KR'],
  ['XT.com', 'XT.com', 'exchange', 'GLOBAL'], ['AscendEX', 'AscendEX', 'exchange', 'GLOBAL'], ['Bitrue', 'Bitrue', 'exchange', 'GLOBAL'],
  ['Hotcoin', 'Hotcoin', 'exchange', 'GLOBAL'], ['Toobit', 'Toobit', 'exchange', 'GLOBAL'], ['BloFin', 'BloFin', 'exchange', 'GLOBAL'],
  // market makers / trading firms
  ['Wintermute', 'Wintermute', 'fund', 'GB'], ['Jump Trading', 'Jump Trading', 'fund', 'US'], ['Cumberland', 'Cumberland', 'fund', 'US'],
  ['GSR', 'GSR', 'fund', 'GLOBAL'], ['Amber Group', 'Amber Group', 'fund', 'SG'], ['DWF Labs', 'DWF Labs', 'fund', 'GLOBAL'],
  ['Galaxy Digital', 'Galaxy Digital', 'fund', 'US'], ['B2C2', 'B2C2', 'fund', 'GB'], ['Flow Traders', 'Flow Traders', 'fund', 'NL'],
  ['Alameda Research', 'Alameda Research', 'fund', 'GLOBAL'], ['Three Arrows', 'Three Arrows Capital', 'fund', 'GLOBAL'],
  // custodians
  ['BitGo', 'BitGo', 'custodian', 'US'], ['Anchorage', 'Anchorage Digital', 'custodian', 'US'], ['Copper', 'Copper', 'custodian', 'GB'],
  ['Coinbase Custody', 'Coinbase Custody', 'custodian', 'US'], ['Coinbase Prime', 'Coinbase Prime', 'custodian', 'US'], ['Ceffu', 'Ceffu', 'custodian', 'GLOBAL'],
  // stablecoin issuers
  ['Tether', 'Tether', 'issuer', 'GLOBAL'], ['Circle', 'Circle', 'issuer', 'US'], ['Paxos', 'Paxos', 'issuer', 'US'],
];
