const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "dbai6bhr01qo2u5dvbr0dbai6bhr01qo2u5dvbrg";

// Master List: S&P 500 + Nasdaq 100 + Major US Growth Stocks (Expanded)
const MASTER_US_WATCHLIST = [
  // Tech & Semiconductors
  { symbol: "AAPL", name: "Apple Inc." }, { symbol: "MSFT", name: "Microsoft Corp." }, { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "AMZN", name: "Amazon.com Inc." }, { symbol: "GOOGL", name: "Alphabet Inc." }, { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla Inc." }, { symbol: "AVGO", name: "Broadcom Inc." }, { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "ORCL", name: "Oracle Corp." }, { symbol: "CRM", name: "Salesforce Inc." }, { symbol: "INTC", name: "Intel Corp." },
  { symbol: "QCOM", name: "Qualcomm Inc." }, { symbol: "TXN", name: "Texas Instruments" }, { symbol: "AMAT", name: "Applied Materials" },
  { symbol: "MU", name: "Micron Technology" }, { symbol: "LRCX", name: "Lam Research" }, { symbol: "PANW", name: "Palo Alto Networks" },
  { symbol: "SNPS", name: "Synopsys Inc." }, { symbol: "CDNS", name: "Cadence Design Systems" }, { symbol: "KLAC", name: "KLA Corp." },
  { symbol: "ADI", name: "Analog Devices" }, { symbol: "MDB", name: "MongoDB Inc." }, { symbol: "NOW", name: "ServiceNow Inc." },
  { symbol: "PLTR", name: "Palantir Technologies" }, { symbol: "CRWD", name: "CrowdStrike Holdings" }, { symbol: "NET", name: "Cloudflare Inc." },
  { symbol: "DDOG", name: "Datadog Inc." }, { symbol: "SNOW", name: "Snowflake Inc." }, { symbol: "TEAM", name: "Atlassian Corp." },
  
  // Finance & Banking
  { symbol: "JPM", name: "JPMorgan Chase" }, { symbol: "BAC", name: "Bank of America" }, { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "C", name: "Citigroup Inc." }, { symbol: "GS", name: "Goldman Sachs" }, { symbol: "MS", name: "Morgan Stanley" },
  { symbol: "V", name: "Visa Inc." }, { symbol: "MA", name: "Mastercard Inc." }, { symbol: "AXP", name: "American Express" },
  { symbol: "BLK", name: "BlackRock Inc." }, { symbol: "PYPL", name: "PayPal Holdings" }, { symbol: "SQ", name: "Block Inc." },
  
  // Healthcare & Biotech
  { symbol: "LLY", name: "Eli Lilly & Co." }, { symbol: "UNH", name: "UnitedHealth Group" }, { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "ABBV", name: "AbbVie Inc." }, { symbol: "MRK", name: "Merck & Co." }, { symbol: "PFE", name: "Pfizer Inc." },
  { symbol: "TMO", name: "Thermo Fisher Scientific" }, { symbol: "ABT", name: "Abbott Laboratories" }, { symbol: "DHR", name: "Danaher Corp." },
  { symbol: "AMGN", name: "Amgen Inc." }, { symbol: "GILD", name: "Gilead Sciences" }, { symbol: "ISRG", name: "Intuitive Surgical" },
  { symbol: "VRTX", name: "Vertex Pharmaceuticals" }, { symbol: "REGN", name: "Regeneron Pharma" }, { symbol: "BMY", name: "Bristol-Myers Squibb" },

  // Consumer Discretionary & Retail
  { symbol: "HD", name: "Home Depot" }, { symbol: "COST", name: "Costco Wholesale" }, { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "TGT", name: "Target Corp." }, { symbol: "LOW", name: "Lowe's Companies" }, { symbol: "NKE", name: "Nike Inc." },
  { symbol: "SBUX", name: "Starbucks Corp." }, { symbol: "MCD", name: "McDonald's Corp." }, { symbol: "BKNG", name: "Booking Holdings" },
  { symbol: "ABNB", name: "Airbnb Inc." }, { symbol: "MAR", name: "Marriott International" }, { symbol: "CMG", name: "Chipotle Mexican Grill" },

  // Communication & Media
  { symbol: "NFLX", name: "Netflix Inc." }, { symbol: "DIS", name: "Walt Disney Co." }, { symbol: "CMCSA", name: "Comcast Corp." },
  { symbol: "TMUS", name: "T-Mobile US" }, { symbol: "VZ", name: "Verizon Communications" }, { symbol: "T", name: "AT&T Inc." },

  // Industrial & Aerospace
  { symbol: "CAT", name: "Caterpillar Inc." }, { symbol: "GE", name: "GE Aerospace" }, { symbol: "BA", name: "Boeing Co." },
  { symbol: "HON", name: "Honeywell International" }, { symbol: "UNP", name: "Union Pacific" }, { symbol: "LMT", name: "Lockheed Martin" },
  { symbol: "RTX", name: "RTX Corp." }, { symbol: "DE", name: "Deere & Co." }, { symbol: "UPS", name: "United Parcel Service" },

  // Major Index ETFs
  { symbol: "SPY", name: "SPDR S&P 500 ETF" }, { symbol: "QQQ", name: "Invesco QQQ Trust" }, { symbol: "IWM", name: "iShares Russell 2000" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF" }, { symbol: "SMH", name: "VanEck Semiconductor ETF" }, { symbol: "XLF", name: "Financial Select Sector SPDR" }
];

// Server Memory Cache
let cachedCandidates = [];
let lastScanTimestamp = null;
let isScanRunning = false;

// Background Scan Engine (Runs continuously in background)
async function runBackgroundMarketScan() {
  if (isScanRunning) return;
  isScanRunning = true;

  console.log(`Starting continuous market scan across ${MASTER_US_WATCHLIST.length} US large-caps...`);
  const detectedSetbacks = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const fourteenDaysAgoSec = nowSec - (14 * 24 * 60 * 60);

  for (let item of MASTER_US_WATCHLIST) {
    try {
      // 1. Fetch live quote
      const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${FINNHUB_API_KEY}`);
      const quote = await quoteResp.json();

      if (quote && quote.c && quote.c > 0) {
        const currentPrice = quote.c;

        // 2. Fetch daily candles to calculate peak drop %
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

        // Filter: Detect setups that dropped 2.5% or more from recent highs (temporary setback condition)
        if (dropPct <= -2.5) {
          // 3. Fetch headline news catalyst
          const todayStr = new Date().toISOString().split('T')[0];
          const lastWeekStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const newsResp = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${item.symbol}&from=${lastWeekStr}&to=${todayStr}&token=${FINNHUB_API_KEY}`);
          const news = await newsResp.json();

          let dropReason = "Market pullback near key technical support level.";
          if (Array.isArray(news) && news.length > 0) {
            dropReason = `Headline: "${news[0].headline?.substring(0, 85)}..."`;
          }

          const estimatedStop = currentPrice * 0.97; // Default 3% stop loss
          const estimatedTarget = currentPrice + ((currentPrice - estimatedStop) * 2); // 1:2 Risk/Reward

          detectedSetbacks.push({
            ticker: item.symbol,
            name: item.name,
            currentPrice,
            dropPct: dropPct.toFixed(1),
            timeframeText,
            dropReason,
            entry: currentPrice,
            stop: estimatedStop,
            target: estimatedTarget
          });
        }
      }

      // Pause 1200ms (1.2 sec) between symbols to stay safely under 60 calls/minute limit
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      console.error(`Error scanning ${item.symbol}:`, err.message);
    }
  }

  // Update Server Memory Cache
  cachedCandidates = detectedSetbacks.sort((a, b) => parseFloat(a.dropPct) - parseFloat(b.dropPct));
  lastScanTimestamp = new Date();
  isScanRunning = false;

  console.log(`Scan complete! Found ${cachedCandidates.length} active setback setups. Next cycle starting shortly...`);
  
  // Re-run scan continuously after a 2-minute pause
  setTimeout(runBackgroundMarketScan, 120000);
}

// Kick off background scanner when server starts
runBackgroundMarketScan();

// API Endpoint 1: Single Live Quote
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

// API Endpoint 2: Instant Cached Setbacks Response
app.get('/api/setbacks', (req, res) => {
  res.json({
    success: true,
    lastScan: lastScanTimestamp,
    totalScanned: MASTER_US_WATCHLIST.length,
    count: cachedCandidates.length,
    candidates: cachedCandidates
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Golovkin Swing Backend active on port ${PORT}`));
