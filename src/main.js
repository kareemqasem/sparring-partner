// Ties everything together: the camera, body tracking, move recognition,
// the opponent, and the tuning tools.

// When you change any file, raise the version number here and in index.html
// (all the "?v=" numbers and the "Version" line), so browsers load the new
// files instead of old saved copies.

import { createTracker, BONES } from "./pose.js?v=17";
import { createMoveDetector } from "./moves.js?v=17";
import { createOpponent } from "./opponent.js?v=17";
import { drawOpponent } from "./ring.js?v=17";

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
const bodyBtn = document.getElementById("body");
const recordButtons = [recordBtn, guidedBtn, punchesBtn, bodyBtn];
const debugEl = document.getElementById("debug");
const stageEl = document.getElementById("stage");
const ringCanvas = document.getElementById("ring");
const ringCtx = ringCanvas.getContext("2d");
const sparBtn = document.getElementById("spar");
const scoreEl = document.getElementById("score");
const voiceBox = document.getElementById("voice");
const calloutsEl = document.getElementById("callouts");
const toolsEl = document.getElementById("tools");
const levelEl = document.getElementById("level");
const levelLabel = document.getElementById("level-label");
const modeEl = document.getElementById("mode");
const modeLabel = document.getElementById("mode-label");
const lengthEl = document.getElementById("length");
const lengthLabel = document.getElementById("length-label");
const resultsEl = document.getElementById("results");
const resultsTitle = document.getElementById("results-title");
const resultsDetail = document.getElementById("results-detail");
const resultsList = document.getElementById("results-list");
const againBtn = document.getElementById("again");
const closeResultsBtn = document.getElementById("close-results");

const MIN_VISIBILITY = 0.5;
const STANCE = "orthodox";

// The voice. Browsers supply their own voices, and which ones exist differs
// by device, so this looks for a female English one and falls back to
// whatever English voice there is. A lowered rate and raised pitch make it
// sound more synthetic.
const FEMALE_VOICE = /female|zira|samantha|victoria|karen|moira|tessa|fiona|serena|susan|hazel|aria|jenny|sonia|libby/i;
let chosenVoice = null;

function chooseVoice() {
  if (!("speechSynthesis" in window)) return;
  const english = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  chosenVoice = english.find((v) => FEMALE_VOICE.test(v.name)) || english[0] || null;
}

if ("speechSynthesis" in window) {
  chooseVoice();
  // Voices often arrive a moment after the page loads.
  window.speechSynthesis.addEventListener("voiceschanged", chooseVoice);
}

// Says something out loud. A new line cuts off the previous one so the
// voice keeps up with fast combinations. `calm` is for full sentences.
function say(text, { calm = false } = {}) {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const words = new SpeechSynthesisUtterance(text);
  if (chosenVoice) words.voice = chosenVoice;
  words.rate = calm ? 0.92 : 1.35;
  words.pitch = 1.15;
  if (synth.speaking || synth.pending) {
    // Some browsers drop a call-out made straight after a cancel.
    synth.cancel();
    setTimeout(() => synth.speak(words), 0);
  } else {
    synth.speak(words);
  }
}

// The welcome, spoken once, on the first button press (browsers do not
// allow any sound before that).
function greet() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  say("Good " + part + ", Consigliere. Welcome to the Code of War.", { calm: true });
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
  ctx.strokeStyle = "#ffffff";
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
    ctx.fillStyle = isHand ? "#ff2d3d" : "#ffffff";
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
const RECORD_COUNTDOWN_MS = 3000; // after you are in position
const IN_POSITION_MS = 1500;      // how long you must hold position first
const FAR_ENOUGH = 0.24;          // shoulders no wider than this share of the picture
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
  // Body work: the four punches thrown to the body, then the body-shot
  // defence (a duck with a small drop of the elbows).
  body: {
    blocks: [
      { move: "body jab", reps: 6 },
      { move: "body cross", reps: 6 },
      { move: "body left hook", reps: 6 },
      { move: "body right hook", reps: 6 },
      { move: "duck", reps: 6 },
    ],
    file: "sparring-body-recording.json",
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

// Short sounds. Unlike the voice they play instantly, so they mark time exactly.
let audio = null;

// Sound can only be switched on from a button press, so call this in one.
function unlockSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!audio && AudioContext) audio = new AudioContext();
  if (audio && audio.state === "suspended") audio.resume();
}

function tone(pitch, seconds = 0.15, shape = "sine", loudness = 0.4) {
  if (!audio) return;
  const source = audio.createOscillator();
  const volume = audio.createGain();
  source.type = shape;
  source.frequency.value = pitch;
  volume.gain.setValueAtTime(loudness, audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + seconds);
  source.connect(volume).connect(audio.destination);
  source.start();
  source.stop(audio.currentTime + seconds);
}

const beep = () => tone(880);

function startRecording(drillName) {
  if (round) endRound("quit");
  resultsEl.hidden = true;
  stageEl.classList.remove("sparring");
  const drill = DRILLS[drillName];
  const guided = Boolean(drill);
  const plan = guided
    ? guidedPlan(drill)
    : { events: [], cues: [], blocks: [], lengthMs: FREE_LENGTH_MS };
  unlockSound();
  recording = {
    guided,
    drill: drillName,
    file: guided ? drill.file : "sparring-recording.json",
    start: null,          // set once you are standing in position
    inPositionSince: null,
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

const round3 = (v) => Math.round(v * 1000) / 1000;
function compact(points) {
  const out = {};
  for (const [name, p] of Object.entries(points)) {
    if (name.endsWith("Hip")) continue;
    out[name] = [round3(p.x), round3(p.y), round3(p.z), round3(p.visibility ?? 1)];
  }
  return out;
}

// Far enough back that head, shoulders and both gloves fit, with room below
// the gloves for body punches and ducks.
function inPosition(points) {
  if (!points) return false;
  const needed = ["nose", "leftShoulder", "rightShoulder", "leftWrist", "rightWrist", "leftElbow", "rightElbow"];
  if (!needed.every((name) => isSeen(points[name]))) return false;
  const width = Math.abs(points.leftShoulder.x - points.rightShoulder.x);
  const lowest = Math.max(points.leftElbow.y, points.rightElbow.y);
  return width <= FAR_ENOUGH && lowest <= 0.8 && points.nose.y >= 0.08;
}

function record(frame, now) {
  if (!recording) return;

  // Nothing starts until you are standing where the camera can see you.
  if (recording.start === null) {
    if (!inPosition(frame && frame.image)) {
      recording.inPositionSince = null;
      setStatus("Step back until your head, both gloves and elbows are in view, with space below them.");
      return;
    }
    if (recording.inPositionSince === null) recording.inPositionSince = now;
    setStatus("Good. Hold still...");
    if (now - recording.inPositionSince < IN_POSITION_MS) return;
    recording.start = now + RECORD_COUNTDOWN_MS;
    say("Ready");
    flash("ready");
    return;
  }

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
bodyBtn.addEventListener("click", () => startRecording("body"));

// Sparring: the opponent, what you see and hear when things happen, and the score.
let sparring = false;
let hitTimer = null;

const opponent = createOpponent({
  onEvent(event) {
    if (event.type === "windup") {
      // Warning: a punch is coming. A low tone means it is going to the body.
      tone(event.target === "body" ? 260 : 520, 0.18, "square", 0.25);
    } else if (event.type === "open") {
      tone(1320, 0.12);                // its guard is down: hit it
    } else if (event.type === "recover") {
      flash("counter!");               // it missed and is exposed
      tone(1320, 0.12);
    } else if (event.type === "strike") {
      if (event.result === "hit") {
        flash(event.target === "body" ? "body hit!" : "hit!");
        tone(110, 0.35, "sawtooth", 0.5);
        stageEl.classList.add("hit");
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => stageEl.classList.remove("hit"), 250);
      } else {
        flash(event.result + "!");
        tone(700, 0.1);
      }
    } else if (event.type === "landed") {
      flash(event.where && event.where !== "head" && round && round.level === "hard" ? event.where + "!" : "landed!");
      tone(1760, 0.2, "triangle", 0.5);
    } else if (event.type === "blocked") {
      tone(300, 0.08, "square", 0.2);
    } else if (event.type === "stopped") {
      endRound("stopped");
      return;
    }
    showScore();
  },
});

// The round: its clock, bell and results.
let round = null; // { mode, level, lengthMs, startedAt, endsAt, lastSecond }

const clockText = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};

function bell(times) {
  for (let i = 0; i < times; i++) setTimeout(() => tone(1175, 0.7, "triangle", 0.5), i * 350);
}

function showScore() {
  if (!round) return;
  const s = opponent.score();
  const left = round.endsAt - performance.now();
  const parts =
    round.mode === "defense"
      ? ["Avoided " + s.avoided, clockText(left), "Hits " + s.taken + " of " + MAX_HITS]
      : ["Landed " + s.landed + "  Avoided " + s.avoided, clockText(left), "Hits taken " + s.taken];
  scoreEl.innerHTML = "";
  parts.forEach((text, i) => {
    const part = document.createElement("span");
    part.textContent = text;
    if (i === 1) part.className = left <= 10000 ? "clock last" : "clock";
    scoreEl.append(part);
  });
}

const MAX_HITS = 5; // matches the opponent's maxHits for defense mode

function startRound() {
  unlockSound();
  const now = performance.now();
  const lengthMs = Number(lengthEl.value) * 60000;
  round = {
    mode: modeEl.value,
    level: levelEl.value,
    lengthMs,
    startedAt: now,
    endsAt: now + lengthMs,
    lastSecond: null,
  };
  sparring = true;
  resultsEl.hidden = true;
  for (const el of [levelEl, modeEl, lengthEl]) el.disabled = true;
  stageEl.classList.add("sparring");
  scoreEl.hidden = false;
  sparBtn.textContent = "Stop round";
  toolsEl.hidden = true;
  // During a round the sounds do the talking, unless you ask for call-outs.
  voiceBox.checked = false;
  opponent.setLevel(round.level);
  opponent.start(now, { mode: round.mode, durationMs: lengthMs });
  bell(1);
  flash(round.mode === "defense" ? "defend" : "fight");
  showScore();
}

// why: "time" (the clock ran out), "stopped" (too many hits), "quit" (you stopped it)
function endRound(why) {
  if (!round) return;
  const finished = round;
  const lasted = Math.min(performance.now(), finished.endsAt) - finished.startedAt;
  const s = opponent.score();
  opponent.stop();
  round = null;
  sparring = false;
  for (const el of [levelEl, modeEl, lengthEl]) el.disabled = false;
  stageEl.classList.remove("hit");
  scoreEl.hidden = true;
  sparBtn.textContent = "Start round";
  toolsEl.hidden = false;

  if (why === "quit") {
    stageEl.classList.remove("sparring");
    return;
  }

  bell(3);
  const faced = s.avoided + s.taken;
  const rows =
    finished.mode === "defense"
      ? [["Avoided", s.avoided], ["Hits taken", s.taken], ["Defence", faced ? Math.round((100 * s.avoided) / faced) + "%" : "-"], ["Lasted", clockText(lasted)]]
      : [["Landed", s.landed], ["Hits taken", s.taken], ["Avoided", s.avoided], ["Defence", faced ? Math.round((100 * s.avoided) / faced) + "%" : "-"]];
  resultsTitle.textContent = why === "stopped" ? "Round stopped" : "Round over";
  resultsDetail.textContent =
    (finished.mode === "defense" ? "Defense" : "Sparring") + " / " + finished.level + " / " +
    clockText(finished.lengthMs) + (why === "stopped" ? " / too many hits" : "");
  resultsList.innerHTML = "";
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    resultsList.append(row);
  }
  resultsEl.hidden = false;
}

// Keeps the clock moving and rings the bell when time is up.
function tickRound(now) {
  if (!round) return;
  const left = round.endsAt - now;
  if (left <= 0) {
    endRound("time");
    return;
  }
  const second = Math.ceil(left / 1000);
  if (second !== round.lastSecond) {
    round.lastSecond = second;
    if (second === 10) tone(880, 0.25, "square", 0.3); // ten seconds left
    showScore();
  }
}

sparBtn.addEventListener("click", () => (round ? endRound("quit") : startRound()));
againBtn.addEventListener("click", startRound);
closeResultsBtn.addEventListener("click", () => {
  resultsEl.hidden = true;
  stageEl.classList.remove("sparring");
});

function drawRing(now) {
  if (!stageEl.classList.contains("sparring")) return;
  const box = ringCanvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  if (ringCanvas.width !== width || ringCanvas.height !== height) {
    ringCanvas.width = width;
    ringCanvas.height = height;
  }
  drawOpponent(ringCtx, width, height, opponent.view(now), now);
}

function run(tracker) {
  const detector = createMoveDetector({
    stance: STANCE,
    onMove(move) {
      const now = performance.now();
      const guided = recording && recording.guided;
      // During a guided recording the voice belongs to the call-outs.
      if (!guided) {
        if (voiceBox.checked) say(move);
        if (!sparring) flash(move);
        showMove(move);
      }
      if (sparring) opponent.playerMove(move, now);
      if (recording && recording.start !== null) {
        recording.moves.push({ t: Math.round(now - recording.start), move });
      }
    },
  });

  let lastVideoTime = -1;
  let frames = 0;
  let fpsStart = performance.now();

  function loop() {
    // The opponent keeps moving every screen refresh, even between camera frames.
    const tick = performance.now();
    opponent.update(tick, { blocking: detector.isBlocking(), head: detector.head() });
    tickRound(tick);
    drawRing(tick);

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
  unlockSound();
  greet();

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
    sparBtn.hidden = false;
    for (const el of [modeLabel, levelLabel, lengthLabel]) el.hidden = false;
    calloutsEl.hidden = false;
    toolsEl.hidden = false;
    flash("ready");
    run(tracker);
  } catch (err) {
    console.error(err);
    setStatus("Body tracking could not load. Check your internet connection and reload.", true);
    startBtn.disabled = false;
  }
});
