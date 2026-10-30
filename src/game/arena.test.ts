import { describe, expect, it } from "vitest";
import {
  generateObstacles,
  obstacleArea,
  pointInObstacle,
  validateSeed,
} from "./arena";
import {
  ARM_TIME,
  Game,
  HIT_RADIUS,
  LIFETIME,
  MAX_DURATION,
  START_MARGIN,
  SPEED,
  replay,
} from "./engine";

const block = { x: 400, y: 200, width: 100, height: 240 };

describe("random arenas", () => {
  it("recreates layouts from the seed and includes open and obstructed rounds", () => {
    const layouts = Array.from({ length: 100 }, (_, seed) =>
      generateObstacles(1000, 640, seed),
    );
    expect(layouts.some((b) => b.length === 0)).toBe(true);
    expect(layouts.some((b) => b.length >= 2)).toBe(true);
    expect(new Set(layouts.map((b) => JSON.stringify(b))).size).toBeGreaterThan(
      70,
    );
    expect(generateObstacles(1000, 640, 42)).toEqual(
      generateObstacles(1000, 640, 42),
    );
  });

  it.each([
    [1000, 640],
    [462, 1000],
    [1000, 100],
    [100, 1000],
    [1000, 1000],
  ])(
    "keeps blocks separate, inside %s × %s, with an open center and at least 84 percent free space",
    (width, height) => {
      for (let seed = 0; seed < 100; seed++) {
        const blocks = generateObstacles(width, height, seed);
        expect(
          blocks.reduce((sum, b) => sum + obstacleArea(b), 0),
        ).toBeLessThanOrEqual(width * height * 0.16);
        for (const [index, b] of blocks.entries()) {
          expect(b.x).toBeGreaterThanOrEqual(24 - 1e-8);
          expect(b.y).toBeGreaterThanOrEqual(24 - 1e-8);
          expect(b.x + b.width).toBeLessThanOrEqual(width - 24 + 1e-8);
          expect(b.y + b.height).toBeLessThanOrEqual(height - 24 + 1e-8);
          expect(pointInObstacle(width / 2, height / 2, b, 28)).toBe(false);
          for (const other of blocks.slice(index + 1)) {
            expect(
              b.x + b.width + 24 <= other.x ||
                other.x + other.width + 24 <= b.x ||
                b.y + b.height + 24 <= other.y ||
                other.y + other.height + 24 <= b.y,
            ).toBe(true);
          }
        }
      }
    },
  );

  it.each([-1, 0x100000000, 0.5, NaN, Infinity])(
    "rejects invalid seed %s",
    (seed) => {
      expect(() => validateSeed(seed)).toThrow(RangeError);
      expect(() => new Game(1000, 640, seed)).toThrow(RangeError);
    },
  );

  it("rejects clicks inside and touching blocks without starting the round or adding waves", () => {
    const game = new Game();
    game.obstacles.push(block);
    expect(game.move(450, 320, 0)).toBe(false);
    expect(game.move(400 - HIT_RADIUS, 320, 0)).toBe(false);
    expect(game.phase).toBe("idle");
    expect(game.waves).toHaveLength(0);
    expect(game.move(300, 320, 0)).toBe(true);
    expect(game.move(450, 320, 100)).toBe(false);
    expect(game.player).toEqual({ x: 300, y: 320 });
    expect(game.clicks).toBe(1);
    expect(game.time).toBe(0);
  });
});

describe("arbitrary blocked contours", () => {
  it("checks the actual circular boundary, including the player radius", () => {
    const circle = {
      x: 400,
      y: 200,
      width: 100,
      height: 100,
      shape: "circle" as const,
    };
    expect(pointInObstacle(401, 201, circle)).toBe(false);
    expect(pointInObstacle(450, 250, circle)).toBe(true);
    expect(pointInObstacle(450, 196, circle, HIT_RADIUS)).toBe(true);
    expect(pointInObstacle(450, 194, circle, HIT_RADIUS)).toBe(false);
  });

  it("checks triangle and concave outlines instead of their bounding rectangle", () => {
    const triangle = {
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      vertices: [
        { x: 200, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
      ],
    };
    expect(pointInObstacle(110, 110, triangle)).toBe(false);
    expect(pointInObstacle(200, 240, triangle)).toBe(true);
    const concave = {
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      vertices: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 180 },
        { x: 180, y: 180 },
        { x: 180, y: 300 },
        { x: 100, y: 300 },
      ],
    };
    expect(pointInObstacle(250, 250, concave)).toBe(false);
    expect(pointInObstacle(140, 250, concave)).toBe(true);
  });

  it("generates circles, triangles, pentagons, rectangles, and irregular contours in varied sizes", () => {
    const blocks = Array.from({ length: 100 }, (_, seed) =>
      generateObstacles(1000, 640, seed),
    ).flat();
    expect(blocks.some((b) => b.shape === "circle")).toBe(true);
    expect(blocks.some((b) => b.vertices?.length === 3)).toBe(true);
    expect(blocks.some((b) => b.vertices?.length === 5)).toBe(true);
    expect(blocks.some((b) => (b.vertices?.length ?? 0) >= 7)).toBe(true);
    expect(blocks.some((b) => b.vertices?.length === 4)).toBe(true);
    expect(blocks.some((b) => b.vertices?.length === 42)).toBe(true);
    expect(blocks.some((b) => Math.max(b.width, b.height) > 300)).toBe(true);
    expect(
      blocks.some((b) => Math.max(b.width / b.height, b.height / b.width) > 6),
    ).toBe(true);
    expect(new Set(blocks.map((b) => b.width)).size).toBeGreaterThan(40);
  });

  it.each([
    [1000, 640],
    [462, 1000],
    [1000, 100],
    [100, 1000],
  ])(
    "rejects destinations inside seeded contours when replaying %s ? %s",
    (width, height) => {
      const game = new Game(width, height, 42);
      const b = game.obstacles[0];
      const x = b.vertices ? b.vertices[0].x : b.x + b.width / 2;
      const y = b.vertices ? b.vertices[0].y : b.y + b.height / 2;
      expect(() => replay([{ x, y, t: 0 }], { width, height }, 42)).toThrow();
    },
  );
});
