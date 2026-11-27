// Step 3 of the plan: the opponent's brain. No drawing here, only what the
// opponent is doing and what happens when the boxer moves.
//
// The opponent cycles through:
//   guard  - covered up; your punches are blocked
//   open   - guard dropped; a punch now lands
//   windup - loading a punch; slip, or have your block up when it arrives
//   strike - the punch arriving (hit you, or you avoided it)
//   hurt   - reacting to a punch you landed
//
// To explore other styles later (faster wind-ups, combinations, attacks
// you must slip to one side), change OPPONENT or add states here.

export const OPPONENT = {
  guardMinMs: 1400,    // shortest time it stays covered up between actions
  guardMaxMs: 3000,    // longest
  attackChance: 0.55,  // after guard: this often it attacks, otherwise it opens up
  windupMs: 1000,      // warning time before its punch arrives
  openMs: 1600,        // how long its guard stays down
  strikeMs: 300,       // how long the arriving punch is shown
  hurtMs: 450,         // how long it reacts to being hit
  coverUpMs: 900,      // after you punch its guard, it will not attack for this long
};

const PUNCHES = ["jab", "cross", "left hook", "right hook"];

export function createOpponent({ random = Math.random, onEvent = () => {}, config = {} } = {}) {
  const C = { ...OPPONENT, ...config };

  let state = "idle";
  let since = 0;
  let until = Infinity;
  let hand = "left";   // which of its hands is punching
  let slipped = false; // did the boxer slip during this wind-up
  let result = null;   // how its last punch ended: "hit", "slipped" or "blocked"
  const score = { landed: 0, avoided: 0, taken: 0 };

  function go(next, time, ms) {
    state = next;
    since = time;
    until = time + ms;
  }

  function toGuard(time) {
    go("guard", time, C.guardMinMs + random() * (C.guardMaxMs - C.guardMinMs));
  }

  function next(time, blocking) {
    if (state === "guard") {
      if (random() < C.attackChance) {
        hand = random() < 0.5 ? "left" : "right";
        slipped = false;
        go("windup", time, C.windupMs);
        onEvent({ type: "windup", hand });
      } else {
        go("open", time, C.openMs);
        onEvent({ type: "open" });
      }
    } else if (state === "windup") {
      result = slipped ? "slipped" : blocking ? "blocked" : "hit";
      if (result === "hit") score.taken += 1;
      else score.avoided += 1;
      go("strike", time, C.strikeMs);
      onEvent({ type: "strike", hand, result });
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
      toGuard(time);
    },

    stop() {
      state = "idle";
      until = Infinity;
    },

    // Call every frame. `blocking` is whether the boxer's guard is up now.
    update(time, { blocking = false } = {}) {
      while (state !== "idle" && time >= until) next(until, blocking);
    },

    // Call when the boxer does a move.
    playerMove(move, time) {
      if (state === "idle") return;

      if (move.startsWith("slip")) {
        if (state === "windup") slipped = true;
        return;
      }
      if (!PUNCHES.includes(move)) return;

      if (state === "open") {
        score.landed += 1;
        go("hurt", time, C.hurtMs);
        onEvent({ type: "landed", move });
      } else if (state === "guard") {
        // It covers up, and does not launch an attack straight into your punch.
        until = Math.max(until, time + C.coverUpMs);
        onEvent({ type: "blocked", move });
      } else if (state === "windup") {
        onEvent({ type: "blocked", move });
      }
    },

    // What to draw right now.
    view(time) {
      const span = until - since;
      const progress = span > 0 && Number.isFinite(span) ? Math.min(1, Math.max(0, (time - since) / span)) : 0;
      return { state, progress, hand, result };
    },

    score: () => ({ ...score }),
  };
}
