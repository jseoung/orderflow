# OrderFlow MVP — System Design

## Overview

A real-time order-flow visualization platform for day traders. Local-only deployment (Node.js backend + React frontend). Designed for 10–50 UI updates/sec with sub-50ms latency from tick ingestion to render.

---

## Architecture

```
[ Data Sources ]
  Simulated Feed  ─┐
  Binance WS Feed  ├──► [ Feed Adapter Layer ]
  Custom WS Feed  ─┘          │
                               ▼
                    [ Aggregation Engine ]
                    ├── Tick ingestion (ring buffer, 10k capacity)
                    ├── DOM builder (level-2 order book)
                    ├── Footprint aggregator (per bar: bid/ask vol at price)
                    ├── CVD calculator (cumulative delta)
                    ├── T&S filter + aggressor inference
                    └── Alert evaluator
                               │
                    [ WebSocket Server (ws://) ]
                    ├── Topic-based fanout (dom, trades, footprint, cvd, alerts)
                    └── REST API (settings, replay, export)
                               │
                    [ React Frontend ]
                    ├── DOM Ladder (virtualized, canvas highlights)
                    ├── Footprint Chart (canvas per bar)
                    ├── Time & Sales (virtualized list, color-coded)
                    ├── CVD/Delta panel (SVG/canvas line chart)
                    ├── Metrics panel (tape speed, large prints, absorption)
                    └── Alert toast system
```

---

## Component Descriptions

### Feed Adapter Layer
- Abstract interface: `IFeedAdapter` with `connect()`, `disconnect()`, `onTrade(cb)`, `onQuote(cb)`, `onDepth(cb)`
- Implementations: `SimulatedFeed`, `BinanceFeed`, `CustomWsFeed`
- Swapping feeds = change one line in config

### Aggregation Engine
- **Ring buffer** for raw ticks (size 10,000, circular overwrite)
- **DOM builder**: maintains sorted bid/ask levels; tracks add/remove/modify for highlight
- **Footprint aggregator**: groups ticks by bar duration (1m/5m/etc), accumulates bid/ask vol per price tick
- **CVD**: running sum of (ask_vol - bid_vol) per trade
- **Alert evaluator**: checks thresholds on every tick batch

### WebSocket Server (Node.js, ws library)
- Single WS endpoint: `ws://localhost:8765`
- Messages are JSON with `{ type, data, ts }` envelope
- Batched dispatch: aggregation engine flushes every 20ms (50hz cap)

### Frontend
- React 18 + TypeScript + Zustand (state) + Vite (build)
- Canvas rendering for DOM ladder changes and footprint bars
- Virtualized list (react-window) for T&S
- Recharts for CVD line chart
- Layout: saved to localStorage, resizable panels (react-resizable-panels)

---

## Data Flow & Latency Budget

```
Raw tick arrives → Feed adapter parses → Ring buffer enqueue   [<1ms]
Ring buffer → Aggregation engine batch                          [<5ms]
Aggregation → WS dispatch (20ms flush interval)                [<20ms]
WS → Frontend receive → Zustand store update                   [<5ms]
Zustand update → React render (batched, RAF-synced)            [<16ms]
──────────────────────────────────────────────────────────────
Total worst case:                                              ~47ms ✓
```

---

## Performance Strategy

1. **Batching**: Aggregation engine collects ticks for 20ms, then emits one WS message per topic
2. **Debouncing**: DOM updates debounced to 50ms to avoid per-keystroke repaints
3. **Canvas rendering**: DOM ladder and footprint bars draw to `<canvas>` directly, bypassing React diffing
4. **Virtualized T&S**: Only renders visible rows (react-window FixedSizeList)
5. **Ring buffer**: O(1) tick ingestion, no GC pressure
6. **Web Workers** (future): Move aggregation engine off main thread

---

## MVP vs Next Iteration

### MVP (this build)
- Simulated feed + Binance WS adapter
- DOM (Level 2), T&S, Footprint, CVD/Delta
- All 4 alert types
- Replay mode (SQLite tick storage + playback)
- CSV export
- Save/load settings + layout

### Next Iteration
- NinjaTrader / Rithmic / Tradovate adapters
- Volume Profile / Market Profile
- Multi-instrument tabs
- Session statistics (VWAP bands, POC)
- Heatmap DOM view
- Cloud sync / multi-device
- P&L overlay

---

## Security & Disclaimer

**DISCLAIMER**: This tool is for market visualization and analysis only. It does not provide financial advice, trading signals, or recommendations. All trading involves risk. Past data patterns do not guarantee future results.
