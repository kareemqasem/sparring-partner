// Steps 1 and 2 of the plan: turn on the camera, track the boxer's body,
// and call out each move it recognises so we can check it by ear.

// When you change any file, raise the version number here and in index.html
// (all the "?v=" numbers and the "Version" line), so browsers load the new
// files instead of old saved copies.

import { createTracker, BONES } from "./pose.js?v=8";
import { createMoveDetector } from "./moves.js?v=8";

const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const readout = document.getElementById("readout");

const movesEl = document.getElementById("moves");
const flashEl = document.getElementById("flash");
const recordBtn = document.getElementById("record");
const guidedBtn = document.getElementById("guided");
const punchesBtn = document.getElementById("punches");
const recordButtons = [recordBtn, guidedBtn, punchesBtn];
const debugEl = document.getElementById("debug");

const MIN_VISIBILITY = 0.5;
const STANCE = "orthodox";

// Says the move out loud. A new call-out cuts off the previous one so the
// voice keeps up with fast combinations.
function say(text) {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const words = new SpeechSynthesisUtterance(text);
  words.rate = 1.4;
  if (synth.speaking || synth.pending) {
    // Some browsers drop a call-out made straight after a cancel.
    synth.cancel();
    setTimeout(() => synth.speak(words), 0);
  } else {
    synth.speak(words);
  }
}

// Shows the move in large letters over the video for a moment.
let flashTimer = null;
function flash(text) {
  flashEl.textContent = text;
  flashEl.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flashEl.classList.remove("on"), 700);
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

// Recording: saves tracked points to a file, so the move recognition can
// be tuned on real punches. It saves numbers only, no video.
//
// A guided recording also calls out a move every few seconds and saves
// which move was asked for when. That is the answer key for tuning.
const RECORD_COUNTDOWN_MS = 5000;
const FREE_LENGTH_MS = 15000;
const CUE_GAP_MS = 2500;
const BLOCK_LEAD_MS = 3000; // time to hear the punch name and get set
const BEEP_GAP_MS = 2000;

const DRILLS = {
  // Every move called out by name, one every few seconds, four times round.
  all: {
    rounds: 4,
    moves: ["jab", "cross", "left hook", "right hook", "slip left", "slip right", "block"],
    file: "sparring-guided-recording.json",
  },
  // One punch at a time: the name is announced once, then each beep means
  // "throw it now". Nothing to think about, so every punch has a sure label.
  punches: {
    blocks: [
      { move: "jab", reps: 6 },
      { move: "cross", reps: 6 },
      { move: "left hook", reps: 6 },
      { move: "right hook", reps: 6 },
    ],
    file: "sparring-punch-recording.json",
  },
};

let recording = null;

// The plan for a guided recording:
//   events: what to say, show or beep, and when
//   cues:   the answer key saved to the file (which move was asked for when)
//   blocks: for block drills, the stretch of time that belongs to each punch
function guidedPlan(drill) {
  const events = [];
  const cues = [];
  const blocks = [];
  let t = 2000; // two quiet seconds in guard first

  if (drill.blocks) {
    for (const block of drill.blocks) {
      const start = t;
      events.push({ t, say: block.move + "s", show: block.move });
      t += BLOCK_LEAD_MS;
      for (let i = 0; i < block.reps; i++) {
        events.push({ t, beep: true, show: block.move });
        cues.push({ t, move: block.move });
        t += BEEP_GAP_MS;
      }
      blocks.push({ start, end: t, move: block.move });
    }
  } else {
    for (let round = 0; round < drill.rounds; round++) {
      for (const move of drill.moves) {
        events.push({ t, say: move, show: move });
        cues.push({ t, move });
        t += CUE_GAP_MS;
      }
    }
  }
  return { events, cues, blocks, lengthMs: t + 500 };
}

// A short beep. Unlike the voice it plays instantly, so it marks time exactly.
let audio = null;
function beep() {
  if (!audio) return;
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  tone.frequency.value = 880;
  volume.gain.setValueAtTime(0.4, audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
  tone.connect(volume).connect(audio.destination);
  tone.start();
  tone.stop(audio.currentTime + 0.15);
}

function startRecording(drillName) {
  const drill = DRILLS[drillName];
  const guided = Boolean(drill);
  const plan = guided
    ? guidedPlan(drill)
    : { events: [], cues: [], blocks: [], lengthMs: FREE_LENGTH_MS };
  // Sound can only be switched on from a button press, which this is.
  if (!audio && (window.AudioContext || window.webkitAudioContext)) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audio && audio.state === "suspended") audio.resume();
  recording = {
    guided,
    drill: drillName,
    file: guided ? drill.file : "sparring-recording.json",
    start: performance.now() + RECORD_COUNTDOWN_MS,
    lengthMs: plan.lengthMs,
    events: plan.events,
    cues: plan.cues,
    blocks: plan.blocks,
    nextEvent: 0,
    frames: [],
    moves: [],
    announced: false,
  };
  for (const button of recordButtons) button.disabled = true;
}

const round = (v) => Math.round(v * 1000) / 1000;
function compact(points) {
  const out = {};
  for (const [name, p] of Object.entries(points)) {
    if (name.endsWith("Hip")) continue;
    out[name] = [round(p.x), round(p.y), round(p.z), round(p.visibility ?? 1)];
  }
  return out;
}

function record(frame, now) {
  if (!recording) return;
  const elapsed = now - recording.start;
  if (elapsed < 0) {
    setStatus("Recording starts in " + Math.ceil(-elapsed / 1000) + "... get into your guard.");
    return;
  }
  if (!recording.announced) {
    recording.announced = true;
    if (!recording.guided) {
      say("Go");
      flash("go");
    }
  }

  if (elapsed <= recording.lengthMs) {
    const event = recording.events[recording.nextEvent];
    if (event && elapsed >= event.t) {
      recording.nextEvent += 1;
      if (event.say) say(event.say);
      if (event.beep) beep();
      flash(event.show);
    }
    if (recording.guided) {
      const done = recording.cues.filter((cue) => cue.t <= elapsed).length;
      setStatus(
        (recording.blocks.length
          ? "Throw the named punch once on every beep, then return to guard. "
          : "Do each move once when you hear it, then return to guard. ") +
          done + " of " + recording.cues.length + ".",
      );
    }
    recording.frames.push(
      frame
        ? { t: Math.round(elapsed), image: compact(frame.image), world: compact(frame.world) }
        : { t: Math.round(elapsed) },
    );
    return;
  }

  const data = {
    recordedAt: new Date().toISOString(),
    guided: recording.guided,
    drill: recording.drill,
    stance: STANCE,
    video: { width: video.videoWidth, height: video.videoHeight },
    cues: recording.cues,
    blocks: recording.blocks,
    moves: recording.moves,
    frames: recording.frames,
  };
  const name = recording.file;
  recording = null;
  say("Done");
  flash("done");

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  link.download = name;
  link.click();
  for (const button of recordButtons) button.disabled = false;
}

recordBtn.addEventListener("click", () => startRecording(null));
guidedBtn.addEventListener("click", () => startRecording("all"));
punchesBtn.addEventListener("click", () => startRecording("punches"));

function run(tracker) {
  const detector = createMoveDetector({
    stance: STANCE,
    onMove(move) {
      // During a guided recording the voice belongs to the call-outs.
      if (!(recording && recording.guided)) {
        say(move);
        flash(move);
        showMove(move);
      }
      if (recording) recording.moves.push({ t: Math.round(performance.now() - recording.start), move });
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
      record(frame, now);

      const d = detector.debug();
      const n = (v) => v.toFixed(1);
      debugEl.textContent =
        "Left hand: speed " + n(d.left.speed) + ", reach " + n(d.left.reach) +
        "   Right hand: speed " + n(d.right.speed) + ", reach " + n(d.right.reach);

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
    for (const button of recordButtons) button.hidden = false;
    say("Ready");
    flash("ready");
    run(tracker);
  } catch (err) {
    console.error(err);
    setStatus("Body tracking could not load. Check your internet connection and reload.", true);
    startBtn.disabled = false;
  }
});
