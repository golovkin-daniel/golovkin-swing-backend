const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const MASTER_US_WATCHLIST = require('./watchlist.json');

const app = express();
app.use(cors());
app.use(express.json());

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "dbai6bhr01qo2u5dvbr0dbai6bhr01qo2u5dvbrg";

const EQUITY_FILE = path.join(__dirname, 'equity.json');
const TRADES_FILE = path.join(__dirname, 'trades.json');

// --- Equity Persistence ---
function getAllStoredEquities() {
  try {
    if (fs.existsSync(EQUITY_FILE)) {
      const data = fs.readFileSync(EQUITY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.error("Error reading equity.json:", e);
  }
  return { "default": 10000, "daniel": 41800 };
}

function saveStoredEquity(userId, val) {
  try {
    const equities = getAllStoredEquities();
    equities[userId] = val;
    fs.writeFileSync(EQUITY_FILE, JSON.stringify(equities, null, 2));
    console.log(`[Settings] Equity for user '${userId}' updated: $${val}`);
  } catch (e) {
    console.error("Error writing equity.json:", e);
  }
}

// --- Trade Journal Persistence ---
function getAllStoredTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {
    console.error("Error reading trades.json:", e);
  }
  return {};
}

function saveStoredTrades(userId, tradesList) {
  try {
    const allTrades = getAllStoredTrades();
    allTrades[userId] = tradesList;
    fs.writeFileSync(TRADES_FILE, JSON.stringify(allTrades, null, 2));
    console.log(`[Journal] Saved ${tradesList.length} trades for user '${userId}'.`);
  } catch (e) {
    console.error("Error writing trades.json:", e);
  }
}

let cachedCandidates = [
  {
    ticker: "TSLA",
    name: "Tesla Inc.",
    currentPrice: 215.50,
    dropPct: "-3.5",
    timeframeText: "2 day peak pullback",
    headline: "Scanner active and processing master watchlist...",
    newsUrl: "https://finviz.com/quote.ashx?t=TSLA",
    summary: "Background worker is currently scanning S&P 500 / Nasdaq 100 instruments.",
    entry: 215.50,
    stop: 209.04,
    target: 228.42
  }
];

let lastScanTimestamp = new Date();
let isScanRunning = false;

function getMarketStatus() {
  const now = new Date();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return { isOpen: false, text: "Closed (Weekend)" };

  const timeVal = ((now.getUTCHours() - 5 + 24) % 24) * 60 + now.getUTCMinutes();
  if (timeVal >= 570 && timeVal <= 960) {
    return { isOpen: true, text: "Open (Live)" };
  }
  return { isOpen: false, text: "Closed (After Hours)" };
}

async function runBackgroundMarketScan() {
  if (isScanRunning) return;
  isScanRunning = true;

  console.log(`[Scanner] Starting live incremental scan across ${MASTER_US_WATCHLIST.length} instruments...`);
  const detectedSetbacks = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const fourteenDaysAgoSec = nowSec - (14 * 24 * 60 * 60);

  for (let item of MASTER_US_WATCHLIST) {
    try {
      const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${FINNHUB_API_KEY}`);
      if (!quoteResp.ok) {
        if (quoteResp.status === 429) {
          console.warn(`[Scanner] Rate limit hit (429) for ${item.symbol}. Pausing 5s...`);
          await new Promise(r => setTimeout(r, 5000));
        }
        await new Promise(r => setTimeout(r, 1800));
        continue;
      }
      const quote = await quoteResp.json();

      if (quote && quote.c && quote.c > 0 && quote.pc > 0) {
        const currentPrice = quote.c;
        const prevClose = quote.pc;

        let dropPct = (((currentPrice - prevClose) / prevClose) * 100);
        let timeframeText = "1 day (vs prev close)";

        const candleResp = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${item.symbol}&resolution=D&from=${fourteenDaysAgoSec}&to=${nowSec}&token=${FINNHUB_API_KEY}`);
        const candleData = await candleResp.json();

        if (candleData && candleData.s === 'ok' && Array.isArray(candleData.h) && candleData.h.length > 0) {
          const highs = candleData.h;
          const maxPrice = Math.max(...highs);
          const maxIndex = highs.indexOf(maxPrice);
          const daysAgo = highs.length - 1 - maxIndex;

          const multiDayDrop = (((currentPrice - maxPrice) / maxPrice) * 100);
          if (multiDayDrop < dropPct) {
            dropPct = multiDayDrop;
            timeframeText = daysAgo > 0 ? `${daysAgo} day peak pullback` : "recent session high pullback";
          }
        }

        if (dropPct <= -2.0) {
          console.log(`[Scanner] 🎯 Match found: ${item.symbol} dropped ${dropPct.toFixed(1)}% (Price: $${currentPrice})`);
          let headline = "Market pullback near key technical support level.";
          let newsUrl = `https://finviz.com/quote.ashx?t=${item.symbol}`;
          let summary = "Technical retracement following broader sector volatility with stable fundamental backdrop.";

          try {
            const todayStr = new Date().toISOString().split('T')[0];
            const lastWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const newsResp = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${item.symbol}&from=${lastWeekStr}&to=${todayStr}&token=${FINNHUB_API_KEY}`);
            const news = await newsResp.json();

            if (Array.isArray(news) && news.length > 0) {
              headline = news[0].headline || headline;
              newsUrl = news[0].url || newsUrl;
              summary = news[0].summary || summary;
            }
          } catch (newsErr) {}

          const estimatedStop = currentPrice * 0.97;
          const estimatedTarget = currentPrice + ((currentPrice - estimatedStop) * 2);

          const candidate = {
            ticker: item.symbol,
            name: item.name || item.symbol,
            currentPrice,
            dropPct: dropPct.toFixed(1),
            timeframeText,
            headline,
            newsUrl,
            summary,
            entry: currentPrice,
            stop: estimatedStop,
            target: estimatedTarget
          };

          detectedSetbacks.push(candidate);
          cachedCandidates = [...detectedSetbacks].sort((a, b) => parseFloat(a.dropPct) - parseFloat(b.dropPct));
        }
      }
      
      await new Promise(r => setTimeout(r, 1800));
    } catch (err) {
      console.error(`[Scanner] Error processing ${item.symbol}:`, err.message);
    }
  }

  lastScanTimestamp = new Date();
  isScanRunning = false;
  console.log(`[Scanner] Scan cycle completed across all ${MASTER_US_WATCHLIST.length} instruments. Total active candidates: ${cachedCandidates.length}. Next scan in 5 minutes.`);
  setTimeout(runBackgroundMarketScan, 300000);
}

runBackgroundMarketScan();

// API Endpoints
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

app.get('/api/health', async (req, res) => {
  const symbol = (req.query.symbol || 'AAPL').toUpperCase();
  try {
    const resp = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`);
    const data = await resp.json();
    if (data && data.metric) {
      return res.json({
        success: true,
        symbol,
        metrics: {
          peRatio: data.metric.peNormalizedAnnual || data.metric.peExclExtraTTM || 'N/A',
          week52High: data.metric['52WeekHigh'] || 'N/A',
          week52Low: data.metric['52WeekLow'] || 'N/A',
          dividendYield: data.metric.dividendYieldIndicatedAnnual || 'N/A',
          beta: data.metric.beta || 'N/A',
          roe: data.metric.roeTTM || 'N/A'
        }
      });
    }
    return res.status(404).json({ success: false, error: "Health metrics not available" });
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

app.get('/api/settings', (req, res) => {
  const userId = req.query.userId || 'daniel';
  const equities = getAllStoredEquities();
  const equity = equities[userId] !== undefined ? equities[userId] : 10000;
  res.json({ success: true, settings: { equity, userId } });
});

app.post('/api/settings', (req, res) => {
  const { equity, userId = 'daniel' } = req.body;
  if (equity !== undefined && !isNaN(equity) && Number(equity) > 0) {
    const val = parseFloat(equity);
    saveStoredEquity(userId, val);
    return res.json({ success: true, settings: { equity: val, userId } });
  }
  return res.status(400).json({ success: false, error: "Invalid equity value" });
});

app.get('/api/trades', (req, res) => {
  const userId = req.query.userId || 'daniel';
  const allTrades = getAllStoredTrades();
  const userTrades = allTrades[userId] || [];
  res.json({ success: true, trades: userTrades });
});

app.post('/api/trades', (req, res) => {
  const { userId = 'daniel', trades } = req.body;
  if (Array.isArray(trades)) {
    saveStoredTrades(userId, trades);
    return res.json({ success: true, count: trades.length });
  }
  return res.status(400).json({ success: false, error: "Invalid trades data" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golovkin Swing Backend active on port ${PORT}`));
