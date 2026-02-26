'use strict';
const { v4: uuidv4 } = require('uuid');

// ============================================================
// AGGRESSOR SIDE INFERENCE
// Tick rule fallback when bid/ask not provided
// ============================================================
function inferSide(price, prevPrice, bidPrice, askPrice) {
  if (bidPrice !== undefined && askPrice !== undefined) {
    if (price >= askPrice) return 'buy';
    if (price <= bidPrice) return 'sell';
  }
  // Tick rule fallback
  if (prevPrice !== undefined) {
    if (price > prevPrice) return 'buy';
    if (price < prevPrice) return 'sell';
  }
  return 'unknown';
}

// ============================================================
// DOM BUILDER
// ============================================================
class DomBuilder {
  constructor(levels = 50) {
    this.maxLevels = levels;
    this.bids = new Map(); // price -> size
    this.asks = new Map();
    this.prevBids = new Map();
    this.prevAsks = new Map();
  }

  update(bids, asks) {
    // bids/asks: array of [price, size]
    this.prevBids = new Map(this.bids);
    this.prevAsks = new Map(this.asks);

    this.bids.clear();
    this.asks.clear();

    for (const [price, size] of bids) {
      if (size > 0) this.bids.set(price, size);
    }
    for (const [price, size] of asks) {
      if (size > 0) this.asks.set(price, size);
    }
  }

  snapshot() {
    const buildLevels = (cur, prev, side) => {
      const entries = [...cur.entries()]
        .sort((a, b) => side === 'bid' ? b[0] - a[0] : a[0] - b[0])
        .slice(0, this.maxLevels);

      return entries.map(([price, size]) => {
        const prevSize = prev.get(price);
        let change = 'unchanged';
        if (prevSize === undefined) change = 'added';
        else if (size > prevSize) change = 'modified';
        else if (size < prevSize) change = 'modified';
        return { price, size, side, change, prevSize: prevSize ?? null };
      });
    };

    const bids = buildLevels(this.bids, this.prevBids, 'bid');
    const asks = buildLevels(this.asks, this.prevAsks, 'ask');

    // Stacked/pulled heuristics
    const largeThreshold = this._calcLargeThreshold();
    const stackedBids = bids.filter(l => l.size >= largeThreshold && l.change !== 'removed');
    const stackedAsks = asks.filter(l => l.size >= largeThreshold && l.change !== 'removed');
    const pulledBids = [...this.prevBids.entries()]
      .filter(([p, s]) => s >= largeThreshold && !this.bids.has(p))
      .map(([price, size]) => ({ price, size, side: 'bid', change: 'removed' }));
    const pulledAsks = [...this.prevAsks.entries()]
      .filter(([p, s]) => s >= largeThreshold && !this.asks.has(p))
      .map(([price, size]) => ({ price, size, side: 'ask', change: 'removed' }));

    return {
      bids,
      asks,
      stackedBids,
      stackedAsks,
      pulledBids,
      pulledAsks,
      bestBid: bids[0]?.price ?? null,
      bestAsk: asks[0]?.price ?? null,
      spread: bids[0] && asks[0] ? asks[0].price - bids[0].price : null
    };
  }

  _calcLargeThreshold() {
    const allSizes = [...this.bids.values(), ...this.asks.values()];
    if (allSizes.length === 0) return 100;
    const mean = allSizes.reduce((a, b) => a + b, 0) / allSizes.length;
    return mean * 3; // 3x average = "large"
  }
}

// ============================================================
// FOOTPRINT AGGREGATOR
// ============================================================
class FootprintAggregator {
  constructor(barDurationMs = 60000, tickSize = 0.25, imbalanceRatio = 3.0) {
    this.barDurationMs = barDurationMs;
    this.tickSize = tickSize;
    this.imbalanceRatio = imbalanceRatio;
    this.currentBar = null;
    this.completedBars = [];
    this.maxBars = 100;
  }

  _newBar(ts, price) {
    const barOpen = Math.floor(ts / this.barDurationMs) * this.barDurationMs;
    return {
      openTs: barOpen,
      closeTs: barOpen + this.barDurationMs,
      open: price,
      high: price,
      low: price,
      close: price,
      totalVolume: 0,
      totalDelta: 0,
      totalBidVol: 0,
      totalAskVol: 0,
      levels: new Map(), // price -> {bidVol, askVol, delta}
      imbalances: []
    };
  }

  _roundToTick(price) {
    return Math.round(price / this.tickSize) * this.tickSize;
  }

  ingest(tick) {
    const { ts, price, size, side } = tick;
    const barTs = Math.floor(ts / this.barDurationMs) * this.barDurationMs;

    // Bar rotation
    if (!this.currentBar || this.currentBar.openTs !== barTs) {
      if (this.currentBar) {
        this._finalizeBar(this.currentBar);
        this.completedBars.push(this._serializeBar(this.currentBar));
        if (this.completedBars.length > this.maxBars) this.completedBars.shift();
      }
      this.currentBar = this._newBar(ts, price);
    }

    const bar = this.currentBar;
    if (price > bar.high) bar.high = price;
    if (price < bar.low) bar.low = price;
    bar.close = price;
    bar.totalVolume += size;

    const roundedPrice = this._roundToTick(price);
    if (!bar.levels.has(roundedPrice)) {
      bar.levels.set(roundedPrice, { bidVol: 0, askVol: 0, delta: 0 });
    }
    const level = bar.levels.get(roundedPrice);

    if (side === 'buy') {
      level.askVol += size;
      level.delta += size;
      bar.totalAskVol += size;
      bar.totalDelta += size;
    } else if (side === 'sell') {
      level.bidVol += size;
      level.delta -= size;
      bar.totalBidVol += size;
      bar.totalDelta -= size;
    } else {
      // Unknown: split evenly
      level.bidVol += size / 2;
      level.askVol += size / 2;
      bar.totalBidVol += size / 2;
      bar.totalAskVol += size / 2;
    }
  }

  _finalizeBar(bar) {
    bar.imbalances = [];
    const prices = [...bar.levels.keys()].sort((a, b) => a - b);
    for (let i = 0; i < prices.length - 1; i++) {
      const lower = bar.levels.get(prices[i]);
      const upper = bar.levels.get(prices[i + 1]);
      if (!lower || !upper) continue;

      // Bid imbalance: lower ask vol >> upper bid vol
      if (upper.bidVol > 0 && lower.askVol / upper.bidVol >= this.imbalanceRatio) {
        bar.imbalances.push({ price: prices[i], ratio: lower.askVol / upper.bidVol, side: 'ask' });
      }
      // Ask imbalance: upper bid vol >> lower ask vol  
      if (lower.askVol > 0 && upper.bidVol / lower.askVol >= this.imbalanceRatio) {
        bar.imbalances.push({ price: prices[i + 1], ratio: upper.bidVol / lower.askVol, side: 'bid' });
      }
    }
  }

  _serializeBar(bar) {
    return {
      ...bar,
      levels: Object.fromEntries(
        [...bar.levels.entries()].map(([k, v]) => [k, v])
      )
    };
  }

  getCurrentBar() {
    if (!this.currentBar) return null;
    this._finalizeBar(this.currentBar);
    return this._serializeBar(this.currentBar);
  }

  getCompletedBars(n = 20) {
    return this.completedBars.slice(-n);
  }

  setBarDuration(ms) {
    this.barDurationMs = ms;
    this.currentBar = null;
  }
}

// ============================================================
// CVD CALCULATOR
// ============================================================
class CvdCalculator {
  constructor() {
    this.sessionCvd = 0;
    this.barCvd = 0;
    this.history = []; // last 500 points
    this.maxHistory = 500;
    this.sessionStart = Date.now();
    this.currentBarTs = null;
    this.barDurationMs = 60000;
  }

  ingest(tick) {
    const delta = tick.side === 'buy' ? tick.size : tick.side === 'sell' ? -tick.size : 0;
    this.sessionCvd += delta;

    const barTs = Math.floor(tick.ts / this.barDurationMs) * this.barDurationMs;
    if (this.currentBarTs !== barTs) {
      this.currentBarTs = barTs;
      this.barCvd = 0;
    }
    this.barCvd += delta;

    const point = { ts: tick.ts, cvd: this.sessionCvd, barDelta: this.barCvd };
    this.history.push(point);
    if (this.history.length > this.maxHistory) this.history.shift();
    return point;
  }

  resetSession() {
    this.sessionCvd = 0;
    this.history = [];
    this.sessionStart = Date.now();
  }

  getHistory(n = 100) {
    return this.history.slice(-n);
  }
}

// ============================================================
// METRICS CALCULATOR (tape speed, large prints, absorption)
// ============================================================
class MetricsCalculator {
  constructor(config = {}) {
    this.largePrintThreshold = config.largePrintThreshold ?? 50;
    this.absorptionWindow = config.absorptionWindow ?? 5000; // ms
    this.speedWindow = 1000; // 1 second for prints/sec
    this.recentTrades = []; // {ts, price, size}
    this.tapeSpeed = 0;
    this.absorptionEvents = [];
  }

  ingest(tick) {
    const now = tick.ts;

    // Clean old entries
    const speedCutoff = now - this.speedWindow;
    const absCutoff = now - this.absorptionWindow;
    this.recentTrades = this.recentTrades.filter(t => t.ts > absCutoff);

    this.recentTrades.push({ ts: now, price: tick.price, size: tick.size, side: tick.side });

    // Tape speed: prints in last second
    this.tapeSpeed = this.recentTrades.filter(t => t.ts > speedCutoff).length;

    // Large print detection
    const isLarge = tick.size >= this.largePrintThreshold;

    // Absorption proxy: many prints but price barely moved
    let absorption = null;
    if (this.recentTrades.length >= 10) {
      const window = this.recentTrades.slice(-20);
      const totalVol = window.reduce((a, t) => a + t.size, 0);
      const priceRange = Math.max(...window.map(t => t.price)) - Math.min(...window.map(t => t.price));
      if (priceRange < 2 * 0.25 && totalVol > this.largePrintThreshold * 5) {
        absorption = { totalVol, priceRange, ts: now };
      }
    }

    return { tapeSpeed: this.tapeSpeed, isLarge, absorption };
  }
}

// ============================================================
// ALERT EVALUATOR
// ============================================================
class AlertEvaluator {
  constructor(config = {}) {
    this.config = {
      deltaThreshold: config.deltaThreshold ?? 500,
      largePrintSize: config.largePrintSize ?? 50,
      tapeSpeedThreshold: config.tapeSpeedThreshold ?? 30,
      domImbalanceRatio: config.domImbalanceRatio ?? 5,
      ...config
    };
    this.recentAlerts = new Map(); // type -> last ts (throttle)
    this.throttleMs = 3000;
  }

  _canAlert(type) {
    const last = this.recentAlerts.get(type);
    if (!last || Date.now() - last > this.throttleMs) {
      this.recentAlerts.set(type, Date.now());
      return true;
    }
    return false;
  }

  _makeAlert(type, message, severity, data = {}) {
    return { id: uuidv4(), type, message, ts: Date.now(), severity, data };
  }

  evaluate({ tick, cvdPoint, metrics, dom }) {
    const alerts = [];

    // Large print
    if (metrics?.isLarge && this._canAlert('large_print')) {
      alerts.push(this._makeAlert('large_print',
        `Large ${tick.side} print: ${tick.size} @ ${tick.price}`,
        'high', { price: tick.price, size: tick.size, side: tick.side }));
    }

    // Delta threshold
    if (cvdPoint && Math.abs(cvdPoint.cvd) >= this.config.deltaThreshold && this._canAlert('delta_threshold')) {
      alerts.push(this._makeAlert('delta_threshold',
        `CVD ${cvdPoint.cvd > 0 ? '+' : ''}${cvdPoint.cvd.toFixed(0)} hit threshold`,
        'medium', { cvd: cvdPoint.cvd }));
    }

    // Tape speed spike
    if (metrics?.tapeSpeed >= this.config.tapeSpeedThreshold && this._canAlert('tape_speed')) {
      alerts.push(this._makeAlert('tape_speed',
        `Tape speed spike: ${metrics.tapeSpeed} prints/sec`,
        'medium', { speed: metrics.tapeSpeed }));
    }

    // DOM imbalance
    if (dom) {
      const bestBidSize = dom.bids[0]?.size ?? 0;
      const bestAskSize = dom.asks[0]?.size ?? 0;
      if (bestBidSize > 0 && bestAskSize > 0) {
        const ratio = Math.max(bestBidSize / bestAskSize, bestAskSize / bestBidSize);
        if (ratio >= this.config.domImbalanceRatio && this._canAlert('dom_imbalance')) {
          const side = bestBidSize > bestAskSize ? 'bid' : 'ask';
          alerts.push(this._makeAlert('dom_imbalance',
            `DOM imbalance ${ratio.toFixed(1)}:1 on ${side} side`,
            'low', { ratio, side }));
        }
      }
    }

    return alerts;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
}

module.exports = {
  inferSide,
  DomBuilder,
  FootprintAggregator,
  CvdCalculator,
  MetricsCalculator,
  AlertEvaluator
};
