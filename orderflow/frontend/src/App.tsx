import React, { useState } from 'react';
import { useWebSocket, API_BASE } from './hooks/useWebSocket';
import { StatusBar } from './components/layout/StatusBar';
import { DomLadder } from './components/dom/DomLadder';
import { TimeSales } from './components/timesales/TimeSales';
import { FootprintChart } from './components/footprint/FootprintChart';
import { CvdPanel } from './components/delta/CvdPanel';
import { AlertsPanel, AlertConfig } from './components/alerts/AlertsPanel';
import './styles.css';

type Tab = 'footprint' | 'alerts';

export default function App() {
  useWebSocket();
  const [rightTab, setRightTab] = useState<Tab>('footprint');

  return (
    <div className="app">
      <StatusBar />
      <div className="main-layout">
        <div className="left-col">
          <div className="panel panel-dom">
            <div className="panel-title">Level 2 DOM</div>
            <DomLadder />
          </div>
          <div className="panel panel-ts">
            <div className="panel-title">Time &amp; Sales</div>
            <TimeSales />
          </div>
        </div>
        <div className="center-col">
          <div className="panel panel-cvd">
            <div className="panel-title">Delta / CVD</div>
            <CvdPanel />
          </div>
          <div className="panel panel-metrics">
            <div className="panel-title">Controls</div>
            <Controls />
          </div>
        </div>
        <div className="right-col">
          <div className="tab-bar">
            <button className={`tab-btn ${rightTab === 'footprint' ? 'active' : ''}`} onClick={() => setRightTab('footprint')}>Footprint</button>
            <button className={`tab-btn ${rightTab === 'alerts' ? 'active' : ''}`} onClick={() => setRightTab('alerts')}>Alerts</button>
          </div>
          <div className="panel panel-right-content">
            {rightTab === 'footprint' ? <FootprintChart /> : (
              <div className="alerts-container">
                <AlertsPanel />
                <AlertConfig />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Controls() {
  const [replayFrom, setReplayFrom] = useState('');
  const [replaySpeed, setReplaySpeed] = useState('1');
  const [replayStatus, setReplayStatus] = useState('');
  const [symbol, setSymbol] = useState('ES');
  const [feedRunning, setFeedRunning] = useState(true);

  const api = (path: string, body?: any) =>
    fetch(`${API_BASE}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => r.json());

  const toggleFeed = async () => {
    if (feedRunning) { await api('/feed/stop'); setFeedRunning(false); }
    else { await api('/feed/start', { type: 'simulated', symbol }); setFeedRunning(true); }
  };

  const startReplay = async () => {
    const fromTs = replayFrom ? new Date(replayFrom).getTime() : Date.now() - 3600000;
    const result = await api('/replay/load', { symbol, fromTs, toTs: Date.now() });
    if (result.count === 0) { setReplayStatus('No recorded data found'); return; }
    await api('/feed/stop');
    setFeedRunning(false);
    await api('/replay/play', { speed: parseFloat(replaySpeed) });
    setReplayStatus(`Replaying ${result.count} ticks...`);
  };

  const stopReplay = async () => { await api('/replay/stop'); setReplayStatus('Stopped'); };

  return (
    <div className="controls">
      <div className="control-section">
        <div className="control-label">Feed</div>
        <div className="control-row">
          <select value={symbol} onChange={e => setSymbol(e.target.value)}>
            <option>ES</option><option>NQ</option><option>CL</option><option>BTC</option>
          </select>
          <button className={`ctrl-btn ${feedRunning ? 'stop' : 'start'}`} onClick={toggleFeed}>
            {feedRunning ? '⏹ Stop' : '▶ Start'} Sim
          </button>
        </div>
      </div>
      <div className="control-section">
        <div className="control-label">Replay</div>
        <div className="control-row">
          <input type="datetime-local" value={replayFrom} onChange={e => setReplayFrom(e.target.value)} />
          <select value={replaySpeed} onChange={e => setReplaySpeed(e.target.value)}>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
          </select>
        </div>
        <div className="control-row">
          <button className="ctrl-btn start" onClick={startReplay}>▶ Replay</button>
          <button className="ctrl-btn stop" onClick={stopReplay}>⏹ Stop</button>
        </div>
        {replayStatus && <div className="replay-status">{replayStatus}</div>}
      </div>
    </div>
  );
}
