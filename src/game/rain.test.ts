import { describe, expect, it } from "vitest";
import { generateObstacles, pointInObstacle } from "./arena";
import { Game, MAX_DURATION, replay } from "./engine";
import {
  Rain,
  RAIN_FALL,
  RAIN_INTERVAL,
  RAIN_MARGIN,
  RAIN_WARNING,
} from "./rain";

function tick(
  rain: Rain,
  until: number,
  width = 1000,
  height = 640,
  obstacles = generateObstacles(width, height, 42),
) {
  while (rain.nextEventAt <= until) {
    rain.advance(rain.nextEventAt, width, height, obstacles);
  }
}

// An open map with a first-second drop in range of the center's stationary dot.
const openSeed = Array.from({ length: 1000 }, (_, seed) => seed).find(
  (seed) => {
    if (generateObstacles(1000, 640, seed).length) return false;
    const rain = new Rain(seed);
    tick(rain, 1000, 1000, 640, []);
    const drop = rain.pending[0];
    if (!drop) return false;
    const distance = Math.hypot(drop.x - 500, drop.y - 320);
    return distance > 100 && distance < 350;
  },
)!;

describe("random drop schedule", () => {
  it("starts at 3%, rolls once per second, and leaves chance unchanged by drops", () => {
    const rain = new Rain(openSeed);
    expect(rain.chance).toBe(3);
    tick(rain, RAIN_INTERVAL - 1);
    expect(rain.pending).toHaveLength(0);
    expect(rain.nextEventAt).toBe(RAIN_INTERVAL);
    tick(rain, RAIN_INTERVAL);
    expect(rain.pending).toHaveLength(1);
    expect(rain.chance).toBe(3);
    tick(rain, 9999);
    expect(rain.chance).toBe(3);
    const count = rain.pending.length + rain.impacts.length;
    tick(rain, 9999);
    expect(rain.pending.length + rain.impacts.length).toBe(count);
  });

  it("increases by one percentage point at each ten-second boundary even without drops", () => {
    const rain = new Rain(42);
    const blocked = [{ x: 0, y: 0, width: 1000, height: 640 }];
    tick(rain, 9999, 1000, 640, blocked);
    expect(rain.chance).toBe(3);
    tick(rain, 10_000, 1000, 640, blocked);
    expect(rain.chance).toBe(4);
    tick(rain, 19_999, 1000, 640, blocked);
    expect(rain.chance).toBe(4);
    tick(rain, 20_000, 1000, 640, blocked);
    expect(rain.chance).toBe(5);
    tick(rain, MAX_DURATION, 1000, 640, blocked);
    expect(rain.chance).toBe(21);
    expect(rain.pending).toEqual([]);
    expect(rain.impacts).toEqual([]);
  });

  it("waits two seconds, then finishes the fall before recording an impact", () => {
    const rain = new Rain(openSeed);
    tick(rain, 1000);
    const drop = { ...rain.pending[0] };
    expect(drop.impactAt).toBe(drop.t + RAIN_WARNING + RAIN_FALL);
    tick(rain, drop.t + RAIN_WARNING);
    expect(rain.impacts).toHaveLength(0);
    tick(rain, drop.impactAt - 0.001);
    expect(rain.pending).toContainEqual(drop);
    tick(rain, drop.impactAt);
    expect(rain.impacts).toContainEqual(drop);
    expect(rain.pending).not.toContainEqual(drop);
  });

  it("allows overlapping warnings and caps the probability at 100%", () => {
    const rain = new Rain(42);
    tick(rain, 970_000);
    expect(rain.chance).toBe(100);
    expect(rain.impacts.length).toBeGreaterThanOrEqual(6);
    tick(rain, 980_000);
    expect(rain.chance).toBe(100);
    expect(rain.pending).toHaveLength(3);
    expect(
      new Set([...rain.impacts, ...rain.pending].map((d) => d.id)).size,
    ).toBe(rain.impacts.length + rain.pending.length);
  });

  it.each([
    [1000, 640],
    [100, 1000],
    [1000, 100],
    [462, 1000],
  ])("chooses only open landing points in %s by %s maps", (width, height) => {
    for (let seed = 0; seed < 30; seed++) {
      const rain = new Rain(seed);
      const obstacles = generateObstacles(width, height, seed);
      tick(rain, MAX_DURATION, width, height, obstacles);
      for (const drop of [...rain.pending, ...rain.impacts]) {
        expect(drop.x).toBeGreaterThanOrEqual(RAIN_MARGIN);
        expect(drop.x).toBeLessThanOrEqual(width - RAIN_MARGIN);
        expect(drop.y).toBeGreaterThanOrEqual(RAIN_MARGIN);
        expect(drop.y).toBeLessThanOrEqual(height - RAIN_MARGIN);
        expect(
          obstacles.some((b) => pointInObstacle(drop.x, drop.y, b, 6)),
        ).toBe(false);
      }
    }
  });

  it("skips completely blocked custom maps without hanging or raising the chance", () => {
    const rain = new Rain(openSeed);
    tick(rain, 1000, 1000, 640, [{ x: 0, y: 0, width: 1000, height: 640 }]);
    expect(rain.pending).toHaveLength(0);
    expect(rain.chance).toBe(3);
  });

  it("restarts the schedule and probability for a new round with the same seed", () => {
    const first = new Rain(42);
    tick(first, MAX_DURATION);
    const second = new Rain(42);
    expect(second.chance).toBe(3);
    expect(second.pending).toEqual([]);
    expect(second.impacts).toEqual([]);
    tick(second, MAX_DURATION);
    expect(second.impacts).toEqual(first.impacts);
    expect(second.pending).toEqual(first.pending);
    expect(second.chance).toEqual(first.chance);
  });
});

describe("rain in the shared game simulation", () => {
  it("creates a normal wave only on impact, without moving the player or counting a click", () => {
    const game = new Game(1000, 640, openSeed);
    game.advance(5000);
    expect(game.rain?.pending).toEqual([]);
    game.move(500, 320, 0);
    game.advance(1000);
    const drop = game.rain!.pending[0];
    game.advance(drop.impactAt - 0.001);
    expect(game.waves).toHaveLength(1);
    game.advance(drop.impactAt);
    expect(game.waves).toHaveLength(2);
    expect(game.waves[1]).toMatchObject({
      x: drop.x,
      y: drop.y,
      t: drop.impactAt,
    });
    expect(game.player).toEqual({ x: 500, y: 320 });
    expect(game.moves).toEqual([{ x: 500, y: 320, t: 0 }]);
    expect(game.clicks).toBe(1);
    expect(new Set(game.waves.map((w) => w.id)).size).toBe(2);
  });

  it("replays rain collisions exactly regardless of frame timing", () => {
    const game = new Game(1000, 640, openSeed);
    game.move(500, 320, 0);
    for (let t = 137; t < MAX_DURATION && game.phase === "playing"; t += 137) {
      game.advance(t);
    }
    expect(game.endReason).toBe("wave");
    expect(game.rain!.impacts.length).toBeGreaterThan(0);
    const result = replay(game.moves, { width: 1000, height: 640 }, openSeed);
    expect(result.time).toBe(game.time);
    expect(result.score).toBe(game.score);
    expect(result.rain!.impacts).toEqual(game.rain!.impacts);
    expect(result.rain!.chance).toBe(game.rain!.chance);
  });

  it("uses the obstacle-aware water simulation for impacts on blocked maps", () => {
    const game = new Game(1000, 640, 42);
    game.move(500, 320, 0);
    game.waves = [];
    const drop = (() => {
      for (let t = 1000; t <= MAX_DURATION; t += 1000) {
        game.advance(t);
        if (game.rain!.pending.length) return game.rain!.pending[0];
      }
      throw new Error("Expected a drop");
    })();
    game.advance(drop.impactAt);
    expect(game.waves[0].field).toBeDefined();
    expect(game.waves[0].field!.origin).toMatchObject({ x: drop.x, y: drop.y });
  });

  it("stops pending drops when the round is interrupted", () => {
    const game = new Game(1000, 640, openSeed);
    game.move(500, 320, 0);
    game.advance(1000);
    expect(game.rain!.pending.length).toBeGreaterThan(0);
    game.interrupt();
    game.advance(MAX_DURATION);
    expect(game.time).toBe(1000);
    expect(game.rain!.impacts).toEqual([]);
    expect(game.waves).toHaveLength(1);
  });
});
