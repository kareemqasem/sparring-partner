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
// On Hard its guard is either high (head covered, body open) or low (body
// covered, head open) and keeps shifting. Punch where the guard is not.
// When it blocks you it may fire straight back.

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
  guardLevels: false,  // does it hold a high or low guard that you punch around
  shiftMinMs: 1200,    // how often its guard shifts between high and low
  shiftMaxMs: 2400,
  counterChance: 0,    // how often it fires back after blocking you
  counterWindupMs: 400,// warning time for that counter

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
    guardLevels: true,
    counterChance: 0.5,
  },
};

export const OPPONENT = LEVELS.easy;

const HEAD_PUNCHES = ["jab", "cross", "left hook", "right hook"];
const BODY_PUNCH = "body shot";

export function createOpponent({ random = Math.random, onEvent = () => {}, level = "easy", config = {} } = {}) {
  let C = { ...LEVELS[level], ...config };

  let state = "idle";
  let since = 0;
  let until = Infinity;
  let hand = "left";         // which of its hands is punching
  let target = "head";       // where its punch is going: "head" or "body"
  let result = null;         // how its last punch ended: "hit", "slipped", "blocked" or "ducked"
  let guardLevel = "high";   // on Hard: "high" or "low"
  let shiftAt = Infinity;    // when the guard next shifts
  let shiftedAt = -Infinity; // when it last shifted
  let coveredAt = -Infinity; // when it last blocked one of your punches
  let coveredWhere = "head";

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

  function toGuard(time) {
    go("guard", time, between(C.guardMinMs, C.guardMaxMs));
    shiftAt = C.guardLevels ? time + between(C.shiftMinMs, C.shiftMaxMs) : Infinity;
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
    } else if (state === "strike" && result !== "hit") {
      go("recover", time, C.recoverMs);
      onEvent({ type: "recover" });
    } else {
      toGuard(time);
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
      guardLevel = "high";
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
        // The guard shifts between high and low while it waits.
        if (state === "guard" && shiftAt <= time && shiftAt < until) {
          guardLevel = guardLevel === "high" ? "low" : "high";
          shiftedAt = shiftAt;
          shiftAt += between(C.shiftMinMs, C.shiftMaxMs);
          onEvent({ type: "shift", guardLevel });
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
      const toBody = move === BODY_PUNCH;
      if (!toBody && !HEAD_PUNCHES.includes(move)) return;
      const where = toBody ? "body" : "head";

      const exposed = state === "open" || state === "recover";
      // With a high guard the body is open; with a low guard the head is.
      const aroundGuard =
        state === "guard" && C.guardLevels && (guardLevel === "high" ? toBody : !toBody);

      if (exposed || aroundGuard) {
        score.landed += 1;
        const counter = state === "recover";
        go("hurt", time, C.hurtMs);
        onEvent({ type: "landed", move, where, counter });
      } else if (state === "guard") {
        coveredAt = time;
        coveredWhere = where;
        onEvent({ type: "blocked", move, where });
        if (C.counterChance > 0 && random() < C.counterChance) {
          // It blocks and fires straight back. A blocked body punch is
          // answered upstairs, with a hook to the head.
          const reply = toBody || random() < 0.5 ? "head" : "body";
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
      // 0 as the guard starts to shift, 1 once it has arrived.
      const shift = Math.min(1, Math.max(0, (time - shiftedAt) / 220));
      return {
        state,
        progress,
        hand,
        target,
        result,
        cover,
        coverWhere: coveredWhere,
        guardLevel: C.guardLevels ? guardLevel : "full",
        shift,
      };
    },

    score: () => ({ ...score }),
  };
}
