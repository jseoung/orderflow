/**
 * Footprint Chart - Volume at price with bid/ask split and imbalance markers
 * Renders using HTML/CSS (canvas upgrade path available)
 */
import React, { useMemo } from 'react';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';
import type { FootprintBar } from '../../types';

function FootprintBarView({ bar, isCurrentBar }: { bar: FootprintBar; isCurrentBar: boolean }) {
  const showImbalances = useOrderFlowStore(s => s.settings.showImbalances);
  const highlightPoc = useOrderFlowStore(s => s.settings.highlightPoc);

  const sortedPrices = useMemo(() =>
    Object.keys(bar.levels).map(Number).sort((a, b) => b - a),
    [bar.levels]
  );

  const maxLevelVol = useMemo(() => {
    let max = 0;
    Object.values(bar.levels).forEach(l => {
      const total = l.buyVol + l.sellVol;
      if (total > max) max = total;
    });
    return max || 1;
  }, [bar.levels]);

  const imbalanceSet = useMemo(() => {
    const set = new Set<string>();
    bar.imbalances.forEach(i => set.add(`${i.price.toFixed(2)}_${i.type}`));
    return set;
  }, [bar.imbalances]);

  const time = new Date(bar.openTime).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className={`fp-bar ${isCurrentBar ? 'current' : ''}`}>
      <div className="fp-bar-header">
        <span className="fp-time">{time}</span>
        <span className={`fp-delta ${bar.delta >= 0 ? 'positive' : 'negative'}`}>
          Δ{bar.delta >= 0 ? '+' : ''}{bar.delta}
        </span>
        <span className="fp-vol">{bar.volume.toLocaleString()}</span>
      </div>
      <div className="fp-levels">
        {sortedPrices.map(price => {
          const priceKey = price.toFixed(2);
          const level = bar.levels[priceKey];
          if (!level) return null;
          const total = level.buyVol + level.sellVol;
          const volPct = (total / maxLevelVol) * 100;
          const isPoc = highlightPoc && price === bar.poc;
          const hasAskImb = showImbalances && imbalanceSet.has(`${priceKey}_ask_imbalance`);
          const hasBidImb = showImbalances && imbalanceSet.has(`${priceKey}_bid_imbalance`);
          const delta = level.buyVol - level.sellVol;

          return (
            <div
              key={priceKey}
              className={`fp-level ${isPoc ? 'poc' : ''} ${hasAskImb ? 'ask-imbalance' : ''} ${hasBidImb ? 'bid-imbalance' : ''}`}
            >
              <span className="fp-price">{priceKey}</span>
              <div className="fp-vols">
                <span className="fp-ask-vol">{level.sellVol || ''}</span>
                <div className="fp-vol-bar" style={{ width: `${Math.min(100, volPct)}%` }} />
                <span className="fp-bid-vol">{level.buyVol || ''}</span>
              </div>
              <span className={`fp-level-delta ${delta >= 0 ? 'pos' : 'neg'}`}>
                {delta >= 0 ? '+' : ''}{delta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FootprintChart() {
  const currentBar = useOrderFlowStore(s => s.currentBar);
  const completedBars = useOrderFlowStore(s => s.completedBars);

  const bars = useMemo(() => {
    const all = [];
    if (currentBar) all.push({ bar: currentBar, isCurrent: true });
    completedBars.slice(0, 5).forEach(b => all.push({ bar: b, isCurrent: false }));
    return all;
  }, [currentBar, completedBars]);

  if (bars.length === 0) {
    return <div className="fp-empty">Waiting for bar data...</div>;
  }

  return (
    <div className="fp-container">
      <div className="fp-legend">
        <span className="fp-legend-ask">Sell</span>
        <span className="fp-legend-mid">Price | Volume</span>
        <span className="fp-legend-bid">Buy</span>
        <span className="fp-legend-delta">Δ</span>
      </div>
      <div className="fp-bars-row">
        {bars.map(({ bar, isCurrent }) => (
          <FootprintBarView key={bar.openTime} bar={bar} isCurrentBar={isCurrent} />
        ))}
      </div>
    </div>
  );
}
