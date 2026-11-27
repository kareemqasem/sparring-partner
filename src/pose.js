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
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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

  return {
    // Returns the named points for one video frame, or null if nobody is seen.
    // Each point is { x, y, visibility } with x and y from 0 to 1.
    track(video, timeMs) {
      const result = landmarker.detectForVideo(video, timeMs);
      const body = result.landmarks && result.landmarks[0];
      if (!body) return null;

      const named = {};
      for (const [name, index] of Object.entries(POINTS)) {
        named[name] = body[index];
      }
      return named;
    },
  };
}
