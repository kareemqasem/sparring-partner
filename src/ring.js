// Draws the opponent: a simple boxer figure facing you. It only draws what
// opponent.js says is happening; it makes no decisions of its own.

const COLORS = {
  body: "#3b4252",
  bodyOpen: "#2e7d5b",   // chest lights up green when the guard is down
  head: "#e0b089",
  glove: "#c62828",
  gloveWarn: "#ff9800",  // the loading glove turns orange as a warning
  hurt: "#ffffff",
  outline: "#0b0c0f",
  target: "#7dffb8",
};

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);

// Where a glove sits for each pose, as fractions of the figure's height,
// measured from the figure's centre line. `side` is -1 for the glove on the
// left of the screen and +1 for the one on the right.
function glovePose(pose, side) {
  switch (pose) {
    case "open":
      return { x: side * 0.27, y: 0.62, size: 1 };
    case "loaded":
      return { x: side * 0.34, y: 0.4, size: 0.85 };
    case "thrown":
      return { x: side * 0.03, y: 0.44, size: 3.2 };
    case "low": // low guard: gloves down in front of the body, head exposed
      return { x: side * 0.1, y: 0.6, size: 1 };
    case "cover": // gloves snap together in front of the face to block
      return { x: side * 0.06, y: 0.33, size: 1.35 };
    case "coverBody": // or together in front of the body
      return { x: side * 0.06, y: 0.6, size: 1.35 };
    case "loadedBody": // pulled back low, to go to your body
      return { x: side * 0.32, y: 0.7, size: 0.85 };
    case "thrownBody": // arriving low on the screen
      return { x: side * 0.03, y: 0.78, size: 3 };
    case "missed": // the punching arm left hanging out after a miss
      return { x: side * 0.2, y: 0.52, size: 1.2 };
    default: // guard: gloves up by the chin
      return { x: side * 0.11, y: 0.36, size: 1 };
  }
}

function mixPose(from, to, k) {
  return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), size: lerp(from.size, to.size, k) };
}

// Works out both glove positions for the opponent's current state.
function gloves(view) {
  const { state, progress, hand } = view;
  const punching = hand === "left" ? -1 : 1;
  const out = {};
  const toBody = view.target === "body";
  for (const side of [-1, 1]) {
    // Where the gloves rest: up by the chin, or down by the body on a low
    // guard, sliding between the two as the guard shifts.
    const high = glovePose("guard", side);
    const low = glovePose("low", side);
    const shift = ease(view.shift ?? 1);
    const guard =
      view.guardLevel === "low" ? mixPose(high, low, shift)
      : view.guardLevel === "high" ? mixPose(low, high, shift)
      : high;
    let pose = guard;
    if (state === "open") {
      // Drops quickly, stays down, comes back up at the end.
      const down = progress < 0.85 ? ease(Math.min(1, progress / 0.15)) : ease((1 - progress) / 0.15);
      pose = mixPose(guard, glovePose("open", side), down);
    } else if (state === "recover") {
      // Off balance after missing: one arm hanging out, the other low,
      // both pulling back to guard at the end.
      const exposed = glovePose(side === punching ? "missed" : "open", side);
      const back = progress < 0.8 ? 0 : ease((progress - 0.8) / 0.2);
      pose = mixPose(exposed, guard, back);
    } else if (state === "guard" && view.cover > 0) {
      const block = glovePose(view.coverWhere === "body" ? "coverBody" : "cover", side);
      pose = mixPose(guard, block, ease(view.cover));
    } else if (state === "hurt") {
      pose = mixPose(glovePose("open", side), guard, ease(progress));
    } else if (side === punching && state === "windup") {
      const loaded = glovePose(toBody ? "loadedBody" : "loaded", side);
      pose = mixPose(guard, loaded, ease(Math.min(1, progress / 0.4)));
    } else if (side === punching && state === "strike") {
      // Flies at you fast, then pulls back.
      const out01 = progress < 0.35 ? ease(progress / 0.35) : 1 - ease((progress - 0.35) / 0.65);
      pose = toBody
        ? mixPose(glovePose("loadedBody", side), glovePose("thrownBody", side), out01)
        : mixPose(glovePose("loaded", side), glovePose("thrown", side), out01);
    }
    out[side] = pose;
  }
  return out;
}

export function drawOpponent(ctx, width, height, view, time) {
  ctx.clearRect(0, 0, width, height);
  if (view.state === "idle") return;

  const size = Math.min(height, width * 1.1); // the figure's height on screen
  const cx = width / 2;
  const top = (height - size) / 2;
  const bob = Math.sin(time / 380) * size * 0.008;
  const sway = Math.sin(time / 900) * size * 0.012;
  const hurt = view.state === "hurt" ? 1 - view.progress : 0;

  const X = (fx) => cx + sway + fx * size;
  const Y = (fy) => top + bob + fy * size;

  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.008);
  ctx.strokeStyle = COLORS.outline;

  // Torso: wide shoulders tapering to the waist.
  const isOpen =
    (view.state === "open" && view.progress < 0.85) ||
    (view.state === "recover" && view.progress < 0.8);
  const chestLit =
    isOpen || (view.state === "guard" && view.guardLevel === "high" && (view.shift ?? 1) >= 1 && view.cover === 0);
  ctx.fillStyle = chestLit ? COLORS.bodyOpen : COLORS.body;
  ctx.beginPath();
  ctx.moveTo(X(-0.24), Y(0.44));
  ctx.quadraticCurveTo(X(0), Y(0.36), X(0.24), Y(0.44));
  ctx.lineTo(X(0.17), Y(1.02));
  ctx.lineTo(X(-0.17), Y(1.02));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // A target ring on the chest while the body can be hit: the guard is
  // down, or (on Hard) it is held high.
  const settled = (view.shift ?? 1) >= 1 && view.cover === 0;
  const bodyOpen = isOpen || (view.state === "guard" && view.guardLevel === "high" && settled);
  const headOpen = view.state === "guard" && view.guardLevel === "low" && settled;
  if (bodyOpen) {
    const pulse = 1 + Math.sin(time / 90) * 0.08;
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = Math.max(3, size * 0.012);
    ctx.beginPath();
    ctx.arc(X(0), Y(0.6), size * 0.07 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = Math.max(2, size * 0.008);
  }

  // Head, knocked back and flashing white when hit.
  const headX = X(hurt * 0.04);
  const headY = Y(0.27 - hurt * 0.03);
  ctx.fillStyle = hurt > 0.5 ? COLORS.hurt : COLORS.head;
  ctx.beginPath();
  ctx.arc(headX, headY, size * 0.095, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // A target ring round the head while the guard is low.
  if (headOpen) {
    const pulse = 1 + Math.sin(time / 90) * 0.06;
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = Math.max(3, size * 0.012);
    ctx.beginPath();
    ctx.arc(headX, headY, size * 0.125 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = Math.max(2, size * 0.008);
  }

  // Eyes, so it reads as facing you.
  ctx.fillStyle = COLORS.outline;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + side * size * 0.035, headY - size * 0.012, size * 0.01, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gloves, the punching one drawn last so it passes in front.
  const poses = gloves(view);
  const punching = view.hand === "left" ? -1 : 1;
  const order = view.state === "windup" || view.state === "strike" ? [-punching, punching] : [-1, 1];
  const covering = view.state === "guard" && view.cover > 0;
  for (const side of order) {
    const pose = poses[side];
    const radius = size * 0.062 * pose.size;
    const warning = side === punching && view.state === "windup";

    if (warning) {
      // A ring that closes in on the glove: when it touches, the punch lands.
      ctx.strokeStyle = COLORS.gloveWarn;
      ctx.lineWidth = Math.max(3, size * 0.012);
      ctx.beginPath();
      ctx.arc(X(pose.x), Y(pose.y), radius * (1 + 2.2 * (1 - view.progress)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = Math.max(2, size * 0.008);
    }

    ctx.fillStyle = warning ? COLORS.gloveWarn : COLORS.glove;
    ctx.beginPath();
    ctx.arc(X(pose.x), Y(pose.y), radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // A burst on its gloves when it blocks your punch.
  if (covering) {
    ctx.strokeStyle = COLORS.hurt;
    ctx.lineWidth = Math.max(3, size * 0.012);
    ctx.globalAlpha = view.cover;
    ctx.beginPath();
    const burstY = view.coverWhere === "body" ? 0.6 : 0.33;
    ctx.arc(X(0), Y(burstY), size * (0.1 + 0.08 * (1 - view.cover)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
