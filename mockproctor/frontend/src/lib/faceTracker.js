/**
 * Face Tracker — Phase 4B
 *
 * Tracks faces across frames for temporal consistency.
 * Reduces frame-to-frame noise and false positives.
 */

export class FaceTracker {
  constructor(maxTrackAge = 5) {
    this.activeTracks = [];
    this.maxTrackAge = maxTrackAge; // Max frames a track can live without matching
    this.nextTrackId = 0;
  }

  /**
   * Update tracker with new detections.
   * Returns confirmed tracks (faces seen for 3+ consecutive frames).
   */
  update(detections) {
    // Age existing tracks
    this.activeTracks = this.activeTracks
      .map(track => ({ ...track, age: track.age + 1 }))
      .filter(track => track.age <= this.maxTrackAge);

    // Match new detections to existing tracks
    const matchedDetections = new Set();

    for (const detection of detections) {
      const bestMatch = this.findBestMatchingTrack(detection);

      if (bestMatch) {
        // Add to existing track
        bestMatch.track.detections.push(detection);
        bestMatch.track.age = 0; // Reset age on match
        bestMatch.track.lastSeen = Date.now();
        matchedDetections.add(detection);
      } else {
        // Create new track
        this.activeTracks.push({
          id: `track_${this.nextTrackId++}`,
          detections: [detection],
          age: 0,
          created: Date.now(),
          lastSeen: Date.now(),
        });
      }
    }

    // Return confirmed tracks (3+ detections = consistent face)
    const confirmedTracks = this.activeTracks
      .filter(track => track.detections.length >= 3)
      .map(track => ({
        detection: track.detections[track.detections.length - 1], // Latest detection
        trackId: track.id,
        consistency: Math.min(1.0, track.detections.length / 10), // 0-1 score
      }));

    return confirmedTracks;
  }

  /**
   * Find the best matching track for a detection based on bounding box distance.
   */
  findBestMatchingTrack(detection) {
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const track of this.activeTracks) {
      if (track.detections.length === 0) continue;

      const lastDetection = track.detections[track.detections.length - 1];
      const distance = this.calculateBoxDistance(lastDetection, detection);

      // Track is candidate if distance is reasonable (face didn't jump across screen)
      if (distance < 100 && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = { track, distance };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Euclidean distance between two bounding boxes.
   * Lower distance = better match.
   */
  calculateBoxDistance(box1, box2) {
    const center1 = {
      x: box1.boundingBox.originX + box1.boundingBox.width / 2,
      y: box1.boundingBox.originY + box1.boundingBox.height / 2,
    };
    const center2 = {
      x: box2.boundingBox.originX + box2.boundingBox.width / 2,
      y: box2.boundingBox.originY + box2.boundingBox.height / 2,
    };

    const dx = center1.x - center2.x;
    const dy = center1.y - center2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Reset tracker (e.g., on session end).
   */
  reset() {
    this.activeTracks = [];
    this.nextTrackId = 0;
  }

  /**
   * Get number of active tracks.
   */
  getTrackCount() {
    return this.activeTracks.length;
  }
}
