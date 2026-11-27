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
  bodyScaleWindowMs: 3000,// body size is the widest the shoulders were in this long
  speedWindowMs: 80,      // hand speed is averaged over this long
  strikeStartSpeed: 3.5,  // shoulder widths per second that starts a punch
  strikeEndSpeed: 1.5,    // below this the punch is over
  strikeMaxMs: 450,       // a punch never lasts longer than this
  cooldownMs: 500,        // ignore the hand while it returns to guard

  // All punches. Heights are measured in the picture against the punching
  // arm's own shoulder: 0 = level with the shoulder, -1 = hanging at the ribs.
  straightReach: 0.9,     // arm at least this straight (1 = fully straight)
  straightReachGain: 0.12,// and it must have straightened by this much
  straightMinSpeed: 3,    // and still be moving this fast when it gets there
  armVisibility: 0.7,     // an arm must be seen this clearly to count its punches

  // Lead hand (the jab hand). A jab drives the elbow up and forward; a lead
  // hook lifts it only part way and the other elbow stays down in guard.
  leadStraightElbowUp: 0.4,
  leadShortJabReach: 0.85,
  leadHookElbowUp: -0.45,
  leadHookMinSpeed: 5,
  leadHookOtherElbowDown: -0.78,

  // Rear hand. Both the cross and the rear hook lift the elbow. In a cross
  // the fist climbs well above the elbow; in a hook they come up level.
  rearElbowUp: 0.1,
  rearMinSpeed: 6,
  rearFistAboveElbow: 0.25,

  // Slips: the head moves quickly sideways and dips while both elbows stay down.
  slipDistance: 0.3,      // head travel sideways, in body widths
  slipDip: 0.2,           // while dropping at least this much
  slipWindowMs: 450,      // both within this long
  slipElbowDown: -0.7,    // both elbows lower than this (same scale as above)
  slipConfirmMs: 220,     // wait this long (a punch wind-up starts the same way)
  slipAfterPunchMs: 1300, // the head swings back after a punch; not a slip
  slipRecoverMs: 1200,    // coming back up from a slip is not another slip

  // Block: both gloves up by the head. In the normal guard the gloves sit
  // about 0.8 below the nose; in a block they come up level with it.
  blockHoldMs: 60,
  blockHeight: 0.5,       // gloves no lower than this far below the nose
  blockWidth: 0.9,        // gloves no further than this to the side of the nose

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
    wristUp: 0,
  });
  const hands = { left: newHand(), right: newHand() };

  let bodyScale = 0; // shoulder width in the picture, at its widest lately
  const widths = [];
  let lastTime = null;
  let lastPunchAt = -Infinity;

  let headNow = null;
  let headTrail = [];
  let slipPending = null;
  let slipQuietUntil = 0;

  let glovesUpSince = null;
  let blocking = false;

  const leadSide = stance === "southpaw" ? "right" : "left";
  const straightName = (side) => (side === leadSide ? "jab" : "cross");

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

  // Elbow and fist height in the picture, compared with the arm's own shoulder.
  function measureArm(side, image) {
    const hand = hands[side];
    const shoulder = image[side + "Shoulder"];
    const elbow = image[side + "Elbow"];
    const wrist = image[side + "Wrist"];
    const usable = bodyScale > 0 && seen(shoulder);
    hand.elbowUp = usable && seen(elbow) ? (shoulder.y - elbow.y) / bodyScale : -1;
    hand.wristUp = usable && seen(wrist) ? (shoulder.y - wrist.y) / bodyScale : 0;
  }

  // Decides what a finished swing was. Returns a move name or null.
  function classify(side, s) {
    if (side === leadSide) {
      if (s.peakElbowUp >= T.leadStraightElbowUp) {
        return s.peakReach >= T.leadShortJabReach ? straightName(side) : null;
      }
      const isHook =
        s.peakSpeed >= T.leadHookMinSpeed &&
        s.peakElbowUp >= T.leadHookElbowUp &&
        s.otherElbowUp <= T.leadHookOtherElbowDown;
      return isHook ? side + " hook" : null;
    }

    if (s.peakSpeed < T.rearMinSpeed || s.peakElbowUp < T.rearElbowUp) return null;
    const fistAboveElbow = s.peakWristUp - s.peakElbowUp;
    return fistAboveElbow >= T.rearFistAboveElbow ? straightName(side) : side + " hook";
  }

  function updateHand(side, frame, shoulderWidth, time) {
    const hand = hands[side];
    const other = hands[side === "left" ? "right" : "left"];
    const { world } = frame;
    const shoulder = world[side + "Shoulder"];
    const elbow = world[side + "Elbow"];
    const wrist = world[side + "Wrist"];

    if (!seen(shoulder) || !clear(elbow) || !clear(wrist)) {
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

    if (!hand.strike) {
      if (speed < T.strikeStartSpeed || time < hand.cooldownUntil) return;
      hand.strike = {
        startTime: oldest.time,
        startReach: oldest.reach,
        peakSpeed: 0,
        peakReach: 0,
        peakElbowUp: -Infinity,
        peakWristUp: -Infinity,
        otherElbowUp: -Infinity,
        called: false,
      };
    }

    const s = hand.strike;
    s.peakSpeed = Math.max(s.peakSpeed, speed);
    s.peakReach = Math.max(s.peakReach, reach);
    s.peakElbowUp = Math.max(s.peakElbowUp, hand.elbowUp);
    s.peakWristUp = Math.max(s.peakWristUp, hand.wristUp);
    s.otherElbowUp = Math.max(s.otherElbowUp, other.elbowUp);

    // A straight punch is called the moment the arm snaps straight,
    // without waiting for the hand to stop.
    const snapped =
      reach >= T.straightReach &&
      reach - s.startReach >= T.straightReachGain &&
      speed >= T.straightMinSpeed;
    if (!s.called && snapped && classify(side, s) === straightName(side)) {
      s.called = true;
      call(hand, straightName(side), time);
    }

    if (speed < T.strikeEndSpeed || time - s.startTime > T.strikeMaxMs) {
      hand.strike = null;
      if (!s.called) {
        const move = classify(side, s);
        if (move) call(hand, move, time);
      }
    }
  }

  function updateHead(image, time) {
    const { nose } = image;
    if (!seen(nose) || bodyScale < 0.01) {
      headNow = null;
      headTrail = [];
      slipPending = null;
      return;
    }
    headNow = { x: nose.x / bodyScale, y: nose.y / bodyScale };

    // Where the head has been over the last moment. A slip is judged by how
    // far the head has just travelled, not by where it is, because the
    // resting position shifts all the time as you move around.
    headTrail.push({ time, x: nose.x, y: nose.y });
    while (headTrail.length > 1 && time - headTrail[0].time > T.slipWindowMs) headTrail.shift();
    let low = nose.x;
    let high = nose.x;
    let top = nose.y;
    for (const p of headTrail) {
      low = Math.min(low, p.x);
      high = Math.max(high, p.x);
      top = Math.min(top, p.y);
    }
    // A slip also dips: the knees bend to take the head off the line.
    // Coming back up from one, or swaying, does not dip.
    const dipped = (nose.y - top) / bodyScale >= T.slipDip;
    // The camera picture is not mirrored: your left is the picture's right.
    const movedLeft = (nose.x - low) / bodyScale;
    const movedRight = (high - nose.x) / bodyScale;

    // In a slip the hands stay home: both elbows down, and it is not the
    // head swinging back after a punch you just threw.
    const guardHeld =
      hands.left.elbowUp <= T.slipElbowDown &&
      hands.right.elbowUp <= T.slipElbowDown &&
      time - lastPunchAt >= T.slipAfterPunchMs;

    if (!guardHeld) {
      slipPending = null;
      return;
    }
    if (slipPending) {
      // Wait a moment: a punch wind-up starts like a slip, then the elbow rises.
      if (time - slipPending.since >= T.slipConfirmMs) {
        const { move } = slipPending;
        slipPending = null;
        slipQuietUntil = time + T.slipRecoverMs;
        onMove(move);
      }
      return;
    }
    if (time < slipQuietUntil) return;
    if (!dipped) return;
    if (movedLeft >= T.slipDistance) slipPending = { move: "slip left", since: time };
    else if (movedRight >= T.slipDistance) slipPending = { move: "slip right", since: time };
  }

  function updateBlock(image, time) {
    const { nose, leftWrist, rightWrist } = image;
    const usable = [nose, leftWrist, rightWrist].every(seen) && bodyScale >= 0.01;

    let glovesUp = false;
    if (usable) {
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
      // everything is measured against the widest it has been in the last
      // few seconds. Only a few seconds, so that walking back from the
      // camera does not leave the scale stuck at its close-up size.
      if (seen(image.leftShoulder) && seen(image.rightShoulder)) {
        widths.push({ time, width: Math.abs(image.leftShoulder.x - image.rightShoulder.x) });
        while (widths.length > 1 && time - widths[0].time > T.bodyScaleWindowMs) widths.shift();
        bodyScale = 0;
        for (const w of widths) bodyScale = Math.max(bodyScale, w.width);
      }

      measureArm("left", image);
      measureArm("right", image);

      if (seen(world.leftShoulder) && seen(world.rightShoulder)) {
        const shoulderWidth = dist(world.leftShoulder, world.rightShoulder);
        if (shoulderWidth > 0.05) {
          updateHand("left", frame, shoulderWidth, time);
          updateHand("right", frame, shoulderWidth, time);
        }
      }
      updateHead(image, time);
      updateBlock(image, time);
    },
    isBlocking: () => blocking,
    // Where the head is, in body widths, or null if it cannot be seen.
    // x grows towards the boxer's left, y grows downward.
    head: () => headNow,
    // Live numbers for tuning: how fast and how straight each arm is.
    debug: () => ({
      left: { speed: hands.left.speed, reach: hands.left.reach },
      right: { speed: hands.right.speed, reach: hands.right.reach },
    }),
  };
}
