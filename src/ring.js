// Draws the opponent as you would see it sparring: up close, filling the
// screen, its head near your eye level. It only draws what opponent.js
// says is happening; it makes no decisions of its own.
//
// Everything is placed in "figure units": fractions of the figure's height,
// sideways from its centre line and down from the top of its head. The
// figure's right side (its liver side) is on the left of the screen.

// Cyber look: a dark grey figure on black, with red as the only colour.
const COLORS = {
  shirt: "#1d1f23",
  shirtShade: "#121316",
  shirtOpen: "#5a1018",   // chest glows dark red when the whole guard is down
  skin: "#8f9298",
  skinShade: "#5c5f65",
  skinLight: "#c9cbd0",
  glove: "#ff2d3d",
  gloveLight: "#ff7f89",
  gloveWarn: "#ffffff",   // the loading glove turns white as a warning
  gloveWarnLight: "#ffffff",
  warnRing: "#ff2d3d",
  hurt: "#ffffff",
  outline: "#3a3d43",
  target: "#ff2d3d",
};

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
const mix = (from, to, k) => ({
  x: lerp(from.x, to.x, k),
  y: lerp(from.y, to.y, k),
  size: lerp(from.size ?? 1, to.size ?? 1, k),
});

const SHOULDER = (side) => ({ x: side * 0.2, y: 0.45 });

// Where the open target's ring is drawn.
const TARGETS = {
  head: { x: 0, y: 0.27, r: 0.125 },
  chest: { x: 0, y: 0.58, r: 0.07 },
  liver: { x: -0.13, y: 0.69, r: 0.055 },
  side: { x: 0.13, y: 0.69, r: 0.055 },
};

// Named glove positions. `side` is -1 for the arm on the left of the screen
// and +1 for the one on the right.
function glovePose(pose, side) {
  switch (pose) {
    case "low": // gloves down in front of the chest, head exposed
      return { x: side * 0.09, y: 0.58, size: 1 };
    case "dropped": // whole guard down
      return { x: side * 0.27, y: 0.64, size: 1 };
    case "missed": // the punching arm left hanging out after a miss
      return { x: side * 0.2, y: 0.54, size: 1.2 };
    case "cover": // gloves snap together in front of the face to block
      return { x: side * 0.06, y: 0.33, size: 1.35 };
    case "coverBody": // or together in front of the body
      return { x: side * 0.06, y: 0.6, size: 1.35 };
    case "loaded": // pulled back to throw at your head
      return { x: side * 0.34, y: 0.4, size: 0.85 };
    case "thrown": // arriving in your face
      return { x: side * 0.03, y: 0.42, size: 3.2 };
    case "loadedBody": // pulled back low, to go to your body
      return { x: side * 0.33, y: 0.64, size: 0.85 };
    case "thrownBody": // arriving low on the screen
      return { x: side * 0.03, y: 0.7, size: 3 };
    default: // "high": gloves up by the chin
      return { x: side * 0.11, y: 0.36, size: 1 };
  }
}

// How the guard sits for each open target: where the glove rests, and
// whether the elbow is tucked over the ribs or lifted away from them.
function restPose(open, side) {
  const tucked = { x: side * 0.2, y: 0.66 };
  const lifted = { x: side * 0.33, y: 0.55 };
  if (open === "head") return { glove: glovePose("low", side), elbow: { x: side * 0.23, y: 0.62 } };
  if (open === "chest") {
    // Gloves a little wide of the chin, leaving the middle clear.
    return { glove: { x: side * 0.15, y: 0.35, size: 1 }, elbow: tucked };
  }
  const flank = open === "liver" ? -1 : open === "side" ? 1 : 0;
  return { glove: glovePose("high", side), elbow: side === flank ? lifted : tucked };
}

// A natural elbow for an arm that is punching or hanging: halfway to the
// glove, pushed outward and down.
function elbowFor(side, glove) {
  const s = SHOULDER(side);
  return { x: (s.x + glove.x) / 2 + side * 0.07, y: (s.y + glove.y) / 2 + 0.07 };
}

// Works out both arms for the opponent's current state.
function arms(view) {
  const { state, progress, hand } = view;
  const punching = hand === "left" ? -1 : 1;
  const toBody = view.target === "body";
  const out = {};

  for (const side of [-1, 1]) {
    // The resting guard, sliding from the last posture to the current one.
    const from = restPose(view.wasOpen ?? view.open, side);
    const to = restPose(view.open, side);
    const k = ease(view.shift ?? 1);
    const rest = { glove: mix(from.glove, to.glove, k), elbow: mix(from.elbow, to.elbow, k) };

    let glove = rest.glove;
    let elbow = rest.elbow;
    const free = (pose) => {
      glove = pose;
      elbow = elbowFor(side, pose);
    };

    if (state === "open") {
      // Drops quickly, stays down, comes back up at the end.
      const down = progress < 0.85 ? ease(Math.min(1, progress / 0.15)) : ease((1 - progress) / 0.15);
      free(mix(rest.glove, glovePose("dropped", side), down));
    } else if (state === "recover") {
      // Off balance after missing: one arm hanging out, the other low,
      // both pulling back to guard at the end.
      const exposed = glovePose(side === punching ? "missed" : "dropped", side);
      const back = progress < 0.8 ? 0 : ease((progress - 0.8) / 0.2);
      free(mix(exposed, rest.glove, back));
    } else if (state === "hurt") {
      free(mix(glovePose("dropped", side), rest.glove, ease(progress)));
    } else if (state === "guard" && view.cover > 0) {
      const block = glovePose(view.coverWhere === "body" ? "coverBody" : "cover", side);
      glove = mix(rest.glove, block, ease(view.cover));
    } else if (side === punching && state === "windup") {
      const loaded = glovePose(toBody ? "loadedBody" : "loaded", side);
      free(mix(rest.glove, loaded, ease(Math.min(1, progress / 0.4))));
    } else if (side === punching && state === "strike") {
      // Flies at you fast, then pulls back.
      const out01 = progress < 0.35 ? ease(progress / 0.35) : 1 - ease((progress - 0.35) / 0.65);
      free(
        toBody
          ? mix(glovePose("loadedBody", side), glovePose("thrownBody", side), out01)
          : mix(glovePose("loaded", side), glovePose("thrown", side), out01),
      );
    }
    out[side] = { glove, elbow };
  }
  return out;
}

export function drawOpponent(ctx, width, height, view, time) {
  ctx.clearRect(0, 0, width, height);
  if (view.state === "idle") return;

  // Up close: the figure is taller than the screen, so its waist runs off
  // the bottom and its head sits about a third of the way down.
  const size = Math.min(height * 1.45, width * 1.25);
  const cx = width / 2;
  const top = height * 0.3 - size * 0.27;
  const bob = Math.sin(time / 380) * size * 0.006;
  const sway = Math.sin(time / 900) * size * 0.012;
  const hurt = view.state === "hurt" ? 1 - view.progress : 0;

  const X = (fx) => cx + sway + fx * size;
  const Y = (fy) => top + bob + fy * size;
  const line = Math.max(2, size * 0.006);

  const disc = (x, y, r, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const ring = (x, y, r, colour, thickness) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const exposed =
    (view.state === "open" && view.progress < 0.85) ||
    (view.state === "recover" && view.progress < 0.8);

  // Neck.
  ctx.fillStyle = COLORS.skinShade;
  ctx.fillRect(X(-0.045), Y(0.33), size * 0.09, size * 0.1);

  // Torso: wide shoulders tapering to the waist, darker down the sides so
  // it reads as rounded.
  ctx.fillStyle = exposed ? COLORS.shirtOpen : COLORS.shirt;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(X(-0.25), Y(0.47));
  ctx.quadraticCurveTo(X(-0.24), Y(0.4), X(-0.08), Y(0.39));
  ctx.lineTo(X(0.08), Y(0.39));
  ctx.quadraticCurveTo(X(0.24), Y(0.4), X(0.25), Y(0.47));
  ctx.lineTo(X(0.18), Y(1.1));
  ctx.lineTo(X(-0.18), Y(1.1));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (!exposed) {
    ctx.fillStyle = COLORS.shirtShade;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(X(side * 0.25), Y(0.47));
      ctx.lineTo(X(side * 0.18), Y(1.1));
      ctx.lineTo(X(side * 0.12), Y(1.1));
      ctx.quadraticCurveTo(X(side * 0.17), Y(0.75), X(side * 0.2), Y(0.47));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Head, knocked back and flashing white when hit.
  const headX = X(hurt * 0.04);
  const headY = Y(0.27 - hurt * 0.03);
  const headR = size * 0.095;
  disc(headX, headY, headR, hurt > 0.5 ? COLORS.hurt : COLORS.skin);
  if (hurt <= 0.5) {
    // Shade under the jaw, light on the brow.
    ctx.save();
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.clip();
    disc(headX, headY + headR * 1.25, headR, COLORS.skinShade);
    disc(headX - headR * 0.3, headY - headR * 0.75, headR * 0.5, COLORS.skinLight);
    ctx.restore();
  }
  ring(headX, headY, headR, COLORS.outline, line);
  // Eyes and brow, so it reads as looking at you.
  for (const side of [-1, 1]) {
    disc(headX + side * headR * 0.38, headY - headR * 0.08, headR * 0.1, COLORS.outline);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = line * 1.5;
    ctx.beginPath();
    ctx.moveTo(headX + side * headR * 0.6, headY - headR * 0.34);
    ctx.lineTo(headX + side * headR * 0.2, headY - headR * 0.26);
    ctx.stroke();
  }

  // The open target: a pulsing ring where a punch will land.
  const settled = (view.shift ?? 1) >= 1 && view.cover === 0;
  const openTarget = view.state === "guard" && settled ? TARGETS[view.open] : exposed ? TARGETS.chest : null;
  const drawTarget = () => {
    if (!openTarget) return;
    const pulse = 1 + Math.sin(time / 90) * 0.07;
    const tx = view.open === "head" && !exposed ? headX : X(openTarget.x);
    const ty = view.open === "head" && !exposed ? headY : Y(openTarget.y);
    ring(tx, ty, size * openTarget.r * pulse, COLORS.target, Math.max(3, size * 0.01));
  };

  // Arms and gloves. The punching arm is drawn last so it passes in front.
  const both = arms(view);
  const punching = view.hand === "left" ? -1 : 1;
  const attacking = view.state === "windup" || view.state === "strike";
  const order = attacking ? [-punching, punching] : [-1, 1];
  const limb = (a, b, w, colour) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
  };

  drawTarget();

  for (const side of order) {
    const { glove, elbow } = both[side];
    const shoulder = SHOULDER(side);
    const thick = size * 0.07;
    const warning = side === punching && view.state === "windup";

    // Upper arm (sleeve) and forearm, each outlined.
    limb(shoulder, elbow, thick + line * 2, COLORS.outline);
    limb(elbow, glove, thick * 0.9 + line * 2, COLORS.outline);
    limb(shoulder, elbow, thick, COLORS.shirt);
    limb(elbow, glove, thick * 0.9, COLORS.skin);

    const gx = X(glove.x);
    const gy = Y(glove.y);
    const radius = size * 0.062 * glove.size;

    if (warning) {
      // A ring that closes in on the glove: when it touches, the punch lands.
      ring(gx, gy, radius * (1 + 2.2 * (1 - view.progress)), COLORS.warnRing, Math.max(3, size * 0.012));
    }
    disc(gx, gy, radius, warning ? COLORS.gloveWarn : COLORS.glove);
    disc(gx - radius * 0.3, gy - radius * 0.35, radius * 0.35, warning ? COLORS.gloveWarnLight : COLORS.gloveLight);
    ring(gx, gy, radius, COLORS.outline, line);
  }

  // A burst on its gloves when it blocks your punch.
  if (view.state === "guard" && view.cover > 0) {
    ctx.globalAlpha = view.cover;
    const burstY = view.coverWhere === "body" ? 0.6 : 0.33;
    ring(X(0), Y(burstY), size * (0.1 + 0.08 * (1 - view.cover)), COLORS.hurt, Math.max(3, size * 0.01));
    ctx.globalAlpha = 1;
  }
}
