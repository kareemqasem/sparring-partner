// Checks how the replay rebuilds the boxer, using a tuning recording made
// from the page (the files the recording buttons download). It turns the
// recording into a round, draws the replay at the given moments, and logs
// each frame for paint-frame.py to turn into a picture.
//
//   node tools/replay-from-recording.mjs recording.json out-prefix 5300 22900 ...
//   python3 tools/paint-frame.py out-prefix-5300.json out-prefix-5300.png
import fs from "node:fs";
import { createReplay } from "../src/replay3d.js";
import { createSession, JOINTS } from "../src/session.js";

const [file, prefix, ...times] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const unpack = (points) =>
  Object.fromEntries(JOINTS.map((n) => {
    const p = points[n] || [0, 0, 0, 0];
    return [n, { x: p[0], y: p[1], z: p[2], visibility: p[3] }];
  }));
const guard = { state: "guard", progress: 0.3, hand: "left", target: "head", open: "full", wasOpen: "full", shift: 1, cover: 0 };

const recorder = createSession({ aspect: data.video ? data.video.width / data.video.height : 16 / 9 });
for (const f of data.frames) {
  recorder.frame(f.t, f.image ? { world: unpack(f.world), image: unpack(f.image) } : null, guard);
}
const session = recorder.finish({}, data.frames.at(-1).t);

for (const spec of times) {
  const [t, orbit = 0] = spec.split("@").map(Number);
  const log = [];
  const state = {};
  const ctx = new Proxy({}, {
    get: (_, k) => (k in state ? state[k] : (...a) => log.push([k, ...a, { ...state }])),
    set: (_, k, x) => { state[k] = x; return true; },
  });
  const canvas = { width: 1280, height: 720, getContext: () => ctx };
  createReplay(canvas, session).draw(t, { orbit, title: spec });
  fs.writeFileSync(`${prefix}-${spec}.json`, JSON.stringify(log));
}
