/**
 * Advanced Face Detection — Phase 4B
 *
 * Bounding box validation to reduce false positives.
 * Validates detected faces meet real-face characteristics.
 */

/**
 * Validate a face bounding box meets realistic constraints.
 * Returns true if the box looks like a real face, false if suspicious.
 */
export function isValidFaceBoundingBox(detection, videoWidth, videoHeight) {
  if (!detection || !detection.boundingBox) {
    return false;
  }

  const box = detection.boundingBox;

  // Validation 1: Face must be reasonable size
  const faceArea = box.width * box.height;
  const videoArea = videoWidth * videoHeight;
  const faceSizeRatio = faceArea / videoArea;

  // Face should be between 1% and 70% of screen
  if (faceSizeRatio < 0.01 || faceSizeRatio > 0.7) {
    console.log(
      `[FACE VALIDATOR] Invalid size: ${(faceSizeRatio * 100).toFixed(2)}% of screen`
    );
    return false;
  }

  // Validation 2: Face must be reasonably centered (not extreme edge)
  const centerX = box.originX + box.width / 2;
  const centerY = box.originY + box.height / 2;

  const edgeMargin = 0.1; // 10% margin from edges
  if (
    centerX < videoWidth * edgeMargin ||
    centerX > videoWidth * (1 - edgeMargin) ||
    centerY < videoHeight * edgeMargin ||
    centerY > videoHeight * (1 - edgeMargin)
  ) {
    console.log(
      `[FACE VALIDATOR] Face too close to edge: (${(centerX / videoWidth).toFixed(2)}, ${(centerY / videoHeight).toFixed(2)})`
    );
    return false;
  }

  // Validation 3: Bounding box aspect ratio should be roughly square
  // Faces are roughly square; extreme aspect ratios suggest false detection
  const aspectRatio = box.width / box.height;
  if (aspectRatio < 0.5 || aspectRatio > 2.0) {
    console.log(`[FACE VALIDATOR] Invalid aspect ratio: ${aspectRatio.toFixed(2)}`);
    return false;
  }

  // Validation 4: Face should not be extremely small (< 20px)
  if (box.width < 20 || box.height < 20) {
    console.log(`[FACE VALIDATOR] Face too small: ${box.width}x${box.height}px`);
    return false;
  }

  return true;
}

/**
 * Calculate combined confidence score from multiple signals.
 * Combines model confidence, bounding box validity, and temporal consistency.
 */
export function calculateCombinedConfidence(
  modelConfidence,
  boundingBoxValid,
  temporalConsistency
) {
  // Weighted average of signals
  const weights = {
    model: 0.5,        // Model's own confidence
    boundingBox: 0.3,  // Geometric validity
    temporal: 0.2,     // Consistency across frames
  };

  const boxScore = boundingBoxValid ? 1.0 : 0.3;
  const temporalScore = temporalConsistency; // 0-1 based on track age/consistency

  const combined =
    modelConfidence * weights.model +
    boxScore * weights.boundingBox +
    temporalScore * weights.temporal;

  return combined;
}
