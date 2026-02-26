'use strict';

const {
  inferSide,
  DomBuilder,
  FootprintAggregator,
  CvdCalculator,
  MetricsCalculator,
  AlertEvaluator,
} = require('../backend/src/engine/aggregation');

const { RingBuffer } = require('../backend/src/utils/ringBuffer');

// ============================================================
// RING BUFFER TESTS
// ============================================================
describe('RingBuffer', () => {
  test('push and last()', () => {
    const rb = new RingBuffer(5);
    rb.push({ v: 1 });
    rb.push({ v: 2 });
    rb.push({ v: 3 });
    const last2 = rb.last(2);
    expect(last2.length).toBe(2);
    expect(last2[1].v).toBe(3); // newest last
  });

  test('circular overwrite', () => {
    const rb = new RingBuffer(3);
    for (let i = 1; i <= 6; i++) rb.push({ v: i });
    const all = rb.last(3);
    expect(all.map(x => x.v).sort()).toEqual([4, 5, 6]);
  });

  test('drainSince returns items since head', () => {
    const rb = new RingBuffer(100);
    rb.push({ v: 1 });
    const h = rb.getHead();
    rb.push({ v: 2 });
    rb.push({ v: 3 });
    const drained = rb.drainSince(h);
    expect(drained.length).toBe(2);
    expect(drained[0].v).toBe(2);
  });
});

// ============================================================
// AGGRESSOR SIDE INFERENCE
// ============================================================
describe('inferSide', () => {
  test('buy when price >= ask', () => {
    expect(inferSide(100.5, undefined, 100, 100.5)).toBe('buy');
  });

  test('sell when price <= bid', () => {
    expect(inferSide(100, undefined, 100, 100.5)).toBe('sell');
  });

  test('tick rule: uptick = buy', () => {
    expect(inferSide(101, 100, undefined, undefined)).toBe('buy');
  });

  test('tick rule: downtick = sell', () => {
    expect(inferSide(99, 100, undefined, undefined)).toBe('sell');
  });

  test('unknown when no context', () => {
    expect(inferSide(100, undefined, undefined, undefined)).toBe('unknown');
  });
});

// ============================================================
// FOOTPRINT AGGREGATOR TESTS
// ============================================================
describe('FootprintAggregator', () => {
  function makeTick(price, size, side, ts) {
    return { ts: ts ?? Date.now(), price, size, side };
  }

  test('accumulates bid/ask volume per price', () => {
    const agg = new FootprintAggregator(60000, 0.5);
    const baseTs = Math.floor(Date.now() / 60000) * 60000;
    agg.ingest(makeTick(100, 10, 'buy', baseTs + 100));
    agg.ingest(makeTick(100, 5, 'sell', baseTs + 200));
    agg.ingest(makeTick(100, 3, 'buy', baseTs + 300));

    const bar = agg.getCurrentBar();
    expect(bar).not.toBeNull();
    const level = bar.levels['100'];
    expect(level.askVol).toBe(13);  // 10 + 3 buys
    expect(level.bidVol).toBe(5);   // 5 sells
    expect(level.delta).toBe(8);    // 13 - 5
  });

  test('total delta accumulates correctly', () => {
    const agg = new FootprintAggregator(60000, 0.5);
    const baseTs = Math.floor(Date.now() / 60000) * 60000;
    agg.ingest(makeTick(100, 20, 'buy', baseTs + 100));
    agg.ingest(makeTick(100.5, 15, 'sell', baseTs + 200));

    const bar = agg.getCurrentBar();
    expect(bar.totalDelta).toBe(20 - 15);  // +5
    expect(bar.totalAskVol).toBe(20);
    expect(bar.totalBidVol).toBe(15);
  });

  test('OHLC tracks correctly', () => {
    const agg = new FootprintAggregator(60000, 0.5);
    const baseTs = Math.floor(Date.now() / 60000) * 60000;
    agg.ingest(makeTick(100, 1, 'buy', baseTs + 10));
    agg.ingest(makeTick(105, 1, 'buy', baseTs + 20));
    agg.ingest(makeTick(98,  1, 'sell', baseTs + 30));
    agg.ingest(makeTick(102, 1, 'buy', baseTs + 40));

    const bar = agg.getCurrentBar();
    expect(bar.open).toBe(100);
    expect(bar.high).toBe(105);
    expect(bar.low).toBe(98);
    expect(bar.close).toBe(102);
  });

  test('imbalance detection at 3:1 ratio', () => {
    const agg = new FootprintAggregator(60000, 0.5, 3.0);
    const baseTs = Math.floor(Date.now() / 60000) * 60000;
    // Create strong bid imbalance: upper price bid vol >> lower price ask vol
    for (let i = 0; i < 30; i++) {
      agg.ingest(makeTick(100.5, 1, 'sell', baseTs + i * 10)); // bid vol at 100.5
    }
    for (let i = 0; i < 5; i++) {
      agg.ingest(makeTick(100, 1, 'buy', baseTs + 300 + i * 10)); // ask vol at 100
    }
    const bar = agg.getCurrentBar();
    // 30 at 100.5 bid vs 5 at 100 ask = 6:1 ratio > 3:1 threshold
    expect(bar.imbalances.length).toBeGreaterThan(0);
  });

  test('unknown side splits volume evenly', () => {
    const agg = new FootprintAggregator(60000, 0.5);
    const baseTs = Math.floor(Date.now() / 60000) * 60000;
    agg.ingest(makeTick(100, 10, 'unknown', baseTs + 100));
    const bar = agg.getCurrentBar();
    const level = bar.levels['100'];
    expect(level.bidVol).toBe(5);
    expect(level.askVol).toBe(5);
  });

  test('bar rotates on new bar period', () => {
    const agg = new FootprintAggregator(60000, 0.5);
    const now = Date.now();
    const bar1Ts = Math.floor(now / 60000) * 60000;
    const bar2Ts = bar1Ts + 60000; // next bar

    agg.ingest(makeTick(100, 5, 'buy', bar1Ts + 100));
    agg.ingest(makeTick(101, 3, 'sell', bar2Ts + 100));

    expect(agg.getCompletedBars(5).length).toBe(1);
    const current = agg.getCurrentBar();
    expect(current.open).toBe(101);
  });
});

// ============================================================
// CVD CALCULATOR TESTS
// ============================================================
describe('CvdCalculator', () => {
  test('CVD accumulates buy ticks positively', () => {
    const calc = new CvdCalculator();
    calc.ingest({ ts: Date.now(), price: 100, size: 10, side: 'buy' });
    calc.ingest({ ts: Date.now(), price: 100, size: 5, side: 'buy' });
    expect(calc.sessionCvd).toBe(15);
  });

  test('CVD accumulates sell ticks negatively', () => {
    const calc = new CvdCalculator();
    calc.ingest({ ts: Date.now(), price: 100, size: 8, side: 'sell' });
    expect(calc.sessionCvd).toBe(-8);
  });

  test('CVD net zero on equal buy/sell', () => {
    const calc = new CvdCalculator();
    calc.ingest({ ts: Date.now(), price: 100, size: 10, side: 'buy' });
    calc.ingest({ ts: Date.now(), price: 100, size: 10, side: 'sell' });
    expect(calc.sessionCvd).toBe(0);
  });

  test('unknown side does not change CVD', () => {
    const calc = new CvdCalculator();
    calc.ingest({ ts: Date.now(), price: 100, size: 100, side: 'unknown' });
    expect(calc.sessionCvd).toBe(0);
  });

  test('reset clears CVD', () => {
    const calc = new CvdCalculator();
    calc.ingest({ ts: Date.now(), price: 100, size: 50, side: 'buy' });
    calc.resetSession();
    expect(calc.sessionCvd).toBe(0);
    expect(calc.getHistory().length).toBe(0);
  });

  test('returns history up to maxHistory', () => {
    const calc = new CvdCalculator();
    for (let i = 0; i < 600; i++) {
      calc.ingest({ ts: Date.now() + i, price: 100, size: 1, side: 'buy' });
    }
    expect(calc.getHistory().length).toBeLessThanOrEqual(500);
  });
});

// ============================================================
// DOM BUILDER TESTS
// ============================================================
describe('DomBuilder', () => {
  test('snapshot returns correct bid/ask sides', () => {
    const dom = new DomBuilder(10);
    dom.update([[100, 50], [99.5, 30]], [[100.5, 40], [101, 20]]);
    const snap = dom.snapshot();
    expect(snap.bids[0].price).toBe(100);
    expect(snap.asks[0].price).toBe(100.5);
    expect(snap.bestBid).toBe(100);
    expect(snap.bestAsk).toBe(100.5);
  });

  test('spread calculated correctly', () => {
    const dom = new DomBuilder(10);
    dom.update([[100, 50]], [[100.5, 40]]);
    const snap = dom.snapshot();
    expect(snap.spread).toBeCloseTo(0.5);
  });

  test('change=added on new price level', () => {
    const dom = new DomBuilder(10);
    dom.update([], []);
    dom.update([[100, 50]], []);
    const snap = dom.snapshot();
    expect(snap.bids[0].change).toBe('added');
  });

  test('removed levels not in snapshot', () => {
    const dom = new DomBuilder(10);
    dom.update([[100, 50]], []);
    dom.update([], []);
    const snap = dom.snapshot();
    expect(snap.bids.length).toBe(0);
  });

  test('zero-size levels removed from book', () => {
    const dom = new DomBuilder(10);
    dom.update([[100, 0], [99, 30]], []);
    const snap = dom.snapshot();
    expect(snap.bids.find(b => b.price === 100)).toBeUndefined();
    expect(snap.bids.find(b => b.price === 99)).toBeDefined();
  });
});

// ============================================================
// ALERT EVALUATOR TESTS
// ============================================================
describe('AlertEvaluator', () => {
  const tick = (size, side = 'buy') => ({ ts: Date.now(), price: 100, size, side });

  test('fires large_print alert when size >= threshold', () => {
    const ae = new AlertEvaluator({ largePrintSize: 50 });
    const alerts = ae.evaluate({
      tick: tick(100, 'buy'),
      metrics: { isLarge: true, tapeSpeed: 5 },
      cvdPoint: { cvd: 0 },
      dom: null,
    });
    expect(alerts.some(a => a.type === 'large_print')).toBe(true);
  });

  test('fires delta_threshold alert', () => {
    const ae = new AlertEvaluator({ deltaThreshold: 500 });
    const alerts = ae.evaluate({
      tick: tick(1),
      metrics: { isLarge: false, tapeSpeed: 1 },
      cvdPoint: { cvd: 600 },
      dom: null,
    });
    expect(alerts.some(a => a.type === 'delta_threshold')).toBe(true);
  });

  test('fires tape_speed alert', () => {
    const ae = new AlertEvaluator({ tapeSpeedThreshold: 30 });
    const alerts = ae.evaluate({
      tick: tick(1),
      metrics: { isLarge: false, tapeSpeed: 40 },
      cvdPoint: { cvd: 0 },
      dom: null,
    });
    expect(alerts.some(a => a.type === 'tape_speed')).toBe(true);
  });

  test('alert throttle prevents duplicate fires', () => {
    const ae = new AlertEvaluator({ largePrintSize: 10 });
    ae.throttleMs = 60000; // long throttle
    const evaluate = () => ae.evaluate({
      tick: tick(50, 'buy'),
      metrics: { isLarge: true, tapeSpeed: 1 },
      cvdPoint: { cvd: 0 },
      dom: null,
    });
    const alerts1 = evaluate();
    const alerts2 = evaluate();
    expect(alerts1.length).toBe(1);
    expect(alerts2.length).toBe(0); // throttled
  });
});
