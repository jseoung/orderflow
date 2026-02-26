/**
 * Time & Sales - virtualized list of recent prints
 * Shows: time, price, size, side indicator, highlights large prints
 */
import React, { useRef, useEffect } from 'react';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';
import type { Tick } from '../../types';

function TradeRow({ trade, largeSizeThreshold }: { trade: Tick; largeSizeThreshold: number }) {
  const isLarge = trade.size >= largeSizeThreshold;
  const time = new Date(trade.ts).toLocaleTimeString('en-US', { hour12: false });
  return (
    <div className={`ts-row ${trade.side} ${isLarge ? 'ts-large' : ''}`}>
      <span className="ts-time">{time}</span>
      <span className={`ts-price ${trade.side}`}>{trade.price.toFixed(2)}</span>
      <span className="ts-size">{trade.size.toLocaleString()}</span>
      <span className={`ts-side-dot ${trade.side}`}>
        {trade.side === 'buy' ? '▲' : '▼'}
      </span>
    </div>
  );
}

export function TimeSales() {
  const trades = useOrderFlowStore(s => s.trades);
  const largeSizeThreshold = useOrderFlowStore(s => s.settings.largeTradeSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    if (!userScrolled.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [trades.length]);

  return (
    <div className="ts-panel">
      <div className="ts-header">
        <span>Time</span>
        <span>Price</span>
        <span>Size</span>
        <span></span>
      </div>
      <div
        ref={containerRef}
        className="ts-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          userScrolled.current = el.scrollTop > 20;
        }}
      >
        {trades.slice(0, 200).map(trade => (
          <TradeRow key={trade.id} trade={trade} largeSizeThreshold={largeSizeThreshold} />
        ))}
      </div>
    </div>
  );
}
