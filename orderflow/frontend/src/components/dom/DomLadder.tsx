/**
 * DOM / Level 2 Ladder
 * Shows bids/asks with size bars, highlights changes, large sizes
 */
import React, { useMemo } from 'react';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';

const LARGE_SIZE_THRESHOLD = 200;
const DOM_LEVELS = 16;

function SizeBar({ size, max, side }: { size: number; max: number; side: 'bid' | 'ask' }) {
  const pct = max > 0 ? Math.min(100, (size / max) * 100) : 0;
  const isLarge = size >= LARGE_SIZE_THRESHOLD;
  return (
    <div className="size-bar-container">
      <div
        className={`size-bar ${side} ${isLarge ? 'large' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function DomLadder() {
  const { dom, prevDom, trades } = useOrderFlowStore(s => ({
    dom: s.dom,
    prevDom: s.prevDom,
    trades: s.trades
  }));

  const lastPrice = trades[0]?.price ?? 0;

  const prevBidMap = useMemo(() => {
    const map = new Map<number, number>();
    if (prevDom) prevDom.bids.forEach(([p, s]) => map.set(p, s));
    return map;
  }, [prevDom]);

  const prevAskMap = useMemo(() => {
    const map = new Map<number, number>();
    if (prevDom) prevDom.asks.forEach(([p, s]) => map.set(p, s));
    return map;
  }, [prevDom]);

  const asks = dom.asks.slice(0, DOM_LEVELS).reverse(); // top ask at top
  const bids = dom.bids.slice(0, DOM_LEVELS);
  const maxBid = Math.max(...bids.map(b => b[1]), 1);
  const maxAsk = Math.max(...asks.map(a => a[1]), 1);
  const maxSize = Math.max(maxBid, maxAsk);

  function sizeClass(current: number, prev: number | undefined) {
    if (prev === undefined) return '';
    if (current > prev * 1.3) return 'size-added';
    if (current < prev * 0.7) return 'size-removed';
    return '';
  }

  return (
    <div className="dom-ladder">
      <div className="dom-header">
        <span>Price</span>
        <span>Size</span>
        <span>Depth</span>
      </div>

      {/* Ask side */}
      <div className="dom-asks">
        {asks.map(([price, size]) => {
          const prev = prevAskMap.get(price);
          const change = sizeClass(size, prev);
          const isLarge = size >= LARGE_SIZE_THRESHOLD;
          return (
            <div key={price} className={`dom-row ask ${change} ${isLarge ? 'large-size' : ''}`}>
              <span className="dom-price ask-price">{price.toFixed(2)}</span>
              <span className="dom-size">{size.toLocaleString()}</span>
              <SizeBar size={size} max={maxSize} side="ask" />
            </div>
          );
        })}
      </div>

      {/* Spread row */}
      {lastPrice > 0 && (
        <div className="dom-spread-row">
          <span className="last-price">{lastPrice.toFixed(2)}</span>
          <span className="spread-label">
            {dom.asks[0] && dom.bids[0]
              ? `Spread: ${(dom.asks[0][0] - dom.bids[0][0]).toFixed(2)}`
              : ''}
          </span>
        </div>
      )}

      {/* Bid side */}
      <div className="dom-bids">
        {bids.map(([price, size]) => {
          const prev = prevBidMap.get(price);
          const change = sizeClass(size, prev);
          const isLarge = size >= LARGE_SIZE_THRESHOLD;
          return (
            <div key={price} className={`dom-row bid ${change} ${isLarge ? 'large-size' : ''}`}>
              <span className="dom-price bid-price">{price.toFixed(2)}</span>
              <span className="dom-size">{size.toLocaleString()}</span>
              <SizeBar size={size} max={maxSize} side="bid" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
