/**
 * Unit tests for order flow calculations
 */
const { AggregationEngine, IMBALANCE_RATIO } = require('../src/engine/AggregationEngine');

// Mock uuid
jest.mock('uuid', () => ({ v4: () => 'test-id' }));

describe('Side Inference', () => {
  let engine;
  beforeEach(() => { engine = new AggregationEngine(); });
  afterEach(() => { clearInterval(engine._metricsTimer); });

  test('buy side when price >= ask', () => {
    engine.lastAsk = 5000;
    engine.lastBid = 4999.75;
    expect(engine._inferSide(5000)).toBe('buy');
    expect(engine._inferSide(5000.25)).toBe('buy');
  });

  test('sell side when price <= bid', () => {
    engine.lastAsk = 5000;
    engine.lastBid = 4999.75;
    expect(engine._inferSide(4999.75)).toBe('sell');
    expect(engine._inferSide(4999.50)).toBe('sell');
  });

  test('tick rule fallback when no bid/ask', () => {
    engine.trades = [{ price: 5000 }];
    expect(engine._inferSide(5000.25)).toBe('buy');
    expect(engine._inferSide(4999.75)).toBe('sell');
  });
});

describe('Delta Calculation', () => {
  let engine;
  beforeEach(() => { engine = new AggregationEngine(); });
  afterEach(() => { clearInterval(engine._metricsTimer); });

  test('buy trade adds positive delta', () => {
    engine.lastAsk = 5000;
    engine.onTrade({ id: '1', symbol: 'ES', price: 5000, size: 10, side: 'buy', bid: 4999.75, ask: 5000, ts: Date.now() });
    expect(engine.cvd).toBe(10);
  });

  test('sell trade adds negative delta', () => {
    engine.lastBid = 4999.75;
    engine.onTrade({ id: '2', symbol: 'ES', price: 4999.75, size: 5, side: 'sell', bid: 4999.75, ask: 5000, ts: Date.now() });
    expect(engine.cvd).toBe(-5);
  });

  test('CVD accumulates correctly', () => {
    const now = Date.now();
    engine.onTrade({ id: '1', symbol: 'ES', price: 5000, size: 20, side: 'buy', bid: 4999.75, ask: 5000, ts: now });
    engine.onTrade({ id: '2', symbol: 'ES', price: 4999.75, size: 8, side: 'sell', bid: 4999.75, ask: 5000, ts: now + 1 });
    engine.onTrade({ id: '3', symbol: 'ES', price: 5000, size: 3, side: 'buy', bid: 4999.75, ask: 5000, ts: now + 2 });
    expect(engine.cvd).toBe(20 - 8 + 3); // 15
  });
});

describe('Footprint Bar Aggregation', () => {
  let engine;
  beforeEach(() => { engine = new AggregationEngine(); });
  afterEach(() => { clearInterval(engine._metricsTimer); });

  test('bar accumulates volume at price', () => {
    const now = Date.now();
    engine.onTrade({ id: '1', symbol: 'ES', price: 5000, size: 10, side: 'buy', bid: 4999.75, ask: 5000, ts: now });
    engine.onTrade({ id: '2', symbol: 'ES', price: 5000, size: 5, side: 'sell', bid: 4999.75, ask: 5000, ts: now + 100 });
    engine.onTrade({ id: '3', symbol: 'ES', price: 5000.25, size: 8, side: 'buy', bid: 5000, ask: 5000.25, ts: now + 200 });

    const bar = engine.currentBar;
    expect(bar.volume).toBe(23);
    expect(bar.buyVolume).toBe(18);
    expect(bar.sellVolume).toBe(5);
    expect(bar.delta).toBe(13);

    const level = bar.levels.get('5000.00');
    expect(level.buyVol).toBe(10);
    expect(level.sellVol).toBe(5);
    expect(level.delta).toBe(5);
  });

  test('POC is the highest volume price', () => {
    const now = Date.now();
    // Heavy at 5000
    for (let i = 0; i < 5; i++) {
      engine.onTrade({ id: 'a'+i, symbol: 'ES', price: 5000, size: 50, side: 'buy', bid: 4999.75, ask: 5000, ts: now + i });
    }
    // Light at 5000.25
    engine.onTrade({ id: 'b1', symbol: 'ES', price: 5000.25, size: 10, side: 'buy', bid: 5000, ask: 5000.25, ts: now + 10 });

    expect(engine.currentBar.poc).toBe(5000);
  });
});

describe('Imbalance Detection', () => {
  let engine;
  beforeEach(() => { engine = new AggregationEngine(); });
  afterEach(() => { clearInterval(engine._metricsTimer); });

  test('detects ask imbalance when buy vol >> next sell vol', () => {
    const now = Date.now();
    // Set up two adjacent levels: 5000 with heavy buy, 5000.25 with light sell
    engine.onTrade({ id: '1', symbol: 'ES', price: 5000, size: 90, side: 'buy', bid: 4999.75, ask: 5000, ts: now });
    engine.onTrade({ id: '2', symbol: 'ES', price: 5000.25, size: 10, side: 'sell', bid: 5000, ask: 5000.25, ts: now + 1 });

    const bar = engine.currentBar;
    const askImb = bar.imbalances.filter(i => i.type === 'ask_imbalance');
    // 90 buy vs 10 sell = 9:1 ratio > 3:1 threshold
    expect(askImb.length).toBeGreaterThan(0);
  });
});

describe('DOM Analysis', () => {
  let engine;
  beforeEach(() => { engine = new AggregationEngine(); });
  afterEach(() => { clearInterval(engine._metricsTimer); });

  test('bid heavy when bid liquidity much larger', () => {
    engine.dom = {
      bids: Array.from({length: 10}, (_, i) => [5000 - i * 0.25, 1000]),
      asks: Array.from({length: 10}, (_, i) => [5000.25 + i * 0.25, 100]),
      lastUpdate: Date.now()
    };
    const metrics = engine._analyzeDOMBalance();
    expect(metrics.bias).toBe('bid_heavy');
    expect(metrics.ratio).toBeGreaterThan(2);
  });
});
