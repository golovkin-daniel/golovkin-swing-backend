const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// Import external watchlist file
const MASTER_US_WATCHLIST = require('./watchlist.json');

const app = express();
app.use(cors());
app.use(express.json());

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "dbai6bhr01qo2u5dvbr0dbai6bhr01qo2u5dvbrg";

let cachedCandidates = [];
let lastScanTimestamp = null;
let isScanRunning = false;

// Helper: Check if US Stock Market is Open (NYSE/NASDAQ: 9:30 AM - 4:00 PM ET, Mon-Fri)
function getMarketStatus() {
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0 = Sun, 6 = Sat
  if (utcDay === 0 || utcDay === 6) return { isOpen: false, text: "Closed (Weekend)" };

  const hoursET = (now.getUTCHours() - 5 + 24) % 24;
  const minsET = now.getUTCMinutes();
  const timeVal = hoursET * 60 + minsET;

  if (timeVal >= 570 && timeVal <= 960) {
    return { isOpen: true, text: "Open (Live)" };
  }
  return { isOpen: false, text: "Closed (After Hours)" };
}

async function runBackgroundMarketScan() {
  if (isScanRunning) return;
  isScanRunning = true;

  console.log(`Starting background scan across ${MASTER_US_WATCHLIST.length} instruments from watchlist.json...`);
  const detectedSetbacks = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const fourteenDaysAgoSec = nowSec - (14 * 24 * 60 * 60);

  for (let item of MASTER_US_WATCHLIST) {
    try {
      const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${FINNHUB_API_KEY}`);
      const quote = await quoteResp.json();

      if (quote && quote.c && quote.c > 0) {
        const currentPrice = quote.c;

        const candleResp = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${item.symbol}&resolution=D&from=${fourteenDaysAgoSec}&to=${nowSec}&token=${FINNHUB_API_KEY}`);
        const candleData = await candleResp.json();

        let dropPct = (((currentPrice - quote.pc) / quote.pc) * 100);
        let timeframeText = "1 day";

        if (candleData && candleData.s === 'ok' && candleData.c && candleData.c.length > 1) {
          const closes = candleData.c;
          const maxPrice = Math.max(...closes);
          const maxIndex = closes.indexOf(maxPrice);
          const daysAgo = closes.length - 1 - maxIndex;

          if (maxPrice > currentPrice) {
            dropPct = (((currentPrice - maxPrice) / maxPrice) * 100);
            timeframeText = daysAgo > 0 ? `${daysAgo} day${daysAgo > 1 ? 's' : ''}` : "recent session";
          }
        }

        // Capture dips >= 2.0%
        if (dropPct <= -2.0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const lastWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const newsResp = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${item.symbol}&from=${lastWeekStr}&to=${todayStr}&token=${FINNHUB_API_KEY}`);
          const news = await newsResp.json();

          let headline = "Market pullback near key technical support level.";
          let newsUrl = `https://finviz.com/quote.ashx?t=${item.symbol}`;
          let summary = "Technical retracement following broader sector volatility with stable fundamental backdrop.";

          if (Array.isArray(news) && news.length > 0) {
            headline = news[0].headline || headline;
            newsUrl = news[0].url || newsUrl;
            summary = news[0].summary || summary;
          }

          const estimatedStop = currentPrice * 0.97;
          const estimatedTarget = currentPrice + ((currentPrice - estimatedStop) * 2);

          detectedSetbacks.push({
            ticker: item.symbol,
            name: item.name,
            healthScore: item.healthScore,
            currentPrice,
            dropPct: dropPct.toFixed(1),
            timeframeText,
            headline,
            newsUrl,
            summary,
            entry: currentPrice,
            stop: estimatedStop,
            target: estimatedTarget
          });
        }
      }
      await new Promise(r => setTimeout(r, 1200)); // 1.2s delay to protect rate limits
    } catch (err) {
      console.error(`Error scanning ${item.symbol}:`, err.message);
    }
  }

  cachedCandidates = detectedSetbacks.sort((a, b) => parseFloat(a.dropPct) - parseFloat(b.dropPct));
  lastScanTimestamp = new Date();
  isScanRunning = false;

  console.log(`Scan cycle finished. Found ${cachedCandidates.length} dip setups.`);
  setTimeout(runBackgroundMarketScan, 180000); // Re-scan every 3 minutes
}

// Start background loop
runBackgroundMarketScan();

app.get('/api/quote', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
    const data = await response.json();
    if (data && data.c && data.c > 0) {
      return res.json({ success: true, symbol, currentPrice: data.c, high: data.h, low: data.l, open: data.o, prevClose: data.pc });
    }
    return res.status(404).json({ success: false, error: "Symbol not found" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/setbacks', (req, res) => {
  res.json({
    success: true,
    marketStatus: getMarketStatus(),
    lastScan: lastScanTimestamp,
    totalScanned: MASTER_US_WATCHLIST.length,
    count: cachedCandidates.length,
    candidates: cachedCandidates
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golovkin Swing Backend active on port ${PORT}`));
