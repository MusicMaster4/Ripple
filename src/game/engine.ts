import {
  generateObstacles,
  pointInObstacle,
  type Obstacle,
  type WaveSource,
} from "./arena";

import { WaterArena, WaterWave } from "./water";
import { Rain } from "./rain";

export const WIDTH = 1000;
export const HEIGHT = 640;
export const SPEED = 27.1875;
export const LIFETIME = 17000;
/** A wave is harmless until it has existed this long. */
export const ARM_TIME = 2000;
export const HIT_RADIUS = 5.5;
/** Keeps the first wall return beyond ARM_TIME, including the dot's hit radius. */
export const START_MARGIN = 40;
export const MAX_DURATION = 180_000;
export const MIN_CLICK_INTERVAL = 80;
export const RULES_VERSION = 13;
export type Move = { x: number; y: number; t: number };
export type Wave = Move & {
  id: number;
  sources: WaveSource[];
  field?: WaterWave;
};
export type Phase = "idle" | "playing" | "over";
export type Bounds = { width: number; height: number };
export type Arena = Bounds & { seed: number };

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
  const sources: WaveSource[] = [];
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
  readonly seed: number | undefined;
  readonly obstacles: Obstacle[];
  player: { x: number; y: number };
  moves: Move[] = [];
  waves: Wave[] = [];
  private water?: WaterArena;
  private waveId = 0;
  readonly rain?: Rain;
  endReason: "wave" | "time" | "interrupted" = "wave";

  constructor(width = WIDTH, height = HEIGHT, seed?: number) {
    validateBounds({ width, height });
    this.width = width;
    this.height = height;
    this.seed = seed;
    // Seedless arenas retain the classic geometry-only simulation. Browser
    // rounds always supply a seed, shared with the server for exact rain replay.
    this.rain = seed === undefined ? undefined : new Rain(seed);
    this.obstacles =
      seed === undefined ? [] : generateObstacles(width, height, seed);
    this.player = { x: width / 2, y: height / 2 };
  }
  get clicks() {
    return this.moves.length;
  }
  get score() {
    return Math.round(this.time) / 1000;
  }

  get moveMargin() {
    return this.phase === "idle" ? START_MARGIN : 6;
  }

  canMoveTo(x: number, y: number) {
    const margin = this.moveMargin;
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= margin &&
      x <= this.width - margin &&
      y >= margin &&
      y <= this.height - margin &&
      !this.obstacles.some((b) => pointInObstacle(x, y, b, HIT_RADIUS))
    );
  }

  advance(to: number) {
    if (this.phase !== "playing" || !Number.isFinite(to) || to <= this.time)
      return;
    const target = Math.min(to, MAX_DURATION);
    // Split at rolls and impacts so newly born waves participate in collisions
    // for the rest of this interval, including a server replay's large jumps.
    while (this.time < target && this.phase === "playing") {
      const next = Math.min(target, this.rain?.nextEventAt ?? Infinity);
      this.advanceWaves(next);
      if (this.phase !== "playing") break;
      for (const drop of this.rain?.advance(
        this.time,
        this.width,
        this.height,
        this.obstacles,
      ) ?? []) {
        this.createWave({ x: drop.x, y: drop.y, t: drop.impactAt });
      }
    }
  }

  private advanceWaves(target: number) {
    let death = Infinity;
    for (const wave of this.waves) {
      if (wave.field) {
        // Once an earlier death is known, later contacts cannot change it.
        // Avoid simulating every remaining wave past that immutable result.
        const contact = wave.field.firstContact(
          this.player,
          this.time - wave.t,
          Math.min(target, death, wave.t + LIFETIME - 1e-7) - wave.t,
          ARM_TIME,
          HIT_RADIUS,
        );
        death = Math.min(death, wave.t + contact);
        continue;
      }
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
    if (this.waves.some((w) => this.time - w.t > LIFETIME))
      this.waves = this.waves.filter((w) => this.time - w.t <= LIFETIME);
    for (const wave of this.waves) wave.field?.setAge(this.time - wave.t);
  }

  move(x: number, y: number, t: number) {
    if (!this.canMoveTo(x, y) || !Number.isFinite(t) || t < 0) return false;
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
    for (const wave of this.waves) {
      if (wave.field) {
        const age = t - wave.t;
        if (
          age >= ARM_TIME &&
          age < LIFETIME &&
          Number.isFinite(
            wave.field.firstContact(
              this.player,
              age,
              age,
              ARM_TIME,
              HIT_RADIUS,
            ),
          )
        )
          hit = true;
        continue;
      }
      for (const s of wave.sources) {
        if (t - wave.t >= LIFETIME || t - wave.t < ARM_TIME) continue;
        const r = ((t - wave.t) * SPEED) / 1000;
        if (Math.abs(Math.hypot(x - s.x, y - s.y) - r) <= HIT_RADIUS)
          hit = true;
      }
    }
    const move = { x, y, t };
    this.moves.push(move);
    this.createWave(move);
    this.phase = hit ? "over" : "playing";
    if (hit) this.endReason = "wave";
    return true;
  }

  private createWave(origin: Move) {
    if (this.obstacles.length && !this.water)
      this.water = new WaterArena(
        this.width,
        this.height,
        this.obstacles,
        SPEED,
      );
    this.waves.push({
      ...origin,
      id: ++this.waveId,
      sources: this.water
        ? []
        : imageSources(origin.x, origin.y, this.width, this.height),
      field: this.water ? new WaterWave(this.water, origin) : undefined,
    });
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
  seed?: number,
) {
  if (!moves.length || moves.length > 2251) throw new Error("Invalid replay.");
  const game = new Game(bounds.width, bounds.height, seed);
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
