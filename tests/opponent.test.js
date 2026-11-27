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
    onEvent: (e) =>
      events.push(
        e.type + (e.result ? ":" + e.result : "") + (e.where === "body" ? ":body" : "") +
          (e.counter ? ":counter" : ""),
      ),
    config: {
      guardMinMs: 1000, guardMaxMs: 1000, attackChance: 0.5, windupMs: 1000, strikeMs: 300,
      recoverMs: 1000, openMs: 1500, hurtMs: 400, coverUpMs: 900, coverShowMs: 300,
      dodgeSideways: 0.28, dodgeDown: 0.3, defenceGraceMs: 400,
    },
  });
  opponent.start(0);
  return { opponent, events };
}

const ATTACK = [0, 0.1, 0.1]; // guard length, then "attack", then which hand
const OPEN = [0, 0.9];        // guard length, then "open up"
const HEAD = { x: 3, y: 4 };  // the boxer's head in guard, in body widths

test("an attack you do nothing about hits you", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  assert.equal(opponent.view(1000).state, "windup");
  opponent.update(2000, { head: HEAD });
  opponent.update(2300, { head: HEAD });
  assert.deepEqual(events, ["windup", "strike:hit", "guard"]);
  assert.deepEqual(opponent.score(), { landed: 0, avoided: 0, taken: 1 });
});

test("moving your head off the line avoids the punch", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(1900, { head: { x: 3.4, y: 4 } });
  opponent.update(2000, { head: { x: 3.4, y: 4 } });
  assert.deepEqual(events, ["windup", "strike:slipped"]);
  assert.deepEqual(opponent.score(), { landed: 0, avoided: 1, taken: 0 });
});

test("ducking avoids the punch, standing taller does not", () => {
  const duck = setup(ATTACK);
  duck.opponent.update(1000, { head: HEAD });
  duck.opponent.update(2000, { head: { x: 3, y: 4.4 } });
  assert.deepEqual(duck.events, ["windup", "strike:slipped"]);

  const tall = setup(ATTACK);
  tall.opponent.update(1000, { head: HEAD });
  tall.opponent.update(2000, { head: { x: 3, y: 3.6 } });
  assert.deepEqual(tall.events, ["windup", "strike:hit"]);
});

test("a small sway is not enough", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(2000, { head: { x: 3.15, y: 4.1 } });
  assert.deepEqual(events, ["windup", "strike:hit"]);
});

test("slipping too early and coming back gets you hit", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(1200, { head: { x: 3.5, y: 4 } });
  opponent.update(1400, { head: HEAD });
  opponent.update(2000, { head: HEAD });
  assert.deepEqual(events, ["windup", "strike:hit"]);
});

test("a slip just before impact still counts after the head returns", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(1700, { head: { x: 3.5, y: 4 } });
  opponent.update(2000, { head: HEAD });
  assert.deepEqual(events, ["windup", "strike:slipped"]);
});

test("a recognised slip during the wind-up counts", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000);
  opponent.playerMove("slip left", 1800);
  opponent.update(2000);
  assert.deepEqual(events, ["windup", "strike:slipped"]);
});

test("a block as the punch arrives avoids it, even a brief one", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(1700, { head: HEAD, blocking: true });
  opponent.update(2000, { head: HEAD, blocking: false });
  assert.deepEqual(events, ["windup", "strike:blocked"]);
  assert.equal(opponent.score().avoided, 1);
});

test("a block dropped long before the punch arrives does not count", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(1200, { head: HEAD, blocking: true });
  opponent.update(2000, { head: HEAD });
  assert.deepEqual(events, ["windup", "strike:hit"]);
});

test("after you avoid its punch it is open to a counter", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(1000, { head: HEAD });
  opponent.update(2000, { head: HEAD, blocking: true });
  opponent.update(2300, { head: HEAD });
  assert.equal(opponent.view(2300).state, "recover");
  opponent.playerMove("cross", 2600);
  assert.deepEqual(events, ["windup", "strike:blocked", "recover", "landed:counter"]);
  assert.equal(opponent.score().landed, 1);
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

test("it blocks a punch into its guard, shows it, and delays its attack", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.playerMove("jab", 900);
  assert.equal(opponent.view(900).cover, 1);
  assert.equal(opponent.view(1500).cover, 0);
  opponent.update(1000);
  assert.equal(opponent.view(1000).state, "guard");
  opponent.update(1800);
  assert.equal(opponent.view(1800).state, "windup");
  assert.deepEqual(events, ["blocked", "windup"]);
  assert.equal(opponent.score().landed, 0);
});

test("missing the opening just lets it close", () => {
  const { opponent, events } = setup(OPEN);
  opponent.update(1000);
  opponent.update(2500);
  assert.deepEqual(events, ["open", "guard"]);
});

test("a long gap between frames still plays every step in order", () => {
  const { opponent, events } = setup(ATTACK);
  opponent.update(2400, { head: HEAD });
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

// --- Hard level: a guard to punch around, body shots, and counters ---

function hard(overrides = {}, randomValues = [0.1]) {
  const events = [];
  const opponent = createOpponent({
    random: scripted(randomValues),
    level: "hard",
    onEvent: (e) =>
      events.push(
        e.type + (e.target ? ":" + e.target : "") + (e.result ? ":" + e.result : "") +
          (e.guardLevel ? ":" + e.guardLevel : "") + (e.where ? ":" + e.where : "") +
          (e.counter ? ":counter" : ""),
      ),
    config: {
      guardMinMs: 3000, guardMaxMs: 3000, shiftMinMs: 1000, shiftMaxMs: 1000,
      windupMs: 500, strikeMs: 300, recoverMs: 800, hurtMs: 400, coverUpMs: 600,
      bodyAttackChance: 0, counterChance: 0, counterWindupMs: 400, ...overrides,
    },
  });
  opponent.start(0);
  return { opponent, events };
}

test("hard: it starts with a high guard, so the body is open and the head is covered", () => {
  const { opponent, events } = hard();
  assert.equal(opponent.view(100).guardLevel, "high");
  opponent.playerMove("jab", 200);
  opponent.playerMove("body shot", 400);
  assert.deepEqual(events, ["blocked:head", "landed:body"]);
  assert.equal(opponent.score().landed, 1);
});

test("hard: the guard shifts low, then the head is open and the body is covered", () => {
  const { opponent, events } = hard();
  opponent.update(1100);
  assert.equal(opponent.view(1100).guardLevel, "low");
  opponent.playerMove("body shot", 1200);
  opponent.playerMove("cross", 1300);
  assert.deepEqual(events, ["shift:low", "blocked:body", "landed:head"]);
});

test("hard: its body shot can only be ducked", () => {
  const blocked = hard({ bodyAttackChance: 1 });
  blocked.opponent.update(3000, { head: HEAD });
  blocked.opponent.update(3500, { head: { x: 3.5, y: 4 }, blocking: true }); // slip and block
  assert.equal(blocked.events.at(-1), "strike:body:hit");

  const ducked = hard({ bodyAttackChance: 1 });
  ducked.opponent.update(3000, { head: HEAD });
  ducked.opponent.update(3400, { head: { x: 3, y: 4.5 } });
  ducked.opponent.update(3500, { head: { x: 3, y: 4.5 } });
  assert.equal(ducked.events.at(-1), "strike:body:ducked");
  assert.equal(ducked.opponent.score().avoided, 1);
});

test("hard: the warning is half a second", () => {
  const { opponent } = hard();
  opponent.update(3000, { head: HEAD });
  assert.equal(opponent.view(3000).state, "windup");
  opponent.update(3499, { head: HEAD });
  assert.equal(opponent.view(3499).state, "windup");
  opponent.update(3500, { head: HEAD });
  assert.equal(opponent.view(3500).state, "strike");
});

test("hard: it blocks a body punch and counters to the head", () => {
  const { opponent, events } = hard({ counterChance: 1 });
  opponent.update(1100, { head: HEAD }); // guard is now low: body covered
  opponent.playerMove("body shot", 1200);
  assert.deepEqual(events, ["shift:low", "blocked:body", "windup:head:counter"]);
  opponent.update(1600, { head: HEAD });
  assert.equal(events.at(-1), "strike:head:hit");
});

test("hard: the counter can be avoided like any other punch", () => {
  const { opponent, events } = hard({ counterChance: 1 });
  opponent.update(1100, { head: HEAD });
  opponent.playerMove("body shot", 1200);
  opponent.update(1500, { head: { x: 3.4, y: 4 } });
  opponent.update(1600, { head: { x: 3.4, y: 4 } });
  assert.equal(events.at(-1), "strike:head:slipped");
});

test("easy: a body shot is just another punch, and no guard shifting", () => {
  const { opponent, events } = setup(OPEN);
  assert.equal(opponent.view(500).guardLevel, "full");
  opponent.playerMove("body shot", 500);
  opponent.update(1400); // it covered up first, so it opens a little later
  opponent.playerMove("body shot", 1500);
  assert.deepEqual(events, ["blocked:body", "open", "landed:body"]);
});
