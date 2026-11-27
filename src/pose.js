// Body tracking: wraps MediaPipe's Pose Landmarker, which finds 33 body
// points in each camera frame. It runs fully in the browser; no video
// leaves the device.

import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

// Indexes of the points boxing cares about, in MediaPipe's numbering.
export const POINTS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

// Lines drawn between points to make the upper-body skeleton.
export const BONES = [
  ["leftShoulder", "rightShoulder"],
  ["leftShoulder", "leftElbow"],
  ["leftElbow", "leftWrist"],
  ["rightShoulder", "rightElbow"],
  ["rightElbow", "rightWrist"],
  ["leftShoulder", "leftHip"],
  ["rightShoulder", "rightHip"],
  ["leftHip", "rightHip"],
];

export async function createTracker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  const pick = (body) => {
    const named = {};
    for (const [name, index] of Object.entries(POINTS)) {
      named[name] = body[index];
    }
    return named;
  };

  return {
    // Returns the named points for one video frame, or null if nobody is seen.
    //   image: where each point is in the picture (x and y from 0 to 1)
    //   world: where each point is in real space, in metres, measured from
    //          the hips. This is what lets us see a punch thrown straight
    //          at the camera.
    track(video, timeMs) {
      const result = landmarker.detectForVideo(video, timeMs);
      const image = result.landmarks && result.landmarks[0];
      const world = result.worldLandmarks && result.worldLandmarks[0];
      if (!image || !world) return null;
      const frame = { image: pick(image), world: pick(world) };
      // Trust the picture's "can I see this point" score for both sets.
      for (const name of Object.keys(POINTS)) {
        frame.world[name] = { ...frame.world[name], visibility: frame.image[name].visibility };
      }
      return frame;
    },
  };
}
