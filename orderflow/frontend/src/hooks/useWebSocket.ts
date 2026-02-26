/**
 * WebSocket hook - connects to backend, dispatches messages to store
 * Supports Codespaces/cloud environments via VITE_WS_URL env var
 */
import { useEffect, useRef, useCallback } from 'react';
import { useOrderFlowStore } from '../store/useOrderFlowStore';
import type { WsMessage } from '../types';

// In Codespaces, VITE_WS_URL is set automatically via .env
// Locally it falls back to ws://localhost:3001
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export { API_BASE };

const MAX_RECONNECT_DELAY = 10000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(500);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTs = useRef(0);

  const store = useOrderFlowStore();

  const pendingTrades = useRef<any[]>([]);
  const rafScheduled = useRef(false);

  const flushTrades = useCallback(() => {
    rafScheduled.current = false;
    const batch = pendingTrades.current.splice(0);
    batch.forEach(t => store.addTrade(t));
  }, []);

  const dispatch = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'snapshot':    store.loadSnapshot(msg.data); break;
      case 'dom_update':  store.updateDom(msg.data); break;
      case 'trade':
        pendingTrades.current.push(msg.data);
        if (!rafScheduled.current) {
          rafScheduled.current = true;
          requestAnimationFrame(flushTrades);
        }
        break;
      case 'footprint_update': store.updateFootprint(msg.data); break;
      case 'cvd_update':       store.updateCvd(msg.data); break;
      case 'metrics_update':   store.updateMetrics(msg.data); break;
      case 'alert':            store.addAlert(msg.data); break;
      case 'pong':             store.setLatency(Date.now() - pingTs.current); break;
    }
  }, [flushTrades]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to', WS_URL);
        store.setConnected(true);
        reconnectDelay.current = 500;
        pingInterval.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            pingTs.current = Date.now();
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        try {
          dispatch(JSON.parse(event.data) as WsMessage);
        } catch (e) { console.error('[WS] Parse error', e); }
      };

      ws.onclose = () => {
        store.setConnected(false);
        if (pingInterval.current) clearInterval(pingInterval.current);
        setTimeout(connect, reconnectDelay.current);
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
      };

      ws.onerror = () => ws.close();
    } catch (e) {
      setTimeout(connect, reconnectDelay.current);
    }
  }, [dispatch]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (pingInterval.current) clearInterval(pingInterval.current);
    };
  }, [connect]);

  const send = useCallback((msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
