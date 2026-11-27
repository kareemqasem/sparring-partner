import test from "node:test";
import assert from "node:assert/strict";
import { createMoveDetector } from "../src/moves.js";

// A made-up boxer standing square to the camera, in metres. The boxer's
// left is +x, up is -y, and towards the camera is -z. The poses copy the
// shapes measured in real recordings: where the elbow and fist end up
// relative to the shoulder for each move.
const GUARD = {
  nose: [0, -0.75, -0.05],
  leftShoulder: [0.18, -0.5, 0],
  rightShoulder: [-0.18, -0.5, 0],
  leftElbow: [0.2, -0.3, -0.1],
  rightElbow: [-0.2, -0.3, -0.1],
  leftWrist: [0.12, -0.56, -0.2],
  rightWrist: [-0.12, -0.56, -0.2],
};

// Straight: the arm snaps straight, elbow lifted, fist well above the elbow.
const LEFT_STRAIGHT = { leftElbow: [0.18, -0.62, -0.3], leftWrist: [0.18, -0.8, -0.55] };
const RIGHT_STRAIGHT = { rightElbow: [-0.18, -0.62, -0.3], rightWrist: [-0.18, -0.8, -0.55] };
// Hook: the arm stays bent and the elbow comes up level with the fist.
const LEFT_HOOK = { leftElbow: [0.2, -0.5, -0.25], leftWrist: [-0.15, -0.52, -0.35] };
const RIGHT_HOOK = { rightElbow: [-0.2, -0.54, -0.25], rightWrist: [0.15, -0.55, -0.35] };
// Body punch: the elbow stays down and the fist drives in below the shoulder.
const BODY_CROSS = { rightElbow: [-0.2, -0.3, -0.15], rightWrist: [-0.1, -0.25, -0.5] };
const BODY_JAB = { leftElbow: [0.2, -0.3, -0.15], leftWrist: [0.1, -0.25, -0.5] };
// Slip: the head goes sideways and dips, hands stay home.
const SLIP_LEFT = { nose: [0.22, -0.69, -0.05] };
const SLIP_RIGHT = { nose: [-0.22, -0.69, -0.05] };
const HIGH_GUARD = { leftWrist: [0.08, -0.78, -0.15], rightWrist: [-0.08, -0.78, -0.15] };
const REST = {};

const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function toFrame(target, k) {
  const world = {};
  const image = {};
  for (const name of Object.keys(GUARD)) {
    const [x, y, z] = target[name] ? mix(GUARD[name], target[name], k) : GUARD[name];
    world[name] = { x, y, z, visibility: 1 };
    image[name] = { x: 0.5 + x * 0.5, y: 1 + y * 0.8, z, visibility: 1 };
  }
  return { world, image };
}

// Each step is [pose, ms going out, ms coming back, ms held]. Every step
// ends with half a second back in guard.
function run(script, options = {}) {
  const moves = [];
  const detector = createMoveDetector({ ...options, onMove: (m) => moves.push(m) });
  let time = 0;
  const step = 1000 / 60;
  for (const [target, outMs, backMs, holdMs = 0] of script) {
    const play = (ms, from, to) => {
      const frames = Math.round(ms / step);
      for (let i = 1; i <= frames; i++) {
        detector.update(toFrame(target, from + ((to - from) * i) / frames), time);
        time += step;
      }
    };
    play(outMs, 0, 1);
    play(holdMs, 1, 1);
    play(backMs, 1, 0);
    play(500, 0, 0);
  }
  return moves;
}

test("standing in guard detects nothing", () => {
  assert.deepEqual(run([[REST, 1000, 1000]]), []);
});

test("orthodox: left straight is a jab, right straight is a cross", () => {
  assert.deepEqual(run([[LEFT_STRAIGHT, 150, 200], [RIGHT_STRAIGHT, 150, 200]]), ["jab", "cross"]);
});

test("southpaw: right straight is the jab", () => {
  assert.deepEqual(run([[RIGHT_STRAIGHT, 150, 200]], { stance: "southpaw" }), ["jab"]);
});

test("a slow practice jab still counts", () => {
  assert.deepEqual(run([[LEFT_STRAIGHT, 300, 400]]), ["jab"]);
});

test("left hook", () => {
  assert.deepEqual(run([[LEFT_HOOK, 130, 200]]), ["left hook"]);
});

test("right hook is not called a cross", () => {
  assert.deepEqual(run([[RIGHT_HOOK, 130, 200]]), ["right hook"]);
});

test("jab, cross, hook combination", () => {
  assert.deepEqual(
    run([[LEFT_STRAIGHT, 130, 170], [RIGHT_STRAIGHT, 130, 170], [LEFT_HOOK, 130, 170]]),
    ["jab", "cross", "left hook"],
  );
});

test("a punch to the body is a body shot, from either hand", () => {
  assert.deepEqual(run([[BODY_CROSS, 150, 200], [REST, 300, 300], [BODY_JAB, 150, 200]]), ["body shot", "body shot"]);
});

test("both arms swinging in one body punch count once", () => {
  assert.deepEqual(run([[{ ...BODY_CROSS, ...BODY_JAB }, 150, 200]]), ["body shot"]);
});

test("slips to each side", () => {
  assert.deepEqual(
    run([[SLIP_LEFT, 150, 150, 300], [REST, 500, 500], [SLIP_RIGHT, 150, 150, 300]]),
    ["slip left", "slip right"],
  );
});

test("coming back up from a slip is not a second slip", () => {
  assert.deepEqual(run([[SLIP_LEFT, 150, 400, 300]]), ["slip left"]);
});

test("leaning into a punch is not a slip", () => {
  assert.deepEqual(run([[{ ...SLIP_LEFT, ...LEFT_STRAIGHT }, 150, 200]]), ["jab"]);
});

test("high guard held is one block", () => {
  assert.deepEqual(run([[HIGH_GUARD, 400, 400, 500]]), ["block"]);
});
