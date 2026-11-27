# sparring-partner

A virtual sparring partner for boxing practice at home. An on-screen opponent
attacks and defends, and the camera watches you to judge what happened.

It is a plain web page: no install and no build step. Body tracking runs in
the browser, so no video leaves your device.

## Status

Version 1 goal: one working 3-minute round that scores hits and misses.

- [x] Step 0: project setup
- [x] Step 1: camera and body tracking (skeleton drawn over the video)
- [ ] Step 2: recognise moves (jab, cross, hook, slip, block)
- [ ] Step 3: on-screen opponent
- [ ] Step 4: scoring
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
