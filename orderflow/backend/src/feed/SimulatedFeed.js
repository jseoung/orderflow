/**
 * SimulatedFeed - Generates realistic order flow data for testing
 * Emits: trade, quote, depth events
 * 
 * Normalized trade format:
 * { id, symbol, price, size, side: 'buy'|'sell', ts, bid, ask }
 * 
 * Normalized depth format:
 * { symbol, bids: [[price,size],...], asks: [[price,size],...], ts }
 */
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class SimulatedFeed extends EventEmitter {
  constructor(symbol, config) {
    super();
    this.symbol = symbol;
    this.running = false;
    this.config = Object.assign({
      basePrice: 5000,
      tickSize: 0.25,
      tradeIntervalMs: 50,     // avg ms between trades
      depthIntervalMs: 200,    // DOM refresh
      domLevels: 20,
      volatility: 0.5,         // price walk volatility
      trendStrength: 0.02,     // probability of trend continuing
    }, config);

    this.price = this.config.basePrice;
    this.bid = this.price - this.config.tickSize;
    this.ask = this.price;
    this.trend = 0; // -1, 0, 1
    this.dom = { bids: new Map(), asks: new Map() };
    this._initDOM();
  }

  _initDOM() {
    const { tickSize, domLevels, basePrice } = this.config;
    for (let i = 1; i <= domLevels; i++) {
      const bidP = +(basePrice - i * tickSize).toFixed(2);
      const askP = +(basePrice + (i-1) * tickSize).toFixed(2);
      this.dom.bids.set(bidP, Math.floor(50 + Math.random() * 300));
      this.dom.asks.set(askP, Math.floor(50 + Math.random() * 300));
    }
  }

  start() {
    this.running = true;
    this._tradeTick();
    this._depthTick();
  }

  stop() {
    this.running = false;
    clearTimeout(this._tradeTimer);
    clearTimeout(this._depthTimer);
  }

  _walkPrice() {
    const { tickSize, volatility, trendStrength } = this.config;
    // Stochastic trend
    if (Math.random() < 0.05) this.trend = Math.sign(Math.random() - 0.5);
    const trendBias = this.trend * trendStrength;
    const r = Math.random() - 0.5 + trendBias;
    if (Math.abs(r) > volatility * 0.3) {
      this.price = +(this.price + Math.sign(r) * tickSize).toFixed(2);
    }
    this.bid = +(this.price - tickSize).toFixed(2);
    this.ask = this.price;
  }

  _tradeTick() {
    if (!this.running) return;
    const jitter = Math.random() * this.config.tradeIntervalMs * 1.5;
    this._tradeTimer = setTimeout(() => {
      this._walkPrice();
      // Occasional large print
      const isLarge = Math.random() < 0.03;
      const size = isLarge
        ? Math.floor(50 + Math.random() * 200)
        : Math.floor(1 + Math.random() * 15);
      const side = Math.random() < 0.5 + this.trend * 0.1 ? 'buy' : 'sell';
      const price = side === 'buy' ? this.ask : this.bid;

      const trade = {
        id: uuidv4(),
        symbol: this.symbol,
        price,
        size,
        side,
        bid: this.bid,
        ask: this.ask,
        ts: Date.now()
      };

      // Update DOM on trade
      if (side === 'buy' && this.dom.asks.has(price)) {
        const current = this.dom.asks.get(price);
        const remaining = current - size;
        if (remaining <= 0) this.dom.asks.delete(price);
        else this.dom.asks.set(price, remaining);
      } else if (side === 'sell' && this.dom.bids.has(price)) {
        const current = this.dom.bids.get(price);
        const remaining = current - size;
        if (remaining <= 0) this.dom.bids.delete(price);
        else this.dom.bids.set(price, remaining);
      }

      this.emit('trade', trade);
      this._tradeTick();
    }, jitter);
  }

  _depthTick() {
    if (!this.running) return;
    this._depthTimer = setTimeout(() => {
      // Rebuild DOM around current price
      const { tickSize, domLevels } = this.config;
      const bids = [];
      const asks = [];

      for (let i = 1; i <= domLevels; i++) {
        const bidP = +(this.bid - (i-1) * tickSize).toFixed(2);
        const askP = +(this.ask + (i-1) * tickSize).toFixed(2);
        if (!this.dom.bids.has(bidP)) {
          this.dom.bids.set(bidP, Math.floor(10 + Math.random() * 200));
        }
        if (!this.dom.asks.has(askP)) {
          this.dom.asks.set(askP, Math.floor(10 + Math.random() * 200));
        }
        // Random DOM changes (pulled/added liquidity)
        if (Math.random() < 0.15) {
          this.dom.bids.set(bidP, Math.floor(10 + Math.random() * 400));
        }
        if (Math.random() < 0.15) {
          this.dom.asks.set(askP, Math.floor(10 + Math.random() * 400));
        }
        bids.push([bidP, this.dom.bids.get(bidP) || 0]);
        asks.push([askP, this.dom.asks.get(askP) || 0]);
      }

      this.emit('depth', {
        symbol: this.symbol,
        bids,
        asks,
        ts: Date.now()
      });
      this._depthTick();
    }, this.config.depthIntervalMs);
  }
}

module.exports = { SimulatedFeed };
