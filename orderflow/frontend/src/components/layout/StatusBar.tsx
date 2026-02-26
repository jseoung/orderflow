import React from 'react';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';

export function StatusBar() {
  const connected = useOrderFlowStore(s => s.connected);
  const latency = useOrderFlowStore(s => s.latency);
  const feedStatus = useOrderFlowStore(s => s.feedStatus);
  const trades = useOrderFlowStore(s => s.trades);

  const handleExport = () => {
    const symbol = feedStatus.symbol || 'ES';
    window.open(`http://localhost:3001/api/export/ticks?symbol=${symbol}`, '_blank');
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <div className={`conn-dot ${connected ? 'connected' : 'disconnected'}`} />
        <span className="conn-label">{connected ? 'LIVE' : 'DISCONNECTED'}</span>
        {connected && <span className="latency">{latency}ms</span>}
        {feedStatus.running && (
          <span className="feed-badge">
            {feedStatus.type?.toUpperCase()} · {feedStatus.symbol}
          </span>
        )}
      </div>
      <div className="status-center">
        <span className="status-title">⚡ OrderFlow</span>
        <span className="disclaimer">Visualization tool · Not financial advice</span>
      </div>
      <div className="status-right">
        <span className="trade-count">{trades.length} prints</span>
        <button className="export-btn" onClick={handleExport}>Export CSV</button>
      </div>
    </div>
  );
}
