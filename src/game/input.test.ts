import { describe, expect, it } from "vitest";
import { Game, MIN_CLICK_INTERVAL, replay } from "./engine";
import { pointerDestination } from "./input";

describe("pointer clicks at screen edges", () => {
  it.each([[1000, 640], [462, 1000], [1000, 1000], [1000, 100], [100, 1000]])(
    "blocks border starts but accepts border moves in %s by %s",
    (width, height) => {
      for (const [x, y] of [
        [0, height / 2], [width, height / 2],
        [width / 2, 0], [width / 2, height],
        [1, 1], [width - 1, 1], [1, height - 1], [width - 1, height - 1],
      ]) {
        const game = new Game(width, height);
        const start = pointerDestination(game, x, y);
        expect(start).toEqual({ x, y });
        expect(game.move(start.x, start.y, 0)).toBe(false);
        expect(game.phase).toBe("idle");
        expect(game.move(width / 2, height / 2, 0)).toBe(true);
        const target = pointerDestination(game, x, y);
        expect(target).toEqual({
          x: Math.max(6, Math.min(width - 6, x)),
          y: Math.max(6, Math.min(height - 6, y)),
        });
        expect(game.move(target.x, target.y, MIN_CLICK_INTERVAL)).toBe(true);
        expect(game.player).toEqual(target);
        expect(game.clicks).toBe(2);
        const result = replay(game.moves, { width, height });
        expect(result.player).toEqual(target);
        expect(result.clicks).toBe(2);
      }
    },
  );

  it("preserves interior clicks and rejects solid destinations", () => {
    const game = new Game();
    game.obstacles.push({ x: 200, y: 200, width: 100, height: 100 });
    expect(game.move(500, 320, 0)).toBe(true);
    const target = pointerDestination(game, 250, 250);
    expect(target).toEqual({ x: 250, y: 250 });
    expect(game.move(target.x, target.y, MIN_CLICK_INTERVAL)).toBe(false);
    expect(game.clicks).toBe(1);
  });
});
