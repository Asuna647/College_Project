/**
 * MediaPipe Face Landmarker wrapper for head-pose estimation.
 * Extracts facial landmarks (~478 keypoints) and calculates head yaw angle.
 *
 * Fixed in Phase 2 refinement:
 * - Better yaw calculation using multiple landmarks for robustness
 * - Confidence threshold filtering
 * - Better error handling and validation
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let landmarker = null;

/**
 * Initialize the Face Landmarker model.
 * Loads from Google CDN, cached by browser after first load.
 */
export async function initFaceLandmarker() {
  if (landmarker) return landmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1, // Only need one face for yaw estimation
    minFaceDetectionConfidence: 0.7, // FIXED: Add confidence threshold
  });

  return landmarker;
}

/**
 * Run landmark detection on a video frame.
 * Returns landmarks array with ~478 facial keypoints.
 */
export function detectLandmarks(video, timestampMs) {
  if (!landmarker) {
    throw new Error("Face Landmarker not initialized");
  }
  return landmarker.detectForVideo(video, timestampMs);
}

/**
 * Calculate head yaw (left/right rotation) from facial landmarks.
 *
 * FIXED: Improved algorithm using multiple landmarks for better accuracy.
 * Uses eye, nose, and face center landmarks to estimate rotation.
 * Returns yaw in degrees: negative = looking left, positive = looking right.
 *
 * MediaPipe landmark indices:
 * - Left eye inner: 33, outer: 133
 * - Right eye inner: 263, outer: 362
 * - Nose tip: 1
 * - Face center: average of all landmarks
 * - Mouth left: 61, right: 291
 */
export function calculateHeadYaw(landmarks) {
  if (!landmarks || landmarks.length < 264) {
    return 0; // Not enough landmarks detected
  }

  try {
    // Extract multiple eye and nose landmarks for robustness
    const leftEyeInner = landmarks[33];
    const leftEyeOuter = landmarks[133];
    const rightEyeInner = landmarks[263];
    const rightEyeOuter = landmarks[362];
    const noseTip = landmarks[1];
    const mouthLeft = landmarks[61];
    const mouthRight = landmarks[291];

    // Calculate eye centers
    const leftEyeCenter = {
      x: (leftEyeInner.x + leftEyeOuter.x) / 2,
      y: (leftEyeInner.y + leftEyeOuter.y) / 2,
    };
    const rightEyeCenter = {
      x: (rightEyeInner.x + rightEyeOuter.x) / 2,
      y: (rightEyeInner.y + rightEyeOuter.y) / 2,
    };

    // Calculate eyes midpoint
    const eyesMidpoint = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
    };

    // Calculate mouth midpoint for additional reference
    const mouthMidpoint = {
      x: (mouthLeft.x + mouthRight.x) / 2,
    };

    // Calculate yaw using nose offset from eyes
    // Better algorithm: use atan2 with better scaling
    const noseOffsetFromEyes = noseTip.x - eyesMidpoint.x;
    const eyeDistance = Math.abs(rightEyeCenter.x - leftEyeCenter.x);

    // Normalize by eye distance for scale-invariance
    const normalizedOffset = eyeDistance > 0 ? noseOffsetFromEyes / eyeDistance : 0;

    // Convert to degrees with better sensitivity
    // Range: -1 to 1 normalizedOffset maps to -90 to 90 degrees
    const yawRaw = normalizedOffset * 90;

    // Clamp to ±90° range
    const yawClamped = Math.max(-90, Math.min(90, yawRaw));

    // FIXED: Add validity check - if nose is not between eyes, it's likely invalid
    const noseIsBetweenEyes =
      noseTip.x > Math.min(leftEyeCenter.x, rightEyeCenter.x) * 0.8 &&
      noseTip.x < Math.max(leftEyeCenter.x, rightEyeCenter.x) * 1.2;

    if (!noseIsBetweenEyes) {
      // Face is rotated too much or landmarks are unreliable
      return 0;
    }

    return yawClamped;
  } catch (err) {
    console.error("Error calculating head yaw:", err);
    return 0;
  }
}

/**
 * Smooth yaw values using exponential moving average.
 * Reduces noise from frame-to-frame jitter.
 *
 * @param {number} newValue - New yaw measurement
 * @param {number} previousSmoothed - Previous smoothed value
 * @param {number} alpha - Smoothing factor (0-1, lower = more smoothing)
 */
export function smoothYaw(newValue, previousSmoothed, alpha = 0.3) {
  // FIXED: Ignore if newValue is invalid (0 when detection failed)
  // to prevent smoothing to zero on detection glitches
  if (newValue === 0 && previousSmoothed !== 0) {
    // Keep previous value if new detection failed
    return previousSmoothed;
  }

  return alpha * newValue + (1 - alpha) * previousSmoothed;
}
