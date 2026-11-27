// Step 3 of the plan: the opponent's brain. No drawing here, only what the
// opponent is doing and what happens when the boxer moves.
//
// The opponent cycles through:
//   guard   - covered up; it blocks your punches
//   windup  - loading a punch; get your head off the line or your block up
//   strike  - the punch arriving (hit you, or you avoided it)
//   recover - it missed and is exposed for a moment: counter-punch now
//   open    - guard dropped on its own; a punch now lands
//   hurt    - reacting to a punch you landed
//
// Defence is judged the way a real punch would be: it is aimed at where
// your head was when the opponent started loading. If your head has moved
// off that line, or your gloves are up, as the punch arrives, it misses.
//
// To explore other styles later (faster wind-ups, combinations, attacks
// you must slip to one side), change OPPONENT or add states here.

export const OPPONENT = {
  guardMinMs: 1400,    // shortest time it stays covered up between actions
  guardMaxMs: 3000,    // longest
  attackChance: 0.75,  // after guard: this often it attacks, otherwise it opens up
  windupMs: 1000,      // warning time before its punch arrives
  strikeMs: 300,       // how long the arriving punch is shown
  recoverMs: 1100,     // how long it is exposed after you avoid its punch
  openMs: 1600,        // how long its guard stays down when it opens up by itself
  hurtMs: 450,         // how long it reacts to being hit
  coverUpMs: 900,      // after you punch its guard, it will not attack for this long
  coverShowMs: 280,    // how long its block is shown

  // Head movement, in body widths, that takes you off the line of its punch.
  dodgeSideways: 0.28,
  dodgeDown: 0.3,
  // A block or head movement this soon before the punch arrives still counts.
  defenceGraceMs: 400,
};

const PUNCHES = ["jab", "cross", "left hook", "right hook"];

export function createOpponent({ random = Math.random, onEvent = () => {}, config = {} } = {}) {
  const C = { ...OPPONENT, ...config };

  let state = "idle";
  let since = 0;
  let until = Infinity;
  let hand = "left";      // which of its hands is punching
  let result = null;      // how its last punch ended: "hit", "slipped" or "blocked"
  let coveredAt = -Infinity; // when it last blocked one of your punches

  let head = null;           // the boxer's head now
  let aimedAt = null;        // the boxer's head when the wind-up began
  let dodgedAt = -Infinity;  // when the head was last off the line
  let blockedAt = -Infinity; // when the boxer's block was last up

  const score = { landed: 0, avoided: 0, taken: 0 };

  function go(next, time, ms) {
    state = next;
    since = time;
    until = time + ms;
  }

  function toGuard(time) {
    go("guard", time, C.guardMinMs + random() * (C.guardMaxMs - C.guardMinMs));
  }

  function next(time) {
    if (state === "guard") {
      if (random() < C.attackChance) {
        hand = random() < 0.5 ? "left" : "right";
        aimedAt = head;
        dodgedAt = -Infinity;
        go("windup", time, C.windupMs);
        onEvent({ type: "windup", hand });
      } else {
        go("open", time, C.openMs);
        onEvent({ type: "open" });
      }
    } else if (state === "windup") {
      const recent = (at) => time - at <= C.defenceGraceMs;
      result = recent(dodgedAt) ? "slipped" : recent(blockedAt) ? "blocked" : "hit";
      if (result === "hit") score.taken += 1;
      else score.avoided += 1;
      go("strike", time, C.strikeMs);
      onEvent({ type: "strike", hand, result });
    } else if (state === "strike" && result !== "hit") {
      go("recover", time, C.recoverMs);
      onEvent({ type: "recover" });
    } else {
      toGuard(time);
      onEvent({ type: "guard" });
    }
  }

  return {
    start(time) {
      score.landed = 0;
      score.avoided = 0;
      score.taken = 0;
      coveredAt = -Infinity;
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
      }
      while (state !== "idle" && time >= until) next(until);
    },

    // Call when the boxer does a move.
    playerMove(move, time) {
      if (state === "idle") return;

      if (move.startsWith("slip")) {
        if (state === "windup") dodgedAt = time;
        return;
      }
      if (!PUNCHES.includes(move)) return;

      if (state === "open" || state === "recover") {
        score.landed += 1;
        const counter = state === "recover";
        go("hurt", time, C.hurtMs);
        onEvent({ type: "landed", move, counter });
      } else if (state === "guard") {
        // It blocks, and does not launch an attack straight into your punch.
        coveredAt = time;
        until = Math.max(until, time + C.coverUpMs);
        onEvent({ type: "blocked", move });
      }
    },

    // What to draw right now.
    view(time) {
      const span = until - since;
      const progress =
        span > 0 && Number.isFinite(span) ? Math.min(1, Math.max(0, (time - since) / span)) : 0;
      // 1 at the moment it blocks your punch, fading to 0.
      const cover = state === "guard" ? Math.max(0, 1 - (time - coveredAt) / C.coverShowMs) : 0;
      return { state, progress, hand, result, cover };
    },

    score: () => ({ ...score }),
  };
}
