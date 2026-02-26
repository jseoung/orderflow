/**
 * ReplayEngine - Load recorded ticks and play back
 */
class ReplayEngine {
  constructor(aggregationEngine, db) {
    this.engine = aggregationEngine;
    this.db = db;
    this.running = false;
    this.speed = 1.0;
    this._timer = null;
    this._ticks = [];
    this._idx = 0;
  }

  async load(symbol, fromTs, toTs) {
    this._ticks = this.db.getTicks(symbol, fromTs, toTs);
    this._idx = 0;
    return { count: this._ticks.length, symbol, fromTs, toTs };
  }

  play(speed) {
    this.speed = speed || 1.0;
    if (this._ticks.length === 0) throw new Error('No ticks loaded. Call load() first.');
    this.running = true;
    this.engine.resetSession();
    this._playNext();
    return { status: 'playing', count: this._ticks.length };
  }

  pause() {
    this.running = false;
    clearTimeout(this._timer);
    return { status: 'paused', idx: this._idx };
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._idx = 0;
    return { status: 'stopped' };
  }

  getStatus() {
    return {
      running: this.running,
      idx: this._idx,
      total: this._ticks.length,
      progress: this._ticks.length > 0 ? +(this._idx / this._ticks.length * 100).toFixed(1) : 0
    };
  }

  _playNext() {
    if (!this.running || this._idx >= this._ticks.length) {
      this.running = false;
      return;
    }
    const tick = this._ticks[this._idx];
    this.engine.onTrade(tick);
    this._idx++;

    if (this._idx < this._ticks.length) {
      const nextTick = this._ticks[this._idx];
      const delay = Math.max(0, (nextTick.ts - tick.ts) / this.speed);
      this._timer = setTimeout(() => this._playNext(), delay);
    } else {
      this.running = false;
    }
  }
}

module.exports = { ReplayEngine };
