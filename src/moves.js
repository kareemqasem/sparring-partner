// Step 2 of the plan: turn tracked body points into boxing moves.
//
// Feed it one frame at a time with update(frame, timeMs). It calls onMove
// with one of: "jab", "cross", "left hook", "right hook", "slip left",
// "slip right", "block".
//
// Distances are measured in shoulder widths, so the same numbers work
// whether you stand near the camera or far from it.

export const TUNING = {
  speedWindowMs: 80,     // hand speed is averaged over this long
  strikeStartSpeed: 3.5, // shoulder widths per second that starts a punch
  strikeEndSpeed: 1.5,   // below this the punch is over
  strikeMaxMs: 450,      // a punch never lasts longer than this
  cooldownMs: 300,       // ignore the hand while it returns to guard
  straightReach: 0.9,    // arm at least this straight (1 = fully straight)
  straightReachGain: 0.12,// and it must have straightened by this much
  hookTravel: 0.4,       // sideways travel across the body for a hook
  slipDistance: 0.45,    // head travel sideways for a slip
  slipRearm: 0.2,        // head must come back this close before the next slip
  sideOnRatio: 0.45,     // shoulders this narrow in the picture = turned side-on
  slipQuietSpeed: 2.5,   // hands must be slower than this for a head move to be a slip
  slipQuietMs: 400,      // and must have been that slow for this long
  headSettleSec: 1.5,    // how quickly "normal head position" follows you
  blockHoldMs: 120,      // both gloves up for this long counts as a block
  blockHeight: 0.35,     // gloves no lower than this far below the nose
  blockWidth: 0.7,       // gloves no further than this to the side of the nose
  minVisibility: 0.5,
  armVisibility: 0.7,    // an arm must be seen this clearly to count its punches
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));

export function createMoveDetector({ stance = "orthodox", onMove = () => {}, tuning = {} } = {}) {
  const T = { ...TUNING, ...tuning };
  const seen = (p) => p && (p.visibility ?? 1) >= T.minVisibility;

  const newHand = () => ({ history: [], strike: null, cooldownUntil: 0, speed: 0, reach: 0 });
  const hands = { left: newHand(), right: newHand() };

  let headHome = null;
  let bodyScale = 0;
  let handsBusyAt = -Infinity;
  let lastTime = null;
  let slipArmed = true;
  let glovesUpSince = null;
  let blocking = false;

  const straightName = (side) => {
    const leadSide = stance === "southpaw" ? "right" : "left";
    return side === leadSide ? "jab" : "cross";
  };

  function finishStrike(side, hand, time) {
    const s = hand.strike;
    hand.strike = null;

    // Straights are called the moment the arm straightens (see updateHand).
    // What is left here is a fast swing that never straightened: a hook.
    if (!s.called && s.peakInward >= T.hookTravel) {
      hand.cooldownUntil = time + T.cooldownMs;
      onMove(side + " hook");
    }
  }

  function updateHand(side, world, shoulderWidth, time, sideOn) {
    const hand = hands[side];
    const other = side === "left" ? "right" : "left";
    const shoulder = world[side + "Shoulder"];
    const elbow = world[side + "Elbow"];
    const wrist = world[side + "Wrist"];
    const otherShoulder = world[other + "Shoulder"];

    const clear = (p) => p && (p.visibility ?? 1) >= T.armVisibility;
    if (!seen(shoulder) || !clear(elbow) || !clear(wrist)) {
      hand.history = [];
      hand.strike = null;
      hand.speed = 0;
      hand.reach = 0;
      return;
    }

    // Wrist position measured from its own shoulder, so stepping around
    // the room does not look like a punch.
    const rel = sub(wrist, shoulder);
    // 1 when the arm is fully straight, small when the fist is at the chin.
    const reach = dist(shoulder, wrist) / (dist(shoulder, elbow) + dist(elbow, wrist));
    // Which way is "across the body" for this hand.
    const inwardSign = Math.sign(otherShoulder.x - shoulder.x) || 1;

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

    if (!hand.strike) {
      // Turned fully side-on, one arm is hidden behind the body and its
      // tracked position is a guess, so no new punch is started from it.
      if (!sideOn && speed >= T.strikeStartSpeed && time >= hand.cooldownUntil) {
        hand.strike = {
          startTime: oldest.time,
          startRel: oldest.rel,
          startReach: oldest.reach,
          peakReach: reach,
          peakInward: 0,
          called: false,
        };
      }
      if (!hand.strike) return;
    }

    const s = hand.strike;
    s.peakReach = Math.max(s.peakReach, reach);
    const inward = ((rel.x - s.startRel.x) * inwardSign) / shoulderWidth;
    s.peakInward = Math.max(s.peakInward, inward);

    // Call a straight punch right away, without waiting for the hand to stop.
    if (!s.called && !sideOn && reach >= T.straightReach && reach - s.startReach >= T.straightReachGain) {
      s.called = true;
      hand.cooldownUntil = time + T.cooldownMs;
      onMove(straightName(side));
    }

    if (speed < T.strikeEndSpeed || time - s.startTime > T.strikeMaxMs) {
      finishStrike(side, hand, time);
    }
  }

  function updateHead(image, time, dtSec) {
    const { nose, leftShoulder, rightShoulder } = image;
    if (!seen(nose) || !seen(leftShoulder) || !seen(rightShoulder)) return;

    if (bodyScale < 0.01) return;

    // Punching moves the head too. Only a head move with quiet hands is a slip.
    const handsBusy =
      hands.left.strike || hands.right.strike ||
      hands.left.speed > T.slipQuietSpeed || hands.right.speed > T.slipQuietSpeed;
    if (handsBusy) handsBusyAt = time;
    const quiet = time - handsBusyAt >= T.slipQuietMs;

    if (headHome === null) headHome = nose.x;
    const offset = (nose.x - headHome) / bodyScale;

    if (!quiet) {
      // Do not let a punch arm or fire a slip.
    } else if (slipArmed && Math.abs(offset) >= T.slipDistance) {
      slipArmed = false;
      // The camera picture is not mirrored: your left is the picture's right.
      onMove(offset > 0 ? "slip left" : "slip right");
    } else if (!slipArmed && Math.abs(offset) <= T.slipRearm) {
      slipArmed = true;
    }

    // "Home" slowly follows the head, so stepping to a new spot resets it.
    const follow = 1 - Math.exp(-dtSec / T.headSettleSec);
    headHome += (nose.x - headHome) * follow;
  }

  function updateBlock(image, time) {
    const { nose, leftShoulder, rightShoulder, leftWrist, rightWrist } = image;
    const usable = [nose, leftShoulder, rightShoulder, leftWrist, rightWrist].every(seen);
    const punching = hands.left.strike || hands.right.strike;

    let glovesUp = false;
    if (usable && !punching) {
      const width = Math.abs(leftShoulder.x - rightShoulder.x);
      const isUp = (wrist) =>
        wrist.y <= nose.y + T.blockHeight * width &&
        Math.abs(wrist.x - nose.x) <= T.blockWidth * width;
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

      // Shoulder width in the picture shrinks when you turn side-on to punch,
      // so everything is measured against the widest it has been lately.
      let sideOn = false;
      if (seen(image.leftShoulder) && seen(image.rightShoulder)) {
        const width = Math.abs(image.leftShoulder.x - image.rightShoulder.x);
        bodyScale = Math.max(width, bodyScale * Math.exp(-dtSec / 10));
        sideOn = width < T.sideOnRatio * bodyScale;
      }
      if (seen(world.leftShoulder) && seen(world.rightShoulder)) {
        const shoulderWidth = dist(world.leftShoulder, world.rightShoulder);
        if (shoulderWidth > 0.05) {
          updateHand("left", world, shoulderWidth, time, sideOn);
          updateHand("right", world, shoulderWidth, time, sideOn);
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
