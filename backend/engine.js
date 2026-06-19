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

// Score per race: clamp to [380, 499], vary ±30 around avgTarget
function generatePacedScore(avgTarget) {
  const MIN = 380;
  const MAX = 499;
  const clampedAvg = Math.max(MIN, Math.min(MAX, avgTarget));
  const variance = (Math.random() - 0.5) * 60;
  const raw = Math.round(clampedAvg + variance);
  return Math.max(MIN, Math.min(MAX, raw));
}

// Human-like wait between races
function raceWait(raceIndex) {
  if ((raceIndex + 1) % 20 === 0) return Math.floor(1200000 + Math.random() * 1200000); // 20–40 min
  if ((raceIndex + 1) % 5 === 0)  return Math.floor(120000  + Math.random() * 120000);  // 2–4 min
  return Math.floor(35000 + Math.random() * 15000); // 35–50 sec
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

// Shared state
const state = {
  running: false,
  paused: false,
  identities: [],
  leaderboard: [],
  logs: [],
  startedAt: null,
  completedAt: null,
};

function log(msg, identityIndex = null) {
  const entry = { time: new Date().toISOString(), msg, identityIndex };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs.pop();
  console.log(`[${entry.time}] ${msg}`);
}

// Fetch leaderboard and return the score needed to beat rank N.
// If cfg.desiredScore is set, use that directly instead.
async function resolveTargetScore(identity) {
  // If user manually set a desired score, use it
  if (identity.desiredScore && identity.desiredScore > 0) {
    return identity.desiredScore;
  }

  const lb = await getLeaderboard();
  if (!lb || !lb.top || lb.top.length === 0) return null;

  state.leaderboard = lb.top;
  const sorted = [...lb.top].sort((a, b) => a.rank - b.rank);
  const targetPlayer = sorted[identity.targetRank - 1];
  if (!targetPlayer) return null;

  // Beat the current holder of that rank by 1 point
  return targetPlayer.totalScore + 1;
}

async function runIdentity(identityIndex) {
  const identity = state.identities[identityIndex];
  identity.status = 'running';
  identity.startedAt = new Date().toISOString();

  const modeStr = identity.desiredScore > 0
    ? `Target Score: ${identity.desiredScore}`
    : `Target Rank: #${identity.targetRank}`;
  log(`Starting: ${identity.name} | ${identity.email} | ${modeStr}`, identityIndex);

  // Initial target resolution
  let targetScore = await resolveTargetScore(identity);

  if (targetScore === null) {
    // No leaderboard data and no manual score — use max possible strategy
    targetScore = identity.races * 499;
    log(`${identity.name}: no leaderboard data, aiming for max ${targetScore}`, identityIndex);
  } else {
    identity.targetScore = targetScore;
    const maxPossible = (identity.races * 499);
    if (targetScore > maxPossible) {
      identity.status = 'unreachable';
      log(`UNREACHABLE: ${identity.name} needs ${targetScore} but max possible is ${maxPossible} (${identity.races} races × 499)`, identityIndex);
      return;
    }
    log(`${identity.name} needs ${targetScore} pts | ${identity.races} races remaining`, identityIndex);
  }

  let consecutiveErrors = 0;
  let lastTargetRefresh = Date.now();
  const REFRESH_INTERVAL = 20 * 1000; // 20 seconds

  for (let i = 0; i < identity.races; i++) {

    // --- Refresh target score every 20 seconds ---
    if (!identity.desiredScore && Date.now() - lastTargetRefresh > REFRESH_INTERVAL) {
      const freshLb = await getLeaderboard();
      if (freshLb && freshLb.top && freshLb.top.length > 0) {
        state.leaderboard = freshLb.top;
        const sorted = [...freshLb.top].sort((a, b) => a.rank - b.rank);
        const tp = sorted[identity.targetRank - 1];
        if (tp) {
          const newTarget = tp.totalScore + 1;
          if (newTarget !== targetScore) {
            log(`${identity.name} ⚡ target updated: ${targetScore} → ${newTarget} (rank #${identity.targetRank} changed)`, identityIndex);
            targetScore = newTarget;
            identity.targetScore = targetScore;

            // Immediately recheck if now unreachable
            const racesLeft = identity.races - i;
            const scoreLeft = targetScore - identity.totalScore;
            const maxLeft = racesLeft * 499;
            if (scoreLeft > maxLeft) {
              identity.status = 'unreachable';
              log(`UNREACHABLE: ${identity.name} now needs ${scoreLeft} more in ${racesLeft} races (max ${maxLeft})`, identityIndex);
              return;
            }
          }
        }
      }
      lastTargetRefresh = Date.now();
    }

    // --- Pause / stop checks ---
    while (state.paused && state.running) {
      await sleep(2000);
    }
    if (!state.running) {
      identity.status = 'stopped';
      log(`Stopped: ${identity.name}`, identityIndex);
      return;
    }

    // --- Recalculate dynamic avg before each race ---
    const racesLeft = identity.races - i;
    const scoreLeft = Math.max(0, targetScore - identity.totalScore);
    // dynamicAvg = how much we need per remaining race, clamped to [380,499]
    const dynamicAvg = racesLeft > 0 ? Math.min(499, Math.max(380, Math.ceil(scoreLeft / racesLeft))) : 499;
    identity.avgNeeded = dynamicAvg;

    // --- Submit race ---
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

    identity.racesPlayed = data.gamesPlayed;
    identity.totalScore  = data.totalScore;
    identity.lastScore   = payload.score;

    const gap = Math.max(0, targetScore - data.totalScore);
    log(
      `${identity.name} | Race ${i+1}/${identity.races} | +${payload.score} | Total: ${data.totalScore} | Gap: ${gap} | Avg needed: ${dynamicAvg}`,
      identityIndex
    );

    // --- Check if target reached ---
    if (data.totalScore >= targetScore) {
      identity.status = 'reached';
      identity.completedAt = new Date().toISOString();
      const label = identity.desiredScore > 0 ? `score ${identity.desiredScore}` : `rank #${identity.targetRank}`;
      log(`★ TARGET REACHED! ${identity.name} — ${data.totalScore} pts in ${data.gamesPlayed} games (target: ${label})`, identityIndex);
      const updated = await getLeaderboard();
      if (updated && updated.top) state.leaderboard = updated.top;
      return;
    }

    // --- Wait before next race (skip wait on last race) ---
    if (i < identity.races - 1) {
      const wait = raceWait(i);
      identity.nextRaceIn = Math.round(wait / 1000);
      log(`${identity.name} waiting ${Math.round(wait/1000)}s until next race`, identityIndex);

      // During long waits, refresh target score every 20s instead of waiting blindly
      const waitEnd = Date.now() + wait;
      while (Date.now() < waitEnd) {
        const remaining = waitEnd - Date.now();
        const chunk = Math.min(remaining, REFRESH_INTERVAL);
        await sleep(chunk);
        identity.nextRaceIn = Math.round((waitEnd - Date.now()) / 1000);

        // Refresh leaderboard mid-wait if not using manual score
        if (!identity.desiredScore && Date.now() - lastTargetRefresh > REFRESH_INTERVAL) {
          const freshLb = await getLeaderboard();
          if (freshLb && freshLb.top && freshLb.top.length > 0) {
            state.leaderboard = freshLb.top;
            const sorted = [...freshLb.top].sort((a, b) => a.rank - b.rank);
            const tp = sorted[identity.targetRank - 1];
            if (tp) {
              const newTarget = tp.totalScore + 1;
              if (newTarget !== targetScore) {
                log(`${identity.name} ⚡ target updated mid-wait: ${targetScore} → ${newTarget}`, identityIndex);
                targetScore = newTarget;
                identity.targetScore = targetScore;
              }
            }
          }
          lastTargetRefresh = Date.now();
        }

        // Check for pause/stop during the wait
        if (!state.running) {
          identity.status = 'stopped';
          identity.nextRaceIn = 0;
          log(`Stopped: ${identity.name}`, identityIndex);
          return;
        }
        while (state.paused && state.running) await sleep(2000);
      }

      identity.nextRaceIn = 0;
    }
  }

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
      targetRank:   cfg.targetRank   || 1,
      desiredScore: cfg.desiredScore || 0,   // 0 = not set, use rank mode
      races: cfg.races,
      status: 'pending',
      racesPlayed: 0,
      totalScore: 0,
      targetScore: null,
      avgNeeded: null,
      lastScore: null,
      nextRaceIn: 0,
      startedAt: null,
      completedAt: null,
    };
  });

  log(`Campaign started — ${state.identities.length} identities, ${parallelCount} in parallel`);

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
