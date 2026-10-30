import type { Game } from "./engine";

/** Keep the dot visible without discarding pointer clicks at the screen edge. */
export function pointerDestination(
  game: Pick<Game, "phase" | "moveMargin" | "width" | "height">,
  x: number,
  y: number,
) {
  // The start margin is a restriction, so never pull an invalid first click inward.
  if (game.phase !== "playing") return { x, y };
  const margin = game.moveMargin;
  return {
    x: Math.max(margin, Math.min(game.width - margin, x)),
    y: Math.max(margin, Math.min(game.height - margin, y)),
  };
}
