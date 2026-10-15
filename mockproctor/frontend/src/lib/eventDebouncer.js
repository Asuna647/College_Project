/** Per-type event cooldown, so one signal type does not suppress another. */
export class EventDebouncer {
  constructor(cooldownMs = 5000) {
    this.cooldownMs = cooldownMs;
    this.lastEmitted = new Map();
  }
  shouldEmit(type, now = Date.now()) {
    const last = this.lastEmitted.get(type);
    if (last !== undefined && now - last < this.cooldownMs) return false;
    this.lastEmitted.set(type, now);
    return true;
  }
  reset(type) {
    if (type) this.lastEmitted.delete(type);
    else this.lastEmitted.clear();
  }
}
