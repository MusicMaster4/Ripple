import { describe, expect, it } from "vitest";
import {
  Game,
  HIT_RADIUS,
  MAX_DURATION,
  SPEED as GAME_SPEED,
  replay,
} from "./engine";
import { pointInObstacle } from "./arena";
import {
  WaterArena,
  WaterWave,
  frontDistance,
  WATER_STEP,
  WATER_LEVEL,
  WATER_VISCOSITY,
} from "./water";

const travelTime = (distance: number) => (distance / SPEED) * 1000;

// Reference speed keeps numerical-physics fixtures independent of gameplay tuning.
const SPEED = 36.25;

const barrier = { x: 450, y: 180, width: 40, height: 280 };

describe("surface-water wave equation", () => {
  it("reflects from a solid boundary without inverting the arriving crest", () => {
    const wave = new WaterWave(new WaterArena(1000, 640, [barrier], SPEED), {
      x: 350,
      y: 320,
    });
    const open = new WaterWave(new WaterArena(1000, 640, [], SPEED), {
      x: 350,
      y: 320,
    });
    expect(wave.valueAt({ x: 350, y: 320 }, travelTime(188.5))).toBeGreaterThan(
      0.04,
    );
    expect(open.valueAt({ x: 350, y: 320 }, travelTime(188.5))).toBeLessThan(0);
  });

  it("diffracts around both corners into the shadow before an outer-wall reflection can arrive", () => {
    const wave = new WaterWave(new WaterArena(1000, 640, [barrier], SPEED), {
      x: 350,
      y: 320,
    });
    const receiver = { x: 550, y: 320 };
    // The straight, blocked 200-unit path would arrive after 200 / SPEED seconds.
    expect(Math.abs(wave.valueAt(receiver, travelTime(217.5)))).toBeLessThan(
      1e-8,
    );
    // The approximately 364-unit path around a corner arrives after 364 / SPEED seconds.
    // An outer-wall return requires over 660 units and cannot explain this crest.
    expect(wave.valueAt(receiver, travelTime(373.375))).toBeGreaterThan(0.01);
    expect(
      wave.front(travelTime(373.375)).some((x, i) => i % 2 === 0 && x > 500),
    ).toBe(true);
    expect(wave.valueAt({ x: 470, y: 320 }, travelTime(373.375))).toBe(0);
  });

  it("keeps the numerical timestep within the two-dimensional stability bound", () => {
    for (const [width, height] of [
      [1000, 640],
      [462, 1000],
      [1000, 100],
      [100, 1000],
    ]) {
      const arena = new WaterArena(width, height, [], SPEED);
      expect(
        ((SPEED * WATER_STEP) / 1000) * Math.hypot(1 / arena.dx, 1 / arena.dy),
      ).toBeLessThan(1);
      const damping = WATER_VISCOSITY / ((SPEED ** 2 * WATER_STEP) / 1000);
      const courantSquare =
        ((SPEED * WATER_STEP) / 1000) ** 2 *
        (1 / arena.dx ** 2 + 1 / arena.dy ** 2);
      expect(courantSquare * (1 + 2 * damping)).toBeLessThan(1);
    }
  });

  it("propagates a crest at the configured water speed within one pulse width", () => {
    const wave = new WaterWave(new WaterArena(1000, 640, [], SPEED), {
      x: 300,
      y: 320,
    });
    let peak = -Infinity,
      at = 0;
    for (
      let age = travelTime(163.125);
      age <= travelTime(224.75);
      age += WATER_STEP
    ) {
      const value = wave.valueAt({ x: 500, y: 320 }, age);
      if (value > peak) {
        peak = value;
        at = age;
      }
    }
    expect(Math.abs((at / 1000) * SPEED - 200)).toBeLessThan(12);
  });

  it("uses conservative circle and concave polygon no-flow boundaries", () => {
    const shapes = [
      { x: 400, y: 200, width: 100, height: 100, shape: "circle" as const },
      {
        x: 600,
        y: 200,
        width: 200,
        height: 200,
        vertices: [
          { x: 600, y: 200 },
          { x: 800, y: 200 },
          { x: 800, y: 280 },
          { x: 680, y: 280 },
          { x: 680, y: 400 },
          { x: 600, y: 400 },
        ],
      },
    ];
    const arena = new WaterArena(1000, 640, shapes, SPEED);
    for (let y = 0; y < arena.rows; y++)
      for (let x = 0; x < arena.cols; x++) {
        const p = { x: (x + 0.5) * arena.dx, y: (y + 0.5) * arena.dy };
        if (shapes.some((b) => pointInObstacle(p.x, p.y, b)))
          expect(arena.solid[y * arena.cols + x]).toBe(1);
      }
    // A concave shape must not turn the empty part of its bounding box solid.
    const openCellX = Math.floor(750 / arena.dx),
      openCellY = Math.floor(350 / arena.dy);
    expect(arena.solid[openCellY * arena.cols + openCellX]).toBe(0);
  });

  it("keeps a sub-cell wall between cell centers in the propagated field", () => {
    const wall = { x: 451, y: 180, width: 1, height: 280 };
    const arena = new WaterArena(1000, 640, [wall], SPEED);
    const leftCell = Math.floor(450 / arena.dx),
      rightCell = Math.floor(454 / arena.dx),
      row = Math.floor(320 / arena.dy);
    expect(pointInObstacle(450, 320, wall)).toBe(false);
    expect(pointInObstacle(454, 320, wall)).toBe(false);
    expect(arena.solid[row * arena.cols + leftCell]).toBe(1);
    expect(arena.solid[row * arena.cols + rightCell]).toBe(1);
    const wave = new WaterWave(arena, { x: 440, y: 320 });
    expect(wave.valueAt({ x: 464, y: 320 }, 0)).toBe(0);
    expect(
      Math.abs(wave.valueAt({ x: 470, y: 320 }, travelTime(60))),
    ).toBeLessThan(1e-8);
  });

  it("does not initialize an impulse through a thin wall", () => {
    const wall = { x: 450, y: 180, width: 8, height: 280 };
    const wave = new WaterWave(new WaterArena(1000, 640, [wall], SPEED), {
      x: 440,
      y: 320,
    });
    expect(wave.valueAt({ x: 464, y: 320 }, 0)).toBe(0);
  });

  it("finds the same contact time across skipped frames and exact numerical boundaries", () => {
    const arena = new WaterArena(1000, 640, [barrier], SPEED);
    const source = { x: 350, y: 320 };
    const whole = new WaterWave(arena, source).firstContact(
      source,
      0,
      15000,
      2000,
      HIT_RADIUS,
    );
    expect(Number.isFinite(whole)).toBe(true);
    const wave = new WaterWave(arena, source);
    let contact = Infinity;
    for (let time = 0; time < 15000; time += 25) {
      contact = wave.firstContact(source, time, time + 25, 2000, HIT_RADIUS);
      if (Number.isFinite(contact)) break;
      wave.setAge(time + 25);
    }
    expect(contact).toBeCloseTo(whole, 8);
  });

  it.each([
    [1000, 640],
    [462, 1000],
    [1000, 100],
    [100, 1000],
  ])(
    "replays the same wave death independently of animation timing in %s × %s",
    (width, height) => {
      const game = new Game(width, height, 42);
      game.move(width / 2, height / 2, 0);
      for (
        let time = 16.7;
        time < MAX_DURATION && game.phase === "playing";
        time += 16.7
      )
        game.advance(time);
      const result = replay(game.moves, { width, height }, 42);
      expect(result.phase).toBe("over");
      expect(result.time).toBeCloseTo(game.time, 7);
      expect(result.score).toBe(game.score);
      expect(result.obstacles).toEqual(game.obstacles);
    },
  );
});

describe("one visible front per drop", () => {
  it("extracts one closed crest with no inner or outer amplitude outlines", () => {
    const origin = { x: 500, y: 320 };
    const wave = new WaterWave(new WaterArena(1000, 640, [], SPEED), origin);
    const front = wave.front(travelTime(145));
    const graph = new Map<string, string[]>();
    const key = (x: number, y: number) => `${x.toFixed(5)},${y.toFixed(5)}`;
    for (let i = 0; i < front.length; i += 4) {
      const a = key(front[i], front[i + 1]),
        b = key(front[i + 2], front[i + 3]);
      graph.set(a, [...(graph.get(a) ?? []), b]);
      graph.set(b, [...(graph.get(b) ?? []), a]);
    }
    expect(graph.size).toBeGreaterThan(100);
    expect(
      [...graph.values()].every((neighbors) => neighbors.length === 2),
    ).toBe(true);
    const remaining = new Set(graph.keys());
    let components = 0;
    while (remaining.size) {
      components++;
      const queue = [remaining.values().next().value!];
      while (queue.length) {
        const at = queue.pop()!;
        if (!remaining.delete(at)) continue;
        queue.push(...graph.get(at)!);
      }
    }
    expect(components).toBe(1);
    expect(frontDistance(front, origin)).toBeGreaterThan(140);
    expect(frontDistance(front, { x: 675, y: 320 })).toBeLessThan(30);
    expect(frontDistance(front, { x: 750, y: 320 })).toBeGreaterThan(50);
  });

  it("creates exactly one field for each accepted click and ignores blocked clicks", () => {
    const game = new Game(1000, 640, 42);
    game.move(500, 320, 0);
    expect(game.waves).toHaveLength(1);
    expect(game.waves[0].field).toBeDefined();
    const b = game.obstacles[0],
      p = b.vertices?.[0] ?? { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    expect(game.move(p.x, p.y, 100)).toBe(false);
    expect(game.waves).toHaveLength(1);
    expect(game.move(500, 320, 100)).toBe(true);
    expect(game.waves).toHaveLength(2);
  });

  it("places a collision on the same crest used by the red proximity highlight", () => {
    const wave = new WaterWave(new WaterArena(1000, 640, [barrier], SPEED), {
      x: 350,
      y: 320,
    });
    const player = { x: 350, y: 320 };
    const death = wave.firstContact(player, 0, 15000, 2000, HIT_RADIUS);
    expect(Number.isFinite(death)).toBe(true);
    expect(wave.distanceToFront(player, death)).toBeLessThan(HIT_RADIUS + 1);
    expect(wave.distanceToFront(player, death - 650)).toBeLessThan(50);
    expect(wave.distanceToFront(player, death - 650)).toBeGreaterThan(
      HIT_RADIUS,
    );
    expect(wave.firstContact(player, death, death, 2000, HIT_RADIUS + 1)).toBe(
      death,
    );
  });
});

describe("reported source-region interference regression", () => {
  const source = { x: 570.8333333333333, y: 231.76040494938132 };
  const reported = () => {
    const map = new Game(1000, 463, 412366530);
    return new WaterWave(
      new WaterArena(1000, 463, map.obstacles, GAME_SPEED),
      source,
    );
  };

  it("does not recreate a lethal crest at the drop location at 9.361 seconds", () => {
    const wave = reported();
    expect(wave.firstContact(source, 0, 11000, 2000, HIT_RADIUS)).toBe(
      Infinity,
    );
    expect(wave.firstContact(source, 9361, 9361, 2000, HIT_RADIUS)).toBe(
      Infinity,
    );
    // The real reflected front is still approaching from outside the source
    // region, rather than a small contour nucleating next to the player.
    expect(wave.distanceToFront(source, 9361)).toBeGreaterThan(60);
  });

  it("rejects the same phantom return with frame-by-frame advancement", () => {
    const wave = reported();
    for (let time = 0; time < 11000; time += 31.7) {
      expect(
        wave.firstContact(
          source,
          time,
          Math.min(time + 31.7, 11000),
          2000,
          HIT_RADIUS,
        ),
      ).toBe(Infinity);
    }
  });
});

describe("continuous rendering and shared scratch grids", () => {
  it("keeps one closed crest moving continuously at 120 Hz, including timestep boundaries", () => {
    const origin = { x: 500, y: 320 };
    const wave = new WaterWave(new WaterArena(1000, 640, [], SPEED), origin);
    let previousRadius = 0;
    for (let frame = 0; frame < 36; frame++) {
      const age = 4000 + frame * (1000 / 120);
      const front = wave.front(age);
      const degrees = new Map<string, number>();
      let radius = 0;
      for (let i = 0; i < front.length; i += 2) {
        const x = front[i],
          y = front[i + 1];
        const key = `${x.toFixed(5)},${y.toFixed(5)}`;
        degrees.set(key, (degrees.get(key) ?? 0) + 1);
        radius += Math.hypot(x - origin.x, y - origin.y);
      }
      radius /= front.length / 2;
      expect(degrees.size).toBeGreaterThan(100);
      expect([...degrees.values()].every((n) => n === 2)).toBe(true);
      if (frame) {
        // A frozen mesh followed by a 50 ms jump fails both bounds.
        expect(radius - previousRadius).toBeGreaterThan((SPEED / 120) * 0.8);
        expect(radius - previousRadius).toBeLessThan((SPEED / 120) * 1.2);
      }
      previousRadius = radius;
    }
  });

  it("isolates cached crests when other drops overwrite the arena's scratch space", () => {
    const arena = new WaterArena(1000, 640, [barrier], SPEED);
    const origin = { x: 350, y: 320 };
    const first = new WaterWave(arena, origin);
    const second = new WaterWave(arena, { x: 700, y: 280 });
    const reference = new WaterWave(
      new WaterArena(1000, 640, [barrier], SPEED),
      origin,
    );
    for (const age of [6001, 6017, 6049, 6050, 6051, 6083, 6100]) {
      first.front(age);
      second.front(age + 2400);
      expect(first.front(age + 0.1)).toEqual(reference.front(age + 0.1));
    }
    first.setAge(6150);
    expect(first.front(6100)).toEqual(reference.front(6100));
    first.front(9000);
    expect(first.front(4000)).toEqual(reference.front(4000));
  });

  it("measures the same near-player arc before and after a full render", () => {
    const arena = new WaterArena(1000, 640, [], SPEED);
    const source = { x: 500, y: 320 };
    const fresh = new WaterWave(arena, source);
    const rendered = new WaterWave(arena, source);
    const age = 4000;
    const front = rendered.front(age);
    const player = {
      x: (front[0] + front[2]) / 2,
      y: (front[1] + front[3]) / 2,
    };
    expect(fresh.distanceToFront(player, age, HIT_RADIUS + 8)).toBeLessThan(
      0.01,
    );
    expect(fresh.firstContact(player, age, age, 2000, HIT_RADIUS)).toBe(age);
    expect(rendered.firstContact(player, age, age, 2000, HIT_RADIUS)).toBe(age);
  });

  it("prefetches without changing the displayed surface, crest, or contact time", () => {
    const arena = new WaterArena(1000, 640, [barrier], SPEED);
    const source = { x: 350, y: 320 };
    const warmed = new WaterWave(arena, source);
    const reference = new WaterWave(arena, source);
    for (const age of [6000, 6001, 6017, 6049, 6050, 6051, 6075, 6100]) {
      warmed.prefetch(age, 0);
      for (const point of [source, { x: 420, y: 300 }, { x: 380, y: 400 }])
        expect(warmed.valueAt(point, age)).toBe(reference.valueAt(point, age));
      expect(warmed.front(age)).toEqual(reference.front(age));
    }
    expect(warmed.firstContact(source, 6100, 15000, 2000, HIT_RADIUS)).toBe(
      reference.firstContact(source, 6100, 15000, 2000, HIT_RADIUS),
    );
  });

  it.each([1000 / 60, 1000 / 144])(
    "keeps a dense rendered round identical to replay at %s ms per frame",
    (frameTime) => {
      const game = new Game(1000, 640, 42);
      for (let t = 0; t < 2000; t += 120)
        expect(game.move(500, 320, t)).toBe(true);
      for (
        let t = game.time + frameTime;
        t < MAX_DURATION && game.phase === "playing";
        t += frameTime
      ) {
        game.advance(t);
        for (const wave of game.waves) {
          wave.field?.front(game.time - wave.t);
          wave.field?.prefetch(
            game.time - wave.t,
            ((wave.id * 0.618033988749895) % 1) * WATER_STEP,
          );
        }
      }
      const result = replay(game.moves, { width: 1000, height: 640 }, 42);
      expect(result.phase).toBe("over");
      expect(game.time).toBeCloseTo(result.time, 7);
      expect(game.score).toBe(result.score);
    },
  );
});
