# ⚡ OrderFlow MVP — Order Flow Visualization Tool

> **Disclaimer**: This tool is for visualization and analysis purposes only. It is not financial advice. All trading decisions are solely your responsibility.

---

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm 9+

### 1. Start the Backend
```bash
cd backend
npm install
npm start
# Backend runs on http://localhost:3001
# WebSocket on ws://localhost:3001
```

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
# UI available at http://localhost:3000
```

The simulated feed starts automatically. You'll see live DOM, footprint, T&S, and CVD within seconds.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (React UI)                      │
│  DOM Ladder │ Time&Sales │ Footprint │ CVD/Delta │ Alerts    │
└─────────────────────┬────────────────────┬──────────────────┘
                      │ WebSocket          │ REST
┌─────────────────────▼────────────────────▼──────────────────┐
│                    Node.js Backend                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  FeedManager │  │  Aggr.Engine │  │  ReplayEngine   │   │
│  │  (Data Layer)│→ │  (Calcs)     │  │  (Playback)     │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           SQLite Database (ticks + settings)          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. Feed (simulated/broker) emits normalized `trade`, `quote`, `depth` events
2. `AggregationEngine` processes each tick in real-time:
   - Infers aggressor side (bid/ask comparison, tick rule fallback)
   - Updates DOM state
   - Aggregates into footprint bars (per-price volume, delta, imbalances)
   - Computes CVD (cumulative volume delta)
   - Measures tape metrics (speed, absorption, large prints)
   - Fires alerts on thresholds
3. All output is broadcast via WebSocket to all connected clients
4. React store (`zustand`) applies batched updates via `requestAnimationFrame`

### Performance Strategy
- Trades batched via `requestAnimationFrame` to avoid UI jank
- DOM updates debounced (200ms intervals from feed)
- Ring buffers limit memory (500 trades in memory, infinite in SQLite)
- `isAnimationActive={false}` on all Recharts lines
- Virtualization-ready list structure for T&S

---

## Connecting a Real Data Feed

Add your feed in `backend/src/feed/`:

```javascript
// backend/src/feed/YourFeed.js
const EventEmitter = require('events');

class YourFeed extends EventEmitter {
  constructor(symbol) { super(); this.symbol = symbol; this.running = false; }
  
  start() {
    this.running = true;
    // Connect to your broker WS here
    // On trade: this.emit('trade', { id, symbol, price, size, side:'buy'|'sell', bid, ask, ts })
    // On depth: this.emit('depth', { symbol, bids:[[price,size],...], asks:[[price,size],...], ts })
    // On quote: this.emit('quote', { bid, ask })
  }
  stop() { this.running = false; }
}
module.exports = { YourFeed };
```

Then wire it in `FeedManager.js`:
```javascript
startYourBroker(symbol) {
  const { YourFeed } = require('./YourFeed');
  this.activeFeed = new YourFeed(symbol);
  this._attachFeed(this.activeFeed);
  this.activeFeed.start();
}
```

And call from the frontend or REST:
```
POST /api/feed/start  { "type": "yourbroker", "symbol": "ES" }
```

---

## Replay Mode

1. Run the simulated feed for a while to record ticks in SQLite
2. Stop the live feed
3. Use the Replay controls in the UI:
   - Pick a start time
   - Choose playback speed (0.5x–10x)
   - Click "▶ Replay"

Or via REST:
```bash
# Load ticks for ES from last hour
curl -X POST http://localhost:3001/api/replay/load \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ES","fromTs":1700000000000,"toTs":1700003600000}'

# Play at 2x speed
curl -X POST http://localhost:3001/api/replay/play -d '{"speed":2}'
```

---

## Export

```bash
# Download ticks as CSV
curl "http://localhost:3001/api/export/ticks?symbol=ES" -o es_ticks.csv
```
Or click **Export CSV** in the status bar.

---

## REST API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + feed status |
| POST | `/api/feed/start` | Start feed `{type, symbol}` |
| POST | `/api/feed/stop` | Stop feed |
| GET | `/api/feed/status` | Feed status |
| POST | `/api/replay/load` | Load ticks `{symbol, fromTs, toTs}` |
| POST | `/api/replay/play` | Start replay `{speed}` |
| POST | `/api/replay/pause` | Pause replay |
| POST | `/api/replay/stop` | Stop replay |
| GET | `/api/replay/status` | Replay progress |
| GET | `/api/export/ticks?symbol=&fromTs=&toTs=` | CSV export |
| GET | `/api/snapshot` | Current engine state |
| GET/POST | `/api/settings` | App settings |
| GET/POST/DELETE | `/api/alerts` | Alert configs |

---

## WebSocket Message Types

```typescript
// Backend → Frontend
{ type: 'snapshot', data: Snapshot }          // On connect
{ type: 'dom_update', data: DomState }         // Every DOM refresh
{ type: 'trade', data: Tick }                  // Every trade
{ type: 'footprint_update', data: { type, bar } } // Bar updates
{ type: 'cvd_update', data: CvdUpdate }        // Every trade
{ type: 'metrics_update', data: MetricsUpdate } // Every 1s
{ type: 'alert', data: Alert }                 // When triggered
{ type: 'pong', ts: number }                   // Heartbeat response

// Frontend → Backend
{ type: 'ping' }                               // Heartbeat
{ type: 'set_alert', data: AlertConfig }        // Add alert
{ type: 'remove_alert', data: { id } }          // Remove alert
```

---

## Order Flow Calculations

### Aggressor Side Inference
1. **Bid/Ask rule**: If `price >= ask` → buy; if `price <= bid` → sell
2. **Tick rule fallback**: If `price > lastTrade.price` → buy; else sell

### Delta
`delta = buyVolume - sellVolume`

### CVD (Cumulative Volume Delta)
`cvd += delta` for every trade. Resets on session reset or replay.

### Footprint Imbalance
At adjacent price levels A (lower) and B (higher):
- **Ask imbalance**: `B.buyVol / A.sellVol >= ratio` (aggression through the ask)  
- **Bid imbalance**: `A.sellVol / B.buyVol >= ratio` (aggression through the bid)
- Default ratio: 3:1

### Absorption Proxy
Heuristic: within a 5-second window, if `priceRange <= 2 ticks` but `totalVolume > 200 contracts` → absorption detected.

---

## Project Structure

```
orderflow/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express + WS server
│   │   ├── feed/
│   │   │   ├── FeedManager.js     # Data abstraction layer
│   │   │   └── SimulatedFeed.js   # Realistic sim data generator
│   │   ├── engine/
│   │   │   ├── AggregationEngine.js # Core calculations
│   │   │   └── ReplayEngine.js    # Tick playback
│   │   ├── api/
│   │   │   └── routes.js          # REST endpoints
│   │   └── utils/
│   │       └── Database.js        # SQLite layer
│   ├── tests/
│   │   └── calculations.test.js   # Unit tests (10 tests)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # Layout + Controls
│   │   ├── styles.css             # Dark terminal theme
│   │   ├── types/index.ts         # All TypeScript types
│   │   ├── store/
│   │   │   └── useOrderFlowStore.ts # Zustand global state
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts    # WS connection + dispatch
│   │   └── components/
│   │       ├── dom/DomLadder.tsx       # Level 2 DOM
│   │       ├── timesales/TimeSales.tsx  # T&S prints list
│   │       ├── footprint/FootprintChart.tsx # Volume at price
│   │       ├── delta/CvdPanel.tsx      # CVD + metrics
│   │       ├── alerts/AlertsPanel.tsx  # Alerts + config
│   │       └── layout/StatusBar.tsx    # Connection + export
│   └── package.json
└── README.md
```

---

## Running Tests
```bash
cd backend && npm test
```
10 unit tests covering: side inference, delta accumulation, CVD, bar aggregation, POC, imbalance detection, DOM balance analysis.

---

## Next Iteration Roadmap
- [ ] VWAP and Session Profile (volume profile by price)
- [ ] Canvas/WebGL renderer for footprint (for dense data)
- [ ] Real broker connectors (Binance, Tradovate, Rithmic)
- [ ] Multi-symbol / multi-chart layouts (drag/resize panels)
- [ ] Historical footprint scrolling
- [ ] Sound alerts
- [ ] Heatmap DOM visualization
- [ ] Per-session P&L tracker
