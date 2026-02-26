/**
 * AggregationEngine
 * Core order flow calculations:
 * - DOM state management
 * - Time & Sales with aggressor inference
 * - Footprint bars (volume at price, bid/ask vol, delta, imbalance)
 * - CVD (Cumulative Volume Delta)
 * - Tape metrics (speed, large prints, absorption)
 * - Alert engine
 */
const EventEmitter = require('events');

const BAR_INTERVAL_MS = 60000; // 1-minute bars by default
const RING_BUFFER_SIZE = 500;  // Max T&S entries kept in memory
const IMBALANCE_RATIO = 3.0;   // Default imbalance threshold
const LARGE_TRADE_THRESHOLD = 50;
const ABSORPTION_WINDOW_MS = 5000;
const ABSORPTION_PRICE_TOLERANCE = 1; // ticks

class AggregationEngine extends EventEmitter {
  constructor() {
    super();
    this.dom = { bids: [], asks: [], lastUpdate: 0 };
    this.trades = [];         // ring buffer
    this.currentBar = null;
    this.completedBars = [];  // last N bars
    this.cvd = 0;
    this.sessionCvd = 0;
    this.alerts = new Map();
    this.metrics = {
      tapeSpeeds: [],         // timestamps of recent trades for speed calc
      recentPrices: [],       // for absorption detection
    };
    this.lastBid = 0;
    this.lastAsk = 0;
    this._barTimer = null;
    this._metricsTimer = null;
    this._startMetricsLoop();
  }

  // ─── Feed Handlers ───────────────────────────────────────────────────────────

  onTrade(tick) {
    // Ensure aggressor side using bid/ask (tick rule already done by feed)
    const side = tick.side || this._inferSide(tick.price);

    const enriched = {
      ...tick,
      side,
      delta: side === 'buy' ? tick.size : -tick.size
    };

    // Ring buffer
    this.trades.push(enriched);
    if (this.trades.length > RING_BUFFER_SIZE) this.trades.shift();

    // Current bar update
    this._updateBar(enriched);

    // CVD
    this.cvd += enriched.delta;
    this.sessionCvd += enriched.delta;

    // Tape metrics
    this.metrics.tapeSpeeds.push(Date.now());
    this.metrics.recentPrices.push({ price: tick.price, ts: tick.ts, size: tick.size, side });

    // Emit
    this.emit('trade', enriched);
    this.emit('cvd_update', {
      cvd: this.cvd,
      sessionCvd: this.sessionCvd,
      barDelta: this.currentBar ? this.currentBar.delta : 0,
      price: tick.price
    });

    // Check alerts
    this._checkAlerts(enriched);
  }

  onQuote(quote) {
    this.lastBid = quote.bid;
    this.lastAsk = quote.ask;
  }

  onDepth(depth) {
    this.dom = {
      bids: depth.bids.sort((a, b) => b[0] - a[0]),
      asks: depth.asks.sort((a, b) => a[0] - b[0]),
      lastUpdate: depth.ts
    };
    
    // DOM imbalance check
    this._checkDOMImbalance();
    
    this.emit('dom_update', this.dom);
  }

  // ─── Bar Management ──────────────────────────────────────────────────────────

  _ensureBar(ts) {
    const barStart = Math.floor(ts / BAR_INTERVAL_MS) * BAR_INTERVAL_MS;
    if (!this.currentBar || this.currentBar.openTime !== barStart) {
      if (this.currentBar) {
        this.completedBars.push(this.currentBar);
        if (this.completedBars.length > 100) this.completedBars.shift();
        this.emit('footprint_update', { type: 'bar_complete', bar: this.currentBar });
      }
      this.currentBar = {
        openTime: barStart,
        closeTime: barStart + BAR_INTERVAL_MS,
        open: 0, high: 0, low: Infinity, close: 0,
        volume: 0, buyVolume: 0, sellVolume: 0,
        delta: 0,
        poc: 0,           // price of control (highest volume price)
        levels: new Map() // price -> { buyVol, sellVol, delta, trades }
      };
    }
    return this.currentBar;
  }

  _updateBar(tick) {
    const bar = this._ensureBar(tick.ts);
    const { price, size, side, delta } = tick;

    if (!bar.open) bar.open = price;
    bar.close = price;
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.volume += size;
    bar.delta += delta;
    if (side === 'buy') bar.buyVolume += size;
    else bar.sellVolume += size;

    // Per-price level
    const priceKey = price.toFixed(2);
    const level = bar.levels.get(priceKey) || { buyVol: 0, sellVol: 0, delta: 0, trades: 0 };
    if (side === 'buy') level.buyVol += size;
    else level.sellVol += size;
    level.delta += delta;
    level.trades++;
    bar.levels.set(priceKey, level);

    // Update POC
    let maxVol = 0;
    bar.levels.forEach((lvl, p) => {
      const total = lvl.buyVol + lvl.sellVol;
      if (total > maxVol) { maxVol = total; bar.poc = parseFloat(p); }
    });

    // Compute imbalances
    this._computeImbalances(bar);

    this.emit('footprint_update', { type: 'bar_update', bar: this._serializeBar(bar) });
  }

  _computeImbalances(bar) {
    const prices = Array.from(bar.levels.keys()).map(parseFloat).sort((a, b) => a - b);
    bar.imbalances = [];
    for (let i = 0; i < prices.length - 1; i++) {
      const p = prices[i].toFixed(2);
      const pNext = prices[i + 1].toFixed(2);
      const curr = bar.levels.get(p);
      const next = bar.levels.get(pNext);
      if (curr && next) {
        // Ask imbalance: current askVol >> next level bidVol
        if (next.sellVol > 0 && curr.buyVol / next.sellVol >= IMBALANCE_RATIO) {
          bar.imbalances.push({ price: prices[i], type: 'ask_imbalance' });
        }
        if (curr.sellVol > 0 && next.buyVol / curr.sellVol >= IMBALANCE_RATIO) {
          bar.imbalances.push({ price: prices[i + 1], type: 'bid_imbalance' });
        }
      }
    }
  }

  _serializeBar(bar) {
    return {
      ...bar,
      levels: Object.fromEntries(bar.levels)
    };
  }

  // ─── Metrics Loop ─────────────────────────────────────────────────────────────

  _startMetricsLoop() {
    this._metricsTimer = setInterval(() => {
      const now = Date.now();
      const window1s = now - 1000;
      const window5s = now - 5000;

      // Clean old data
      this.metrics.tapeSpeeds = this.metrics.tapeSpeeds.filter(t => t > window5s);
      this.metrics.recentPrices = this.metrics.recentPrices.filter(t => t.ts > window5s - ABSORPTION_WINDOW_MS);

      const speed1s = this.metrics.tapeSpeeds.filter(t => t > window1s).length;
      const speed5s = this.metrics.tapeSpeeds.length / 5;

      // Absorption: many trades at same price with little movement
      const absorption = this._detectAbsorption();

      // DOM pull/stack
      const domMetrics = this._analyzeDOMBalance();

      const metricsPayload = {
        speed1s,
        speed5s: +speed5s.toFixed(1),
        absorption,
        domBalance: domMetrics,
        ts: now
      };

      this.emit('metrics_update', metricsPayload);
    }, 1000);
  }

  _detectAbsorption() {
    const window = this.metrics.recentPrices;
    if (window.length < 5) return null;
    
    const prices = window.map(w => w.price);
    const priceRange = Math.max(...prices) - Math.min(...prices);
    const totalVol = window.reduce((s, w) => s + w.size, 0);
    
    // High volume but tiny price movement = absorption
    if (priceRange <= 2 && totalVol > 200) {
      const sellVol = window.filter(w => w.side === 'sell').reduce((s, w) => s + w.size, 0);
      const buyVol = totalVol - sellVol;
      return {
        detected: true,
        priceRange,
        totalVolume: totalVol,
        buyVol,
        sellVol,
        bias: buyVol > sellVol ? 'buy' : 'sell'
      };
    }
    return { detected: false };
  }

  _analyzeDOMBalance() {
    if (!this.dom.bids.length || !this.dom.asks.length) return null;
    const bidLiq = this.dom.bids.slice(0, 10).reduce((s, b) => s + b[1], 0);
    const askLiq = this.dom.asks.slice(0, 10).reduce((s, a) => s + a[1], 0);
    const ratio = askLiq > 0 ? +(bidLiq / askLiq).toFixed(2) : 0;
    return { bidLiq, askLiq, ratio, bias: ratio > 1.2 ? 'bid_heavy' : ratio < 0.8 ? 'ask_heavy' : 'balanced' };
  }

  _checkDOMImbalance() {
    const metrics = this._analyzeDOMBalance();
    if (!metrics) return;
    if (metrics.ratio >= 2.5 || metrics.ratio <= 0.4) {
      this.emit('alert', {
        type: 'dom_imbalance',
        message: `DOM imbalance: ${metrics.bias} (${metrics.ratio}x)`,
        data: metrics,
        ts: Date.now()
      });
    }
  }

  // ─── Alert Engine ─────────────────────────────────────────────────────────────

  setAlert(alert) {
    this.alerts.set(alert.id, alert);
  }

  removeAlert(id) {
    this.alerts.delete(id);
  }

  _checkAlerts(tick) {
    this.alerts.forEach(alert => {
      if (!alert.enabled) return;
      
      switch (alert.type) {
        case 'large_print':
          if (tick.size >= (alert.threshold || LARGE_TRADE_THRESHOLD)) {
            this.emit('alert', {
              alertId: alert.id,
              type: 'large_print',
              message: `Large ${tick.side} print: ${tick.size} @ ${tick.price}`,
              data: tick,
              ts: Date.now()
            });
          }
          break;

        case 'delta_threshold':
          if (Math.abs(this.cvd) >= (alert.threshold || 500)) {
            this.emit('alert', {
              alertId: alert.id,
              type: 'delta_threshold',
              message: `CVD threshold hit: ${this.cvd.toFixed(0)}`,
              data: { cvd: this.cvd },
              ts: Date.now()
            });
          }
          break;

        case 'tape_speed':
          const speed = this.metrics.tapeSpeeds.filter(t => t > Date.now() - 1000).length;
          if (speed >= (alert.threshold || 20)) {
            this.emit('alert', {
              alertId: alert.id,
              type: 'tape_speed',
              message: `Fast tape: ${speed} prints/sec`,
              data: { speed },
              ts: Date.now()
            });
          }
          break;
      }
    });
  }

  // ─── Side Inference (Tick Rule Fallback) ─────────────────────────────────────

  _inferSide(price) {
    if (this.lastAsk && price >= this.lastAsk) return 'buy';
    if (this.lastBid && price <= this.lastBid) return 'sell';
    // Tick rule: compare to last trade
    if (this.trades.length > 0) {
      const lastPrice = this.trades[this.trades.length - 1].price;
      return price >= lastPrice ? 'buy' : 'sell';
    }
    return Math.random() < 0.5 ? 'buy' : 'sell';
  }

  // ─── Snapshot for new clients ─────────────────────────────────────────────────

  getSnapshot() {
    return {
      dom: this.dom,
      trades: this.trades.slice(-50),
      currentBar: this.currentBar ? this._serializeBar(this.currentBar) : null,
      completedBars: this.completedBars.slice(-20).map(b => this._serializeBar(b)),
      cvd: this.cvd,
      sessionCvd: this.sessionCvd
    };
  }

  resetSession() {
    this.cvd = 0;
    this.sessionCvd = 0;
    this.trades = [];
    this.currentBar = null;
    this.completedBars = [];
  }
}

module.exports = { AggregationEngine, BAR_INTERVAL_MS, IMBALANCE_RATIO, LARGE_TRADE_THRESHOLD };
