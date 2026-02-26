/**
 * OrderFlow MVP - Main Server
 * WebSocket + REST API for order flow visualization
 */
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

const { FeedManager } = require('./feed/FeedManager');
const { AggregationEngine } = require('./engine/AggregationEngine');
const { ReplayEngine } = require('./engine/ReplayEngine');
const { Database } = require('./utils/Database');
const { createRestRoutes } = require('./api/routes');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Core systems
const db = new Database(path.join(__dirname, '../data/orderflow.db'));
const aggregationEngine = new AggregationEngine();
const feedManager = new FeedManager(aggregationEngine, db);
const replayEngine = new ReplayEngine(aggregationEngine, db);

// REST routes
app.use('/api', createRestRoutes(db, feedManager, replayEngine, aggregationEngine));

// Broadcast to all connected WS clients
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// Hook aggregation engine output to broadcast
aggregationEngine.on('dom_update', d => broadcast('dom_update', d));
aggregationEngine.on('trade', d => broadcast('trade', d));
aggregationEngine.on('footprint_update', d => broadcast('footprint_update', d));
aggregationEngine.on('cvd_update', d => broadcast('cvd_update', d));
aggregationEngine.on('alert', d => broadcast('alert', d));
aggregationEngine.on('metrics_update', d => broadcast('metrics_update', d));

// WS client connection handler
wss.on('connection', (ws, req) => {
  console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);

  // Send current state snapshot on connect
  const snapshot = aggregationEngine.getSnapshot();
  ws.send(JSON.stringify({ type: 'snapshot', data: snapshot, ts: Date.now() }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleClientMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
    }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe':
      // Future: per-client subscriptions
      break;
    case 'set_alert':
      aggregationEngine.setAlert(msg.data);
      ws.send(JSON.stringify({ type: 'alert_set', data: { id: msg.data.id } }));
      break;
    case 'remove_alert':
      aggregationEngine.removeAlert(msg.data.id);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;
  }
}

server.listen(PORT, () => {
  console.log(`\n🚀 OrderFlow Backend running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket available on ws://localhost:${PORT}`);
  console.log(`📊 Starting simulated feed...\n`);
  feedManager.startSimulated();
});

module.exports = { app, server };
