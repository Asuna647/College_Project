/**
 * Thin wrapper around MediaPipe's FaceDetector task.
 * Model and WASM runtime load from Google's public CDN — no local model
 * files or API keys needed, but it does require an internet connection
 * on first load (the model gets cached by the browser after that).
 *
 * FIXED Phase 2 refinement:
 * - Added min confidence threshold to reduce false positives
 * - Better filtering of background objects
 */

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

let detector = null;

export async function initFaceDetector() {
  if (detector) return detector;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.75, // FIXED: Increased from default ~0.5 to 0.75 to reduce false positives
  });

  return detector;
}

/**
 * Runs detection on a single video frame.
 * `timestampMs` must strictly increase between calls — performance.now()
 * from the render loop is the right source for this.
 *
 * FIXED: Filter detections by confidence to reduce false positives.
 */
export function detectFaces(video, timestampMs) {
  if (!detector) {
    throw new Error("Face detector not initialized — call initFaceDetector() first");
  }
  const result = detector.detectForVideo(video, timestampMs);

  // FIXED: Filter detections by confidence threshold
  if (result.detections) {
    result.detections = result.detections.filter((detection) => {
      // Each detection has a confidence score, keep only high-confidence ones
      const confidence = detection.categories?.[0]?.score ?? 0;
      return confidence > 0.7; // Strict confidence threshold
    });
  }

  return result;
}
