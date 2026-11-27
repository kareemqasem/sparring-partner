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

// --- Hard level: one open target to find, body shots, counters, combinations ---

// Rolls for choosing what to leave open. From a closed guard the four
// targets are equally likely; from an open one the choice is between the
// other three targets and closing up.
const FROM_CLOSED = { head: 0.1, chest: 0.3, liver: 0.6, side: 0.9 };
const FIRST = 0;   // the first of the options on offer
const ANY = 0.5;   // a roll whose value does not matter

function hard(overrides = {}, randomValues = [ANY]) {
  const events = [];
  const opponent = createOpponent({
    random: scripted(randomValues),
    level: "hard",
    onEvent: (e) =>
      events.push(
        e.type + (e.target ? ":" + e.target : "") + (e.result ? ":" + e.result : "") +
          (e.open ? ":" + e.open : "") + (e.where ? ":" + e.where : "") +
          (e.counter ? ":counter" : ""),
      ),
    config: {
      guardMinMs: 6000, guardMaxMs: 6000, shiftMinMs: 800, shiftMaxMs: 800, openGraceMs: 250,
      windupMs: 500, strikeMs: 300, recoverMs: 800, hurtMs: 400, coverUpMs: 600,
      bodyAttackChance: 0, counterChance: 0, counterWindupMs: 300, comboChance: 0, comboWindupMs: 350,
      ...overrides,
    },
  });
  opponent.start(0);
  return { opponent, events };
}

test("hard: only the open target can be hit", () => {
  const { opponent, events } = hard({}, [ANY, FROM_CLOSED.chest, ANY]);
  assert.equal(opponent.view(100).open, "chest");
  opponent.playerMove("jab", 100);
  opponent.playerMove("liver shot", 200);
  opponent.playerMove("chest shot", 300);
  assert.deepEqual(events, ["shift:chest", "blocked:head", "blocked:liver", "landed:chest"]);
  assert.equal(opponent.score().landed, 1);
});

test("hard: each punch goes to its own target", () => {
  for (const [target, move] of [["head", "cross"], ["liver", "liver shot"], ["side", "side shot"]]) {
    const { opponent, events } = hard({}, [ANY, FROM_CLOSED[target], ANY]);
    opponent.playerMove(move, 100);
    assert.equal(events.at(-1), "landed:" + target);
  }
});

test("hard: the open target changes in under a second, never to the same one", () => {
  const { opponent } = hard({}, [ANY, FROM_CLOSED.chest, ANY, FIRST, ANY, FIRST, ANY]);
  const seen = [opponent.view(0).open];
  for (const t of [800, 1600]) {
    opponent.update(t);
    seen.push(opponent.view(t).open);
  }
  assert.equal(seen[0], "chest");
  assert.notEqual(seen[1], seen[0]);
  assert.notEqual(seen[2], seen[1]);
});

test("hard: a punch read just after its target closed still lands, a late one does not", () => {
  const justAfter = hard({}, [ANY, FROM_CLOSED.chest, ANY, FIRST, ANY]);
  justAfter.opponent.update(800);
  justAfter.opponent.playerMove("chest shot", 950);
  assert.equal(justAfter.events.at(-1), "landed:chest");

  const late = hard({}, [ANY, FROM_CLOSED.chest, ANY, FIRST, ANY]);
  late.opponent.update(800);
  late.opponent.playerMove("chest shot", 1200);
  assert.equal(late.events.at(-1), "blocked:chest");
});

test("hard: after being hit it does not leave the same target open", () => {
  const { opponent } = hard({}, [ANY, FROM_CLOSED.chest, ANY]);
  opponent.playerMove("chest shot", 100);
  opponent.update(500);
  assert.equal(opponent.view(500).state, "guard");
  assert.notEqual(opponent.view(500).open, "chest");
  opponent.playerMove("chest shot", 520);
  assert.equal(opponent.score().landed, 1);
});

test("hard: land twice on one target and it always counters when you go back", () => {
  // Counters are switched almost off, so a counter here can only come from
  // it having grown wary of the chest.
  const { opponent, events } = hard(
    { counterChance: 0.001, shiftMinMs: 5000, shiftMaxMs: 5000 },
    [ANY, FROM_CLOSED.chest, ANY],
  );
  opponent.playerMove("chest shot", 100);   // first hit
  opponent.update(500);                      // back in guard, chest covered
  opponent.playerMove("chest shot", 900);   // blocked, and no counter yet
  assert.equal(events.at(-1), "blocked:chest");

  const wary = hard(
    { counterChance: 0.001, shiftMinMs: 5000, shiftMaxMs: 5000, wiseAfter: 1 },
    [ANY, FROM_CLOSED.chest, ANY],
  );
  wary.opponent.playerMove("chest shot", 100);
  wary.opponent.update(500);
  wary.opponent.playerMove("chest shot", 900);
  assert.equal(wary.events.at(-1), "windup:head:counter");
});

test("hard: its body shot can only be ducked", () => {
  const blocked = hard({ bodyAttackChance: 1 });
  blocked.opponent.update(6000, { head: HEAD });
  blocked.opponent.update(6500, { head: { x: 3.5, y: 4 }, blocking: true }); // slip and block
  assert.equal(blocked.events.at(-1), "strike:body:hit");

  const ducked = hard({ bodyAttackChance: 1 });
  ducked.opponent.update(6000, { head: HEAD });
  ducked.opponent.update(6400, { head: { x: 3, y: 4.5 } });
  ducked.opponent.update(6500, { head: { x: 3, y: 4.5 } });
  assert.equal(ducked.events.at(-1), "strike:body:ducked");
});

test("hard: it blocks a body punch and counters to the head in 0.3 seconds", () => {
  const { opponent, events } = hard({ counterChance: 1 }, [ANY, FROM_CLOSED.head, ANY]);
  opponent.playerMove("liver shot", 1000 - 900);
  assert.deepEqual(events.slice(-2), ["blocked:liver", "windup:head:counter"]);
  opponent.update(399, { head: HEAD });
  assert.equal(opponent.view(399).state, "windup");
  opponent.update(400, { head: HEAD });
  assert.equal(events.at(-1), "strike:head:hit");
});

test("hard: a counter can be two punches, the second to the other level", () => {
  const { opponent, events } = hard({ counterChance: 1, comboChance: 1 }, [ANY, FROM_CLOSED.head, ANY]);
  opponent.playerMove("chest shot", 100);          // blocked, counter to the head
  opponent.update(400, { head: HEAD });             // first punch lands
  opponent.update(700, { head: HEAD });             // second punch loads, to the body
  assert.equal(events.at(-1), "windup:body:counter");
  opponent.update(1000, { head: { x: 3, y: 4.5 } }); // ducked
  opponent.update(1050, { head: { x: 3, y: 4.5 } });
  assert.deepEqual(events.slice(-4), ["windup:head:counter", "strike:head:hit", "windup:body:counter", "strike:body:ducked"]);
  assert.deepEqual(opponent.score(), { landed: 0, avoided: 1, taken: 1 });
});

test("easy: a body punch is just another punch, and the guard has no gaps", () => {
  const { opponent, events } = setup(OPEN);
  assert.equal(opponent.view(500).open, "full");
  opponent.playerMove("chest shot", 500);
  opponent.update(1400); // it covered up first, so it opens a little later
  opponent.playerMove("liver shot", 1500);
  assert.deepEqual(events, ["blocked", "open", "landed"]);
});
