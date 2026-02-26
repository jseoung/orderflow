/**
 * Database - SQLite persistence for ticks and settings
 */
const Database3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class Database {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    this.db = new Database3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this._migrate();
    this._prepareStatements();
    console.log('[DB] Initialized at ' + dbPath);
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ticks (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        size INTEGER NOT NULL,
        side TEXT NOT NULL,
        bid REAL,
        ask REAL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ticks_symbol_ts ON ticks(symbol, ts);
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        threshold REAL,
        enabled INTEGER DEFAULT 1,
        config TEXT
      );
    `);
  }

  _prepareStatements() {
    this._insertTick = this.db.prepare(
      'INSERT OR IGNORE INTO ticks (id,symbol,price,size,side,bid,ask,ts) VALUES (?,?,?,?,?,?,?,?)'
    );
    this._getTicks = this.db.prepare(
      'SELECT * FROM ticks WHERE symbol=? AND ts>=? AND ts<=? ORDER BY ts ASC'
    );
    this._getSettings = this.db.prepare('SELECT value FROM settings WHERE key=?');
    this._setSetting = this.db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  }

  insertTick(tick) {
    this._insertTick.run(tick.id, tick.symbol, tick.price, tick.size, tick.side, tick.bid, tick.ask, tick.ts);
  }

  getTicks(symbol, fromTs, toTs) {
    fromTs = fromTs || 0;
    toTs = toTs || Date.now();
    return this._getTicks.all(symbol, fromTs, toTs);
  }

  exportTicksCsv(symbol, fromTs, toTs) {
    const ticks = this.getTicks(symbol, fromTs, toTs);
    const header = 'id,symbol,price,size,side,bid,ask,ts\n';
    const rows = ticks.map(t =>
      `${t.id},${t.symbol},${t.price},${t.size},${t.side},${t.bid},${t.ask},${t.ts}`
    ).join('\n');
    return header + rows;
  }

  getSetting(key, defaultValue) {
    const row = this._getSettings.get(key);
    return row ? JSON.parse(row.value) : defaultValue;
  }

  setSetting(key, value) {
    this._setSetting.run(key, JSON.stringify(value));
  }

  getTickCount(symbol) {
    return this.db.prepare('SELECT COUNT(*) as c FROM ticks WHERE symbol=?').get(symbol).c;
  }
}

module.exports = { Database };
