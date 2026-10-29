export const WIDTH = 1000;
export const HEIGHT = 640;
export const SPEED = 36.25;
export const LIFETIME = 34000;
/** A wave is harmless until it has existed this long. */
export const ARM_TIME = 2000;
export const HIT_RADIUS = 5.5;
export const MAX_DURATION = 180_000;
export const MIN_CLICK_INTERVAL = 80;
export const RULES_VERSION = 3;
export type Move = { x: number; y: number; t: number };
export type Wave = Move & { id: number; sources: { x: number; y: number }[] };
export type Phase = "idle" | "playing" | "over";
export type Bounds = { width: number; height: number };

/** Bounds are normalized to a 1000-unit longest viewport edge. */
export function validateBounds({ width, height }: Bounds): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 100 ||
    height < 100 ||
    width > 1000 ||
    height > 1000 ||
    Math.max(width, height) !== 1000
  ) {
    throw new RangeError(
      "Game dimensions must be integers from 100 to 1000, with a longest edge of 1000.",
    );
  }
}
const MAX_RADIUS = (SPEED * LIFETIME) / 1000;

/** Image sources produce exact specular reflections off all four walls. */
export function imageSources(
  x: number,
  y: number,
  width = WIDTH,
  height = HEIGHT,
) {
  validateBounds({ width, height });
  const sources: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  // Each mirrored family repeats every two arena lengths. Derive tile limits
  // from wave reach so narrow screens retain every repeated-wall reflection.
  for (const sx of [1, -1])
    for (const sy of [1, -1]) {
      const minX = Math.ceil((-MAX_RADIUS - sx * x) / (2 * width));
      const maxX = Math.floor((width + MAX_RADIUS - sx * x) / (2 * width));
      const minY = Math.ceil((-MAX_RADIUS - sy * y) / (2 * height));
      const maxY = Math.floor((height + MAX_RADIUS - sy * y) / (2 * height));
      for (let i = minX; i <= maxX; i++)
        for (let j = minY; j <= maxY; j++) {
          const px = 2 * i * width + sx * x;
          const py = 2 * j * height + sy * y;
          const dx = Math.max(0, -px, px - width);
          const dy = Math.max(0, -py, py - height);
          const key = `${px},${py}`;
          if (Math.hypot(dx, dy) <= MAX_RADIUS && !seen.has(key)) {
            seen.add(key);
            sources.push({ x: px, y: py });
          }
        }
    }
  return sources;
}

export class Game {
  phase: Phase = "idle";
  time = 0;
  readonly width: number;
  readonly height: number;
  player: { x: number; y: number };
  moves: Move[] = [];
  waves: Wave[] = [];
  endReason: "wave" | "time" | "interrupted" = "wave";

  constructor(width = WIDTH, height = HEIGHT) {
    validateBounds({ width, height });
    this.width = width;
    this.height = height;
    this.player = { x: width / 2, y: height / 2 };
  }
  get clicks() {
    return this.moves.length;
  }
  get score() {
    return (this.clicks * Math.round(this.time)) / 1000;
  }

  advance(to: number) {
    if (this.phase !== "playing" || !Number.isFinite(to) || to <= this.time)
      return;
    const target = Math.min(to, MAX_DURATION);
    let death = Infinity;
    for (const wave of this.waves) {
      for (const source of wave.sources) {
        const distance = Math.hypot(
          this.player.x - source.x,
          this.player.y - source.y,
        );
        // The outgoing wave must clear its birthplace before it can hit the dot.
        const ownOrigin =
          source.x === wave.x &&
          source.y === wave.y &&
          distance < HIT_RADIUS + 0.1;
        if (ownOrigin) continue;
        // Contact only counts once the wave has armed.
        const enter = Math.max(
          wave.t + ARM_TIME,
          wave.t + (Math.max(0, distance - HIT_RADIUS) / SPEED) * 1000,
        );
        const leave = wave.t + ((distance + HIT_RADIUS) / SPEED) * 1000;
        if (
          leave >= enter &&
          leave >= this.time &&
          enter <= target &&
          enter < wave.t + LIFETIME &&
          this.time < wave.t + LIFETIME
        ) {
          death = Math.min(death, Math.max(this.time, enter));
        }
      }
    }
    if (Number.isFinite(death)) {
      this.time = death;
      this.phase = "over";
      this.endReason = "wave";
    } else {
      this.time = target;
      if (target >= MAX_DURATION) {
        this.phase = "over";
        this.endReason = "time";
      }
    }
    this.waves = this.waves.filter((w) => this.time - w.t <= LIFETIME);
  }

  move(x: number, y: number, t: number) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(t) ||
      x < 6 ||
      x > this.width - 6 ||
      y < 6 ||
      y > this.height - 6 ||
      t < 0
    )
      return false;
    if (this.phase === "over" || t < this.time) return false;
    const first = this.phase === "idle";
    if (first && t !== 0) return false;
    if (!first && t - this.moves[this.moves.length - 1].t < MIN_CLICK_INTERVAL)
      return false;
    if (!first) this.advance(t);
    if ((this.phase as Phase) === "over") return false;
    this.player = { x, y };
    this.time = t;
    // Every accepted click counts, including a move onto a wave. Keeping the
    // terminal click in the replay lets the server reproduce the exact result.
    let hit = false;
    for (const wave of this.waves)
      for (const s of wave.sources) {
        if (t - wave.t >= LIFETIME || t - wave.t < ARM_TIME) continue;
        const r = ((t - wave.t) * SPEED) / 1000;
        if (Math.abs(Math.hypot(x - s.x, y - s.y) - r) <= HIT_RADIUS)
          hit = true;
      }
    const move = { x, y, t };
    this.moves.push(move);
    this.waves.push({
      ...move,
      id: this.moves.length,
      sources: imageSources(x, y, this.width, this.height),
    });
    this.phase = hit ? "over" : "playing";
    if (hit) this.endReason = "wave";
    return true;
  }

  interrupt() {
    if (this.phase === "playing") {
      this.phase = "over";
      this.endReason = "interrupted";
    }
  }
}

export function replay(
  moves: Move[],
  bounds: Bounds = { width: WIDTH, height: HEIGHT },
) {
  if (!moves.length || moves.length > 2251) throw new Error("Invalid replay.");
  const game = new Game(bounds.width, bounds.height);
  for (const [index, m] of moves.entries()) {
    if (
      !game.move(m.x, m.y, m.t) ||
      (game.phase === "over" && index !== moves.length - 1)
    ) {
      throw new Error("Invalid move or a wave was hit.");
    }
  }
  game.advance(MAX_DURATION);
  return game;
}
