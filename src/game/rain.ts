import { pointInObstacle, type Obstacle, type Point } from "./arena";

export const RAIN_INTERVAL = 1000;
export const RAIN_INCREASE_INTERVAL = 10_000;
export const RAIN_WARNING = 2000;
export const RAIN_FALL = 550;
export const RAIN_MARGIN = 14;
export type RainDrop = Point & { id: number; t: number; impactAt: number };

/** A separate seeded stream keeps rain independent of map generation and input. */
export class Rain {
  chance = 3;
  pending: RainDrop[] = [];
  impacts: RainDrop[] = [];
  private nextRoll = RAIN_INTERVAL;
  private count = 0;
  private random: () => number;

  constructor(seed: number) {
    let state = seed ^ 0xa53c9e17;
    this.random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let n = Math.imul(state ^ (state >>> 15), 1 | state);
      n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  get nextEventAt() {
    return Math.min(this.nextRoll, this.pending[0]?.impactAt ?? Infinity);
  }

  /** Called at exact simulation event times, even when frames or inputs skip ahead. */
  advance(time: number, width: number, height: number, obstacles: Obstacle[]) {
    const landed: RainDrop[] = [];
    while (this.pending.length && this.pending[0].impactAt <= time) {
      const drop = this.pending.shift()!;
      this.impacts.push(drop);
      landed.push(drop);
    }
    if (time >= this.nextRoll) {
      const t = this.nextRoll;
      this.nextRoll += RAIN_INTERVAL;
      this.chance = Math.min(100, 3 + Math.floor(t / RAIN_INCREASE_INTERVAL));
      if (this.random() < this.chance / 100) {
        // Rejection sampling is uniform over open water; a bounded search also
        // handles custom maps with no available landing spot without hanging.
        for (let attempt = 0; attempt < 256; attempt++) {
          const x = RAIN_MARGIN + this.random() * (width - 2 * RAIN_MARGIN);
          const y = RAIN_MARGIN + this.random() * (height - 2 * RAIN_MARGIN);
          if (obstacles.some((b) => pointInObstacle(x, y, b, 6))) continue;
          this.pending.push({
            x,
            y,
            t,
            id: ++this.count,
            impactAt: t + RAIN_WARNING + RAIN_FALL,
          });
          break;
        }
      }
    }
    return landed;
  }
}
