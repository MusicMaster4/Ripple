import { describe, expect, it } from "vitest";
import {
  ARM_TIME,
  Game,
  HEIGHT,
  HIT_RADIUS,
  LIFETIME,
  MAX_DURATION,
  MIN_CLICK_INTERVAL,
  START_MARGIN,
  SPEED,
  WIDTH,
  imageSources,
  replay,
  validateBounds,
  RULES_VERSION,
} from "./engine";

const deathAt = (distance: number, born = 0) =>
  born + ((distance - HIT_RADIUS) / SPEED) * 1000;

describe("circular wave reflections", () => {
  it("includes reachable wall and corner image sources without duplicates", () => {
    const sources = imageSources(100, 200);
    expect(sources).toContainEqual({ x: 100, y: 200 });
    expect(sources).toContainEqual({ x: -100, y: 200 });
    expect(sources).not.toContainEqual({ x: WIDTH * 2 - 100, y: 200 });
    expect(sources).toContainEqual({ x: 100, y: -200 });
    expect(sources).toContainEqual({ x: 100, y: HEIGHT * 2 - 200 });
    expect(sources).toContainEqual({ x: -100, y: -200 });
    expect(sources).not.toContainEqual({ x: 100, y: HEIGHT * 2 + 200 });
    expect(new Set(sources.map((s) => `${s.x},${s.y}`)).size).toBe(
      sources.length,
    );
  });

  it.each([
    [100, 300, 200],
    [WIDTH - 100, 300, 200],
    [500, 100, 200],
    [500, HEIGHT - 100, 200],
    [500, HEIGHT / 2, HEIGHT],
  ])(
    "returns from the nearest wall for a dot at (%s, %s)",
    (x, y, distance) => {
      const game = new Game();
      expect(game.move(x, y, 0)).toBe(true);
      game.advance(deathAt(distance) - 0.01);
      expect(game.phase).toBe("playing");
      game.advance(deathAt(distance) + 0.01);
      if (deathAt(distance) < LIFETIME) {
        expect(game.phase).toBe("over");
        expect(game.time).toBeCloseTo(deathAt(distance), 8);
      } else {
        expect(game.phase).toBe("playing");
        expect(game.waves).toHaveLength(0);
      }
    },
  );

  it("does not kill the dot with its own outgoing newborn wave", () => {
    const game = new Game();
    game.move(WIDTH / 2, HEIGHT / 2, 0);
    game.advance(1000);
    expect(game.phase).toBe("playing");
  });

  it("detects a wave that entirely crosses the dot between animation frames", () => {
    const game = new Game();
    game.move(100, 300, 0);
    game.advance(30_000);
    expect(game.phase).toBe("over");
    expect(game.time).toBeCloseTo(deathAt(200), 8);
  });

  it("detects outgoing waves at a moved destination", () => {
    const game = new Game();
    game.move(200, 320, 0);
    game.move(600, 320, 100);
    game.advance(30_000);
    expect(game.phase).toBe("over");
    expect(game.time).toBeCloseTo(deathAt(400), 8);
  });

  it("does not collide with an expired wave", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.waves[0].t = -LIFETIME - 1;
    game.waves[0].sources = [{ x: 500, y: 320 }];
    game.advance(1000);
    expect(game.phase).toBe("playing");
    expect(game.waves).toHaveLength(0);
  });

  it("does not collide at the exact instant a wave becomes fully invisible", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.waves[0].sources = [
      { x: 500 + (SPEED * LIFETIME) / 1000 + HIT_RADIUS, y: 320 },
    ];
    game.advance(LIFETIME + 10);
    expect(game.phase).toBe("playing");
  });
});

describe("arming delay", () => {
  it.each([ARM_TIME - 1, ARM_TIME, ARM_TIME + 1])(
    "checks a teleport at age %s",
    (age) => {
      const game = new Game();
      game.move(200, 320, 0);
      game.move(200 + (SPEED * age) / 1000, 320, age);
      expect(game.phase).toBe(age < ARM_TIME ? "playing" : "over");
    },
  );

  it("lets a young wave pass through the dot harmlessly", () => {
    const game = new Game();
    game.move(500, 320, 0);
    // A second click lands inside the first wave's path before it arms.
    game.move(500 + SPEED * 0.5, 320, 500);
    game.advance(ARM_TIME - 1);
    expect(game.phase).toBe("playing");
    // The first wave has already passed; the new one is still harmless.
    game.advance(ARM_TIME + 400);
    expect(game.phase).toBe("playing");
  });

  it("allows a move directly onto an unarmed wave", () => {
    const game = new Game();
    game.move(200, 320, 0);
    expect(game.move(200 + SPEED, 320, 1000)).toBe(true);
    expect(game.phase).toBe("playing");
  });

  it("kills the instant a wave arms on top of the dot", () => {
    const game = new Game();
    game.move(200, 320, 0);
    game.move(200 + (SPEED * ARM_TIME) / 1000 - 1, 320, 1500);
    game.advance(ARM_TIME + 100);
    expect(game.phase).toBe("over");
    expect(game.time).toBe(ARM_TIME);
  });

  it("replays deaths at the arming instant exactly", () => {
    const game = new Game();
    game.move(200, 320, 0);
    game.move(200 + (SPEED * ARM_TIME) / 1000, 320, 1500);
    game.advance(30_000);
    expect(replay(game.moves).time).toBe(game.time);
  });
});

describe("moves and scoring", () => {
  it.each([
    [Number.NaN, 100, 0],
    [100, Infinity, 0],
    [100, 100, Number.NaN],
    [5, 20, 0],
    [WIDTH - 5, 20, 0],
    [20, 5, 0],
    [20, HEIGHT - 5, 0],
    [100, 100, -1],
    [100, 100, 1],
  ])("rejects invalid first input (%s, %s, %s)", (x, y, t) => {
    const game = new Game();
    expect(game.move(x, y, t)).toBe(false);
    expect(game.phase).toBe("idle");
    expect(game.clicks).toBe(0);
  });

  it("rejects rapid clicks without moving or incrementing the score", () => {
    const game = new Game();
    game.move(100, 200, 0);
    expect(game.move(500, 200, MIN_CLICK_INTERVAL - 1)).toBe(false);
    expect(game.player).toEqual({ x: 100, y: 200 });
    expect(game.clicks).toBe(1);
    expect(game.move(500, 200, MIN_CLICK_INTERVAL)).toBe(true);
    expect(game.clicks).toBe(2);
  });

  it("rejects time travel after a frame has advanced the game", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.advance(200);
    expect(game.move(700, 320, 100)).toBe(false);
    expect(game.time).toBe(200);
  });

  it("ignores invalid clock values", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.advance(Number.NaN);
    game.advance(Infinity);
    expect(game.time).toBe(0);
    expect(game.phase).toBe("playing");
  });

  it("counts a fatal teleport and records it for exact replay", () => {
    const game = new Game();
    game.move(200, 320, 0);
    expect(game.move(200 + SPEED * 3, 320, 3000)).toBe(true);
    expect(game.phase).toBe("over");
    expect(game.clicks).toBe(2);
    expect(game.time).toBe(3000);
    expect(game.score).toBe(3);
    expect(game.moves).toHaveLength(2);
    expect(replay(game.moves).score).toBe(game.score);
    expect(replay(game.moves).time).toBe(game.time);
  });

  it("never accepts a move after the dot has been hit between clicks", () => {
    const game = new Game();
    game.move(100, 300, 0);
    expect(game.move(500, 300, deathAt(200) + 1)).toBe(false);
    expect(game.phase).toBe("over");
    expect(game.clicks).toBe(1);
    expect(game.time).toBeCloseTo(deathAt(200), 8);
  });

  it("calculates score from the same millisecond precision shown in the UI", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.move(700, 320, 100);
    game.advance(123.4567);
    expect(game.score).toBe(Math.round(game.time) / 1000);
    expect(game.score).toBe(0.123);
  });

  it("ends a wave-free run at the three-minute limit", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.waves = [];
    game.advance(MAX_DURATION + 1000);
    expect(game.phase).toBe("over");
    expect(game.endReason).toBe("time");
    expect(game.time).toBe(MAX_DURATION);
  });

  it("ends an interrupted run at the latest actual simulation time", () => {
    const game = new Game();
    game.move(500, 320, 0);
    game.advance(1000);
    game.interrupt();
    game.advance(5000);
    expect(game.phase).toBe("over");
    expect(game.endReason).toBe("interrupted");
    expect(game.time).toBe(1000);
  });
});

describe("server replay validation", () => {
  it("reproduces natural death independently of frame timing", () => {
    const game = new Game();
    game.move(200, 320, 0);
    game.move(600, 320, 100);
    game.advance(500);
    game.advance(1000);
    game.advance(30_000);
    const result = replay(game.moves);
    expect(result.time).toBe(game.time);
    expect(result.score).toBe(game.score);
    expect(result.clicks).toBe(game.clicks);
  });

  it("rejects empty and oversized replays", () => {
    expect(() => replay([])).toThrow();
    expect(() =>
      replay(
        Array.from({ length: 2252 }, (_, i) => ({ x: 500, y: 320, t: i * 80 })),
      ),
    ).toThrow();
  });

  it("rejects unordered, non-finite, and out-of-bounds replay moves", () => {
    const first = { x: 500, y: 320, t: 0 };
    for (const last of [
      { x: 700, y: 320, t: -100 },
      { x: 700, y: 320, t: Infinity },
      { x: 1001, y: 320, t: 100 },
    ]) {
      expect(() => replay([first, last])).toThrow();
    }
  });

  it("rejects any move after a terminal teleport", () => {
    expect(() =>
      replay([
        { x: 200, y: 320, t: 0 },
        { x: 200 + SPEED * 3, y: 320, t: 3000 },
        { x: 800, y: 320, t: 3100 },
      ]),
    ).toThrow();
  });

  it("rejects a move after an earlier reflected-wave collision", () => {
    expect(() =>
      replay([
        { x: 100, y: 300, t: 0 },
        { x: 800, y: 320, t: deathAt(200) + 1 },
      ]),
    ).toThrow();
  });
});

describe("fullscreen viewport bounds and slower waves", () => {
  it("reduces wave speed by 25 percent and keeps the 17-second lifetime", () => {
    expect(SPEED).toBe(36.25 * 0.75);
    expect(LIFETIME).toBe(34000 / 2);
    expect((SPEED * LIFETIME) / 1000).toBe((145 * 8500 * 0.75) / 2000);
    expect(RULES_VERSION).toBe(13);
  });

  it.each([
    [1000, 463],
    [462, 1000],
    [1000, 1000],
    [100, 1000],
    [1000, 100],
  ])("centers the initial player in %s by %s bounds", (width, height) => {
    const game = new Game(width, height);
    expect(game.width).toBe(width);
    expect(game.height).toBe(height);
    expect(game.player).toEqual({ x: width / 2, y: height / 2 });
  });

  it.each([
    [0, 1000],
    [99, 1000],
    [1001, 1000],
    [1000, 99],
    [1000, 1001],
    [1000, 463.5],
    [1000, Infinity],
    [NaN, 1000],
    [500, 500],
    [999, 640],
  ])("rejects malformed or unnormalized %s by %s bounds", (width, height) => {
    expect(() => validateBounds({ width, height })).toThrow(RangeError);
    expect(() => new Game(width, height)).toThrow(RangeError);
    expect(() => imageSources(50, 50, width, height)).toThrow(RangeError);
    expect(() => replay([{ x: 50, y: 50, t: 0 }], { width, height })).toThrow(
      RangeError,
    );
  });

  it("rejects moves beyond runtime viewport boundaries", () => {
    const game = new Game(462, 1000);
    expect(game.move(500, 320, 0)).toBe(false);
    expect(game.move(400, 800, 0)).toBe(true);
    expect(game.move(400, 995, 100)).toBe(false);
  });

  it.each([
    [1000, 463],
    [462, 1000],
    [1000, 1000],
    [100, 1000],
    [1000, 100],
  ])(
    "expires waves or detects their return in %s by %s bounds",
    (width, height) => {
      const game = new Game(width, height);
      game.move(width / 2, height / 2, 0);
      game.advance(MAX_DURATION);
      expect(game.phase).toBe("over");
      const death = deathAt(Math.min(width, height));
      expect(game.endReason).toBe(death < LIFETIME ? "wave" : "time");
      expect(game.time).toBeCloseTo(death < LIFETIME ? death : MAX_DURATION, 8);
    },
  );

  it("includes reachable repeated reflections on a narrow viewport", () => {
    const sources = imageSources(50, 500, 100, 1000);
    expect(sources).toContainEqual({ x: 550, y: 500 });
    expect(sources).toContainEqual({ x: -450, y: 500 });
    expect(sources).not.toContainEqual({ x: 1250, y: 500 });
    expect(sources).not.toContainEqual({ x: 50, y: -500 });
    expect(new Set(sources.map((s) => `${s.x},${s.y}`)).size).toBe(
      sources.length,
    );
  });

  it("preserves radial distance across a portrait corner reflection", () => {
    const width = 462,
      height = 1000;
    const sources = imageSources(100, 200, width, height);
    const corner = sources.find((s) => s.x === -100 && s.y === -200)!;
    expect(Math.hypot(300 - corner.x, 400 - corner.y)).toBeCloseTo(
      Math.hypot(400, 600),
      8,
    );
  });

  it("replays a fatal teleport with the exact viewport dimensions", () => {
    const game = new Game(462, 1000);
    game.move(200, 500, 0);
    game.move(200 + SPEED * 3, 500, 3000);
    const result = replay(game.moves, { width: 462, height: 1000 });
    expect(result.phase).toBe("over");
    expect(result.width).toBe(462);
    expect(result.height).toBe(1000);
    expect(result.time).toBe(game.time);
    expect(result.score).toBe(game.score);
  });

  it("replays reflected deaths using their true screen edge instead of a fixed arena", () => {
    const game = new Game(1000, 463);
    game.move(500, 300, 0);
    game.advance(MAX_DURATION);
    expect(replay(game.moves, { width: 1000, height: 463 }).time).toBe(
      game.time,
    );
    expect(replay(game.moves).time).not.toBe(game.time);
  });
});

describe("first-click border margin", () => {
  const formats = [
    [1000, 640],
    [462, 1000],
    [1000, 1000],
    [100, 1000],
    [1000, 100],
  ];

  it("leaves enough room for the entire first return to follow the arming delay", () => {
    expect(deathAt(2 * START_MARGIN)).toBeGreaterThan(ARM_TIME);
  });

  it.each(formats)(
    "rejects border starts but accepts later border moves and their replays in %s by %s",
    (width, height) => {
      const margin = START_MARGIN;
      const outside = [
        [margin - 0.001, height / 2],
        [width - margin + 0.001, height / 2],
        [width / 2, margin - 0.001],
        [width / 2, height - margin + 0.001],
        [6, 6],
        [width - 6, 6],
        [6, height - 6],
        [width - 6, height - 6],
      ];
      for (const [x, y] of outside) {
        const game = new Game(width, height);
        expect(game.canMoveTo(x, y)).toBe(false);
        expect(game.move(x, y, 0)).toBe(false);
        expect(game.phase).toBe("idle");
        expect(game.waves).toHaveLength(0);
        expect(() => replay([{ x, y, t: 0 }], { width, height })).toThrow();
        const first = { x: width / 2, y: height / 2, t: 0 };
        expect(game.move(first.x, first.y, first.t)).toBe(true);
        expect(game.moveMargin).toBe(6);
        expect(game.canMoveTo(x, y)).toBe(true);
        expect(game.move(x, y, 100)).toBe(true);
        expect(game.player).toEqual({ x, y });
        expect(game.clicks).toBe(2);
        expect(game.waves).toHaveLength(2);
        expect(game.time).toBe(100);
        expect(() =>
          replay([first, { x, y, t: 100 }], { width, height }),
        ).not.toThrow();
      }
    },
  );

  it.each(formats)(
    "still rejects moves closer than 6 units to the edges in %s by %s",
    (width, height) => {
      const game = new Game(width, height);
      expect(game.moveMargin).toBe(START_MARGIN);
      expect(game.move(width / 2, height / 2, 0)).toBe(true);
      for (const [x, y] of [
        [5.999, height / 2],
        [width - 5.999, height / 2],
        [width / 2, 5.999],
        [width / 2, height - 5.999],
      ]) {
        expect(game.canMoveTo(x, y)).toBe(false);
        expect(game.move(x, y, 100)).toBe(false);
        expect(() =>
          replay([...game.moves, { x, y, t: 100 }], { width, height }),
        ).toThrow();
      }
      expect(game.clicks).toBe(1);
      expect(game.waves).toHaveLength(1);
      expect(game.time).toBe(0);
    },
  );

  it.each(formats)(
    "returns armed waves only before expiration in %s by %s",
    (width, height) => {
      const margin = START_MARGIN;
      for (const fx of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        for (const fy of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const x = margin + (width - 2 * margin) * fx;
          const y = margin + (height - 2 * margin) * fy;
          const game = new Game(width, height);
          expect(game.move(x, y, 0)).toBe(true);
          const death = deathAt(2 * Math.min(x, y, width - x, height - y));
          game.advance(death - 0.001);
          expect(game.phase).toBe("playing");
          game.advance(MAX_DURATION);
          expect(game.endReason).toBe(death < LIFETIME ? "wave" : "time");
          expect(game.phase).toBe("over");
          expect(game.time).toBeCloseTo(
            death < LIFETIME ? death : MAX_DURATION,
            8,
          );
          expect(game.time).toBeGreaterThan(ARM_TIME);
          expect(replay(game.moves, { width, height }).time).toBe(game.time);
        }
      }
    },
  );
});
