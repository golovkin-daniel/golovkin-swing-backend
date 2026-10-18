const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "dbai6bhr01qo2u5dvbr0dbai6bhr01qo2u5dvbrg";

// Expanded Watchlist: Core S&P 500 & Nasdaq 100 Leaders
const SP500_NASDAQ_WATCHLIST = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "BRK.B", name: "Berkshire Hathaway" },
  { symbol: "LLY", name: "Eli Lilly & Co." },
  { symbol: "AVGO", name: "Broadcom Inc." },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "UNH", name: "UnitedHealth Group" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "PG", name: "Procter & Gamble" },
  { symbol: "HD", name: "Home Depot" },
  { symbol: "COST", name: "Costco Wholesale" },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "ABBV", name: "AbbVie Inc." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "BAC", name: "Bank of America" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" }
];

// Helper delay to respect Finnhub API rate limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

app.get('/api/setbacks', async (req, res) => {
  try {
    const results = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const fourteenDaysAgoSec = nowSec - (14 * 24 * 60 * 60);

    // Process in small batches to respect rate limits
    for (let item of SP500_NASDAQ_WATCHLIST) {
      try {
        const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${FINNHUB_API_KEY}`);
        const quote = await quoteResp.json();

        if (quote && quote.c && quote.c > 0) {
          const currentPrice = quote.c;

          // Fetch historical candles for multi-day drop percentage
          const candleResp = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${item.symbol}&resolution=D&from=${fourteenDaysAgoSec}&to=${nowSec}&token=${FINNHUB_API_KEY}`);
          const candleData = await candleResp.json();

          let dropPct = (((currentPrice - quote.pc) / quote.pc) * 100).toFixed(1);
          let timeframeText = "1 day (session drop)";

          if (candleData && candleData.s === 'ok' && candleData.c && candleData.c.length > 1) {
            const closes = candleData.c;
            const maxPrice = Math.max(...closes);
            const maxIndex = closes.indexOf(maxPrice);
            const daysAgo = closes.length - 1 - maxIndex;

            if (maxPrice > currentPrice) {
              dropPct = (((currentPrice - maxPrice) / maxPrice) * 100).toFixed(1);
              timeframeText = daysAgo > 0 ? `${daysAgo} day${daysAgo > 1 ? 's' : ''}` : "recent session";
            }
          }

          // Fetch news headline
          const todayStr = new Date().toISOString().split('T')[0];
          const lastWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const newsResp = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${item.symbol}&from=${lastWeekStr}&to=${todayStr}&token=${FINNHUB_API_KEY}`);
          const news = await newsResp.json();

          let dropReason = "Market pullback near key technical support level.";
          if (Array.isArray(news) && news.length > 0) {
            dropReason = `Headline: "${news[0].headline?.substring(0, 85)}..."`;
          }

          const estimatedStop = currentPrice * 0.97;
          const estimatedTarget = currentPrice + ((currentPrice - estimatedStop) * 2);

          results.push({
            ticker: item.symbol,
            name: item.name,
            currentPrice,
            dropPct,
            timeframeText,
            dropReason,
            entry: currentPrice,
            stop: estimatedStop,
            target: estimatedTarget
          });
        }
        await sleep(100); // 100ms pause between tickers to prevent rate-limit throttling
      } catch (err) {
        console.error(`Error scanning ${item.symbol}:`, err);
      }
    }

    res.json({ success: true, timestamp: new Date(), count: results.length, candidates: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golovkin Swing Backend running on port ${PORT}`));
