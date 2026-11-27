// The opponent's brain. No drawing here, only what the opponent is doing
// and what happens when the boxer moves.
//
// The opponent cycles through:
//   guard   - covered up; it blocks what its guard covers
//   windup  - loading a punch at your head or body; defend before it arrives
//   strike  - the punch arriving (hit you, or you avoided it)
//   recover - it missed and is exposed for a moment: counter-punch now
//   open    - guard dropped on its own; a punch now lands (Easy only)
//   hurt    - reacting to a punch you landed
//
// Defence is judged the way a real punch would be. A head shot is aimed at
// where your head was when the opponent started loading: it misses if your
// head has moved off that line or your gloves are up as it arrives. A body
// shot can only be ducked.
//
// On Hard it leaves only one target open at a time - head, chest, liver or
// the other side - and keeps changing which. Punch the open one. It also
// learns: land twice on the same target and it starts keeping that one
// covered and countering when you go back to it. When it blocks you it may
// fire straight back, sometimes with two punches.

const BASE = {
  guardMinMs: 1400,    // shortest time it stays covered up between actions
  guardMaxMs: 3000,    // longest
  attackChance: 0.75,  // after guard: this often it attacks, otherwise it opens up
  windupMs: 1000,      // warning time before its punch arrives
  strikeMs: 300,       // how long the arriving punch is shown
  recoverMs: 1100,     // how long it is exposed after you avoid its punch
  openMs: 1600,        // how long its guard stays down when it opens up by itself
  hurtMs: 450,         // how long it reacts to being hit
  coverUpMs: 900,      // after it blocks you, it will not start a normal attack for this long
  coverShowMs: 280,    // how long its block is shown

  bodyAttackChance: 0, // how often its attack goes to your body
  postures: false,     // does it leave one target open that you must find
  shiftMinMs: 600,     // how long one target stays open before the guard changes
  shiftMaxMs: 1000,
  closedChance: 0.2,   // how often the change is to a fully closed guard
  openGraceMs: 250,    // a punch read this soon after its target closed still lands
  wiseAfter: 2,        // hits in a row on one target before it starts protecting it
  wiseWeight: 0.25,    // how much less often it then leaves that target open
  counterChance: 0,    // how often it fires back after blocking you
  counterWindupMs: 300,// warning time for that counter
  comboChance: 0,      // how often a counter is followed by a second punch
  comboWindupMs: 350,  // warning time for that second punch

  // Head movement, in body widths, that takes you off the line of a head shot.
  dodgeSideways: 0.28,
  dodgeDown: 0.3,
  // How far the head must drop to duck a body shot.
  duckDown: 0.35,
  // A block or head movement this soon before the punch arrives still counts.
  defenceGraceMs: 400,
};

export const LEVELS = {
  // The first version: one-second warnings, head shots only, full guard.
  easy: { ...BASE },
  // Faster, half the warning, body shots, a guard to punch around, counters.
  hard: {
    ...BASE,
    guardMinMs: 900,
    guardMaxMs: 2000,
    attackChance: 1,
    windupMs: 500,
    recoverMs: 800,
    coverUpMs: 600,
    bodyAttackChance: 0.4,
    postures: true,
    counterChance: 0.5,
    comboChance: 0.5,
  },
};

export const OPPONENT = LEVELS.easy;

// Where each of the boxer's punches lands. "liver" is the opponent's right
// side, which is on your left as you face it; "side" is its other flank.
const PUNCH_TARGET = {
  jab: "head",
  cross: "head",
  "left hook": "head",
  "right hook": "head",
  "chest shot": "chest",
  "liver shot": "liver",
  "side shot": "side",
};
const TARGETS = ["head", "chest", "liver", "side"];

export function createOpponent({ random = Math.random, onEvent = () => {}, level = "easy", config = {} } = {}) {
  let C = { ...LEVELS[level], ...config };

  let state = "idle";
  let since = 0;
  let until = Infinity;
  let hand = "left";         // which of its hands is punching
  let target = "head";       // where its punch is going: "head" or "body"
  let result = null;         // how its last punch ended: "hit", "slipped", "blocked" or "ducked"
  let open = "closed";       // on Hard: the one target left open, or "closed"
  let wasOpen = "closed";    // what was open before the last change
  let shiftAt = Infinity;    // when the guard next changes
  let shiftedAt = -Infinity; // when it last changed
  let wary = null;           // the target it has learned to protect
  let streak = { where: null, count: 0 };
  let comboLeft = 0;         // punches still to come in the current counter
  let coveredAt = -Infinity; // when it last blocked one of your punches
  let coveredWhere = "head";
  let hurtWhere = null;      // the target it was last hit on

  let head = null;           // the boxer's head now
  let aimedAt = null;        // the boxer's head when the wind-up began
  let dodgedAt = -Infinity;  // when the head was last off the line of a head shot
  let duckedAt = -Infinity;  // when the head was last low enough to duck a body shot
  let blockedAt = -Infinity; // when the boxer's block was last up

  const score = { landed: 0, avoided: 0, taken: 0 };

  const between = (min, max) => min + random() * (max - min);

  function go(next, time, ms) {
    state = next;
    since = time;
    until = time + ms;
  }

  // Picks what to leave open next: never the same as now, never `avoid`,
  // and rarely the target it has grown wary of.
  function pickOpen(avoid) {
    const options = [...TARGETS, "closed"].filter((t) => t !== open && t !== avoid);
    const weight = (t) =>
      t === "closed" ? C.closedChance * TARGETS.length : t === wary ? C.wiseWeight : 1;
    let roll = random() * options.reduce((sum, t) => sum + weight(t), 0);
    for (const t of options) {
      roll -= weight(t);
      if (roll < 0) return t;
    }
    return options[options.length - 1];
  }

  function changeGuard(time, avoid) {
    wasOpen = open;
    open = pickOpen(avoid);
    shiftedAt = time;
    shiftAt = time + between(C.shiftMinMs, C.shiftMaxMs);
    onEvent({ type: "shift", open });
  }

  function toGuard(time, avoid) {
    go("guard", time, between(C.guardMinMs, C.guardMaxMs));
    if (C.postures) {
      changeGuard(time, avoid);
      wasOpen = "closed"; // nothing "just closed" when it has only just covered up
    } else {
      shiftAt = Infinity;
    }
  }

  function startAttack(time, ms, where, counter) {
    hand = random() < 0.5 ? "left" : "right";
    target = where;
    aimedAt = head;
    dodgedAt = -Infinity;
    duckedAt = -Infinity;
    go("windup", time, ms);
    onEvent({ type: "windup", hand, target, counter });
  }

  function next(time) {
    if (state === "guard") {
      if (random() < C.attackChance) {
        comboLeft = 0;
        startAttack(time, C.windupMs, random() < C.bodyAttackChance ? "body" : "head", false);
      } else {
        go("open", time, C.openMs);
        onEvent({ type: "open" });
      }
    } else if (state === "windup") {
      const recent = (at) => time - at <= C.defenceGraceMs;
      if (target === "body") result = recent(duckedAt) ? "ducked" : "hit";
      else result = recent(dodgedAt) ? "slipped" : recent(blockedAt) ? "blocked" : "hit";
      if (result === "hit") score.taken += 1;
      else score.avoided += 1;
      go("strike", time, C.strikeMs);
      onEvent({ type: "strike", hand, target, result });
    } else if (state === "strike" && comboLeft > 0) {
      // The second punch of a counter, to the other level.
      comboLeft -= 1;
      startAttack(time, C.comboWindupMs, target === "body" ? "head" : "body", true);
    } else if (state === "strike" && result !== "hit") {
      go("recover", time, C.recoverMs);
      onEvent({ type: "recover" });
    } else {
      // Coming back from being hit, it does not leave the same target open.
      const avoid = state === "hurt" ? hurtWhere : null;
      toGuard(time, avoid);
      onEvent({ type: "guard" });
    }
  }

  return {
    setLevel(name) {
      C = { ...LEVELS[name], ...config };
    },

    start(time) {
      score.landed = 0;
      score.avoided = 0;
      score.taken = 0;
      coveredAt = -Infinity;
      shiftedAt = -Infinity;
      open = "closed";
      wasOpen = "closed";
      wary = null;
      streak = { where: null, count: 0 };
      comboLeft = 0;
      toGuard(time);
    },

    stop() {
      state = "idle";
      until = Infinity;
    },

    // Call every frame with what the boxer is doing right now:
    //   blocking - is the block up
    //   head     - head position in body widths ({ x, y }), or null if unseen
    update(time, { blocking = false, head: headNow = null } = {}) {
      head = headNow;
      if (blocking) blockedAt = time;
      if (state === "windup" && head && aimedAt) {
        const sideways = Math.abs(head.x - aimedAt.x);
        const down = head.y - aimedAt.y;
        if (sideways >= C.dodgeSideways || down >= C.dodgeDown) dodgedAt = time;
        if (down >= C.duckDown) duckedAt = time;
      }

      while (state !== "idle") {
        // While it waits, the guard keeps changing which target is open.
        if (state === "guard" && shiftAt <= time && shiftAt < until) {
          changeGuard(shiftAt);
        } else if (time >= until) {
          next(until);
        } else {
          break;
        }
      }
    },

    // Call when the boxer does a move.
    playerMove(move, time) {
      if (state === "idle") return;

      if (move.startsWith("slip")) {
        if (state === "windup") dodgedAt = time;
        return;
      }
      const where = PUNCH_TARGET[move];
      if (!where) return;
      const toBody = where !== "head";

      const exposed = state === "open" || state === "recover";
      // The open target can be hit. Reading a punch takes a moment, so one
      // thrown at a target that has only just closed still counts.
      const justClosed = wasOpen === where && time - shiftedAt <= C.openGraceMs;
      const aroundGuard = state === "guard" && C.postures && (open === where || justClosed);

      if (exposed || aroundGuard) {
        score.landed += 1;
        const counter = state === "recover";
        // Hit the same place often enough and it learns to protect it.
        streak = streak.where === where ? { where, count: streak.count + 1 } : { where, count: 1 };
        if (C.postures && streak.count >= C.wiseAfter) wary = where;
        go("hurt", time, C.hurtMs);
        hurtWhere = where;
        onEvent({ type: "landed", move, where, counter });
      } else if (state === "guard") {
        coveredAt = time;
        coveredWhere = toBody ? "body" : "head";
        onEvent({ type: "blocked", move, where });
        // It always punishes you for going back to the target it is wary of.
        const fireBack =
          C.counterChance > 0 && (where === wary || random() < C.counterChance);
        if (fireBack) {
          // It blocks and fires straight back. A blocked body punch is
          // answered upstairs, with a hook to the head.
          const reply = toBody || random() < 0.5 ? "head" : "body";
          comboLeft = random() < C.comboChance ? 1 : 0;
          startAttack(time, C.counterWindupMs, reply, true);
        } else {
          // It covers up, and does not launch an attack straight into your punch.
          until = Math.max(until, time + C.coverUpMs);
        }
      }
    },

    // What to draw right now.
    view(time) {
      const span = until - since;
      const progress =
        span > 0 && Number.isFinite(span) ? Math.min(1, Math.max(0, (time - since) / span)) : 0;
      // 1 at the moment it blocks your punch, fading to 0.
      const cover = state === "guard" ? Math.max(0, 1 - (time - coveredAt) / C.coverShowMs) : 0;
      // 0 as the guard starts to change, 1 once it has arrived.
      const shift = Math.min(1, Math.max(0, (time - shiftedAt) / 180));
      return {
        state,
        progress,
        hand,
        target,
        result,
        cover,
        coverWhere: coveredWhere,
        // Which target is open: "head", "chest", "liver", "side", "closed",
        // or "full" on Easy where the guard has no gaps to find.
        open: C.postures ? open : "full",
        wasOpen: C.postures ? wasOpen : "full",
        shift,
      };
    },

    score: () => ({ ...score }),
  };
}
