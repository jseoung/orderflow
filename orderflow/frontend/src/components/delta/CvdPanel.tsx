/**
 * CVD / Delta Panel
 * Shows: CVD chart, session CVD, bar delta, tape metrics
 */
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';

export function CvdPanel() {
  const cvd = useOrderFlowStore(s => s.cvd);
  const sessionCvd = useOrderFlowStore(s => s.sessionCvd);
  const barDelta = useOrderFlowStore(s => s.barDelta);
  const cvdHistory = useOrderFlowStore(s => s.cvdHistory);
  const metrics = useOrderFlowStore(s => s.metrics);

  const chartData = cvdHistory.slice(-100).map((d, i) => ({
    i,
    cvd: d.cvd,
    price: d.price
  }));

  const absorption = metrics?.absorption;
  const domBalance = metrics?.domBalance;

  return (
    <div className="cvd-panel">
      {/* CVD Stats Row */}
      <div className="cvd-stats-row">
        <div className="stat-box">
          <span className="stat-label">Session CVD</span>
          <span className={`stat-value ${sessionCvd >= 0 ? 'positive' : 'negative'}`}>
            {sessionCvd >= 0 ? '+' : ''}{sessionCvd.toLocaleString()}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Bar Δ</span>
          <span className={`stat-value ${barDelta >= 0 ? 'positive' : 'negative'}`}>
            {barDelta >= 0 ? '+' : ''}{barDelta}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Tape /s</span>
          <span className={`stat-value ${(metrics?.speed1s ?? 0) > 10 ? 'hot' : ''}`}>
            {metrics?.speed1s ?? 0}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">5s avg</span>
          <span className="stat-value">{metrics?.speed5s?.toFixed(1) ?? '0.0'}</span>
        </div>
      </div>

      {/* CVD Chart */}
      <div className="cvd-chart">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <XAxis dataKey="i" hide />
            <YAxis width={50} tick={{ fontSize: 10, fill: '#888' }} />
            <ReferenceLine y={0} stroke="#555" strokeDasharray="2 2" />
            <Tooltip
              contentStyle={{ background: '#1a1a2e', border: '1px solid #333', fontSize: 11 }}
              formatter={(v: any) => [v.toLocaleString(), 'CVD']}
              labelFormatter={() => ''}
            />
            <Line
              type="monotone"
              dataKey="cvd"
              dot={false}
              strokeWidth={1.5}
              stroke={cvd >= 0 ? '#00c896' : '#ff4d6d'}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics Section */}
      {domBalance && (
        <div className={`metrics-row dom-balance ${domBalance.bias}`}>
          <span className="metrics-label">DOM Balance</span>
          <span className="metrics-value">
            {domBalance.bias.replace('_', ' ')} ({domBalance.ratio}x)
          </span>
          <div className="dom-balance-bar">
            <div
              className="bid-bar"
              style={{ width: `${(domBalance.bidLiq / (domBalance.bidLiq + domBalance.askLiq)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {absorption?.detected && (
        <div className="metrics-row absorption">
          <span className="metrics-label">⚠ Absorption</span>
          <span className="metrics-value">
            {absorption.bias?.toUpperCase()} side | {absorption.totalVolume?.toLocaleString()} contracts | range: {absorption.priceRange}
          </span>
        </div>
      )}
    </div>
  );
}
