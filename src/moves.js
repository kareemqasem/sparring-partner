// Step 2 of the plan: turn tracked body points into boxing moves.
//
// Feed it one frame at a time with update(frame, timeMs). It calls onMove
// with one of: "jab", "cross", "left hook", "right hook", "slip left",
// "slip right", "block".
//
// Distances are measured against the boxer's own body (shoulder widths),
// so the same numbers work near the camera or far from it.
//
// The numbers in TUNING were set from a labelled 75-second recording of
// one boxer (orthodox, laptop camera). They are a starting point, not a
// universal truth: re-check them against new recordings.

export const TUNING = {
  speedWindowMs: 80,      // hand speed is averaged over this long
  strikeStartSpeed: 3.5,  // shoulder widths per second that starts a punch
  strikeEndSpeed: 1.5,    // below this the punch is over
  strikeMaxMs: 450,       // a punch never lasts longer than this
  cooldownMs: 500,        // ignore the hand while it returns to guard

  // Straight punches (jab, cross): the arm snaps straight while still fast.
  straightReach: 0.9,     // arm at least this straight (1 = fully straight)
  straightReachGain: 0.12,// and it must have straightened by this much
  straightMinSpeed: 3,    // and still be moving this fast when it gets there
  straightFistLead: 0.23, // if the elbow is lifted, the fist must still be this
                          // much higher than it. In a hook they come up level.

  // Hooks: a fast swing with the elbow lifted to about shoulder height,
  // that never snapped straight.
  hookMinSpeed: 6,        // fastest point of the swing
  hookElbowUp: -0.2,      // elbow height vs shoulder (0 = level, -1 = hanging)

  // Turned side-on, the far arm is hidden behind the body and its tracked
  // position is a guess, so it is ignored.
  turnedRatio: 0.6,       // how much further back one shoulder is than the other
  armVisibility: 0.7,     // an arm must be seen this clearly to count its punches

  // Slips: the head moves sideways while both elbows stay down in guard.
  slipDistance: 0.33,     // head travel sideways
  slipRearm: 0.15,        // head must come back this close before the next slip
  slipElbowDown: -0.7,    // both elbows lower than this
  slipConfirmMs: 220,     // must stay true this long (a punch wind-up does not)
  headSettleSec: 1.5,     // how quickly "normal head position" follows you

  // Block: both gloves up by the head and held.
  blockHoldMs: 120,
  blockHeight: 0.35,      // gloves no lower than this far below the nose
  blockWidth: 0.7,        // gloves no further than this to the side of the nose

  minVisibility: 0.5,
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));

export function createMoveDetector({ stance = "orthodox", onMove = () => {}, tuning = {} } = {}) {
  const T = { ...TUNING, ...tuning };
  const seen = (p) => p && (p.visibility ?? 1) >= T.minVisibility;
  const clear = (p) => p && (p.visibility ?? 1) >= T.armVisibility;

  const newHand = () => ({
    history: [],
    strike: null,
    cooldownUntil: 0,
    speed: 0,
    reach: 0,
    elbowUp: -1,
  });
  const hands = { left: newHand(), right: newHand() };

  let bodyScale = 0; // shoulder width in the picture, at its widest lately
  let lastTime = null;
  let lastPunchAt = -Infinity;

  let headHome = null;
  let slipArmed = true;
  let slipPending = null;

  let glovesUpSince = null;
  let blocking = false;

  const straightName = (side) => {
    const leadSide = stance === "southpaw" ? "right" : "left";
    return side === leadSide ? "jab" : "cross";
  };

  function call(hand, move, time) {
    hand.cooldownUntil = time + T.cooldownMs;
    lastPunchAt = time;
    slipPending = null;
    onMove(move);
  }

  function resetHand(hand) {
    hand.history = [];
    hand.strike = null;
    hand.speed = 0;
    hand.reach = 0;
  }

  function updateHand(side, frame, shoulderWidth, time, hidden) {
    const hand = hands[side];
    const { world, image } = frame;
    const shoulder = world[side + "Shoulder"];
    const elbow = world[side + "Elbow"];
    const wrist = world[side + "Wrist"];

    // Elbow height in the picture, compared with its own shoulder.
    const imgShoulder = image[side + "Shoulder"];
    const imgElbow = image[side + "Elbow"];
    hand.elbowUp =
      bodyScale > 0 && seen(imgShoulder) && seen(imgElbow)
        ? (imgShoulder.y - imgElbow.y) / bodyScale
        : -1;

    if (hidden || !seen(shoulder) || !clear(elbow) || !clear(wrist)) {
      resetHand(hand);
      return;
    }

    // Wrist position measured from its own shoulder, so stepping around
    // the room does not look like a punch.
    const rel = sub(wrist, shoulder);
    // 1 when the arm is fully straight, smaller as the elbow bends.
    const reach = dist(shoulder, wrist) / (dist(shoulder, elbow) + dist(elbow, wrist));

    hand.history.push({ time, rel, reach });
    while (hand.history.length > 2 && time - hand.history[0].time > T.speedWindowMs) {
      hand.history.shift();
    }

    const oldest = hand.history[0];
    const seconds = (time - oldest.time) / 1000;
    if (seconds < 0.02) return;
    const speed = dist(rel, oldest.rel) / seconds / shoulderWidth;
    hand.speed = speed;
    hand.reach = reach;
    // How far the fist is above the elbow (y grows downward).
    const fistLead = (elbow.y - wrist.y) / shoulderWidth;
    const looksLikeHook = hand.elbowUp >= T.hookElbowUp && fistLead < T.straightFistLead;

    if (!hand.strike) {
      if (speed < T.strikeStartSpeed || time < hand.cooldownUntil) return;
      hand.strike = {
        startTime: oldest.time,
        startReach: oldest.reach,
        peakSpeed: speed,
        peakElbowUp: hand.elbowUp,
        called: false,
      };
    }

    const s = hand.strike;
    s.peakSpeed = Math.max(s.peakSpeed, speed);
    s.peakElbowUp = Math.max(s.peakElbowUp, hand.elbowUp);

    // A straight punch is called the moment the arm snaps straight,
    // without waiting for the hand to stop.
    if (
      !s.called &&
      reach >= T.straightReach &&
      reach - s.startReach >= T.straightReachGain &&
      speed >= T.straightMinSpeed &&
      !looksLikeHook
    ) {
      s.called = true;
      call(hand, straightName(side), time);
    }

    if (speed < T.strikeEndSpeed || time - s.startTime > T.strikeMaxMs) {
      hand.strike = null;
      // A fast swing with the elbow up that never snapped straight: a hook.
      if (!s.called && s.peakSpeed >= T.hookMinSpeed && s.peakElbowUp >= T.hookElbowUp) {
        call(hand, side + " hook", time);
      }
    }
  }

  function updateHead(image, time, dtSec) {
    const { nose } = image;
    if (!seen(nose) || bodyScale < 0.01) {
      slipPending = null;
      return;
    }

    if (headHome === null) headHome = nose.x;
    const offset = (nose.x - headHome) / bodyScale;

    // In a slip the hands stay home: both elbows down, no punch just thrown.
    const guardHeld =
      hands.left.elbowUp <= T.slipElbowDown &&
      hands.right.elbowUp <= T.slipElbowDown &&
      time - lastPunchAt >= T.cooldownMs;

    if (!slipArmed) {
      if (Math.abs(offset) <= T.slipRearm) slipArmed = true;
    } else if (Math.abs(offset) >= T.slipDistance && guardHeld) {
      // The camera picture is not mirrored: your left is the picture's right.
      const move = offset > 0 ? "slip left" : "slip right";
      if (!slipPending || slipPending.move !== move) slipPending = { move, since: time };
      if (time - slipPending.since >= T.slipConfirmMs) {
        slipPending = null;
        slipArmed = false;
        onMove(move);
      }
    } else {
      slipPending = null;
    }

    // "Home" follows the head so stepping to a new spot resets it, but only
    // slowly while the head is off to one side, or a slip would drag it along.
    const away = Math.abs(offset) > T.slipRearm;
    const follow = 1 - Math.exp(-dtSec / (away ? T.headSettleSec * 6 : T.headSettleSec));
    headHome += (nose.x - headHome) * follow;
  }

  function updateBlock(image, time) {
    const { nose, leftWrist, rightWrist } = image;
    const usable = [nose, leftWrist, rightWrist].every(seen) && bodyScale >= 0.01;
    const punching = hands.left.strike || hands.right.strike;

    let glovesUp = false;
    if (usable && !punching) {
      const isUp = (wrist) =>
        wrist.y <= nose.y + T.blockHeight * bodyScale &&
        Math.abs(wrist.x - nose.x) <= T.blockWidth * bodyScale;
      glovesUp = isUp(leftWrist) && isUp(rightWrist);
    }

    if (!glovesUp) {
      glovesUpSince = null;
      blocking = false;
      return;
    }
    if (glovesUpSince === null) glovesUpSince = time;
    if (!blocking && time - glovesUpSince >= T.blockHoldMs) {
      blocking = true;
      onMove("block");
    }
  }

  return {
    update(frame, time) {
      if (!frame) return;
      const dtSec = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000);
      lastTime = time;

      const { image, world } = frame;

      // Shoulder width in the picture shrinks when you turn to punch, so
      // everything is measured against the widest it has been lately.
      if (seen(image.leftShoulder) && seen(image.rightShoulder)) {
        const width = Math.abs(image.leftShoulder.x - image.rightShoulder.x);
        bodyScale = Math.max(width, bodyScale * Math.exp(-dtSec / 10));
      }

      if (seen(world.leftShoulder) && seen(world.rightShoulder)) {
        const shoulderWidth = dist(world.leftShoulder, world.rightShoulder);
        if (shoulderWidth > 0.05) {
          // Larger z is further from the camera. When one shoulder is well
          // behind the other, that side's arm is hidden by the body.
          const turn = (world.leftShoulder.z - world.rightShoulder.z) / shoulderWidth;
          updateHand("left", frame, shoulderWidth, time, turn >= T.turnedRatio);
          updateHand("right", frame, shoulderWidth, time, turn <= -T.turnedRatio);
        }
      }
      updateHead(image, time, dtSec);
      updateBlock(image, time);
    },
    isBlocking: () => blocking,
    // Live numbers for tuning: how fast and how straight each arm is.
    debug: () => ({
      left: { speed: hands.left.speed, reach: hands.left.reach },
      right: { speed: hands.right.speed, reach: hands.right.reach },
    }),
  };
}
