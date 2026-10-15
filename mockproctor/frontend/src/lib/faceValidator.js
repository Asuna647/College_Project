/** Permissive sanity checks for face boxes; confidence is not the sole filter. */
export function calculateCombinedConfidence(detection) {
  const scores = (detection?.categories || [])
    .map((category) => Number(category?.score))
    .filter((score) => Number.isFinite(score));
  return scores.length ? Math.max(...scores) : 0;
}

export function isValidFaceBoundingBox(box, videoWidth, videoHeight, confidence = 1) {
  if (!box || ![box.originX, box.originY, box.width, box.height].every(Number.isFinite)) return false;
  if (box.width <= 12 || box.height <= 12) return false;
  if (box.width > videoWidth * 1.05 || box.height > videoHeight * 1.05) return false;
  if (box.originX + box.width < 0 || box.originY + box.height < 0) return false;
  if (box.originX > videoWidth || box.originY > videoHeight) return false;
  if (!Number.isFinite(confidence) || confidence < 0.20) return false;
  return true;
}

export function validateDetections(detections, videoWidth, videoHeight) {
  if (!Array.isArray(detections)) return [];
  return detections.filter((detection) =>
    isValidFaceBoundingBox(
      detection?.boundingBox, videoWidth, videoHeight, calculateCombinedConfidence(detection),
    )
  );
}
