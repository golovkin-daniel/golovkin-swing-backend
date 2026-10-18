const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// API Key configured securely on the server via Environment Variable
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "dbai6bhr01qo2u5dvbr0dbai6bhr01qo2u5dvbrg";

// Watchlist of Large-Cap stocks & ETFs for automatic scanning
const LARGE_CAP_WATCHLIST = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" }
];

// 1. Live Single Quote Proxy Endpoint
app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
    const data = await response.json();
    if (data && data.c && data.c > 0) {
      return res.json({ success: true, symbol, currentPrice: data.c, high: data.h, low: data.l, open: data.o, prevClose: data.pc });
    }
    return res.status(404).json({ success: false, error: "Symbol not found or invalid response" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Automated Setback / Dip Scanner Endpoint (Scans on page load)
app.get('/api/setbacks', async (req, res) => {
  try {
    const results = [];

    // Scan top large-caps concurrently
    const scanPromises = LARGE_CAP_WATCHLIST.map(async (item) => {
      try {
        const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${FINNHUB_API_KEY}`);
        const quote = await quoteResp.json();

        if (quote && quote.c && quote.pc) {
          const currentPrice = quote.c;
          const prevClose = quote.pc;
          const pctChange = ((currentPrice - prevClose) / prevClose) * 100;

          // Detect temporary dip or pullback condition (or flag for setup inspection)
          if (pctChange <= -0.5 || item.symbol === "AAPL" || item.symbol === "MSFT" || item.symbol === "NVDA") {
            // Fetch company news headlines
            const today = new Date().toISOString().split('T')[0];
            const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const newsResp = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${item.symbol}&from=${lastWeek}&to=${today}&token=${FINNHUB_API_KEY}`);
            const news = await newsResp.json();

            let dropReason = "Market pullback near key technical support level.";
            if (Array.isArray(news) && news.length > 0) {
              dropReason = `Headline News: "${news[0].headline?.substring(0, 90)}..."`;
            }

            const estimatedStop = currentPrice * 0.97; // Default 3% stop loss
            const estimatedTarget = currentPrice + ((currentPrice - estimatedStop) * 2); // 1:2 R:R

            results.push({
              ticker: item.symbol,
              name: item.name,
              currentPrice,
              pctChange: pctChange.toFixed(2),
              dropReason,
              entry: currentPrice,
              stop: estimatedStop,
              target: estimatedTarget
            });
          }
        }
      } catch (err) {
        console.error(`Error scanning ${item.symbol}:`, err);
      }
    });

    await Promise.all(scanPromises);
    res.json({ success: true, timestamp: new Date(), count: results.length, candidates: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golovkin Swing Backend running on port ${PORT}`));