import test from "node:test";
import assert from "node:assert/strict";
import { createOpponent } from "../src/opponent.js";

// A scripted "random" so the opponent's choices are known in each test.
function scripted(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function setup(randomValues) {
  const events = [];
  const opponent = createOpponent({
    random: scripted(randomValues),
    onEvent: (e) => events.push(e.type + (e.result ? ":" + e.result : "")),
    config: { guardMinMs: 1000, guardMaxMs: 1000, attackChance: 0.5, windupMs: 1000, openMs: 1500, strikeMs: 300, hurtMs: 400, coverUpMs: 900 },
  });
  opponent.start(0);
  return { opponent, events };
}

const ATTACK = [0, 0.1, 0.1]; // guard length, then "attack", then which hand
const OPEN = [0, 0.9];        // guard length, then "open up"

test("an attack you do nothing about hits you", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000);
  assert.equal(opponent.view(1000).state, "windup");
  opponent.update(2000);
  assert.deepEqual(events, ["windup", "strike:hit"]);
  assert.deepEqual(opponent.score(), { landed: 0, avoided: 0, taken: 1 });
});

test("slipping during the wind-up avoids the punch", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000);
  opponent.playerMove("slip left", 1600);
  opponent.update(2000);
  assert.deepEqual(events, ["windup", "strike:slipped"]);
  assert.deepEqual(opponent.score(), { landed: 0, avoided: 1, taken: 0 });
});

test("a slip before the wind-up does not count", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.playerMove("slip left", 500);
  opponent.update(1000);
  opponent.update(2000);
  assert.deepEqual(events, ["windup", "strike:hit"]);
});

test("having your block up when the punch arrives avoids it", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000);
  opponent.update(2000, { blocking: true });
  assert.deepEqual(events, ["windup", "strike:blocked"]);
  assert.equal(opponent.score().avoided, 1);
});

test("a punch into the open guard lands, once", () => {
  const { opponent, events } = setup(OPEN);
  opponent.update(1000);
  opponent.playerMove("cross", 1200);
  opponent.playerMove("left hook", 1300); // it is already reacting
  assert.deepEqual(events, ["open", "landed"]);
  assert.equal(opponent.score().landed, 1);
  assert.equal(opponent.view(1300).state, "hurt");
  opponent.update(1600);
  assert.equal(opponent.view(1600).state, "guard");
});

test("a punch into its guard is blocked and delays its next attack", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.playerMove("jab", 900);
  opponent.update(1000);
  assert.equal(opponent.view(1000).state, "guard");
  opponent.update(1800);
  assert.equal(opponent.view(1800).state, "windup");
  assert.deepEqual(events, ["blocked", "windup"]);
});

test("missing the opening just lets it close", () => {
  const { opponent, events } = setup(OPEN);
  opponent.update(1000);
  opponent.update(2500);
  assert.deepEqual(events, ["open", "guard"]);
  assert.equal(opponent.score().landed, 0);
});

test("a long gap between frames still plays every step in order", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(2400);
  assert.deepEqual(events, ["windup", "strike:hit", "guard"]);
});

test("nothing happens before start or after stop", () => {
  const events = [];
  const opponent = createOpponent({ onEvent: (e) => events.push(e.type) });
  opponent.update(99999);
  opponent.playerMove("jab", 99999);
  opponent.start(0);
  opponent.stop();
  opponent.update(99999);
  assert.deepEqual(events, []);
});
