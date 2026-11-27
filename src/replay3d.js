// The 3D replay: two glowing skeletons in a ring, rebuilt from a recorded
// round. The boxer's upper body moves exactly as it was tracked; the
// opponent replays what it did. Everything is real 3D geometry, drawn onto
// an ordinary canvas so that it can also be captured as a video.
//
// The ring's coordinates, in metres: x runs from the boxer towards the
// opponent, y is up from the floor, z is across the ring. The boxer stands
// at -x facing +x; the opponent stands at +x facing back.

import { frameAt, jointsAt, tallyAt } from "./session.js";

const BOXER_X = -0.52;
const OPPONENT_X = 0.52;
const HIP_HEIGHT = 0.9;
const BOXER = "#ffffff";
const OPPONENT = "#ff2d3d";
const GRID = "#2b2d31";
const ROPE = "#5c5f65";

// --- small vector helpers -------------------------------------------------
const v = (x, y, z) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => v(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => {
  const l = length(a);
  return l > 1e-6 ? mul(a, 1 / l) : v(0, 1, 0);
};
const lerp3 = (a, b, k) => add(a, mul(sub(b, a), k));
const mid = (a, b) => lerp3(a, b, 0.5);
const ease = (k) => k * k * (3 - 2 * k);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Where the middle joint of a two-bone limb goes (elbow or knee): the two
// bones have fixed lengths, and the joint bends towards `pole`.
export function bend(root, tip, upper, lower, pole) {
  const reach = sub(tip, root);
  const d = clamp(length(reach), Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
  const dir = unit(reach);
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const side = unit(sub(pole, mul(dir, dot(pole, dir))));
  return add(add(root, mul(dir, along)), mul(side, out));
}

// --- the camera -----------------------------------------------------------
// eye and target are points in the ring; fov is the vertical view angle.
export function makeCamera(eye, target, width, height, fov = 38) {
  const forward = unit(sub(target, eye));
  const right = unit(cross(forward, v(0, 1, 0)));
  const up = cross(right, forward);
  const focal = height / 2 / Math.tan((fov * Math.PI) / 360);
  return {
    // Returns where a point lands on the screen and its size scale there,
    // or null if it is behind the camera.
    project(p) {
      const d = sub(p, eye);
      const depth = dot(d, forward);
      if (depth < 0.15) return null;
      return {
        x: width / 2 + (dot(d, right) / depth) * focal,
        y: height / 2 - (dot(d, up) / depth) * focal,
        scale: focal / depth,
        depth,
      };
    },
  };
}

// --- the boxer's skeleton, from tracked joints ------------------------------
// The tracker measures from the hips, with x to the boxer's left, y down
// and z away from the camera. The boxer faced the camera, so "towards the
// camera" becomes "towards the opponent".
function boxerJoints(tracked, crouch) {
  const base = v(BOXER_X, HIP_HEIGHT - crouch, 0);
  const place = (p) => add(base, v(clamp(-p.z, -0.6, 0.95), -p.y, -p.x));
  const j = {};
  for (const name of Object.keys(tracked)) j[name] = place(tracked[name]);
  return j;
}

// --- the opponent's skeleton, from what it was doing ------------------------
// Glove positions for each pose: f is how far forward of its shoulders,
// u the height above the floor, l how far out to the side.
const GLOVE = {
  high: { f: 0.24, u: 1.5, l: 0.1 },
  wide: { f: 0.24, u: 1.5, l: 0.17 },
  low: { f: 0.26, u: 1.2, l: 0.08 },
  dropped: { f: 0.14, u: 1.0, l: 0.25 },
  missed: { f: 0.5, u: 1.25, l: 0.15 },
  cover: { f: 0.32, u: 1.52, l: 0.05 },
  coverBody: { f: 0.32, u: 1.2, l: 0.05 },
  loaded: { f: -0.04, u: 1.45, l: 0.3 },
  loadedBody: { f: 0, u: 1.1, l: 0.28 },
};
// Where its punches are aimed: the boxer's head and body in guard. If the
// boxer has moved off that spot, the punch visibly misses.
const AIM = { head: v(BOXER_X + 0.1, 1.5, 0), body: v(BOXER_X + 0.16, 1.12, 0) };

function opponentJoints(view) {
  const hurt = view.state === "hurt" ? 1 - view.progress : 0;
  const lean = view.state === "recover" ? 0.1 : 0;
  const chest = v(OPPONENT_X - 0.04 - lean + hurt * 0.05, 1.42, 0);
  const j = {
    leftHip: v(OPPONENT_X, HIP_HEIGHT, 0.1),
    rightHip: v(OPPONENT_X, HIP_HEIGHT, -0.1),
    leftShoulder: add(chest, v(0, 0, 0.2)),
    rightShoulder: add(chest, v(0, 0, -0.2)),
    head: add(chest, v(-0.03 + hurt * 0.1, 0.2 + hurt * 0.02, 0)),
    facing: v(-1, 0, 0),
  };

  // side -1 is the arm on the boxer's left as he looks at it (z below zero).
  const glove = (name, side) => {
    const g = GLOVE[name];
    return v(chest.x - g.f, g.u, side * g.l);
  };
  const rest = (open, side) => {
    if (open === "head") return glove("low", side);
    if (open === "chest") return glove("wide", side);
    return glove("high", side);
  };
  const punching = view.hand === "left" ? -1 : 1;
  const toBody = view.target === "body";
  const k = ease(view.shift ?? 1);

  for (const side of [-1, 1]) {
    const guard = lerp3(rest(view.wasOpen ?? view.open, side), rest(view.open, side), k);
    let hand = guard;
    const p = view.progress;
    if (view.state === "open") {
      const down = p < 0.85 ? ease(Math.min(1, p / 0.15)) : ease((1 - p) / 0.15);
      hand = lerp3(guard, glove("dropped", side), down);
    } else if (view.state === "recover") {
      const exposed = glove(side === punching ? "missed" : "dropped", side);
      hand = lerp3(exposed, guard, p < 0.8 ? 0 : ease((p - 0.8) / 0.2));
    } else if (view.state === "hurt") {
      hand = lerp3(glove("dropped", side), guard, ease(p));
    } else if (view.state === "guard" && view.cover > 0) {
      hand = lerp3(guard, glove(view.coverWhere === "body" ? "coverBody" : "cover", side), ease(view.cover));
    } else if (side === punching && view.state === "windup") {
      hand = lerp3(guard, glove(toBody ? "loadedBody" : "loaded", side), ease(Math.min(1, p / 0.4)));
    } else if (side === punching && view.state === "strike") {
      const out = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65);
      hand = lerp3(glove(toBody ? "loadedBody" : "loaded", side), toBody ? AIM.body : AIM.head, out);
    }
    const shoulder = side === 1 ? j.leftShoulder : j.rightShoulder;
    // Elbows hang down and out; one lifts away to show an open flank.
    const flank = view.open === "liver" ? -1 : view.open === "side" ? 1 : 0;
    const pole = v(0.2, side === flank ? -0.2 : -1, side * (side === flank ? 1.2 : 0.5));
    const elbow = bend(shoulder, hand, 0.3, 0.32, pole);
    const name = side === 1 ? "left" : "right";
    j[name + "Wrist"] = hand;
    j[name + "Elbow"] = elbow;
  }
  return j;
}

// --- turning joints into bones to draw ---------------------------------------
// Returns { lines: [[a, b, thickness]], balls: [[centre, radius, dark]] },
// all in metres. `forward` is the way the fighter faces and `leadSide`
// which foot is in front.
function skeleton(j, forward, leadSide) {
  const lines = [];
  const balls = [];
  const bone = (a, b, w = 0.022) => lines.push([a, b, w]);

  const neck = add(mid(j.leftShoulder, j.rightShoulder), v(0, 0.04, 0));
  const pelvis = mid(j.leftHip, j.rightHip);
  const spine = unit(sub(pelvis, neck));
  const across = unit(sub(j.leftShoulder, j.rightShoulder));
  const depth = unit(cross(across, spine));
  const torso = length(sub(pelvis, neck));

  // Spine, with a tick for each vertebra.
  bone(neck, pelvis, 0.016);
  for (let i = 0; i <= 10; i++) {
    const c = add(neck, mul(spine, (torso * i) / 10));
    bone(add(c, mul(across, -0.022)), add(c, mul(across, 0.022)), 0.02);
  }

  // Rib cage: hoops round the spine, widest in the middle.
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    const c = add(add(neck, mul(spine, torso * (0.1 + 0.08 * i))), mul(depth, -0.03));
    const wide = 0.1 + 0.07 * Math.sin(Math.PI * (0.2 + 0.65 * k));
    const deep = 0.07 + 0.04 * Math.sin(Math.PI * (0.2 + 0.65 * k));
    let previous = null;
    for (let s = 0; s <= 14; s++) {
      const a = (Math.PI * 2 * s) / 14;
      const p = add(add(c, mul(across, Math.cos(a) * wide)), mul(depth, Math.sin(a) * deep));
      if (previous) bone(previous, p, 0.012);
      previous = p;
    }
  }

  // Collar bones and pelvis.
  bone(neck, j.leftShoulder, 0.02);
  bone(neck, j.rightShoulder, 0.02);
  bone(j.leftHip, j.rightHip, 0.035);
  bone(pelvis, add(pelvis, mul(spine, -0.08)), 0.03);

  // Arms, with boxing gloves.
  for (const side of ["left", "right"]) {
    const shoulder = j[side + "Shoulder"];
    const elbow = j[side + "Elbow"];
    const wrist = j[side + "Wrist"];
    balls.push([shoulder, 0.035]);
    if (!elbow || !wrist) continue;
    bone(shoulder, elbow, 0.028);
    bone(elbow, wrist, 0.022);
    balls.push([elbow, 0.03]);
    balls.push([add(wrist, mul(unit(sub(wrist, elbow)), 0.06)), 0.075]);
  }

  // Legs. They are not tracked: the feet stay planted in a boxing stance,
  // lead foot towards the other fighter, and the knees bend as the hips drop.
  for (const side of ["left", "right"]) {
    const hip = j[side + "Hip"];
    const outward = Math.sign(hip.z - pelvis.z) || (side === "left" ? 1 : -1);
    const lead = side === leadSide;
    const ankle = v(pelvis.x + forward.x * (lead ? 0.24 : -0.2), 0.05, pelvis.z + outward * 0.19);
    const knee = bend(hip, ankle, 0.46, 0.46, add(forward, v(0, 0.3, 0)));
    bone(hip, knee, 0.03);
    bone(knee, ankle, 0.024);
    bone(ankle, add(ankle, mul(forward, 0.2)), 0.024);
    balls.push([knee, 0.035]);
  }

  // Skull: cranium, jaw, and dark eye sockets on the side it faces.
  const head = j.head;
  bone(neck, add(head, v(0, -0.09, 0)), 0.024);
  balls.push([head, 0.105]);
  balls.push([add(head, add(mul(forward, 0.03), v(0, -0.085, 0))), 0.07]);
  for (const s of [-1, 1]) {
    balls.push([add(head, add(mul(forward, 0.088), add(mul(across, s * 0.042), v(0, 0.012, 0)))), 0.03, true]);
  }
  return { lines, balls };
}

// The boxer's skull centre: between the ears when they were seen, else
// just behind the nose.
function boxerHead(j) {
  const ears = mid(j.leftEar, j.rightEar);
  const fromNose = add(j.nose, v(-0.08, 0, 0));
  return length(sub(ears, j.nose)) < 0.2 ? lerp3(ears, fromNose, 0.3) : fromNose;
}

// --- drawing ------------------------------------------------------------------
const WIDTHS = [1, 1.5, 2, 3, 4, 6, 8, 11, 15, 20];
const nearestWidth = (w) => WIDTHS.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best));

function drawLines(ctx, camera, lines, colour, glow) {
  // Lines of a similar thickness are stroked together: far fewer strokes,
  // which keeps the glow cheap.
  const groups = new Map();
  for (const [a, b, thickness] of lines) {
    const pa = camera.project(a);
    const pb = camera.project(b);
    if (!pa || !pb) continue;
    const w = nearestWidth(thickness * (pa.scale + pb.scale) * 0.5);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(pa, pb);
  }
  ctx.strokeStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = glow;
  for (const [w, points] of groups) {
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i + 1].x, points[i + 1].y);
    }
    ctx.stroke();
  }
}

function drawBalls(ctx, camera, balls, colour, glow) {
  ctx.shadowColor = colour;
  for (const [centre, radius, dark] of balls) {
    const p = camera.project(centre);
    if (!p) continue;
    ctx.shadowBlur = dark ? 0 : glow;
    ctx.fillStyle = dark ? "#000000" : colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, radius * p.scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

function ringLines() {
  const floor = [];
  const ropes = [];
  const half = 2.4;
  for (let i = -6; i <= 6; i++) {
    const k = (i * half) / 6;
    floor.push([v(-half, 0, k), v(half, 0, k), 0.01]);
    floor.push([v(k, 0, -half), v(k, 0, half), 0.01]);
  }
  const corners = [v(-half, 0, -half), v(half, 0, -half), v(half, 0, half), v(-half, 0, half)];
  corners.forEach((c, i) => {
    const next = corners[(i + 1) % 4];
    ropes.push([c, add(c, v(0, 1.35, 0)), 0.05]);
    for (const h of [0.5, 0.9, 1.3]) ropes.push([add(c, v(0, h, 0)), add(next, v(0, h, 0)), 0.018]);
  });
  return { floor, ropes };
}

const RING = ringLines();
const EVENT_TEXT = {
  hit: "hit",
  slipped: "slipped",
  ducked: "ducked",
  blocked: "blocked",
  landed: "landed",
  landedCounter: "counter",
};

export function createReplay(canvas, session) {
  const ctx = canvas.getContext("2d");

  // How low the boxer was, from how far the head dropped in the picture
  // compared with where it usually sat.
  const heights = session.frames.map((f) => f.headY).filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  const usualHead = heights.length ? heights[Math.floor(heights.length * 0.35)] : 0;
  const crouchAt = (t) => {
    const f = frameAt(session, t);
    if (!f || !Number.isFinite(f.headY)) return 0;
    return clamp((f.headY - usualHead) * 0.38 * 0.8, -0.05, 0.42);
  };

  let lastBoxer = null; // kept so the boxer does not vanish if tracking drops out

  return {
    lengthMs: session.lengthMs,

    // Draws the round at time t (milliseconds). `orbit` swings the camera
    // round the ring, in degrees; 0 is the steady side view.
    draw(t, { orbit = 0, zoom = 1, title = "" } = {}) {
      const { width, height } = canvas;
      const angle = (orbit * Math.PI) / 180;
      const far = 3.6 / zoom;
      const eye = v(Math.sin(angle) * far, 1.3 + Math.abs(Math.sin(angle)) * 0.35, Math.cos(angle) * far);
      const camera = makeCamera(eye, v(0, 0.98, 0), width, height);
      const px = height / 720;

      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#050506";
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = "round";

      drawLines(ctx, camera, RING.floor, GRID, 0);
      // Only the ropes and posts on the far side are drawn, so nothing
      // crosses in front of the fighters.
      const middle = camera.project(v(0, 1, 0)).depth;
      const farSide = RING.ropes.filter(([a, b]) => {
        const p = camera.project(mid(a, b));
        return p && p.depth > middle + 0.6;
      });
      drawLines(ctx, camera, farSide, ROPE, 0);

      // Glowing parts add their light together where they overlap.
      ctx.globalCompositeOperation = "lighter";
      const glow = 14 * px;

      const frame = frameAt(session, t);
      const view = frame ? frame.view : { state: "idle", progress: 0 };
      if (view.state !== "idle") {
        const j = opponentJoints(view);
        const bones = skeleton(j, v(-1, 0, 0), "left");
        drawLines(ctx, camera, bones.lines, OPPONENT, glow);
        ctx.globalCompositeOperation = "source-over";
        drawBalls(ctx, camera, bones.balls, OPPONENT, glow);
        ctx.globalCompositeOperation = "lighter";
      }

      const tracked = jointsAt(session, t);
      if (tracked) {
        const j = boxerJoints(tracked, crouchAt(t));
        j.head = boxerHead(j);
        lastBoxer = j;
      }
      if (lastBoxer) {
        const bones = skeleton(lastBoxer, v(1, 0, 0), session.meta.stance === "southpaw" ? "right" : "left");
        drawLines(ctx, camera, bones.lines, BOXER, glow);
        ctx.globalCompositeOperation = "source-over";
        drawBalls(ctx, camera, bones.balls, BOXER, glow);
      }

      // Words over the top: the clock, the score so far, and what just happened.
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      const mono = "ui-monospace, Menlo, Consolas, monospace";
      const tally = tallyAt(session, t);
      const seconds = Math.max(0, Math.ceil((session.lengthMs - t) / 1000));
      ctx.textBaseline = "top";
      ctx.font = `600 ${26 * px}px ${mono}`;
      ctx.fillStyle = "#e8e8ea";
      ctx.textAlign = "left";
      ctx.fillText(`LANDED ${tally.landed}   AVOIDED ${tally.avoided}`, 28 * px, 24 * px);
      ctx.textAlign = "right";
      ctx.fillText(`HITS TAKEN ${tally.taken}`, width - 28 * px, 24 * px);
      ctx.textAlign = "center";
      ctx.font = `600 ${38 * px}px ${mono}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"), width / 2, 18 * px);

      const recent = [...session.events].reverse().find((e) => e.t <= t && t - e.t < 900);
      if (recent) {
        const fade = 1 - (t - recent.t) / 900;
        ctx.globalAlpha = clamp(fade * 1.6, 0, 1);
        ctx.font = `700 ${64 * px}px ${mono}`;
        ctx.fillStyle = recent.kind === "hit" ? OPPONENT : "#ffffff";
        ctx.fillText(EVENT_TEXT[recent.kind].toUpperCase(), width / 2, 84 * px);
        ctx.globalAlpha = 1;
      }

      ctx.textBaseline = "bottom";
      ctx.font = `600 ${18 * px}px ${mono}`;
      ctx.fillStyle = "#8f9298";
      ctx.textAlign = "left";
      ctx.fillText("THE CODE OF WAR", 28 * px, height - 22 * px);
      ctx.textAlign = "right";
      ctx.fillText(title.toUpperCase(), width - 28 * px, height - 22 * px);
    },
  };
}

// The order of play for a highlight clip: the chosen moments back to back,
// slowed a little. Returns the clip's length and a function from clip time
// to { t: round time, orbit: camera swing in degrees }.
export function highlightPlan(highlights, speed = 0.6) {
  const parts = [];
  let clock = 0;
  for (const h of highlights) {
    const lasts = (h.to - h.from) / speed;
    parts.push({ at: clock, lasts, from: h.from, to: h.to });
    clock += lasts;
  }
  return {
    lengthMs: clock,
    at(clipTime) {
      const part = [...parts].reverse().find((p) => clipTime >= p.at) || parts[0];
      const k = clamp((clipTime - part.at) / part.lasts, 0, 1);
      const index = parts.indexOf(part);
      // Each moment is filmed from its own side, swinging slowly past.
      const swing = (index % 2 === 0 ? 1 : -1) * (18 + 34 * k);
      return { t: part.from + (part.to - part.from) * k, orbit: swing, zoom: 1 };
    },
  };
}
