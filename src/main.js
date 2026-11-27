// Steps 1 and 2 of the plan: turn on the camera, track the boxer's body,
// and call out each move it recognises so we can check it by ear.

import { createTracker, BONES } from "./pose.js";
import { createMoveDetector } from "./moves.js";

const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const readout = document.getElementById("readout");

const movesEl = document.getElementById("moves");

const MIN_VISIBILITY = 0.5;
const STANCE = "orthodox";

// Says the move out loud. A new call-out cuts off the previous one so the
// voice keeps up with fast combinations.
function say(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const words = new SpeechSynthesisUtterance(text);
  words.rate = 1.4;
  window.speechSynthesis.speak(words);
}

const recentMoves = [];
function showMove(move) {
  recentMoves.unshift(move);
  recentMoves.length = Math.min(recentMoves.length, 6);
  movesEl.textContent = recentMoves.join("  \u2190  ");
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

function isSeen(point) {
  return point && (point.visibility ?? 1) >= MIN_VISIBILITY;
}

function draw(points) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points) return;

  const px = (p) => [p.x * canvas.width, p.y * canvas.height];

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#4dd0e1";
  for (const [from, to] of BONES) {
    const a = points[from];
    const b = points[to];
    if (!isSeen(a) || !isSeen(b)) continue;
    ctx.beginPath();
    ctx.moveTo(...px(a));
    ctx.lineTo(...px(b));
    ctx.stroke();
  }

  for (const [name, point] of Object.entries(points)) {
    if (!isSeen(point)) continue;
    const isHand = name.endsWith("Wrist");
    const [x, y] = px(point);
    ctx.fillStyle = isHand ? "#e5484d" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, isHand ? 12 : 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// What the boxer needs in view for sparring: head, both shoulders, both hands.
function describeView(points) {
  if (!points) return "No one in view. Step into the frame.";
  const needed = ["nose", "leftShoulder", "rightShoulder", "leftWrist", "rightWrist"];
  const missing = needed.filter((name) => !isSeen(points[name]));
  if (missing.length === 0) return "Tracking: head, shoulders and both hands.";
  return "Can't see everything yet. Step back and keep your hands up.";
}

function run(tracker) {
  const detector = createMoveDetector({
    stance: STANCE,
    onMove(move) {
      say(move);
      showMove(move);
    },
  });

  let lastVideoTime = -1;
  let frames = 0;
  let fpsStart = performance.now();

  function loop() {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const frame = tracker.track(video, now);
      const points = frame ? frame.image : null;
      draw(points);
      setStatus(describeView(points));
      detector.update(frame, now);

      frames += 1;
      const elapsed = performance.now() - fpsStart;
      if (elapsed >= 1000) {
        readout.textContent = Math.round((frames * 1000) / elapsed) + " frames per second";
        frames = 0;
        fpsStart = performance.now();
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("This browser can't open the camera. The page must be opened over https.", true);
    startBtn.disabled = false;
    return;
  }

  try {
    setStatus("Opening the camera...");
    await startCamera();
  } catch (err) {
    setStatus("Camera could not start. Allow camera access for this page, then try again.", true);
    startBtn.disabled = false;
    return;
  }

  try {
    setStatus("Loading body tracking. The first time takes a few seconds...");
    const tracker = await createTracker();
    startBtn.hidden = true;
    say("Ready");
    run(tracker);
  } catch (err) {
    console.error(err);
    setStatus("Body tracking could not load. Check your internet connection and reload.", true);
    startBtn.disabled = false;
  }
});
