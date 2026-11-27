// Remembers a round so it can be replayed afterwards: where the boxer's
// joints were on every camera frame, what the opponent was doing, and each
// thing that happened (punches landed, avoided, taken).
//
// Nothing is saved to disk or sent anywhere. The round lives in memory until
// the next one starts or the page is closed.

// The joints kept for the replay, in this order. Positions are in metres,
// measured from the middle of the hips, as the body tracker reports them.
export const JOINTS = [
  "nose", "leftEar", "rightEar",
  "leftShoulder", "rightShoulder",
  "leftElbow", "rightElbow",
  "leftWrist", "rightWrist",
  "leftHip", "rightHip",
];

// Events worth showing in a replay, and how much each adds to a highlight.
const HIGHLIGHT_WORTH = { landedCounter: 5, landed: 4, slipped: 3, ducked: 3, blocked: 2, hit: 2 };

export function createSession(meta = {}) {
  const frames = [];
  const events = [];

  return {
    // t is milliseconds since the round began.
    frame(t, world, headY, view) {
      let joints = null;
      if (world) {
        joints = new Float32Array(JOINTS.length * 3);
        JOINTS.forEach((name, i) => {
          const p = world[name];
          joints[i * 3] = p ? p.x : 0;
          joints[i * 3 + 1] = p ? p.y : 0;
          joints[i * 3 + 2] = p ? p.z : 0;
        });
      }
      frames.push({ t, joints, headY, view });
    },

    event(t, event) {
      if (event.type === "strike") events.push({ t, kind: event.result, target: event.target });
      else if (event.type === "landed") events.push({ t, kind: event.counter ? "landedCounter" : "landed", where: event.where });
    },

    finish(score, lengthMs) {
      return { meta, frames, events, score, lengthMs };
    },
  };
}

// The frame at or just before time t.
export function frameAt(session, t) {
  const { frames } = session;
  if (frames.length === 0) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (frames[middle].t <= t) low = middle;
    else high = middle - 1;
  }
  return frames[low];
}

// The boxer's joints at time t, averaged over a few neighbouring frames to
// take the jitter out (depth from a single camera is especially shaky).
export function jointsAt(session, t, windowMs = 45) {
  const { frames } = session;
  if (frames.length === 0) return null;
  const centre = frames.indexOf(frameAt(session, t));
  const sum = new Float32Array(JOINTS.length * 3);
  let count = 0;
  for (let i = centre; i >= 0 && t - frames[i].t <= windowMs; i--) {
    if (frames[i].joints) { for (let k = 0; k < sum.length; k++) sum[k] += frames[i].joints[k]; count++; }
  }
  for (let i = centre + 1; i < frames.length && frames[i].t - t <= windowMs; i++) {
    if (frames[i].joints) { for (let k = 0; k < sum.length; k++) sum[k] += frames[i].joints[k]; count++; }
  }
  if (count === 0) return null;
  const out = {};
  JOINTS.forEach((name, i) => {
    out[name] = { x: sum[i * 3] / count, y: sum[i * 3 + 1] / count, z: sum[i * 3 + 2] / count };
  });
  return out;
}

// The running score at time t, counted from the events so far.
export function tallyAt(session, t) {
  const tally = { landed: 0, avoided: 0, taken: 0 };
  for (const e of session.events) {
    if (e.t > t) break;
    if (e.kind === "landed" || e.kind === "landedCounter") tally.landed++;
    else if (e.kind === "hit") tally.taken++;
    else tally.avoided++;
  }
  return tally;
}

// Picks the best moments of the round for a short clip: the busiest and
// most eventful exchanges, as a list of { from, to } in round time, in
// order, adding up to no more than maxMs.
export function pickHighlights(session, { maxMs = 14000, leadMs = 1500, tailMs = 1800, joinMs = 2500 } = {}) {
  const exchanges = [];
  for (const e of session.events) {
    const last = exchanges[exchanges.length - 1];
    const worth = HIGHLIGHT_WORTH[e.kind] ?? 1;
    if (last && e.t - last.lastT <= joinMs) {
      last.lastT = e.t;
      last.worth += worth;
    } else {
      exchanges.push({ firstT: e.t, lastT: e.t, worth });
    }
  }

  const chosen = [];
  let total = 0;
  for (const x of [...exchanges].sort((a, b) => b.worth - a.worth)) {
    const from = Math.max(0, x.firstT - leadMs);
    const to = Math.min(session.lengthMs, x.lastT + tailMs);
    if (total + (to - from) > maxMs) continue;
    chosen.push({ from, to });
    total += to - from;
  }
  chosen.sort((a, b) => a.from - b.from);

  // A round where nothing happened still gets a clip: its opening seconds.
  if (chosen.length === 0) chosen.push({ from: 0, to: Math.min(session.lengthMs, 6000) });
  return chosen;
}
