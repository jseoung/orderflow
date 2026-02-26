const { SimulatedFeed } = require('./SimulatedFeed');

class FeedManager {
  constructor(aggregationEngine, db) {
    this.engine = aggregationEngine;
    this.db = db;
    this.activeFeed = null;
    this.feedType = null;
  }

  startSimulated(symbol, config) {
    symbol = symbol || 'ES';
    config = config || {};
    this.stop();
    this.activeFeed = new SimulatedFeed(symbol, config);
    this._attachFeed(this.activeFeed);
    this.activeFeed.start();
    this.feedType = 'simulated';
    console.log('[Feed] Started simulated feed for ' + symbol);
  }

  stop() {
    if (this.activeFeed) {
      this.activeFeed.stop();
      this.activeFeed = null;
      this.feedType = null;
    }
  }

  getStatus() {
    return {
      type: this.feedType,
      running: this.activeFeed ? this.activeFeed.running : false,
      symbol: this.activeFeed ? this.activeFeed.symbol : null
    };
  }

  _attachFeed(feed) {
    feed.on('trade', tick => {
      this.db.insertTick(tick);
      this.engine.onTrade(tick);
    });
    feed.on('quote', quote => { this.engine.onQuote(quote); });
    feed.on('depth', depth => { this.engine.onDepth(depth); });
  }
}

module.exports = { FeedManager };
