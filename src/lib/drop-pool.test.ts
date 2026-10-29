import { describe, expect, it } from "vitest";
import { DropPool } from "./drop-pool";

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function picks(pool: DropPool, count: number) {
  return Array.from({ length: count }, () => pool.next());
}

describe("DropPool", () => {
  it("defaults to 64 variations and a 32-pick cooldown", () => {
    const pool = new DropPool();
    expect(pool.size).toBe(64);
    expect(pool.cooldown).toBe(32);
  });

  it("never repeats within the first 33 drops", () => {
    for (let seed = 0; seed < 20; seed++) {
      const sequence = picks(new DropPool(64, seeded(seed)), 33);
      expect(new Set(sequence).size).toBe(33);
    }
  });

  it("keeps every repeated sound at least 33 selections apart", () => {
    const sequence = picks(new DropPool(64, seeded(42)), 10_000);
    const previous = new Map<number, number>();
    sequence.forEach((index, position) => {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(64);
      const last = previous.get(index);
      if (last !== undefined)
        expect(position - last).toBeGreaterThanOrEqual(33);
      previous.set(index, position);
    });
  });

  it("returns old choices to the pool after exactly half the pool has played", () => {
    const sequence = picks(new DropPool(64, () => 0), 34);
    expect(sequence.slice(0, 33)).toEqual(
      Array.from({ length: 33 }, (_, i) => i),
    );
    expect(sequence[33]).toBe(0);
  });

  it("can reach every one of the 64 variants", () => {
    const sequence = picks(new DropPool(64, seeded(2048)), 10_000);
    expect(new Set(sequence).size).toBe(64);
    const counts = Array.from(
      { length: 64 },
      (_, i) => sequence.filter((index) => index === i).length,
    );
    expect(Math.min(...counts)).toBeGreaterThan(100);
    expect(Math.max(...counts)).toBeLessThan(220);
  });

  it("gives reproducible sequences with an injected seeded source", () => {
    expect(picks(new DropPool(64, seeded(100)), 250)).toEqual(
      picks(new DropPool(64, seeded(100)), 250),
    );
    expect(picks(new DropPool(64, seeded(100)), 50)).not.toEqual(
      picks(new DropPool(64, seeded(101)), 50),
    );
  });

  it("selects the first available sound for random zero", () => {
    expect(picks(new DropPool(4, () => 0), 6)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it.each([1 - Number.EPSILON, 1])(
    "selects the last available sound for random %s",
    (roll) => {
      expect(picks(new DropPool(4, () => roll), 6)).toEqual([3, 2, 1, 3, 2, 1]);
    },
  );

  it.each([-1, -Number.MAX_VALUE])(
    "clamps random values below zero (%s)",
    (roll) => {
      expect(new DropPool(4, () => roll).next()).toBe(0);
    },
  );

  it.each([2, Number.MAX_VALUE])(
    "clamps random values above one (%s)",
    (roll) => {
      expect(new DropPool(4, () => roll).next()).toBe(3);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite randomness (%s) without changing history",
    (roll) => {
      let current = roll;
      const pool = new DropPool(4, () => current);
      expect(() => pool.next()).toThrow(RangeError);
      current = 0;
      expect(pool.next()).toBe(0);
    },
  );

  it("alternates reliably for a minimum-sized pool", () => {
    expect(picks(new DropPool(2, seeded(1)), 8)).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1,
    ]);
  });

  it("uses the floor of half the size for an odd pool", () => {
    const pool = new DropPool(5, () => 0);
    expect(pool.cooldown).toBe(2);
    expect(picks(pool, 7)).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it.each([0, 1, -5, 2.5, NaN, Infinity, 2 ** 53])(
    "rejects invalid pool size %s",
    (size) => {
      expect(() => new DropPool(size)).toThrow(RangeError);
    },
  );

  it("keeps independent history for different pools", () => {
    const first = new DropPool(4, () => 0);
    const second = new DropPool(4, () => 0);
    first.next();
    first.next();
    expect(second.next()).toBe(0);
    expect(first.next()).toBe(2);
  });
});
