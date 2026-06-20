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
  const MAX = 500;
  // If we need 500 every race to hit target, don't apply variance — return 500 exactly
  if (avgTarget >= 500) return 500;
  const clampedAvg = Math.max(MIN, Math.min(MAX, avgTarget));
  const variance = (Math.random() - 0.5) * 60;
  const raw = Math.round(clampedAvg + variance);
  return Math.max(MIN, Math.min(MAX, raw));
}

function raceWait(raceIndex) {
  const r = Math.random();
  if (r < 0.03) return Math.floor(25 * 60000 + Math.random() * 20 * 60000); // 3%: 25–45 min
  if (r < 0.18) return Math.floor(3  * 60000 + Math.random() *  5 * 60000); // 15%: 3–8 min
  return Math.floor(45000 + Math.random() * 45000);                          // 82%: 45–90 sec
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

// ─── Global state ─────────────────────────────────────────────────────────────
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

// ─── Background leaderboard poller (1 second) ─────────────────────────────────
// One shared poller for all identities — avoids N parallel fetches
let pollerTimer = null;

function startLeaderboardPoller() {
  if (pollerTimer) return;
  pollerTimer = setInterval(async () => {
    if (!state.running) {
      clearInterval(pollerTimer);
      pollerTimer = null;
      return;
    }
    const lb = await getLeaderboard();
    if (!lb || !lb.top || lb.top.length === 0) return;
    state.leaderboard = lb.top;

    // For every running identity, update their targetScore from fresh leaderboard
    const sorted = [...lb.top].sort((a, b) => a.rank - b.rank);
    for (const identity of state.identities) {
      if (identity.status !== 'running') continue;

      const tp = sorted[identity.targetRank - 1];
      if (!tp) continue;

      const liveRankScore = tp.totalScore;

      // If identity is using desired score mode: warn if the rank holder now beats them
      if (identity.desiredScore > 0) {
        if (liveRankScore >= identity.desiredScore && !identity.warnedScoreBeaten) {
          identity.warnedScoreBeaten = true;
          log(
            `⚠ WARNING: ${identity.name} — Rank #${identity.targetRank} holder now has ${liveRankScore} which beats your desired score of ${identity.desiredScore}. Consider stopping and increasing your target.`,
            identity.index
          );
        } else if (liveRankScore < identity.desiredScore) {
          identity.warnedScoreBeaten = false; // reset if they drop back
        }
        continue; // desired score mode: don't change targetScore
      }

      // Rank mode: update targetScore if rank holder changed
      const newTarget = liveRankScore + 1;
      if (newTarget !== identity.targetScore) {
        const racesLeft = identity.races - identity.racesPlayed;
        const scoreLeft = newTarget - identity.totalScore;
        const maxLeft = racesLeft * 499;

        if (scoreLeft > maxLeft && racesLeft > 0) {
          // Became unreachable due to rank jump
          if (identity.status === 'running') {
            identity.status = 'unreachable';
            log(
              `UNREACHABLE: ${identity.name} — rank #${identity.targetRank} jumped to ${liveRankScore}. Need ${scoreLeft} more in ${racesLeft} races (max ${maxLeft}).`,
              identity.index
            );
          }
        } else {
          if (identity.targetScore !== null) {
            log(
              `${identity.name} ⚡ target updated: ${identity.targetScore} → ${newTarget} (rank #${identity.targetRank} is now ${liveRankScore})`,
              identity.index
            );
          }
          identity.targetScore = newTarget;
        }
      }
    }
  }, 1000);
}

// ─── Identity runner ──────────────────────────────────────────────────────────
async function runIdentity(identityIndex) {
  const identity = state.identities[identityIndex];
  identity.status = 'running';
  identity.startedAt = new Date().toISOString();
  identity.warnedScoreBeaten = false;

  const modeStr = identity.desiredScore > 0
    ? `Desired Score: ${identity.desiredScore}`
    : `Target Rank: #${identity.targetRank}`;
  log(`Starting: ${identity.name} | ${identity.email} | ${modeStr}`, identityIndex);

  // ── Resolve initial targetScore ──
  if (identity.desiredScore > 0) {
    identity.targetScore = identity.desiredScore;
    log(`${identity.name}: score override mode — targeting ${identity.desiredScore} pts`, identityIndex);
  } else {
    // Pull from already-cached leaderboard (poller may have it), else fetch once
    const src = state.leaderboard.length > 0 ? state.leaderboard : null;
    if (src) {
      const sorted = [...src].sort((a, b) => a.rank - b.rank);
      const tp = sorted[identity.targetRank - 1];
      if (tp) identity.targetScore = tp.totalScore + 1;
    }

    if (!identity.targetScore) {
      // Explicit fetch if poller hasn't fired yet
      const lb = await getLeaderboard();
      if (lb && lb.top && lb.top.length > 0) {
        state.leaderboard = lb.top;
        const sorted = [...lb.top].sort((a, b) => a.rank - b.rank);
        const tp = sorted[identity.targetRank - 1];
        if (tp) identity.targetScore = tp.totalScore + 1;
      }
    }

    if (!identity.targetScore) {
      identity.targetScore = identity.races * 499; // fallback: go max
      log(`${identity.name}: no leaderboard data yet, targeting max ${identity.targetScore}`, identityIndex);
    } else {
      const maxPossible = identity.races * 499;
      if (identity.targetScore > maxPossible) {
        identity.status = 'unreachable';
        log(`UNREACHABLE: ${identity.name} needs ${identity.targetScore} but max possible is ${maxPossible}`, identityIndex);
        return;
      }
      log(`${identity.name} initial target: ${identity.targetScore} pts over ${identity.races} races`, identityIndex);
    }
  }

  let consecutiveErrors = 0;

  for (let i = 0; i < identity.races; i++) {

    // Stop if poller marked us unreachable
    if (identity.status === 'unreachable') return;

    // Pause / stop
    while (state.paused && state.running) await sleep(2000);
    if (!state.running) {
      identity.status = 'stopped';
      log(`Stopped: ${identity.name}`, identityIndex);
      return;
    }

    // Recalculate dynamicAvg from live targetScore (updated by poller)
    const racesLeft = identity.races - i;
    const scoreLeft = Math.max(0, identity.targetScore - identity.totalScore);
    const dynamicAvg = Math.min(500, Math.max(380, Math.ceil(scoreLeft / racesLeft)));
    identity.avgNeeded = dynamicAvg;

    // Submit race
    let result = await submitScore(identity.name, identity.email, dynamicAvg);

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

    const gap = Math.max(0, identity.targetScore - data.totalScore);
    log(
      `${identity.name} | Race ${i+1}/${identity.races} | +${payload.score} | Total: ${data.totalScore.toLocaleString()} | Gap: ${gap} | Avg needed: ${dynamicAvg}`,
      identityIndex
    );

    // Target reached?
    if (data.totalScore >= identity.targetScore) {
      identity.status = 'reached';
      identity.completedAt = new Date().toISOString();
      const label = identity.desiredScore > 0
        ? `score ${identity.desiredScore.toLocaleString()}`
        : `rank #${identity.targetRank}`;
      log(`★ TARGET REACHED! ${identity.name} — ${data.totalScore.toLocaleString()} pts in ${data.gamesPlayed} games (${label})`, identityIndex);
      return;
    }

    // Wait before next race — sleep in 1s chunks so poller updates stay live
    if (i < identity.races - 1) {
      const wait = raceWait(i);
      const waitEnd = Date.now() + wait;
      identity.nextRaceIn = Math.round(wait / 1000);
      log(`${identity.name} waiting ${Math.round(wait/1000)}s until next race`, identityIndex);

      while (Date.now() < waitEnd) {
        if (!state.running) {
          identity.status = 'stopped';
          identity.nextRaceIn = 0;
          log(`Stopped: ${identity.name}`, identityIndex);
          return;
        }
        if (identity.status === 'unreachable') { identity.nextRaceIn = 0; return; }
        while (state.paused && state.running) await sleep(1000);
        await sleep(1000);
        identity.nextRaceIn = Math.max(0, Math.round((waitEnd - Date.now()) / 1000));
      }

      identity.nextRaceIn = 0;
    }
  }

  identity.status = 'completed';
  identity.completedAt = new Date().toISOString();
  log(`Completed all ${identity.races} races: ${identity.name} — final score ${identity.totalScore.toLocaleString()}`, identityIndex);
}

// ─── Campaign control ─────────────────────────────────────────────────────────
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
      desiredScore: cfg.desiredScore || 0,
      races: cfg.races,
      status: 'pending',
      racesPlayed: 0,
      totalScore: 0,
      targetScore: null,
      avgNeeded: null,
      lastScore: null,
      nextRaceIn: 0,
      warnedScoreBeaten: false,
      startedAt: null,
      completedAt: null,
    };
  });

  log(`Campaign started — ${state.identities.length} identities, ${parallelCount} in parallel`);

  // Start the shared 1-second leaderboard poller
  startLeaderboardPoller();

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
