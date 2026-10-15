/** Temporal bounding-box smoothing to reduce flicker between nearby frames. */
export class FaceTracker {
  constructor(maxMissedFrames = 5, matchDistanceRatio = 0.18, smoothing = 0.55) {
    this.maxMissedFrames = maxMissedFrames;
    this.matchDistanceRatio = matchDistanceRatio;
    this.smoothing = smoothing;
    this.tracks = [];
    this.nextId = 1;
  }

  update(detections = []) {
    const matchedIds = new Set();
    const output = [];
    for (const detection of (Array.isArray(detections) ? detections : [])) {
      const box = detection?.boundingBox;
      if (!box) continue;
      const center = centerOf(box);
      const diagonal = Math.hypot(box.width, box.height) || 1;
      let best = null;
      let bestDistance = Infinity;
      for (const track of this.tracks) {
        if (matchedIds.has(track.id)) continue;
        const distance = Math.hypot(center.x - track.center.x, center.y - track.center.y);
        const limit = Math.max(35, diagonal * this.matchDistanceRatio * 5);
        if (distance <= limit && distance < bestDistance) {
          best = track;
          bestDistance = distance;
        }
      }
      if (!best) {
        best = { id: this.nextId++, box: { ...box }, center, missed: 0, age: 1 };
        this.tracks.push(best);
      } else {
        best.box = blendBox(best.box, box, this.smoothing);
        best.center = centerOf(best.box);
        best.missed = 0;
        best.age += 1;
      }
      matchedIds.add(best.id);
      output.push({ ...detection, boundingBox: { ...best.box }, trackId: best.id, stabilityFrames: best.age });
    }
    for (const track of this.tracks) if (!matchedIds.has(track.id)) track.missed += 1;
    this.tracks = this.tracks.filter((track) => track.missed <= this.maxMissedFrames);
    return output;
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }
}

function centerOf(box) {
  return { x: box.originX + box.width / 2, y: box.originY + box.height / 2 };
}
function blendBox(a, b, alpha) {
  return {
    originX: a.originX + alpha * (b.originX - a.originX),
    originY: a.originY + alpha * (b.originY - a.originY),
    width: a.width + alpha * (b.width - a.width),
    height: a.height + alpha * (b.height - a.height),
  };
}
