/**
 * REST API routes
 */
const express = require('express');

function createRestRoutes(db, feedManager, replayEngine, aggregationEngine) {
  const router = express.Router();

  // Health
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: Date.now(), feed: feedManager.getStatus() });
  });

  // Feed control
  router.post('/feed/start', (req, res) => {
    const { type, symbol, config } = req.body;
    try {
      if (type === 'simulated' || !type) {
        feedManager.startSimulated(symbol || 'ES', config || {});
        res.json({ status: 'started', type: 'simulated', symbol: symbol || 'ES' });
      } else {
        res.status(400).json({ error: 'Feed type not supported yet: ' + type });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/feed/stop', (req, res) => {
    feedManager.stop();
    res.json({ status: 'stopped' });
  });

  router.get('/feed/status', (req, res) => {
    res.json(feedManager.getStatus());
  });

  // Replay
  router.post('/replay/load', async (req, res) => {
    const { symbol, fromTs, toTs } = req.body;
    try {
      const result = await replayEngine.load(symbol, fromTs, toTs);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/replay/play', (req, res) => {
    const { speed } = req.body;
    try {
      const result = replayEngine.play(speed);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.post('/replay/pause', (req, res) => res.json(replayEngine.pause()));
  router.post('/replay/stop', (req, res) => res.json(replayEngine.stop()));
  router.get('/replay/status', (req, res) => res.json(replayEngine.getStatus()));

  // Export
  router.get('/export/ticks', (req, res) => {
    const { symbol, fromTs, toTs } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const csv = db.exportTicksCsv(symbol, parseInt(fromTs) || 0, parseInt(toTs) || Date.now());
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${symbol}_ticks.csv"`);
    res.send(csv);
  });

  // Tick stats
  router.get('/ticks/stats', (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    res.json({ symbol, count: db.getTickCount(symbol) });
  });

  // Settings
  router.get('/settings', (req, res) => {
    const settings = db.getSetting('app_settings', {});
    res.json(settings);
  });

  router.post('/settings', (req, res) => {
    db.setSetting('app_settings', req.body);
    res.json({ status: 'saved' });
  });

  // Session snapshot
  router.get('/snapshot', (req, res) => {
    res.json(aggregationEngine.getSnapshot());
  });

  // Alerts
  router.get('/alerts', (req, res) => {
    const alerts = Array.from(aggregationEngine.alerts.values());
    res.json(alerts);
  });

  router.post('/alerts', (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    const alert = { ...req.body, id: req.body.id || uuidv4(), enabled: true };
    aggregationEngine.setAlert(alert);
    res.json(alert);
  });

  router.delete('/alerts/:id', (req, res) => {
    aggregationEngine.removeAlert(req.params.id);
    res.json({ status: 'removed', id: req.params.id });
  });

  return router;
}

module.exports = { createRestRoutes };
