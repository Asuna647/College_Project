/**
 * Advanced Gaze Detection — Phase 4C
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
    // Use multiple face region landmarks for robust estimation
    const forehead = landmarks[10];      // Top of head
    const chin = landmarks[152];         // Bottom of chin
    const leftCheek = landmarks[234];    // Left face
    const rightCheek = landmarks[454];   // Right face
    const noseBase = landmarks[2];       // Nose bridge
    const noseTip = landmarks[1];        // Nose tip
    const leftEye = landmarks[33];       // Left eye
    const rightEye = landmarks[263];     // Right eye

    // Validate critical landmarks exist
    if (!forehead || !chin || !noseBase || !noseTip || !leftEye || !rightEye) {
      return { yaw: 0, pitch: 0, roll: 0, confidence: 0 };
    }

    // ===== PITCH CALCULATION (up/down rotation) =====
    // Face length (forehead to chin)
    const faceCenterY = (forehead.y + chin.y) / 2;
    // Nose deviation from center indicates pitch
    const nosePitchDeviation = noseBase.y - faceCenterY;
    // Map to -60 to 60 degrees
    const pitchRaw = nosePitchDeviation * 150; // Empirical scaling
    const pitch = Math.max(-60, Math.min(60, pitchRaw));

    // ===== YAW CALCULATION (left/right rotation) =====
    const cheekDistance = Math.abs(rightCheek.x - leftCheek.x);
    const noseCenterX = (leftCheek.x + rightCheek.x) / 2;
    const noseDeviation = noseTip.x - noseCenterX;
    // Map to -90 to 90 degrees
    const yawRaw = (noseDeviation / cheekDistance) * 90;
    const yaw = Math.max(-90, Math.min(90, yawRaw));

    // ===== ROLL CALCULATION (tilt left/right) =====
    // Eye horizontal alignment indicates roll
    const eyeAngleDiff = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const roll = (eyeAngleDiff * 180) / Math.PI;
    const rollClamped = Math.max(-30, Math.min(30, roll));

    // ===== CONFIDENCE CALCULATION =====
    // Based on visibility of critical landmarks
    const criticalLandmarks = [
      forehead,
      chin,
      leftCheek,
      rightCheek,
      noseBase,
      noseTip,
      leftEye,
      rightEye,
    ];

    const visibleCount = criticalLandmarks.filter(
      lm => lm && lm.visibility > 0.7
    ).length;

    const confidence = visibleCount / criticalLandmarks.length; // 0-1

    return {
      yaw: Math.round(yaw * 10) / 10,      // Round to 0.1 degree
      pitch: Math.round(pitch * 10) / 10,
      roll: Math.round(rollClamped * 10) / 10,
      confidence: Math.round(confidence * 100) / 100, // 0-1
    };
  } catch (err) {
    console.error("Error in advanced gaze detection:", err);
    return { yaw: 0, pitch: 0, roll: 0, confidence: 0 };
  }
}

/**
 * Gaze event detector with confidence-based triggering.
 * Only fires events when confidence exceeds threshold.
 */
export class GazeEventDetector {
  constructor(
    yawThreshold = 25,
    durationSeconds = 5,
    confidenceThreshold = 0.7
  ) {
    this.yawThreshold = yawThreshold;
    this.durationSeconds = durationSeconds;
    this.confidenceThreshold = confidenceThreshold;

    this.lookingAwayStart = null;
    this.lookingAwayFired = false;
    this.lastHeadPose = null;
  }

  /**
   * Evaluate head pose and return event if criteria met.
   * Returns null if no event, or { type, confidence, duration, yaw }
   */
  evaluate(headPose) {
    this.lastHeadPose = headPose;

    // Only evaluate if confidence is high enough
    if (headPose.confidence < this.confidenceThreshold) {
      // Low confidence - don't fire events
      this.lookingAwayStart = null;
      this.lookingAwayFired = false;
      return null;
    }

    const isLookingAway =
      Math.abs(headPose.yaw) > this.yawThreshold &&
      headPose.confidence > this.confidenceThreshold;

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

  /**
   * Get current gaze state for UI display.
   */
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

  /**
   * Reset detector state.
   */
  reset() {
    this.lookingAwayStart = null;
    this.lookingAwayFired = false;
    this.lastHeadPose = null;
  }
}

/**
 * Adaptive Gaze Detector with calibration phase.
 * Learns baseline noise during calibration and adapts thresholds.
 */
export class AdaptiveGazeDetector {
  constructor(calibrationDurationSeconds = 5) {
    this.calibrationPhase = true;
    this.calibrationSamples = [];
    this.calibrationDurationMs = calibrationDurationSeconds * 1000;
    this.calibrationStartTime = null;

    // Defaults (updated during calibration)
    this.adaptiveThreshold = 25;
    this.adaptiveDuration = 5;
    this.baselineNoise = 0;
  }

  /**
   * Feed a head pose sample. During calibration, learns baseline noise.
   * Returns { phase: "calibrating"|"ready", progress: 0-1 }
   */
  feedSample(headPose) {
    if (this.calibrationPhase) {
      if (this.calibrationStartTime === null) {
        this.calibrationStartTime = Date.now();
      }

      this.calibrationSamples.push(headPose);

      const elapsed = Date.now() - this.calibrationStartTime;
      const progress = Math.min(1, elapsed / this.calibrationDurationMs);

      if (elapsed >= this.calibrationDurationMs) {
        // Calibration complete
        this.finishCalibration();
        return { phase: "ready", progress: 1 };
      }

      return { phase: "calibrating", progress };
    }

    return { phase: "ready", progress: 1 };
  }

  /**
   * Finish calibration and calculate adaptive thresholds.
   */
  finishCalibration() {
    if (this.calibrationSamples.length === 0) {
      this.calibrationPhase = false;
      return;
    }

    // Calculate baseline noise (standard deviation of yaw during calibration)
    const yawValues = this.calibrationSamples.map(s => Math.abs(s.yaw || 0));
    const mean = yawValues.reduce((a, b) => a + b, 0) / yawValues.length;
    const variance =
      yawValues.reduce((sum, y) => sum + (y - mean) ** 2, 0) /
      yawValues.length;
    this.baselineNoise = Math.sqrt(variance);

    // Set adaptive threshold to baseline + 3 standard deviations
    // This gives us a threshold that's rarely triggered by natural head movement
    this.adaptiveThreshold = Math.max(20, this.baselineNoise + 15);

    console.log(
      `[ADAPTIVE GAZE] Calibration complete. Baseline noise: ${this.baselineNoise.toFixed(1)}°, Adaptive threshold: ${this.adaptiveThreshold.toFixed(1)}°`
    );

    this.calibrationPhase = false;
  }

  /**
   * Check if head is looking away using adaptive threshold.
   */
  isLookingAway(headPose) {
    if (this.calibrationPhase) {
      return false; // Don't fire events during calibration
    }

    return Math.abs(headPose.yaw) > this.adaptiveThreshold;
  }

  /**
   * Get calibration status.
   */
  getCalibrationStatus() {
    return {
      calibrating: this.calibrationPhase,
      baselineNoise: this.baselineNoise,
      adaptiveThreshold: this.adaptiveThreshold,
    };
  }

  /**
   * Reset for new session.
   */
  reset() {
    this.calibrationPhase = true;
    this.calibrationSamples = [];
    this.calibrationStartTime = null;
    this.adaptiveThreshold = 25;
    this.baselineNoise = 0;
  }
}
