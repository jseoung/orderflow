/**
 * Zustand store - central state for all order flow data
 * Uses efficient batching to minimize re-renders
 */
import { create } from 'zustand';
import type { Tick, DomState, FootprintBar, CvdUpdate, MetricsUpdate, Alert, AlertConfig } from '../types';

const MAX_TRADES = 500;
const MAX_ALERTS = 100;
const MAX_CVD_HISTORY = 300;

interface OrderFlowStore {
  // Connection
  connected: boolean;
  latency: number;
  feedStatus: { type: string | null; running: boolean; symbol: string | null };

  // DOM
  dom: DomState;
  prevDom: DomState | null;

  // Time & Sales
  trades: Tick[];

  // Footprint
  currentBar: FootprintBar | null;
  completedBars: FootprintBar[];

  // CVD
  cvd: number;
  sessionCvd: number;
  barDelta: number;
  cvdHistory: { ts: number; cvd: number; price: number }[];

  // Metrics
  metrics: MetricsUpdate | null;

  // Alerts
  alerts: Alert[];
  alertConfigs: AlertConfig[];

  // Settings
  settings: {
    largeTradeSize: number;
    imbalanceRatio: number;
    barIntervalMs: number;
    showImbalances: boolean;
    highlightPoc: boolean;
  };

  // Actions
  setConnected: (v: boolean) => void;
  setLatency: (v: number) => void;
  setFeedStatus: (v: any) => void;
  updateDom: (dom: DomState) => void;
  addTrade: (trade: Tick) => void;
  updateFootprint: (payload: { type: string; bar: FootprintBar }) => void;
  updateCvd: (payload: CvdUpdate) => void;
  updateMetrics: (payload: MetricsUpdate) => void;
  addAlert: (alert: Alert) => void;
  clearAlerts: () => void;
  loadSnapshot: (snapshot: any) => void;
  updateSettings: (settings: Partial<OrderFlowStore['settings']>) => void;
  addAlertConfig: (cfg: AlertConfig) => void;
  removeAlertConfig: (id: string) => void;
}

export const useOrderFlowStore = create<OrderFlowStore>((set) => ({
  connected: false,
  latency: 0,
  feedStatus: { type: null, running: false, symbol: null },
  dom: { bids: [], asks: [], lastUpdate: 0 },
  prevDom: null,
  trades: [],
  currentBar: null,
  completedBars: [],
  cvd: 0,
  sessionCvd: 0,
  barDelta: 0,
  cvdHistory: [],
  metrics: null,
  alerts: [],
  alertConfigs: [],
  settings: {
    largeTradeSize: 50,
    imbalanceRatio: 3.0,
    barIntervalMs: 60000,
    showImbalances: true,
    highlightPoc: true,
  },

  setConnected: (v) => set({ connected: v }),
  setLatency: (v) => set({ latency: v }),
  setFeedStatus: (v) => set({ feedStatus: v }),

  updateDom: (dom) => set(state => ({
    prevDom: state.dom,
    dom
  })),

  addTrade: (trade) => set(state => {
    const trades = [trade, ...state.trades];
    if (trades.length > MAX_TRADES) trades.length = MAX_TRADES;
    return { trades };
  }),

  updateFootprint: (payload) => set(state => {
    if (payload.type === 'bar_complete') {
      const completedBars = [payload.bar, ...state.completedBars].slice(0, 50);
      return { completedBars, currentBar: null };
    }
    return { currentBar: payload.bar };
  }),

  updateCvd: (payload) => set(state => {
    const cvdHistory = [...state.cvdHistory, { ts: Date.now(), cvd: payload.cvd, price: payload.price }];
    if (cvdHistory.length > MAX_CVD_HISTORY) cvdHistory.shift();
    return {
      cvd: payload.cvd,
      sessionCvd: payload.sessionCvd,
      barDelta: payload.barDelta,
      cvdHistory
    };
  }),

  updateMetrics: (payload) => set({ metrics: payload }),

  addAlert: (alert) => set(state => {
    const alerts = [alert, ...state.alerts];
    if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
    return { alerts };
  }),

  clearAlerts: () => set({ alerts: [] }),

  loadSnapshot: (snapshot) => set(state => ({
    dom: snapshot.dom || state.dom,
    trades: (snapshot.trades || []).reverse(),
    currentBar: snapshot.currentBar,
    completedBars: snapshot.completedBars || [],
    cvd: snapshot.cvd || 0,
    sessionCvd: snapshot.sessionCvd || 0,
  })),

  updateSettings: (settings) => set(state => ({
    settings: { ...state.settings, ...settings }
  })),

  addAlertConfig: (cfg) => set(state => ({
    alertConfigs: [...state.alertConfigs.filter(a => a.id !== cfg.id), cfg]
  })),

  removeAlertConfig: (id) => set(state => ({
    alertConfigs: state.alertConfigs.filter(a => a.id !== id)
  })),
}));
