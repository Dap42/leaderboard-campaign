const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'https://api-g5leosq2cq-el.a.run.app';
const ORIGIN = 'https://redmiturbo5.com';

const firstNames = [
  "Aarav","Vivaan","Aditya","Vihaan","Arjun","Sai","Reyansh","Ayaan","Krishna","Ishaan",
  "Priya","Ananya","Diya","Kavya","Riya","Neha","Pooja","Anjali","Shreya","Aakanksha",
  "Rohit","Rahul","Amit","Suresh","Rajesh","Vikas","Deepak","Manish","Sandeep","Nikhil",
  "Sunita","Meena","Rekha","Geeta","Usha","Lakshmi","Sarita","Kamla","Pushpa","Radha",
  "Aryan","Dev","Karan","Rohan","Varun","Shivam","Tushar","Gaurav","Himanshu","Akash",
  "Mohit","Sachin","Ravi","Sanjay","Vinod","Manoj","Prakash","Dinesh","Ramesh","Sunil",
  "Priyanka","Swati","Divya","Sneha","Preeti","Komal","Nisha","Shweta","Payal","Simran"
];

const lastNames = [
  "Sharma","Patel","Singh","Gupta","Verma","Joshi","Kumar","Nair","Mehta","Shah",
  "Yadav","Mishra","Tiwari","Pandey","Dubey","Chauhan","Soni","Rawat","Rana","Bose",
  "Kapoor","Malhotra","Chopra","Saxena","Aggarwal","Garg","Bansal","Agarwal","Bhatt","Dixit",
  "Reddy","Rao","Iyer","Pillai","Menon","Naidu","Nambiar","Krishnan","Subramanian","Rajan",
  "Thakur","Bhatia","Arora","Bajaj","Sethi","Khanna","Anand","Chawla","Ahuja","Sodhi"
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateIdentity() {
  const first = randomFrom(firstNames);
  const last = randomFrom(lastNames);
  const name = `${first} ${last}`;
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const num = Math.floor(Math.random() * 8999) + 1000;
  const yr = [1995,1996,1997,1998,1999,2000,2001,2002,2003][Math.floor(Math.random()*9)];
  const short = Math.floor(Math.random() * 99) + 1;
  const patterns = [
    `${f}.${l}${num}`, `${f}${l}${num}`, `${f}_${l}_${short}`,
    `${f}${yr}`, `${l}.${f}${short}`, `${f}${l}${yr}`,
    `${f}.${short}.${l}`, `${l}${num}${f.charAt(0)}`,
  ];
  const base = randomFrom(patterns);
  const noise = Math.random() > 0.5 ? Math.floor(Math.random() * 999) : "";
  return { name, email: `${base}${noise}@gmail.com` };
}

function generateHumanRaceTime() {
  const base = 31 + Math.random() * 10;
  const drift = Math.random() * 0.9999 + Math.random() * 0.00001;
  return parseFloat((base + drift).toFixed(14));
}

function generateHumanPickups() {
  const r = Math.random();
  if (r < 0.70) return 18;
  if (r < 0.90) return 17;
  return 15 + Math.floor(Math.random() * 2);
}

function generatePacedScore(avgTarget) {
  const MIN = 380;
  const MAX = 499;
  const clampedAvg = Math.max(MIN, Math.min(MAX, avgTarget));
  const variance = (Math.random() - 0.5) * 60;
  const raw = Math.round(clampedAvg + variance);
  return Math.max(MIN, Math.min(MAX, raw));
}

// Human-like wait between races: 35–50 seconds
function raceWait(raceIndex) {
  // Every 5th race take a longer break (2–4 min)
  if ((raceIndex + 1) % 5 === 0) {
    return Math.floor(120000 + Math.random() * 120000); // 2–4 min
  }
  // Every 20th race take a big break (20–40 min)
  if ((raceIndex + 1) % 20 === 0) {
    return Math.floor(1200000 + Math.random() * 1200000); // 20–40 min
  }
  // Normal: 35–50 seconds
  return Math.floor(35000 + Math.random() * 15000);
}

async function getLeaderboard() {
  try {
    const resp = await fetch(`${BASE_URL}/leaderboard?limit=10`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Origin': ORIGIN,
        'Referer': `${ORIGIN}/`
      }
    });
    return await resp.json();
  } catch (e) {
    return null;
  }
}

async function submitScore(name, email, avgScoreTarget) {
  const raceTimeSeconds = generateHumanRaceTime();
  const pickups = generateHumanPickups();
  const score = generatePacedScore(avgScoreTarget);

  const payload = {
    name, email, score,
    carUsed: "red",
    raceTimeSeconds, pickups,
    requestId: uuidv4()
  };

  const resp = await fetch(`${BASE_URL}/leaderboard/score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN,
      'Referer': `${ORIGIN}/`
    },
    body: JSON.stringify(payload)
  });

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('Retry-After');
    return { error: 'rate_limit', retryAfter: retryAfter ? parseInt(retryAfter, 10) : null };
  }
  if (!resp.ok) return { error: `http_${resp.status}` };

  const data = await resp.json();
  return { payload, data };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Global campaign state — shared with server.js via reference
const state = {
  running: false,
  paused: false,
  identities: [],       // live status of each identity
  leaderboard: [],      // latest top 10
  logs: [],             // rolling log of last 200 events
  startedAt: null,
  completedAt: null,
};

function log(msg, identityIndex = null) {
  const entry = {
    time: new Date().toISOString(),
    msg,
    identityIndex
  };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs.pop();
  console.log(`[${entry.time}] ${msg}`);
}

async function runIdentity(identityIndex) {
  const identity = state.identities[identityIndex];
  identity.status = 'running';
  identity.startedAt = new Date().toISOString();

  log(`Starting: ${identity.name} | ${identity.email} | Target Rank #${identity.targetRank}`, identityIndex);

  // Fetch live leaderboard for target score
  const lb = await getLeaderboard();
  let targetScore = null;
  let avgScoreNeeded = 437; // safe default

  if (lb && lb.top && lb.top.length > 0) {
    state.leaderboard = lb.top;
    const sorted = [...lb.top].sort((a, b) => a.rank - b.rank);
    const targetPlayer = sorted[identity.targetRank - 1];

    if (targetPlayer) {
      targetScore = targetPlayer.totalScore + 1;
      avgScoreNeeded = Math.ceil(targetScore / identity.races);
      identity.targetScore = targetScore;
      identity.avgNeeded = avgScoreNeeded;

      const maxPossible = identity.races * 499;
      if (targetScore > maxPossible) {
        identity.status = 'unreachable';
        log(`UNREACHABLE: ${identity.name} needs ${targetScore} but max is ${maxPossible}`, identityIndex);
        return;
      }

      log(`${identity.name} needs ${targetScore} pts | avg ${avgScoreNeeded}/race over ${identity.races} races`, identityIndex);
    }
  }

  let dynamicAvg = avgScoreNeeded;
  let consecutiveErrors = 0;
  let lastTargetRefresh = Date.now();

  for (let i = 0; i < identity.races; i++) {
    // Re-fetch leaderboard every 30 minutes to keep target score fresh
    if (Date.now() - lastTargetRefresh > 20 * 1000) {
      const freshLb = await getLeaderboard();
      if (freshLb && freshLb.top && freshLb.top.length > 0) {
        state.leaderboard = freshLb.top;
        const sorted = [...freshLb.top].sort((a, b) => a.rank - b.rank);
        const tp = sorted[identity.targetRank - 1];
        if (tp) {
          const newTarget = tp.totalScore + 1;
          if (newTarget !== targetScore) {
            log(`${identity.name} target updated: ${targetScore} → ${newTarget} (rank #${identity.targetRank} changed)`, identityIndex);
            targetScore = newTarget;
            identity.targetScore = targetScore;
          }
        }
      }
      lastTargetRefresh = Date.now();
    }
    // Check for pause or stop
    while (state.paused && state.running) {
      await sleep(2000);
    }
    if (!state.running) {
      identity.status = 'stopped';
      log(`Stopped: ${identity.name}`, identityIndex);
      return;
    }

    let result = await submitScore(identity.name, identity.email, dynamicAvg);

    // Rate limit recovery
    while (result.error === 'rate_limit') {
      consecutiveErrors++;
      const wait = result.retryAfter || Math.min(60, 15 * consecutiveErrors);
      log(`[429] ${identity.name} — waiting ${wait}s`, identityIndex);
      await sleep(wait * 1000);
      result = await submitScore(identity.name, identity.email, dynamicAvg);
    }

    if (result.error) {
      log(`[ERR] ${identity.name} race ${i+1}: ${result.error}`, identityIndex);
      continue;
    }

    consecutiveErrors = 0;
    const { payload, data } = result;

    // Update identity state
    identity.racesPlayed = data.gamesPlayed;
    identity.totalScore = data.totalScore;
    identity.lastScore = payload.score;
    identity.lastRaceTime = payload.raceTimeSeconds;
    identity.lastPickups = payload.pickups;

    // Recalculate dynamic avg
    if (targetScore && data.totalScore < targetScore) {
      const remaining = targetScore - data.totalScore;
      const remainingRaces = identity.races - data.gamesPlayed;
      if (remainingRaces > 0) {
        dynamicAvg = Math.ceil(remaining / remainingRaces);
        identity.avgNeeded = dynamicAvg;
      }
    }

    const gap = targetScore ? Math.max(0, targetScore - data.totalScore) : '?';
    log(
      `${identity.name} | Race ${i+1}/${identity.races} | +${payload.score} | Total: ${data.totalScore} | Gap to #${identity.targetRank}: ${gap}`,
      identityIndex
    );

    // Check if target reached
    if (targetScore && data.totalScore >= targetScore) {
      identity.status = 'reached';
      identity.completedAt = new Date().toISOString();
      log(`★ RANK #${identity.targetRank} REACHED! ${identity.name} — ${data.totalScore} pts in ${data.gamesPlayed} games`, identityIndex);

      // Refresh leaderboard
      const updated = await getLeaderboard();
      if (updated && updated.top) state.leaderboard = updated.top;
      return;
    }

    // Human wait between races
    if (i < identity.races - 1) {
      const wait = raceWait(i);
      identity.nextRaceIn = Math.round(wait / 1000);
      log(`${identity.name} waiting ${Math.round(wait/1000)}s until next race`, identityIndex);
      await sleep(wait);
      identity.nextRaceIn = 0;
    }
  }

  // Completed all races without hitting target
  identity.status = 'completed';
  identity.completedAt = new Date().toISOString();
  log(`Completed all ${identity.races} races: ${identity.name} — final score ${identity.totalScore}`, identityIndex);
}

async function startCampaign(config, parallelCount = 1) {
  if (state.running) return { error: 'Campaign already running' };

  state.running = true;
  state.paused = false;
  state.logs = [];
  state.startedAt = new Date().toISOString();
  state.completedAt = null;

  const usedEmails = new Set();
  state.identities = config.map((cfg, i) => {
    let identity;
    do { identity = generateIdentity(); }
    while (usedEmails.has(identity.email));
    usedEmails.add(identity.email);

    return {
      index: i,
      name: identity.name,
      email: identity.email,
      targetRank: cfg.targetRank,
      races: cfg.races,
      status: 'pending',
      racesPlayed: 0,
      totalScore: 0,
      targetScore: null,
      avgNeeded: null,
      lastScore: null,
      lastRaceTime: null,
      lastPickups: null,
      nextRaceIn: 0,
      startedAt: null,
      completedAt: null,
    };
  });

  log(`Campaign started — ${state.identities.length} identities, ${parallelCount} running in parallel`);

  // Run identities in batches of parallelCount
  (async () => {
    const total = state.identities.length;
    for (let i = 0; i < total; i += parallelCount) {
      if (!state.running) break;
      const batch = state.identities.slice(i, i + parallelCount).map(id => id.index);
      log(`Starting batch: identities ${batch.map(b => b + 1).join(', ')}`);
      await Promise.all(batch.map(idx => runIdentity(idx)));
    }
    state.running = false;
    state.completedAt = new Date().toISOString();
    log('Campaign complete');
  })();

  return { ok: true };
}

  return { ok: true };
}

function pauseCampaign() {
  state.paused = true;
  log('Campaign paused');
}

function resumeCampaign() {
  state.paused = false;
  log('Campaign resumed');
}

function stopCampaign() {
  state.running = false;
  state.paused = false;
  log('Campaign stopped');
}

module.exports = { state, startCampaign, pauseCampaign, resumeCampaign, stopCampaign, getLeaderboard };
