import test from "node:test";
import assert from "node:assert/strict";
import { bend, makeCamera, createReplay, highlightPlan } from "../src/replay3d.js";
import { createSession, JOINTS } from "../src/session.js";

const v = (x, y, z) => ({ x, y, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("a bent limb keeps both bone lengths and bends towards the pole", () => {
  const root = v(0, 1, 0);
  const tip = v(0.4, 1, 0);
  const elbow = bend(root, tip, 0.3, 0.3, v(0, -1, 0));
  assert.ok(Math.abs(dist(root, elbow) - 0.3) < 1e-6);
  assert.ok(Math.abs(dist(elbow, tip) - 0.3) < 1e-6);
  assert.ok(elbow.y < 1);
});

test("a limb asked to reach too far goes straight instead of breaking", () => {
  const elbow = bend(v(0, 0, 0), v(5, 0, 0), 0.3, 0.3, v(0, -1, 0));
  assert.ok(Number.isFinite(elbow.x) && Number.isFinite(elbow.y));
  assert.ok(Math.abs(elbow.x - 0.3) < 0.02);
});

test("the camera puts its target mid-screen, nearer things bigger, and hides what is behind it", () => {
  const camera = makeCamera(v(0, 1, 4), v(0, 1, 0), 1280, 720);
  const centre = camera.project(v(0, 1, 0));
  assert.ok(Math.abs(centre.x - 640) < 1e-6 && Math.abs(centre.y - 360) < 1e-6);
  assert.ok(camera.project(v(0, 1, 2)).scale > centre.scale);
  assert.ok(camera.project(v(1, 1, 0)).x > 640);
  assert.ok(camera.project(v(0, 2, 0)).y < 360);
  assert.equal(camera.project(v(0, 1, 5)), null);
});

// A canvas stand-in that fails the test if anything is drawn with a broken number.
function fakeCanvas() {
  let calls = 0;
  const bad = (x) => typeof x === "number" && !Number.isFinite(x);
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { if (a.some(bad)) throw new Error("bad number in " + String(k)); calls++; }),
    set: (t, k, x) => { if (bad(x)) throw new Error("bad " + String(k)); t[k] = x; return true; },
  });
  return { width: 1280, height: 720, getContext: () => ctx, calls: () => calls };
}

const GUARD = {
  nose: [0, -0.62, -0.12], leftEar: [0.07, -0.63, -0.03], rightEar: [-0.07, -0.63, -0.03],
  leftShoulder: [0.18, -0.48, 0], rightShoulder: [-0.18, -0.48, 0],
  leftElbow: [0.2, -0.28, -0.1], rightElbow: [-0.2, -0.28, -0.1],
  leftWrist: [0.12, -0.55, -0.2], rightWrist: [-0.12, -0.55, -0.2],
  leftHip: [0.1, 0, 0], rightHip: [-0.1, 0, 0],
};
// What the tracker reports: its 3D guess, and where each joint is in the picture.
const world = () => ({
  world: Object.fromEntries(JOINTS.map((n) => [n, { x: GUARD[n][0], y: GUARD[n][1], z: GUARD[n][2] }])),
  image: Object.fromEntries(JOINTS.map((n) => [n, { x: 0.5 + GUARD[n][0] * 0.4, y: 0.75 + GUARD[n][1] * 0.7, visibility: 1 }])),
});

test("the replay draws every kind of moment, including ones with nobody tracked", () => {
  const recorder = createSession();
  const states = ["guard", "open", "windup", "strike", "recover", "hurt", "idle"];
  let t = 0;
  for (const state of states) for (const hand of ["left", "right"]) for (const target of ["head", "body"]) for (const open of ["full", "closed", "head", "chest", "liver", "side"]) {
    for (const progress of [0, 0.3, 0.9]) {
      recorder.frame(t, t % 7 === 0 ? null : world(), { state, progress, hand, target, open, wasOpen: "closed", shift: 0.5, cover: progress, coverWhere: "body" });
      t += 20;
    }
  }
  recorder.event(100, { type: "strike", result: "hit", target: "head" });
  recorder.event(900, { type: "landed", where: "liver", counter: true });
  const session = recorder.finish({ landed: 1, avoided: 0, taken: 1 }, t);

  const canvas = fakeCanvas();
  const replay = createReplay(canvas, session);
  for (let time = -100; time <= t + 100; time += 20) replay.draw(time, { orbit: (time / 40) % 90, zoom: 1.1, title: "test" });
  assert.ok(canvas.calls() > 1000);
});

test("an empty round can still be drawn", () => {
  const canvas = fakeCanvas();
  createReplay(canvas, createSession().finish({}, 60000)).draw(1000);
  assert.ok(canvas.calls() > 0);
});

test("a highlight clip plays its moments back to back, slowed down", () => {
  const plan = highlightPlan([{ from: 1000, to: 4000 }, { from: 9000, to: 12000 }], 0.5);
  assert.equal(plan.lengthMs, 12000);
  assert.equal(plan.at(0).t, 1000);
  assert.equal(plan.at(3000).t, 2500);
  assert.equal(plan.at(6000).t, 9000);
  assert.equal(plan.at(99999).t, 12000);
  assert.notEqual(Math.sign(plan.at(100).orbit), Math.sign(plan.at(6100).orbit));
});
