// Checks the 3D replay without a browser. It draws one replay frame onto a
// stand-in canvas that logs every drawing call; paint-frame.py then turns
// that log into a picture you can look at (without the glow).
//
//   node tools/replay-frame.mjs '{"view":{"state":"guard","progress":0.3,"hand":"left","target":"head","open":"full","wasOpen":"full","shift":1,"cover":0}}' frame.json
//   python3 tools/paint-frame.py frame.json frame.png
//
// The first argument describes the moment: "view" is what the opponent is
// doing, "jab": true has the boxer mid-jab, "orbit" swings the camera.
import fs from "node:fs";
import { createReplay } from "../src/replay3d.js";
import { createSession, JOINTS } from "../src/session.js";

const log = [];
const state = {};
const ctx = new Proxy({}, {
  get: (t, k) => (k in state ? state[k] : (...a) => log.push([k, ...a, { ...state }])),
  set: (t, k, x) => { state[k] = x; return true; },
});
const canvas = { width: 1280, height: 720, getContext: () => ctx };

const GUARD = {
  nose: [0, -0.62, -0.12], leftEar: [0.07, -0.63, -0.03], rightEar: [-0.07, -0.63, -0.03],
  leftShoulder: [0.18, -0.48, 0], rightShoulder: [-0.18, -0.48, 0],
  leftElbow: [0.2, -0.28, -0.1], rightElbow: [-0.2, -0.28, -0.1],
  leftWrist: [0.12, -0.55, -0.2], rightWrist: [-0.12, -0.55, -0.2],
  leftHip: [0.1, 0, 0], rightHip: [-0.1, 0, 0],
};
const JAB = { ...GUARD, leftElbow: [0.18, -0.52, -0.3], leftWrist: [0.17, -0.6, -0.6] };
const pose = (P) => Object.fromEntries(JOINTS.map((n) => [n, { x: P[n][0], y: P[n][1], z: P[n][2] }]));

const scene = JSON.parse(process.argv[2]);
const recorder = createSession();
recorder.frame(0, pose(scene.jab ? JAB : GUARD), scene.headY ?? 4, scene.view);
if (scene.event) recorder.event(0, scene.event);
const session = recorder.finish({}, 60000);
createReplay(canvas, session).draw(0, { orbit: scene.orbit ?? 0, zoom: scene.zoom ?? 1, title: scene.title ?? "" });
fs.writeFileSync(process.argv[3], JSON.stringify(log));
