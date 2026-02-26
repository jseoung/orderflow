'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

class TickStorage {
  constructor(dbPath = path.join(DATA_DIR, 'ticks.db')) {
    this.db = new Database(dbPath);
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        side TEXT NOT NULL,
        symbol TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ticks_ts ON ticks(ts);
      CREATE INDEX IF NOT EXISTS idx_ticks_symbol ON ticks(symbol);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        symbol TEXT,
        start_ts INTEGER,
        end_ts INTEGER,
        tick_count INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Prepared statements
    this._insertTick = this.db.prepare(
      'INSERT INTO ticks (ts, price, size, side, symbol) VALUES (?, ?, ?, ?, ?)'
    );
    this._insertTickBatch = this.db.transaction((ticks) => {
      for (const t of ticks) {
        this._insertTick.run(t.ts, t.price, t.size, t.side, t.symbol ?? 'UNKNOWN');
      }
    });
  }

  saveTick(tick) {
    this._insertTick.run(tick.ts, tick.price, tick.size, tick.side, tick.symbol ?? 'UNKNOWN');
  }

  saveBatch(ticks) {
    this._insertTickBatch(ticks);
  }

  /** Load ticks for replay */
  getTicksInRange(symbol, startTs, endTs) {
    return this.db.prepare(
      'SELECT * FROM ticks WHERE symbol=? AND ts>=? AND ts<=? ORDER BY ts ASC'
    ).all(symbol, startTs, endTs);
  }

  /** Export to CSV string */
  exportCsv(symbol, startTs, endTs) {
    const rows = this.getTicksInRange(symbol, startTs ?? 0, endTs ?? Date.now() + 1e10);
    const lines = ['ts,price,size,side,symbol'];
    for (const r of rows) {
      lines.push(`${r.ts},${r.price},${r.size},${r.side},${r.symbol}`);
    }
    return lines.join('\n');
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }

  listSessions() {
    return this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50').all();
  }

  getTickStats(symbol) {
    return this.db.prepare(
      'SELECT COUNT(*) as count, MIN(ts) as first_ts, MAX(ts) as last_ts FROM ticks WHERE symbol=?'
    ).get(symbol);
  }

  pruneOld(maxAgeDays = 7) {
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    const result = this.db.prepare('DELETE FROM ticks WHERE ts < ?').run(cutoff);
    return result.changes;
  }

  close() { this.db.close(); }
}

// ============================================================
// REPLAY ENGINE
// ============================================================
class ReplayEngine {
  constructor(storage, onTick) {
    this.storage = storage;
    this.onTick = onTick;
    this._timer = null;
    this._ticks = [];
    this._pos = 0;
    this._speed = 1.0;
    this._playing = false;
    this._startRealTs = 0;
    this._startTickTs = 0;
  }

  load(symbol, startTs, endTs) {
    this._ticks = this.storage.getTicksInRange(symbol, startTs, endTs);
    this._pos = 0;
    this._playing = false;
    console.log(`[Replay] Loaded ${this._ticks.length} ticks`);
    return this._ticks.length;
  }

  play(speed = 1.0) {
    if (this._ticks.length === 0) return;
    this._speed = speed;
    this._playing = true;
    this._startRealTs = Date.now();
    this._startTickTs = this._ticks[this._pos]?.ts ?? Date.now();
    this._scheduleNext();
  }

  pause() {
    this._playing = false;
    if (this._timer) clearTimeout(this._timer);
  }

  stop() {
    this.pause();
    this._pos = 0;
  }

  setSpeed(speed) {
    this._speed = speed;
  }

  getStatus() {
    return {
      playing: this._playing,
      pos: this._pos,
      total: this._ticks.length,
      progress: this._ticks.length ? this._pos / this._ticks.length : 0,
      speed: this._speed,
      currentTs: this._ticks[this._pos]?.ts ?? null
    };
  }

  _scheduleNext() {
    if (!this._playing || this._pos >= this._ticks.length) {
      if (this._pos >= this._ticks.length) {
        this._playing = false;
        console.log('[Replay] Complete');
      }
      return;
    }

    const tick = this._ticks[this._pos];
    if (this._pos + 1 >= this._ticks.length) {
      this.onTick(tick);
      this._pos++;
      this._playing = false;
      return;
    }

    const nextTick = this._ticks[this._pos + 1];
    const delay = Math.max(0, (nextTick.ts - tick.ts) / this._speed);

    this.onTick(tick);
    this._pos++;

    this._timer = setTimeout(() => this._scheduleNext(), Math.min(delay, 5000));
  }
}

module.exports = { TickStorage, ReplayEngine };
