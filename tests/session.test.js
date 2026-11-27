import test from "node:test";
import assert from "node:assert/strict";
import { createSession, frameAt, jointsAt, tallyAt, pickHighlights, JOINTS } from "../src/session.js";

const body = (x) => Object.fromEntries(JOINTS.map((name) => [name, { x, y: 1, z: 2 }]));

function sample() {
  const recorder = createSession({ mode: "spar" });
  for (let t = 0; t <= 1000; t += 20) recorder.frame(t, t === 500 ? null : body(t / 1000), 4, { state: "guard" });
  recorder.event(100, { type: "windup" });
  recorder.event(300, { type: "strike", result: "slipped", target: "head" });
  recorder.event(600, { type: "landed", where: "chest", counter: true });
  recorder.event(900, { type: "strike", result: "hit", target: "body" });
  return recorder.finish({ landed: 1, avoided: 1, taken: 1 }, 60000);
}

test("finds the frame at or just before a time", () => {
  const session = sample();
  assert.equal(frameAt(session, 0).t, 0);
  assert.equal(frameAt(session, 59).t, 40);
  assert.equal(frameAt(session, 99999).t, 1000);
  assert.equal(frameAt(session, -5).t, 0);
});

test("joints are averaged over neighbouring frames and skip frames with nobody in view", () => {
  const session = sample();
  const joints = jointsAt(session, 200, 45);
  assert.ok(Math.abs(joints.nose.x - 0.2) < 0.001);
  assert.equal(joints.leftWrist.z, 2);
  assert.ok(jointsAt(session, 500, 10) === null);
  assert.ok(jointsAt(session, 500, 45) !== null);
});

test("only outcomes are kept as events, and the tally follows them through the round", () => {
  const session = sample();
  assert.deepEqual(session.events.map((e) => e.kind), ["slipped", "landedCounter", "hit"]);
  assert.deepEqual(tallyAt(session, 0), { landed: 0, avoided: 0, taken: 0 });
  assert.deepEqual(tallyAt(session, 700), { landed: 1, avoided: 1, taken: 0 });
  assert.deepEqual(tallyAt(session, 5000), { landed: 1, avoided: 1, taken: 1 });
});

test("highlights are the most eventful exchanges, in order, within the time limit", () => {
  const recorder = createSession();
  recorder.event(5000, { type: "strike", result: "hit" });                 // a lone hit: least worth
  recorder.event(20000, { type: "strike", result: "slipped" });            // slip then counter: most worth
  recorder.event(21000, { type: "landed", counter: true });
  recorder.event(40000, { type: "landed" });                               // a clean landed punch
  const session = recorder.finish({}, 60000);

  const all = pickHighlights(session, { maxMs: 60000 });
  assert.deepEqual(all.map((h) => h.from), [3500, 18500, 38500]);
  assert.equal(all[1].to, 22800);

  const short = pickHighlights(session, { maxMs: 8000 });
  assert.deepEqual(short.map((h) => h.from), [18500, 38500]);
});

test("a round with nothing in it still gets a clip", () => {
  const session = createSession().finish({}, 60000);
  assert.deepEqual(pickHighlights(session), [{ from: 0, to: 6000 }]);
});
