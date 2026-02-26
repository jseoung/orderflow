'use strict';
/**
 * SimulatedFeed — generates realistic market data without a broker
 * Models a micro-trending market with mean reversion, DOM dynamics,
 * realistic trade sizing distributions.
 */
class SimulatedFeed {
  constructor(config = {}) {
    this.symbol = config.symbol ?? 'SIM/USDT';
    this.startPrice = config.startPrice ?? 50000;
    this.tickSize = config.tickSize ?? 0.5;
    this.tickInterval = config.tickInterval ?? 100; // ms between ticks
    this.domLevels = config.domLevels ?? 20;
    this.baseSize = config.baseSize ?? 1;
    this.largePrintFreq = config.largePrintFreq ?? 0.03; // 3% chance large print

    this.price = this.startPrice;
    this.bid = this.price - this.tickSize;
    this.ask = this.price + this.tickSize;
    this.trend = 0;           // -1, 0, +1
    this.trendStrength = 0;
    this.trendDuration = 0;

    this._tradeCallbacks = [];
    this._quoteCallbacks = [];
    this._depthCallbacks = [];
    this._timer = null;
    this._running = false;
  }

  onTrade(cb) { this._tradeCallbacks.push(cb); }
  onQuote(cb) { this._quoteCallbacks.push(cb); }
  onDepth(cb) { this._depthCallbacks.push(cb); }

  connect() {
    this._running = true;
    this._tick();
    console.log(`[SimFeed] Started — symbol=${this.symbol} price=${this.price}`);
  }

  disconnect() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
    console.log('[SimFeed] Stopped');
  }

  _tick() {
    if (!this._running) return;

    this._updatePrice();
    this._emitTrade();

    // Emit depth every 5 ticks
    if (Math.random() < 0.2) this._emitDepth();

    // Variable interval: simulates burst tape activity
    const jitter = this.tickInterval * (0.5 + Math.random());
    this._timer = setTimeout(() => this._tick(), jitter);
  }

  _updatePrice() {
    // Update trend periodically
    this.trendDuration--;
    if (this.trendDuration <= 0) {
      const r = Math.random();
      this.trend = r < 0.35 ? 1 : r < 0.70 ? -1 : 0;
      this.trendStrength = 0.4 + Math.random() * 0.4;
      this.trendDuration = 10 + Math.floor(Math.random() * 40);
    }

    // Mean reversion + trend + noise
    const noise = (Math.random() - 0.5) * this.tickSize * 4;
    const trendBias = this.trend * this.trendStrength * this.tickSize;
    const meanRev = (this.startPrice - this.price) * 0.0001;

    this.price = Math.round((this.price + noise + trendBias + meanRev) / this.tickSize) * this.tickSize;
    this.bid = this.price - this.tickSize;
    this.ask = this.price + this.tickSize;
  }

  _emitTrade() {
    // Size: log-normal distribution
    let size = Math.round(Math.exp(Math.random() * 2 + 0.5) * this.baseSize);
    const isLarge = Math.random() < this.largePrintFreq;
    if (isLarge) size *= (10 + Math.floor(Math.random() * 40));

    // Aggressor side: biased by trend
    const buyProb = 0.5 + this.trend * 0.1;
    const side = Math.random() < buyProb ? 'buy' : 'sell';

    const tick = {
      ts: Date.now(),
      price: side === 'buy' ? this.ask : this.bid,
      size,
      side,
      symbol: this.symbol
    };

    for (const cb of this._tradeCallbacks) cb(tick);
  }

  _emitDepth() {
    const bids = [];
    const asks = [];

    // Generate DOM levels around current price
    for (let i = 0; i < this.domLevels; i++) {
      const bidPrice = this.bid - i * this.tickSize;
      const askPrice = this.ask + i * this.tickSize;

      // Size increases at round numbers (clustering)
      const roundBonus = (bidPrice % 10 < 0.01 || bidPrice % 50 < 0.01) ? 3 : 1;
      const bidSize = Math.round((5 + Math.random() * 30) * roundBonus * (1 + i * 0.1));
      const askSize = Math.round((5 + Math.random() * 30) * roundBonus * (1 + i * 0.1));

      bids.push([bidPrice, bidSize]);
      asks.push([askPrice, askSize]);
    }

    for (const cb of this._depthCallbacks) cb({ bids, asks, ts: Date.now(), symbol: this.symbol });
  }
}

// ============================================================
// BINANCE WEBSOCKET FEED
// ============================================================
const WebSocket = require('ws');

class BinanceFeed {
  constructor(config = {}) {
    this.symbol = (config.symbol ?? 'BTCUSDT').toLowerCase();
    this.wsBase = 'wss://stream.binance.com:9443/stream?streams=';
    this._tradeCallbacks = [];
    this._quoteCallbacks = [];
    this._depthCallbacks = [];
    this._ws = null;
    this._prevPrice = null;
  }

  onTrade(cb) { this._tradeCallbacks.push(cb); }
  onQuote(cb) { this._quoteCallbacks.push(cb); }
  onDepth(cb) { this._depthCallbacks.push(cb); }

  connect() {
    const streams = `${this.symbol}@aggTrade/${this.symbol}@depth20@100ms`;
    this._ws = new WebSocket(`${this.wsBase}${streams}`);

    this._ws.on('open', () => console.log(`[BinanceFeed] Connected — ${this.symbol}`));
    this._ws.on('message', (raw) => this._onMessage(raw));
    this._ws.on('error', (err) => console.error('[BinanceFeed] Error:', err.message));
    this._ws.on('close', () => {
      console.log('[BinanceFeed] Disconnected. Reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    });
  }

  disconnect() {
    if (this._ws) this._ws.close();
  }

  _onMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      if (!msg.data) return;
      const { e } = msg.data;

      if (e === 'aggTrade') {
        const d = msg.data;
        const price = parseFloat(d.p);
        const size = parseFloat(d.q);
        const side = d.m ? 'sell' : 'buy'; // m=true means buyer is market maker = sell aggressor
        this._prevPrice = price;

        const tick = { ts: d.T, price, size, side, symbol: this.symbol, id: d.a };
        for (const cb of this._tradeCallbacks) cb(tick);
      }

      if (e === 'depthUpdate') {
        const d = msg.data;
        const bids = d.b.map(([p, s]) => [parseFloat(p), parseFloat(s)]);
        const asks = d.a.map(([p, s]) => [parseFloat(p), parseFloat(s)]);
        for (const cb of this._depthCallbacks) cb({ bids, asks, ts: Date.now(), symbol: this.symbol });
      }
    } catch (err) {
      console.error('[BinanceFeed] Parse error:', err.message);
    }
  }
}

// ============================================================
// CUSTOM WEBSOCKET FEED (plug in your own stream)
// ============================================================
class CustomWsFeed {
  constructor(config = {}) {
    this.url = config.url ?? 'ws://localhost:9000';
    this._tradeCallbacks = [];
    this._quoteCallbacks = [];
    this._depthCallbacks = [];
    this._ws = null;
  }

  onTrade(cb) { this._tradeCallbacks.push(cb); }
  onQuote(cb) { this._quoteCallbacks.push(cb); }
  onDepth(cb) { this._depthCallbacks.push(cb); }

  connect() {
    this._ws = new WebSocket(this.url);
    this._ws.on('open', () => console.log(`[CustomFeed] Connected — ${this.url}`));
    this._ws.on('message', (raw) => {
      // Expected format: { type: 'trade'|'depth', ...fields }
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'trade') {
          for (const cb of this._tradeCallbacks) cb(msg);
        } else if (msg.type === 'depth') {
          for (const cb of this._depthCallbacks) cb(msg);
        }
      } catch (e) { /* ignore */ }
    });
  }

  disconnect() {
    if (this._ws) this._ws.close();
  }
}

function createFeed(type, config = {}) {
  switch (type) {
    case 'binance': return new BinanceFeed(config);
    case 'custom': return new CustomWsFeed(config);
    case 'simulated':
    default: return new SimulatedFeed(config);
  }
}

module.exports = { SimulatedFeed, BinanceFeed, CustomWsFeed, createFeed };
