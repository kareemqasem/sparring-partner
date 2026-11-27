// Draws an anatomical skeleton over the boxer from the tracked body points:
// skull, spine, rib cage, collar bones, arm bones and hands, with a glow.
//
// `points` are the tracked points in the picture (x and y from 0 to 1).
// Only the upper body is tracked, so that is all that is drawn. Everything
// is sized from the shoulder width, so it fits at any distance.

const seen = (p) => p && (p.visibility ?? 1) >= 0.5;

export function drawSkeleton(ctx, points, width, height, { colour = "#ffffff", glow = "#ffffff" } = {}) {
  if (!points) return;
  const at = (p) => ({ x: p.x * width, y: p.y * height });
  const { nose, leftEar, rightEar, leftShoulder, rightShoulder, leftHip, rightHip } = points;
  if (!seen(leftShoulder) || !seen(rightShoulder)) return;

  const ls = at(leftShoulder);
  const rs = at(rightShoulder);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const along = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

  // The body's size and its own axes: `down` runs along the spine and
  // `across` from one shoulder to the other, so the rib cage leans with you.
  const neck = mid(ls, rs);
  const shoulderWidth = Math.max(8, dist(ls, rs));
  const hips = seen(leftHip) && seen(rightHip) ? mid(at(leftHip), at(rightHip)) : null;
  let down = hips ? { x: hips.x - neck.x, y: hips.y - neck.y } : { x: 0, y: 1 };
  const downLength = Math.hypot(down.x, down.y) || 1;
  down = { x: down.x / downLength, y: down.y / downLength };
  const across = { x: -down.y, y: down.x };
  // The spine's length: to the hips when they are in view, otherwise a
  // typical torso for this shoulder width.
  const torso = hips ? Math.max(downLength, shoulderWidth) : shoulderWidth * 1.45;
  const body = (a, d) => ({ x: neck.x + across.x * a + down.x * d, y: neck.y + across.y * a + down.y * d });

  const unit = shoulderWidth;
  const thin = Math.max(1.5, unit * 0.022);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.shadowColor = glow;
  ctx.shadowBlur = unit * 0.14;

  const line = (a, b, w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const dot = (p, r) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // A long bone: a shaft with a knob at each end.
  const bone = (a, b, w) => {
    line(a, b, w);
    dot(a, w * 0.85);
    dot(b, w * 0.85);
  };

  // Spine: a column of vertebrae from the neck down.
  const vertebrae = 13;
  for (let i = 0; i <= vertebrae; i++) {
    const d = (torso * i) / vertebrae;
    const half = unit * (0.035 + 0.012 * (i / vertebrae));
    line(body(-half, d), body(half, d), thin * 1.9);
  }
  line(body(0, 0), body(0, torso), thin);

  // Rib cage: pairs of ribs curving out from the spine and round to the
  // breastbone, widest in the middle.
  const ribs = 7;
  const cageTop = torso * 0.1;
  const cageHeight = torso * 0.52;
  ctx.lineWidth = thin * 1.5;
  for (let i = 0; i < ribs; i++) {
    const k = i / (ribs - 1);
    const d = cageTop + cageHeight * k;
    const reach = unit * (0.3 + 0.2 * Math.sin(Math.PI * (0.15 + 0.7 * k)));
    const droop = unit * (0.07 + 0.05 * k);
    for (const side of [-1, 1]) {
      const start = body(side * unit * 0.04, d);
      const outer = body(side * reach * 1.25, d + droop * 0.4);
      // The lowest ribs stop short of the breastbone.
      const end = body(side * unit * (k > 0.75 ? 0.2 : 0.05), d + droop * 1.6);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(outer.x, outer.y, end.x, end.y);
      ctx.stroke();
    }
  }
  // Breastbone.
  line(body(0, cageTop * 0.6), body(0, cageTop + cageHeight * 0.78), thin * 2.4);

  // Collar bones, from the top of the breastbone out to each shoulder.
  const collarStart = body(0, cageTop * 0.6);
  line(collarStart, ls, thin * 1.8);
  line(collarStart, rs, thin * 1.8);

  // Pelvis, when the hips are in view.
  if (hips) {
    const lh = at(leftHip);
    const rh = at(rightHip);
    ctx.lineWidth = thin * 2;
    for (const hip of [lh, rh]) {
      const outer = along(hips, hip, 1.5);
      ctx.beginPath();
      ctx.moveTo(hips.x, hips.y - unit * 0.06);
      ctx.quadraticCurveTo(outer.x, outer.y - unit * 0.22, outer.x, outer.y);
      ctx.quadraticCurveTo(hip.x, hip.y + unit * 0.14, hips.x, hips.y + unit * 0.1);
      ctx.stroke();
    }
  }

  // Arms: one upper-arm bone, two forearm bones, and a hand.
  for (const side of ["left", "right"]) {
    const shoulder = side === "left" ? ls : rs;
    const elbowPoint = points[side + "Elbow"];
    const wristPoint = points[side + "Wrist"];
    dot(shoulder, unit * 0.05);
    if (!seen(elbowPoint)) continue;
    const elbow = at(elbowPoint);
    bone(shoulder, elbow, unit * 0.045);
    if (!seen(wristPoint)) continue;
    const wrist = at(wristPoint);

    const length = dist(elbow, wrist) || 1;
    const dir = { x: (wrist.x - elbow.x) / length, y: (wrist.y - elbow.y) / length };
    const normal = { x: -dir.y, y: dir.x };
    const gap = unit * 0.028;
    const shift = (p, k) => ({ x: p.x + normal.x * k, y: p.y + normal.y * k });
    bone(shift(elbow, gap * 0.5), shift(wrist, gap), unit * 0.026);
    bone(shift(elbow, -gap * 0.5), shift(wrist, -gap), unit * 0.026);

    // Hand: a palm and four finger bones fanning out past the wrist.
    const palm = { x: wrist.x + dir.x * unit * 0.07, y: wrist.y + dir.y * unit * 0.07 };
    dot(palm, unit * 0.045);
    for (let f = -1.5; f <= 1.5; f += 1) {
      const base = shift(palm, f * unit * 0.022);
      const tip = {
        x: base.x + (dir.x + normal.x * f * 0.18) * unit * 0.12,
        y: base.y + (dir.y + normal.y * f * 0.18) * unit * 0.12,
      };
      line(base, tip, thin * 1.4);
    }
  }

  // Skull, sized from the ears when they are in view and tilted with them.
  if (seen(nose)) {
    const n = at(nose);
    const earsSeen = seen(leftEar) && seen(rightEar);
    const le = earsSeen ? at(leftEar) : null;
    const re = earsSeen ? at(rightEar) : null;
    const earSpan = earsSeen ? dist(le, re) : 0;
    const r = Math.max(unit * 0.26, Math.min(unit * 0.5, earSpan > unit * 0.2 ? earSpan * 0.6 : unit * 0.34));
    const tilt = earsSeen && earSpan > unit * 0.2 ? Math.atan2(le.y - re.y, le.x - re.x) : 0;
    // Keep the tilt small: a head seen in profile gives a wild angle.
    const angle = Math.max(-0.6, Math.min(0.6, Math.abs(tilt) > Math.PI / 2 ? tilt - Math.sign(tilt) * Math.PI : tilt));

    // Neck bones up to the skull.
    line(neck, { x: n.x, y: n.y + r * 0.75 }, thin * 2.2);

    ctx.save();
    ctx.translate(n.x, n.y - r * 0.25);
    ctx.rotate(angle);

    // Cranium and jaw, as one solid shape.
    ctx.beginPath();
    ctx.arc(0, -r * 0.1, r, Math.PI * 0.95, Math.PI * 0.05);
    ctx.quadraticCurveTo(r * 0.98, r * 0.55, r * 0.6, r * 0.75);
    ctx.lineTo(r * 0.45, r * 1.2);
    ctx.quadraticCurveTo(0, r * 1.38, -r * 0.45, r * 1.2);
    ctx.lineTo(-r * 0.6, r * 0.75);
    ctx.quadraticCurveTo(-r * 0.98, r * 0.55, -r * 0.99, r * 0.05);
    ctx.closePath();
    ctx.fill();

    // Eye sockets, nose hole and teeth, cut out in black.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#000000";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * r * 0.4, r * 0.08, r * 0.27, r * 0.23, side * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, r * 0.38);
    ctx.lineTo(r * 0.12, r * 0.66);
    ctx.lineTo(-r * 0.12, r * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.95);
    ctx.lineTo(r * 0.42, r * 0.95);
    for (let t = -3; t <= 3; t++) {
      ctx.moveTo(t * r * 0.12, r * 0.82);
      ctx.lineTo(t * r * 0.12, r * 1.08);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}
