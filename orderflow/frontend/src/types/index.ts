export interface Tick {
  id: string;
  symbol: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  delta: number;
  bid: number;
  ask: number;
  ts: number;
}

export interface DomEntry {
  price: number;
  size: number;
}

export interface DomState {
  bids: [number, number][];
  asks: [number, number][];
  lastUpdate: number;
}

export interface FootprintLevel {
  buyVol: number;
  sellVol: number;
  delta: number;
  trades: number;
}

export interface FootprintImbalance {
  price: number;
  type: 'ask_imbalance' | 'bid_imbalance';
}

export interface FootprintBar {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  poc: number;
  levels: Record<string, FootprintLevel>;
  imbalances: FootprintImbalance[];
}

export interface CvdUpdate {
  cvd: number;
  sessionCvd: number;
  barDelta: number;
  price: number;
}

export interface MetricsUpdate {
  speed1s: number;
  speed5s: number;
  absorption: {
    detected: boolean;
    priceRange?: number;
    totalVolume?: number;
    buyVol?: number;
    sellVol?: number;
    bias?: 'buy' | 'sell';
  } | null;
  domBalance: {
    bidLiq: number;
    askLiq: number;
    ratio: number;
    bias: 'bid_heavy' | 'ask_heavy' | 'balanced';
  } | null;
  ts: number;
}

export interface Alert {
  id: string;
  type: 'large_print' | 'delta_threshold' | 'tape_speed' | 'dom_imbalance';
  message: string;
  data: any;
  ts: number;
  alertId?: string;
}

export interface AlertConfig {
  id: string;
  type: string;
  threshold: number;
  enabled: boolean;
}

export interface Snapshot {
  dom: DomState;
  trades: Tick[];
  currentBar: FootprintBar | null;
  completedBars: FootprintBar[];
  cvd: number;
  sessionCvd: number;
}

export type WsMessage =
  | { type: 'snapshot'; data: Snapshot; ts: number }
  | { type: 'dom_update'; data: DomState; ts: number }
  | { type: 'trade'; data: Tick; ts: number }
  | { type: 'footprint_update'; data: { type: 'bar_update' | 'bar_complete'; bar: FootprintBar }; ts: number }
  | { type: 'cvd_update'; data: CvdUpdate; ts: number }
  | { type: 'alert'; data: Alert; ts: number }
  | { type: 'metrics_update'; data: MetricsUpdate; ts: number }
  | { type: 'pong'; ts: number };
