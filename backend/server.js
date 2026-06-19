const express = require('express');
const cors = require('cors');
const { state, startCampaign, pauseCampaign, resumeCampaign, stopCampaign, getLeaderboard } = require('./engine');

const app = express();
app.use(cors());
app.use(express.json());

// GET current state (frontend polls this every 3s)
app.get('/api/state', (req, res) => {
  res.json({
    running: state.running,
    paused: state.paused,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    identities: state.identities,
    leaderboard: state.leaderboard,
    logs: state.logs.slice(0, 50),
  });
});

// POST start a new campaign
app.post('/api/start', async (req, res) => {
  const { config } = req.body;
  if (!config || !Array.isArray(config) || config.length === 0) {
    return res.status(400).json({ error: 'config must be a non-empty array' });
  }
  for (const c of config) {
    if (!c.targetRank || !c.races) {
      return res.status(400).json({ error: 'each config needs targetRank and races' });
    }
    if (c.targetRank < 1 || c.targetRank > 10) {
      return res.status(400).json({ error: 'targetRank must be 1–10' });
    }
    if (c.races < 1 || c.races > 101) {
      return res.status(400).json({ error: 'races must be 1–101' });
    }
  }
  const result = await startCampaign(config);
  res.json(result);
});

// POST pause
app.post('/api/pause', (req, res) => {
  pauseCampaign();
  res.json({ ok: true });
});

// POST resume
app.post('/api/resume', (req, res) => {
  resumeCampaign();
  res.json({ ok: true });
});

// POST stop
app.post('/api/stop', (req, res) => {
  stopCampaign();
  res.json({ ok: true });
});

// GET live leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const lb = await getLeaderboard();
  res.json(lb || { top: [] });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
