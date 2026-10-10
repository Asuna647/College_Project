/**
 * Event debouncer and deduplicator for Phase 4.
 * Prevents duplicate events from firing too frequently.
 *
 * Strategy:
 * - Same event type won't fire within deduplicationWindow (default 5s)
 * - Preserves order and timestamps
 * - Thread-safe for single event stream
 */

export class EventDebouncer {
  constructor(deduplicationWindowMs = 5000) {
    this.lastEventsByType = {};
    this.deduplicationWindow = deduplicationWindowMs;
  }

  /**
   * Check if an event should be emitted based on deduplication rules.
   * @param {string} eventType - Type of event (e.g., "no_face", "looking_away")
   * @returns {boolean} true if event should be emitted, false if deduplicated
   */
  shouldEmit(eventType) {
    const now = Date.now();
    const lastEmitTime = this.lastEventsByType[eventType] || 0;
    const timeSinceLastEvent = now - lastEmitTime;

    if (timeSinceLastEvent >= this.deduplicationWindow) {
      this.lastEventsByType[eventType] = now;
      console.log(`[DEBOUNCER] Emitting ${eventType}`);
      return true;
    }
    console.log(
      `[DEBOUNCER] Suppressing ${eventType} (${timeSinceLastEvent}ms since last emit)`
    );
    return false;
  }

  /**
   * Reset debouncer state (e.g., on session end).
   */
  reset() {
    this.lastEventsByType = {};
  }

  /**
   * Get time until next emission of an event type is allowed.
   * @param {string} eventType
   * @returns {number} milliseconds, 0 if can emit now
   */
  getTimeUntilNextEmit(eventType) {
    const now = Date.now();
    const lastEmitTime = this.lastEventsByType[eventType] || 0;
    const timeSinceLastEvent = now - lastEmitTime;
    const timeRemaining = this.deduplicationWindow - timeSinceLastEvent;
    return Math.max(0, timeRemaining);
  }
}
