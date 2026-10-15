/**
 * Lightweight webcam-derived head pose / gaze heuristic.
 * Intended for anomaly review, not precise scientific gaze measurement.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function calculateHeadPoseAdvanced(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 264) {
    return { yaw: 0, pitch: 0, roll: 0, gazeOffset: 0, gazeVerticalOffset: 0, confidence: 0 };
  }

  const leftOuter = landmarks[33];
  const rightOuter = landmarks[263];
  const nose = landmarks[1];
  const leftInner = landmarks[133];
  const rightInner = landmarks[362];
  const mouthUpper = landmarks[13] || landmarks[0];
  const mouthLower = landmarks[14] || landmarks[0];
  if (![leftOuter, rightOuter, nose, leftInner, rightInner].every(Boolean)) {
    return { yaw: 0, pitch: 0, roll: 0, gazeOffset: 0, gazeVerticalOffset: 0, confidence: 0 };
  }

  const faceWidth = Math.abs(rightOuter.x - leftOuter.x);
  if (faceWidth < 1e-4) return { yaw: 0, pitch: 0, roll: 0, gazeOffset: 0, gazeVerticalOffset: 0, confidence: 0 };

  const eyeCenterX = (leftOuter.x + rightOuter.x) / 2;
  const eyeCenterY = (leftOuter.y + rightOuter.y) / 2;
  const yaw = clamp(((nose.x - eyeCenterX) / faceWidth) * 150, -45, 45);
  const roll = Math.atan2(rightOuter.y - leftOuter.y, rightOuter.x - leftOuter.x) * 180 / Math.PI;
  const mouthY = (mouthUpper.y + mouthLower.y) / 2;
  const eyeToMouth = mouthY - eyeCenterY;
  const noseProgress = Math.abs(eyeToMouth) > 1e-4 ? (nose.y - eyeCenterY) / eyeToMouth : 0.5;
  // This is a normalized landmark pitch proxy, not a true physical angle.
  // A larger multiplier gives small up/down head movements enough range to detect.
  const pitch = clamp((noseProgress - 0.48) * 100, -35, 35);

  let gazeOffset = 0;
  let gazeVerticalOffset = 0;
  if (landmarks.length >= 478 && landmarks[468] && landmarks[473]) {
    const normalized = (iris, cornerA, cornerB) => {
      const minX = Math.min(cornerA.x, cornerB.x);
      const width = Math.abs(cornerB.x - cornerA.x);
      if (width < 1e-5) return 0.5;
      return clamp((iris.x - minX) / width, 0, 1);
    };
    const leftPosition = normalized(landmarks[468], leftOuter, leftInner);
    const rightPosition = normalized(landmarks[473], rightInner, rightOuter);
    // A heuristic offset from iris location; calibrated against the neutral pose.
    gazeOffset = (((leftPosition + rightPosition) / 2) - 0.5) * 50;

    // Track vertical iris position relative to upper/lower eyelids. This detects
    // eye-only looking up/down, which head-pitch alone cannot reliably detect.
    const leftUpper = landmarks[159];
    const leftLower = landmarks[145];
    const rightUpper = landmarks[386];
    const rightLower = landmarks[374];
    const normalizedY = (iris, upper, lower) => {
      const height = lower.y - upper.y;
      if (Math.abs(height) < 1e-5) return 0.5;
      return clamp((iris.y - upper.y) / height, 0, 1);
    };
    if (leftUpper && leftLower && rightUpper && rightLower) {
      const leftVertical = normalizedY(landmarks[468], leftUpper, leftLower);
      const rightVertical = normalizedY(landmarks[473], rightUpper, rightLower);
      // Scale to percentage points; calibration supplies the neutral baseline.
      gazeVerticalOffset = (((leftVertical + rightVertical) / 2) - 0.5) * 100;
    }
  }

  const features = [yaw, pitch, gazeOffset, gazeVerticalOffset];
  return { yaw, pitch, roll, gazeOffset, gazeVerticalOffset, features,
    confidence: landmarks.length >= 478 ? 0.9 : 0.65 };
}

export class AdaptiveGazeDetector {
  constructor(calibrationMs = 2200, minSamples = 24) {
    this.calibrationMs = calibrationMs;
    this.minSamples = minSamples;
    this.startedAt = Date.now();
    this.samples = [];
    this.phase = "calibrating";
    this.baseline = null;
  }

  feedSample(pose) {
    if (this.phase === "ready") return { phase: "ready", progress: 1, baseline: this.baseline };

    if (pose && pose.confidence > 0.4 &&
        Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch) &&
        Number.isFinite(pose.gazeOffset) &&
        Number.isFinite(pose.gazeVerticalOffset ?? 0)) {
      this.samples.push({ yaw: pose.yaw, pitch: pose.pitch, gazeOffset: pose.gazeOffset,
        gazeVerticalOffset: pose.gazeVerticalOffset ?? 0 });
    }

    const elapsed = Date.now() - this.startedAt;
    const progress = clamp(elapsed / this.calibrationMs, 0, 1);
    if (elapsed >= this.calibrationMs && this.samples.length >= this.minSamples) {
      const mean = (key) => this.samples.reduce((sum, sample) => sum + sample[key], 0) / this.samples.length;
      this.baseline = { yaw: mean("yaw"), pitch: mean("pitch"), gazeOffset: mean("gazeOffset"),
        gazeVerticalOffset: mean("gazeVerticalOffset") };
      this.phase = "ready";
      return { phase: "ready", progress: 1, baseline: this.baseline, sampleCount: this.samples.length };
    }
    return { phase: "calibrating", progress, sampleCount: this.samples.length };
  }
}

export class GazeEventDetector {
  constructor(yawThreshold = 13, sustainedSeconds = 0.65, gazeThreshold = 7) {
    this.yawThreshold = yawThreshold;
    this.sustainedMs = sustainedSeconds * 1000;
    this.gazeThreshold = gazeThreshold;
    this.pitchThreshold = 7;
    this.gazeVerticalThreshold = 8;
    this.baseline = { yaw: 0, pitch: 0, gazeOffset: 0, gazeVerticalOffset: 0 };
    this.awaySince = null;
  }

  setBaseline(baseline) {
    if (!baseline) return;
    this.baseline = {
      yaw: Number.isFinite(baseline.yaw) ? baseline.yaw : 0,
      pitch: Number.isFinite(baseline.pitch) ? baseline.pitch : 0,
      gazeOffset: Number.isFinite(baseline.gazeOffset) ? baseline.gazeOffset : 0,
      gazeVerticalOffset: Number.isFinite(baseline.gazeVerticalOffset) ? baseline.gazeVerticalOffset : 0,
    };
  }

  evaluate(pose, now = Date.now()) {
    if (!pose || pose.confidence < 0.4) {
      this.awaySince = null;
      return null;
    }

    const yawDelta = Math.abs(pose.yaw - this.baseline.yaw);
    const pitchDelta = Math.abs(pose.pitch - this.baseline.pitch);
    const gazeDelta = Math.abs(pose.gazeOffset - this.baseline.gazeOffset);
    const gazeVerticalDelta = Math.abs((pose.gazeVerticalOffset ?? 0) - this.baseline.gazeVerticalOffset);
    const away = yawDelta > this.yawThreshold ||
      pitchDelta > this.pitchThreshold ||
      gazeDelta > this.gazeThreshold ||
      gazeVerticalDelta > this.gazeVerticalThreshold;

    if (!away) {
      this.awaySince = null;
      return null;
    }

    if (this.awaySince === null) this.awaySince = now;
    if (now - this.awaySince < this.sustainedMs) return null;
    return { type: "looking_away", yawDelta, pitchDelta, gazeDelta, gazeVerticalDelta };
  }

  reset() {
    this.awaySince = null;
  }
}


// User-specific mapping from webcam eye/head features to normalized screen coordinates.
// Targets span the viewport. A prediction outside the calibrated screen plus a tolerance
// margin is only a candidate; the detector separately enforces confidence and dwell time.
export const SCREEN_CALIBRATION_TARGETS = [
  { x: 0.08, y: 0.12 }, { x: 0.50, y: 0.12 }, { x: 0.92, y: 0.12 },
  { x: 0.08, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.92, y: 0.50 },
  { x: 0.08, y: 0.88 }, { x: 0.50, y: 0.88 }, { x: 0.92, y: 0.88 },
];

export function gazeFeatureVector(pose) {
  return [
    1,
    clamp((pose?.gazeOffset || 0) / 25, -2, 2),
    clamp((pose?.gazeVerticalOffset || 0) / 50, -2, 2),
    clamp((pose?.yaw || 0) / 45, -1.5, 1.5),
    clamp((pose?.pitch || 0) / 35, -1.5, 1.5),
  ];
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function fitRidge(samples, outputKey, lambda = 0.025) {
  const dimensions = samples[0].features.length;
  const matrix = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
  const vector = Array(dimensions).fill(0);
  for (const sample of samples) {
    const x = sample.features;
    for (let i = 0; i < dimensions; i += 1) {
      vector[i] += x[i] * sample.target[outputKey];
      for (let j = 0; j < dimensions; j += 1) matrix[i][j] += x[i] * x[j];
    }
  }
  // Do not penalize the intercept.
  for (let i = 1; i < dimensions; i += 1) matrix[i][i] += lambda;
  return solveLinearSystem(matrix, vector);
}

export class ScreenGazeCalibrator {
  constructor() { this.reset(); }
  reset() {
    this.phase = "idle";
    this.targetIndex = 0;
    this.targetStartedAt = 0;
    this.targetSamples = [];
    this.samples = [];
    this.model = null;
    this.lastError = null;
  }
  start(now = performance.now()) {
    this.phase = "collecting";
    this.targetIndex = 0;
    this.targetStartedAt = now;
    this.targetSamples = [];
    this.samples = [];
    this.model = null;
    this.lastError = null;
  }
  get target() { return SCREEN_CALIBRATION_TARGETS[this.targetIndex] || null; }
  addSample(pose, now = performance.now()) {
    if (this.phase !== "collecting" || !pose || pose.confidence < 0.75) return this.status();
    const elapsed = now - this.targetStartedAt;
    // Ignore the initial eye movement toward the dot; use only the stable tail.
    if (elapsed >= 350 && elapsed <= 1350) this.targetSamples.push(gazeFeatureVector(pose));
    if (elapsed < 1500) return this.status();
    if (this.targetSamples.length < 5) {
      this.lastError = `Not enough stable face/eye samples for point ${this.targetIndex + 1}. Keep your face visible and try again.`;
      this.targetStartedAt = now;
      this.targetSamples = [];
      return this.status();
    }
    const dimensions = this.targetSamples[0].length;
    const features = Array(dimensions).fill(0);
    for (const sample of this.targetSamples) sample.forEach((v, i) => { features[i] += v / this.targetSamples.length; });
    this.samples.push({ features, target: SCREEN_CALIBRATION_TARGETS[this.targetIndex] });
    this.targetIndex += 1;
    this.targetSamples = [];
    this.lastError = null;
    if (this.targetIndex >= SCREEN_CALIBRATION_TARGETS.length) {
      const xWeights = fitRidge(this.samples, "x");
      const yWeights = fitRidge(this.samples, "y");
      if (!xWeights || !yWeights) {
        this.phase = "failed";
        this.lastError = "Calibration could not fit a stable mapping. Please recalibrate.";
      } else {
        const errors = this.samples.map((sample) => {
          const px = xWeights.reduce((sum, w, i) => sum + w * sample.features[i], 0);
          const py = yWeights.reduce((sum, w, i) => sum + w * sample.features[i], 0);
          return Math.hypot(px - sample.target.x, py - sample.target.y);
        });
        const rms = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
        this.model = { xWeights, yWeights, rms };
        this.phase = rms <= 0.30 ? "ready" : "failed";
        if (this.phase === "failed") this.lastError = "Calibration was inconsistent across the screen. Improve lighting, keep your face centered, and try again.";
      }
    } else {
      this.targetStartedAt = now;
    }
    return this.status();
  }
  predict(pose) {
    if (this.phase !== "ready" || !this.model || !pose || pose.confidence < 0.75) return null;
    const features = gazeFeatureVector(pose);
    const dot = (weights) => weights.reduce((sum, w, i) => sum + w * features[i], 0);
    const x = dot(this.model.xWeights);
    const y = dot(this.model.yWeights);
    return { x, y, confidence: clamp(pose.confidence * clamp(1 - Math.max(0, this.model.rms - 0.08) * 0.5, 0.8, 1), 0, 1), calibrationError: this.model.rms };
  }
  status() {
    return { phase: this.phase, targetIndex: this.targetIndex, targetCount: SCREEN_CALIBRATION_TARGETS.length,
      target: this.target, progress: this.targetIndex / SCREEN_CALIBRATION_TARGETS.length,
      sampleCount: this.targetSamples.length, error: this.lastError, rms: this.model?.rms ?? null };
  }
}

export class ScreenGazeEventDetector {
  constructor({ margin = 0.04, sustainedSeconds = 1.8, minConfidence = 0.78 } = {}) {
    this.margin = margin;
    this.sustainedMs = sustainedSeconds * 1000;
    this.minConfidence = minConfidence;
    this.outsideSince = null;
    this.lastResult = null;
  }
  evaluate(prediction, now = Date.now()) {
    if (!prediction || prediction.confidence < this.minConfidence ||
        !Number.isFinite(prediction.x) || !Number.isFinite(prediction.y)) {
      this.outsideSince = null;
      this.lastResult = null;
      return null;
    }
    const outside = prediction.x < -this.margin || prediction.x > 1 + this.margin ||
      prediction.y < -this.margin || prediction.y > 1 + this.margin;
    if (!outside) {
      this.outsideSince = null;
      this.lastResult = null;
      return null;
    }
    if (this.outsideSince === null) this.outsideSince = now;
    const durationMs = now - this.outsideSince;
    this.lastResult = { type: "looking_away", x: prediction.x, y: prediction.y,
      confidence: prediction.confidence, durationMs };
    return durationMs >= this.sustainedMs ? this.lastResult : null;
  }
  reset() { this.outsideSince = null; this.lastResult = null; }
}
