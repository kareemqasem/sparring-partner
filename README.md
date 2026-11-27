# sparring-partner

A virtual sparring partner for boxing practice at home. An on-screen opponent
attacks and defends, and the camera watches you to judge what happened.

It is a plain web page: no install and no build step. Body tracking runs in
the browser, so no video leaves your device.

## Status

Version 1 goal: one working 3-minute round that scores hits and misses.

- [x] Step 0: project setup
- [x] Step 1: camera and body tracking (skeleton drawn over the video)
- [x] Step 2: recognise moves (jab, cross, hook, slip, block), spoken out loud. Tuned on one labelled recording of one boxer; needs checking on fresh recordings. Punches to the body are recognised as a body shot, without saying which hand or which punch.
- [x] Step 3: on-screen opponent (simple boxer figure; blocks your punches, winds up before punching, and is open to a counter when you make it miss)
- [x] Easy and Hard levels. Hard has a half-second warning, body shots you must duck, a high or low guard to punch around, and counters after it blocks you
- [ ] Step 4: scoring (basic counts are in: landed, avoided, hits taken)
- [ ] Step 5: 3-minute round with timer and summary
- [ ] Step 6: test and tune at home

## Run it

Browsers only allow the camera on secure pages, so opening `index.html`
directly from a folder will not work. Either:

- **GitHub Pages:** in the repo, go to Settings, then Pages, and deploy from
  the `main` branch. Open the address it gives you.
- **On your laptop:** run `python3 -m http.server` in this folder and open
  `http://localhost:8000`.

## Files

- `index.html`, `style.css`: the page
- `src/main.js`: camera, drawing, and the main loop
- `src/pose.js`: body tracking (MediaPipe Pose Landmarker)
- `src/moves.js`: turns tracked points into moves; the `TUNING` numbers at the top control sensitivity
- `src/opponent.js`: what the opponent does and how your moves affect it; the `LEVELS` numbers set each level's timing and behaviour
- `src/ring.js`: draws the opponent
- `tests/`: checks for move recognition and opponent behaviour, run with `npm test`
