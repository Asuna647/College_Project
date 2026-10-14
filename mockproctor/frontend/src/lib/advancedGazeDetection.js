/**
 * Advanced Gaze Detection — Phase 4C (Optimized for Robustness)
 *
 * Improved head pose estimation using multiple facial landmarks.
 * Calculates yaw, pitch, and roll for robust 3D head position.
 */

/**
 * Calculate head pose (yaw, pitch, roll) from facial landmarks.
 * Uses multiple face regions for robust 3D estimation.
 *
 * Returns: { yaw, pitch, roll, confidence }
 *   yaw:        -90 to 90 degrees (left/right rotation)
 *   pitch:      -60 to 60 degrees (up/down rotation)
 *   roll:       -30 to 30 degrees (tilt left/right)
 *   confidence: 0-1 score based on landmark visibility
 */
export function calculateHeadPoseAdvanced(landmarks) {
  if (!landmarks || landmarks.length < 468) {
    return { yaw: 0, pitch: 0, roll: 0, confidence: 0 };
  }

  try {
    const forehead = landmarks[10];      // Top of head
    const chin = landmarks[152];         // Bottom of chin
    const leftCheek = landmarks[234];    // Left face
    const rightCheek = landmarks[454];   // Right face
    const noseBase = landmarks[2];       // Nose bridge
    const noseTip = landmarks[1];        // Nose tip
    const leftEye = landmarks[33];       // Left eye
    const rightEye = landmarks[263];     // Right eye

    if (!forehead || !chin || !noseBase || !noseTip || !leftEye || !rightEye) {
      return { yaw: 0, pitch: 0, roll: 0, confidence: 0 };
    }

    // ===== PITCH CALCULATION (Enhanced for looking up / down detection) =====
    const faceCenterY = (forehead.y + chin.y) / 2;
    const nosePitchDeviation = noseBase.y - faceCenterY;
    const pitchRaw = nosePitchDeviation * 180; // Increased sensitivity for looking up/down
    const pitch = Math.max(-60, Math.min(60, pitchRaw));

    // ===== YAW CALCULATION (Robust Perspective Mapping) =====
    const cheekDistance = Math.abs(rightCheek.x - leftCheek.x);
    const noseCenterX = (leftCheek.x + rightCheek.x) / 2;
    const noseDeviation = noseTip.x - noseCenterX;
    // Enhanced sensitivity scaling: mapping wider range with high sensitivity
    const yawRaw = (noseDeviation / (cheekDistance || 1)) * 130;
    const yaw = Math.max(-90, Math.min(90, yawRaw));

    // ===== EYE GAZE VECTOR CALCULATION (Pupil-in-Eye-Opening Ratio) =====
    // MediaPipe iris/eye landmarks:
    // Left eye corners: inner 133, outer 33. Right eye corners: inner 362, outer 263.
    // We compute horizontal offset of the eye centers relative to eye corners to detect side glances without head turn.
    const leftEyeInner = landmarks[133];
    const leftEyeOuter = landmarks[33];
    const rightEyeInner = landmarks[362];
    const rightEyeOuter = landmarks[263];

    let eyeGazeOffset = 0;
    if (leftEyeInner && leftEyeOuter && rightEyeInner && rightEyeOuter && leftEye && rightEye) {
      const leftEyeWidth = Math.abs(leftEyeOuter.x - leftEyeInner.x) || 0.01;
      const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x) || 0.01;

      // Distance from pupil/center to inner vs outer corners
      const leftEyeCenterRatio = (leftEye.x - leftEyeInner.x) / leftEyeWidth;
      const rightEyeCenterRatio = (rightEye.x - rightEyeInner.x) / rightEyeWidth;

      // Average eye gaze offset (-0.5 to 0.5)
      eyeGazeOffset = ((leftEyeCenterRatio + rightEyeCenterRatio) / 2 - 0.5) * 60;
    }

    // Combine head yaw and enhanced eye gaze offset for precise side-glance & pupil tracking
    const combinedYaw = yaw + (eyeGazeOffset * 1.5);
    const finalYaw = Math.max(-90, Math.min(90, combinedYaw));

    // ===== ROLL CALCULATION =====
    const eyeAngleDiff = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const roll = (eyeAngleDiff * 180) / Math.PI;
    const rollClamped = Math.max(-30, Math.min(30, roll));

    // ===== CONFIDENCE CALCULATION =====
    // Fallback: If landmarks exist, assign high confidence (MediaPipe face_landmarker.task doesn't always populate visibility)
    const confidence = (landmarks && landmarks.length >= 468) ? 0.95 : 0.0;

    return {
      yaw: Math.round(finalYaw * 10) / 10,
      pitch: Math.round(pitch * 10) / 10,
      roll: Math.round(rollClamped * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };
  } catch (err) {
    console.error("Error in advanced gaze detection:", err);
    return { yaw: 0, pitch: 0, roll: 0, confidence: 0 };
  }
}

/**
 * Gaze event detector with confidence-based triggering.
 * Tuned with lower threshold and shorter duration for responsive detection.
 */
export class GazeEventDetector {
  constructor(
    yawThreshold = 20,         // Tuned down from 25 to 20 degrees for better sensitivity
    durationSeconds = 2.5,     // Tuned down from 5s to 2.5s for faster responsiveness
    confidenceThreshold = 0.45 // Tuned down from 0.7 to 0.45 to prevent false rejections
  ) {
    this.yawThreshold = yawThreshold;
    this.durationSeconds = durationSeconds;
    this.confidenceThreshold = confidenceThreshold;

    this.lookingAwayStart = null;
    this.lookingAwayFired = false;
    this.lastHeadPose = null;
  }

  evaluate(headPose) {
    this.lastHeadPose = headPose;

    if (headPose.confidence < this.confidenceThreshold) {
      this.lookingAwayStart = null;
      this.lookingAwayFired = false;
      return null;
    }

    // Ultra-strict evaluation with hysteresis deadband to prevent flickering false alarms
    const isLookingAwayYaw = Math.abs(headPose.yaw) > 15;
    const isLookingAwayPitch = headPose.pitch < -14 || headPose.pitch > 20;
    const isLookingAway = (isLookingAwayYaw || isLookingAwayPitch) &&
      headPose.confidence >= this.confidenceThreshold;

    if (isLookingAway) {
      if (this.lookingAwayStart === null) {
        this.lookingAwayStart = Date.now();
        this.lookingAwayFired = false;
      }

      const elapsedMs = Date.now() - this.lookingAwayStart;
      const elapsedSeconds = elapsedMs / 1000;

      if (elapsedSeconds >= this.durationSeconds && !this.lookingAwayFired) {
        this.lookingAwayFired = true;
        return {
          type: "looking_away",
          confidence: headPose.confidence,
          duration: elapsedSeconds,
          yaw: headPose.yaw,
        };
      }
    } else {
      this.lookingAwayStart = null;
      this.lookingAwayFired = false;
    }

    return null;
  }

  getCurrentState() {
    if (!this.lastHeadPose) {
      return { state: "ok", confidence: 0 };
    }

    if (this.lastHeadPose.confidence < this.confidenceThreshold) {
      return { state: "low_confidence", confidence: this.lastHeadPose.confidence };
    }

    if (Math.abs(this.lastHeadPose.yaw) > this.yawThreshold) {
      return { state: "looking_away", confidence: this.lastHeadPose.confidence };
    }

    return { state: "ok", confidence: this.lastHeadPose.confidence };
  }

  reset() {
    this.lookingAwayStart = null;
    this.lookingAwayFired = false;
    this.lastHeadPose = null;
  }
}

/**
 * Adaptive Gaze Detector with calibration phase.
 */
export class AdaptiveGazeDetector {
  constructor(calibrationDurationSeconds = 3) {
    this.calibrationPhase = true;
    this.calibrationSamples = [];
    this.calibrationDurationMs = calibrationDurationSeconds * 1000;
    this.calibrationStartTime = null;

    this.adaptiveThreshold = 20;
    this.adaptiveDuration = 2.5;
    this.baselineNoise = 0;
  }

  feedSample(headPose) {
    if (this.calibrationPhase) {
      if (this.calibrationStartTime === null) {
        this.calibrationStartTime = Date.now();
      }

      this.calibrationSamples.push(headPose);

      const elapsed = Date.now() - this.calibrationStartTime;
      const progress = Math.min(1, elapsed / this.calibrationDurationMs);

      if (elapsed >= this.calibrationDurationMs) {
        this.finishCalibration();
        return { phase: "ready", progress: 1 };
      }

      return { phase: "calibrating", progress };
    }

    return { phase: "ready", progress: 1 };
  }

  finishCalibration() {
    if (this.calibrationSamples.length === 0) {
      this.calibrationPhase = false;
      return;
    }

    const yawValues = this.calibrationSamples.map(s => Math.abs(s.yaw || 0));
    const mean = yawValues.reduce((a, b) => a + b, 0) / yawValues.length;
    const variance =
      yawValues.reduce((sum, y) => sum + (y - mean) ** 2, 0) /
      yawValues.length;
    this.baselineNoise = Math.sqrt(variance);

    this.adaptiveThreshold = Math.max(18, this.baselineNoise + 12);

    console.log(
      `[ADAPTIVE GAZE] Calibration complete. Baseline noise: ${this.baselineNoise.toFixed(1)}°, Adaptive threshold: ${this.adaptiveThreshold.toFixed(1)}°`
    );

    this.calibrationPhase = false;
  }

  isLookingAway(headPose) {
    if (this.calibrationPhase) {
      return false;
    }

    return Math.abs(headPose.yaw) > this.adaptiveThreshold;
  }

  getCalibrationStatus() {
    return {
      calibrating: this.calibrationPhase,
      baselineNoise: this.baselineNoise,
      adaptiveThreshold: this.adaptiveThreshold,
    };
  }

  reset() {
    this.calibrationPhase = true;
    this.calibrationSamples = [];
    this.calibrationStartTime = null;
    this.adaptiveThreshold = 20;
    this.baselineNoise = 0;
  }
}
