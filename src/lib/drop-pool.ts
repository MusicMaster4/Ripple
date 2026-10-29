/**
 * Uniformly samples drop variations while withholding the most recent half.
 * The game supplies 24 sounds, so 12 other sounds must play before a repeat.
 */
export class DropPool {
  readonly size: number;
  readonly cooldown: number;
  private readonly random: () => number;
  private readonly recent: number[] = [];

  constructor(size = 64, random: () => number = Math.random) {
    if (!Number.isSafeInteger(size) || size < 2) {
      throw new RangeError("Drop pool size must be an integer of at least 2.");
    }
    this.size = size;
    this.cooldown = Math.floor(size / 2);
    this.random = random;
  }

  /** Returns a zero-based sound index, excluding the last `cooldown` picks. */
  next(): number {
    const excluded = new Set(this.recent);
    const available: number[] = [];
    for (let index = 0; index < this.size; index++) {
      if (!excluded.has(index)) available.push(index);
    }
    const roll = this.random();
    if (!Number.isFinite(roll))
      throw new RangeError("Random source must return a finite number.");
    // Clamping also handles injected sources that return the inclusive bound 1.
    const slot = Math.max(
      0,
      Math.min(available.length - 1, Math.floor(roll * available.length)),
    );
    const index = available[slot];
    this.recent.push(index);
    if (this.recent.length > this.cooldown) this.recent.shift();
    return index;
  }
}
