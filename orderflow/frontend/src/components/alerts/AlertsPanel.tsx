/**
 * Alerts Panel - shows triggered alerts and alert config
 */
import React, { useState } from 'react';
import { useOrderFlowStore } from '../../store/useOrderFlowStore';

const ALERT_ICONS: Record<string, string> = {
  large_print: '🔔',
  delta_threshold: '📊',
  tape_speed: '⚡',
  dom_imbalance: '⚖️',
};

export function AlertsPanel() {
  const alerts = useOrderFlowStore(s => s.alerts);
  const clearAlerts = useOrderFlowStore(s => s.clearAlerts);

  return (
    <div className="alerts-panel">
      <div className="alerts-header">
        <span>Alerts</span>
        <span className="alert-count">{alerts.length}</span>
        {alerts.length > 0 && (
          <button className="clear-btn" onClick={clearAlerts}>Clear</button>
        )}
      </div>
      <div className="alerts-list">
        {alerts.length === 0 && (
          <div className="alerts-empty">No alerts triggered</div>
        )}
        {alerts.slice(0, 50).map((alert, i) => (
          <div key={i} className={`alert-item ${alert.type}`}>
            <span className="alert-icon">{ALERT_ICONS[alert.type] || '⚠️'}</span>
            <div className="alert-body">
              <span className="alert-message">{alert.message}</span>
              <span className="alert-time">
                {new Date(alert.ts).toLocaleTimeString('en-US', { hour12: false })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AlertConfig() {
  const alertConfigs = useOrderFlowStore(s => s.alertConfigs);
  const addAlertConfig = useOrderFlowStore(s => s.addAlertConfig);
  const removeAlertConfig = useOrderFlowStore(s => s.removeAlertConfig);

  const [newType, setNewType] = useState('large_print');
  const [newThreshold, setNewThreshold] = useState('50');

  const add = () => {
    const cfg = {
      id: Date.now().toString(),
      type: newType,
      threshold: parseFloat(newThreshold) || 50,
      enabled: true
    };
    addAlertConfig(cfg);
    // Also send to backend
    fetch('http://localhost:3001/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    }).catch(() => {});
  };

  return (
    <div className="alert-config">
      <div className="alert-config-title">Configure Alerts</div>
      <div className="alert-config-form">
        <select value={newType} onChange={e => setNewType(e.target.value)}>
          <option value="large_print">Large Print</option>
          <option value="delta_threshold">Delta Threshold</option>
          <option value="tape_speed">Tape Speed</option>
        </select>
        <input
          type="number"
          value={newThreshold}
          onChange={e => setNewThreshold(e.target.value)}
          placeholder="Threshold"
        />
        <button onClick={add} className="add-alert-btn">+ Add</button>
      </div>
      <div className="alert-config-list">
        {alertConfigs.map(cfg => (
          <div key={cfg.id} className="alert-config-item">
            <span>{cfg.type}</span>
            <span className="threshold-badge">{cfg.threshold}</span>
            <button onClick={() => removeAlertConfig(cfg.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
