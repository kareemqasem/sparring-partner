import test from "node:test";
import assert from "node:assert/strict";
import { createMoveDetector } from "../src/moves.js";

// A made-up boxer standing square to the camera, in metres.
// The boxer's left is +x in "world" and the picture's right in "image".
const GUARD = {
  nose: [0, -0.75, -0.05],
  leftShoulder: [0.18, -0.5, 0],
  rightShoulder: [-0.18, -0.5, 0],
  leftElbow: [0.2, -0.3, -0.1],
  rightElbow: [-0.2, -0.3, -0.1],
  leftWrist: [0.12, -0.6, -0.2],
  rightWrist: [-0.12, -0.6, -0.2],
};

const LEFT_STRAIGHT = { leftElbow: [0.18, -0.5, -0.3], leftWrist: [0.18, -0.5, -0.6] };
const RIGHT_STRAIGHT = { rightElbow: [-0.18, -0.5, -0.3], rightWrist: [-0.18, -0.5, -0.6] };
const LEFT_HOOK = { leftElbow: [0.2, -0.5, -0.25], leftWrist: [-0.1, -0.5, -0.3] };
const HIGH_GUARD = { leftWrist: [0.08, -0.78, -0.15], rightWrist: [-0.08, -0.78, -0.15] };

const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function pose(target, k, shiftX = 0) {
  const out = {};
  for (const name of Object.keys(GUARD)) {
    const p = target[name] ? mix(GUARD[name], target[name], k) : GUARD[name];
    out[name] = [p[0] + shiftX, p[1], p[2]];
  }
  return out;
}

function toFrame(points) {
  const world = {};
  const image = {};
  for (const [name, [x, y, z]] of Object.entries(points)) {
    world[name] = { x, y, z, visibility: 1 };
    image[name] = { x: 0.5 + x * 0.5, y: 1 + y * 0.8, z, visibility: 1 };
  }
  return { world, image };
}

function run(script, options = {}) {
  const moves = [];
  const detector = createMoveDetector({ ...options, onMove: (m) => moves.push(m) });
  let time = 0;
  const step = 1000 / 60;
  for (const [target, outMs, backMs, holdMs = 0, headOnly = false] of script) {
    const play = (ms, from, to) => {
      const frames = Math.max(1, Math.round(ms / step));
      for (let i = 1; i <= frames; i++) {
        const k = from + ((to - from) * i) / frames;
        const points = headOnly ? pose({}, 0) : pose(target, k);
        if (headOnly) points.nose = [GUARD.nose[0] + target * k, GUARD.nose[1], GUARD.nose[2]];
        detector.update(toFrame(points), time);
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
  assert.deepEqual(run([[{}, 1000, 1000]]), []);
});

test("orthodox: left straight is a jab, right straight is a cross", () => {
  assert.deepEqual(run([[LEFT_STRAIGHT, 150, 200], [RIGHT_STRAIGHT, 150, 200]]), ["jab", "cross"]);
});

test("southpaw: right straight is the jab", () => {
  assert.deepEqual(run([[RIGHT_STRAIGHT, 150, 200]], { stance: "southpaw" }), ["jab"]);
});

test("a slow practice punch still counts", () => {
  assert.deepEqual(run([[LEFT_STRAIGHT, 300, 400]]), ["jab"]);
});

test("left hook", () => {
  assert.deepEqual(run([[LEFT_HOOK, 150, 200]]), ["left hook"]);
});

test("jab, cross, hook combination", () => {
  assert.deepEqual(
    run([[LEFT_STRAIGHT, 130, 170], [RIGHT_STRAIGHT, 130, 170], [LEFT_HOOK, 130, 170]]),
    ["jab", "cross", "left hook"],
  );
});

test("slips to each side", () => {
  assert.deepEqual(run([[0.22, 150, 150, 100, true], [-0.22, 150, 150, 100, true]]), [
    "slip left",
    "slip right",
  ]);
});

test("high guard held is one block", () => {
  assert.deepEqual(run([[HIGH_GUARD, 400, 400, 500]]), ["block"]);
});
