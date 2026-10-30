import { useEffect, useRef } from "react";
import {
  ARM_TIME,
  Game,
  WIDTH,
  SPEED,
  LIFETIME,
  type Arena,
  type Move,
  type Phase,
} from "./engine";
import {
  INK,
  INK_RGB,
  PAPER,
  PAPER_RGB,
  brushRing,
  floodPath,
  inkBlot,
} from "./ink";
import { frontDistance, WATER_STEP } from "./water";
import { drawRain } from "./rain-render";
import { type Obstacle } from "./arena";
import { sound } from "../lib/audio";
import { pointerDestination } from "./input";
export type GameResult = {
  score: number;
  clicks: number;
  milliseconds: number;
  moves: Move[];
  interrupted: boolean;
  bounds: Arena;
};
export type GameStats = {
  score: number;
  clicks: number;
  time: number;
  phase: Phase;
};

export function GameCanvas({
  resetKey,
  blocked,
  onStart,
  onEnd,
  onStats,
  onReady,
}: {
  resetKey: number;
  blocked: boolean;
  onStart: (bounds: Arena) => void;
  onEnd: (result: GameResult) => void;
  onStats: (stats: GameStats) => void;
  onReady: (interrupt: () => void) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onStart, onEnd, onStats, onReady });
  useEffect(() => {
    callbacks.current = { onStart, onEnd, onStats, onReady };
  });
  const blockRef = useRef(blocked);
  useEffect(() => {
    blockRef.current = blocked;
  }, [blocked]);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    let game = new Game(undefined, undefined, seed);
    const obstaclePaths = new WeakMap<Obstacle, Path2D>();
    function obstaclePath(b: Obstacle) {
      let path = obstaclePaths.get(b);
      if (path) return path;
      path = new Path2D();
      if (b.shape === "circle")
        path.arc(
          b.x + b.width / 2,
          b.y + b.height / 2,
          b.width / 2,
          0,
          Math.PI * 2,
        );
      else if (b.vertices) {
        path.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (const p of b.vertices.slice(1)) path.lineTo(p.x, p.y);
        path.closePath();
      } else path.rect(b.x, b.y, b.width, b.height);
      obstaclePaths.set(b, path);
      return path;
    }
    let obstacleLayer: HTMLCanvasElement | undefined;
    let origin = 0,
      frame = 0,
      ended = false,
      endedAt = 0,
      lastUpdate = 0,
      lastStats = "";
    let cssWidth = 1000,
      cssHeight = 640,
      dpr = 1,
      keyboardMode = false;
    let keyboardX = 500,
      keyboardY = 320;
    let heardDrops = 0;
    function playRainSounds() {
      const impacts = game.rain?.impacts ?? [];
      while (heardDrops < impacts.length) {
        const drop = impacts[heardDrops++];
        // Like click audio, stale impacts must not burst after a stalled frame.
        if (game.time - drop.impactAt < 500)
          void sound.drip(drop.x / game.width);
      }
    }
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    function finish() {
      if (ended || game.phase !== "over") return;
      ended = true;
      endedAt = performance.now();
      sound.drip(game.player.x / game.width, true);
      sound.stop();
      callbacks.current.onEnd({
        score: game.score,
        clicks: game.clicks,
        milliseconds: Math.round(game.time),
        moves: [...game.moves],
        interrupted: game.endReason === "interrupted",
        bounds: { width: game.width, height: game.height, seed },
      });
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // ResizeObserver can report zero while the page unloads or a surface hides.
      // Keep the last valid arena until a measurable viewport returns.
      if (!canvas.isConnected || rect.width <= 0 || rect.height <= 0) return;
      if (
        game.phase === "playing" &&
        (Math.abs(cssWidth - rect.width) > 2 ||
          Math.abs(cssHeight - rect.height) > 2)
      ) {
        game.interrupt();
        finish();
      }
      cssWidth = rect.width;
      cssHeight = rect.height;
      if (game.phase === "idle") {
        const longer = Math.max(rect.width, rect.height);
        game = new Game(
          Math.max(100, Math.round((rect.width / longer) * WIDTH)),
          Math.max(100, Math.round((rect.height / longer) * WIDTH)),
          seed,
        );
        keyboardX = game.width / 2;
        keyboardY = game.height / 2;
      }
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      obstacleLayer = undefined;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    callbacks.current.onReady(() => {
      game.interrupt();
      finish();
    });
    const hidden = () => {
      if (document.hidden) {
        game.interrupt();
        finish();
        sound.stop();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const input = (event: PointerEvent | KeyboardEvent) => {
      if (blockRef.current || game.phase === "over") return;
      if (event instanceof PointerEvent && event.button !== 0) return;
      if (
        event instanceof KeyboardEvent &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        keyboardMode = true;
        keyboardX = Math.max(
          game.moveMargin,
          Math.min(
            game.width - game.moveMargin,
            keyboardX +
              (event.key === "ArrowRight"
                ? 45
                : event.key === "ArrowLeft"
                  ? -45
                  : 0),
          ),
        );
        keyboardY = Math.max(
          game.moveMargin,
          Math.min(
            game.height - game.moveMargin,
            keyboardY +
              (event.key === "ArrowDown"
                ? 45
                : event.key === "ArrowUp"
                  ? -45
                  : 0),
          ),
        );
        return;
      }
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))
        return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event instanceof PointerEvent) keyboardMode = false;
      const { x, y } =
        event instanceof PointerEvent
          ? pointerDestination(
              game,
              ((event.clientX - rect.left) / rect.width) * game.width,
              ((event.clientY - rect.top) / rect.height) * game.height,
            )
          : { x: keyboardX, y: keyboardY };
      if (!game.canMoveTo(x, y)) return;
      const starting = game.phase === "idle";
      if (starting) {
        origin = performance.now();
        void sound.start();
      }
      if (game.move(x, y, starting ? 0 : performance.now() - origin)) {
        if (starting)
          callbacks.current.onStart({
            width: game.width,
            height: game.height,
            seed,
          });
        playRainSounds();
        sound.drip(x / game.width);
        callbacks.current.onStats({
          score: game.score,
          clicks: game.clicks,
          time: game.time,
          phase: game.phase,
        });
      }
      playRainSounds();
      finish();
    };
    canvas.addEventListener("pointerdown", input);
    canvas.addEventListener("keydown", input);
    const drawRings = (rgb: string, scale: number, dim = 1) => {
      for (const wave of game.waves) {
        const age = game.time - wave.t;
        if (age < 0 || age > LIFETIME) continue;
        const r = (age / 1000) * SPEED;
        const fade = Math.min(1, (LIFETIME - age) / 900) * dim;
        const armed = age >= ARM_TIME;
        // Young waves breathe in and out until they turn solid and deadly.
        const alpha = armed
          ? fade
          : (0.28 +
              0.42 *
                (0.5 +
                  0.5 *
                    (motionQuery.matches
                      ? 0
                      : Math.cos((age / 480) * Math.PI * 2)))) *
            fade;
        const snap = armed ? Math.max(0, 1 - (age - ARM_TIME) / 260) : 0;
        const width = armed ? 3.6 * (1 + snap * 0.6) : 2.8;
        const seed = wave.id * 1.37;
        // Interpolate the cached crest band at the exact display time. The
        // physical timestep stays fixed, including on 120/144/240 Hz screens.
        const front = wave.field?.front(age);
        if (game.phase === "playing")
          wave.field?.prefetch(
            age,
            ((wave.id * 0.618033988749895) % 1) * WATER_STEP,
          );
        const hasProximity =
          dim === 1 &&
          armed &&
          game.phase === "playing" &&
          (front
            ? frontDistance(front, game.player) <= 50
            : wave.sources.some((source) => {
                const dist = Math.hypot(
                  game.player.x - source.x,
                  game.player.y - source.y,
                );
                return Math.abs(dist - r) <= 50;
              }));

        if (hasProximity) {
          const grad = ctx.createRadialGradient(
            game.player.x,
            game.player.y,
            0,
            game.player.x,
            game.player.y,
            50,
          );
          grad.addColorStop(0, `rgba(235, 30, 30, ${alpha})`);
          grad.addColorStop(0.35, `rgba(238, 55, 55, ${alpha})`);
          grad.addColorStop(0.7, `rgba(242, 130, 125, ${alpha})`);
          grad.addColorStop(1, `rgba(${rgb}, ${alpha})`);
          ctx.fillStyle = grad;

          const strokeGrad = ctx.createRadialGradient(
            game.player.x,
            game.player.y,
            0,
            game.player.x,
            game.player.y,
            50,
          );
          strokeGrad.addColorStop(0, `rgba(235, 30, 30, ${alpha * 0.45})`);
          strokeGrad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.22})`);
          ctx.strokeStyle = strokeGrad;
        } else {
          ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
          ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.22})`;
        }
        if (front) {
          ctx.save();
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.lineWidth = width * 0.65;
          ctx.beginPath();
          for (let i = 0; i + 3 < front.length; i += 4) {
            ctx.moveTo(front[i], front[i + 1]);
            ctx.lineTo(front[i + 2], front[i + 3]);
          }
          ctx.stroke();
          ctx.restore();
          continue;
        }
        ctx.lineWidth = 0.9 / scale;
        for (const source of wave.sources) {
          const reach = r + 6;
          if (
            source.x + reach < 0 ||
            source.x - reach > game.width ||
            source.y + reach < 0 ||
            source.y - reach > game.height
          )
            continue;
          // Skip rings that already enclose the whole page.
          const far = Math.max(
            Math.hypot(source.x, source.y),
            Math.hypot(game.width - source.x, source.y),
            Math.hypot(source.x, game.height - source.y),
            Math.hypot(game.width - source.x, game.height - source.y),
          );
          if (far < r - 6) continue;
          brushRing(ctx, source.x, source.y, r, width, seed);
        }
      }
    };
    const render = (now: number) => {
      if (game.phase === "playing") game.advance(now - origin);
      playRainSounds();
      finish();
      const scaleX = cssWidth / game.width,
        scaleY = cssHeight / game.height;
      const scale = Math.min(scaleX, scaleY);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Preserve circles when an orientation change ends the current round.
      ctx.setTransform(
        dpr * scale,
        0,
        0,
        dpr * scale,
        ((cssWidth - game.width * scale) * dpr) / 2,
        ((cssHeight - game.height * scale) * dpr) / 2,
      );
      ctx.save();
      const px = game.player.x,
        py = game.player.y;
      if (game.phase !== "idle") {
        drawRings(PAPER_RGB, scale);
        ctx.fillStyle = PAPER;
        inkBlot(ctx, px, py, 4.2, game.clicks);
      }
      if (game.phase === "over") {
        // A last, inverted wave sweeps out from the dot and washes the page.
        const progress = motionQuery.matches
          ? 1
          : Math.min(1, (now - endedAt) / 1300);
        const eased = 1 - (1 - progress) ** 3;
        const padX = (cssWidth / scale - game.width) / 2;
        const padY = (cssHeight / scale - game.height) / 2;
        const reach =
          Math.max(
            Math.hypot(px + padX, py + padY),
            Math.hypot(game.width + padX - px, py + padY),
            Math.hypot(px + padX, game.height + padY - py),
            Math.hypot(game.width + padX - px, game.height + padY - py),
          ) * 1.25;
        const outer = 6 + eased * (reach + 260);
        const inner = Math.max(0, outer - 40 - 220 * eased);
        const seed = game.clicks * 0.7;
        ctx.save();
        floodPath(ctx, px, py, outer, seed);
        ctx.fillStyle = PAPER;
        ctx.fill();
        ctx.clip();
        drawRings(INK_RGB, scale);
        ctx.restore();
        if (inner > 0) {
          ctx.save();
          floodPath(ctx, px, py, inner, seed + 2);
          ctx.fillStyle = INK;
          ctx.fill();
          ctx.clip();
          drawRings(PAPER_RGB, scale, 0.14);
          ctx.restore();
        }
        ctx.fillStyle = PAPER;
        inkBlot(ctx, px, py, 4.2, game.clicks);
        ctx.strokeStyle = `rgba(${PAPER_RGB}, .6)`;
        ctx.lineWidth = 1.2 / scale;
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Static contour clipping and hatching are rasterized once per resize.
      if (
        (!blockRef.current || game.phase !== "idle") &&
        game.obstacles.length
      ) {
        if (!obstacleLayer) {
          obstacleLayer = document.createElement("canvas");
          obstacleLayer.width = canvas.width;
          obstacleLayer.height = canvas.height;
          const layerContext = obstacleLayer.getContext("2d")!;
          layerContext.setTransform(
            dpr * scale,
            0,
            0,
            dpr * scale,
            ((cssWidth - game.width * scale) * dpr) / 2,
            ((cssHeight - game.height * scale) * dpr) / 2,
          );
          for (const b of game.obstacles) {
            layerContext.fillStyle = INK;
            layerContext.fill(obstaclePath(b));
            layerContext.save();
            layerContext.clip(obstaclePath(b));
            layerContext.fillStyle = `rgba(${PAPER_RGB}, .08)`;
            layerContext.fillRect(b.x, b.y, b.width, b.height);
            layerContext.strokeStyle = `rgba(${PAPER_RGB}, .13)`;
            layerContext.lineWidth = 0.8 / scale;
            layerContext.beginPath();
            for (let offset = -b.height; offset < b.width; offset += 7) {
              layerContext.moveTo(b.x + offset, b.y);
              layerContext.lineTo(b.x + offset + b.height, b.y + b.height);
            }
            layerContext.stroke();
            layerContext.restore();
            layerContext.strokeStyle = `rgba(${PAPER_RGB}, .6)`;
            layerContext.lineWidth = 1.2 / scale;
            layerContext.stroke(obstaclePath(b));
          }
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(obstacleLayer, 0, 0);
        ctx.restore();
      }
      if (game.phase === "playing" && game.rain) {
        drawRain(ctx, game.rain.pending, game.time, motionQuery.matches);
        // Keep the player legible if a landing mark is drawn over their position.
        ctx.fillStyle = PAPER;
        inkBlot(ctx, px, py, 4.2, game.clicks);
      }
      if (
        keyboardMode &&
        document.activeElement === canvas &&
        game.phase !== "over"
      ) {
        ctx.strokeStyle = game.canMoveTo(keyboardX, keyboardY)
          ? `rgba(${PAPER_RGB}, .55)`
          : "rgba(238, 55, 55, .7)";
        ctx.lineWidth = 1.2 / scale;
        ctx.beginPath();
        ctx.arc(keyboardX, keyboardY, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      if (now - lastUpdate > 100) {
        const current = [game.score, game.clicks, game.time, game.phase].join(
          ":",
        );
        if (current !== lastStats) {
          callbacks.current.onStats({
            score: game.score,
            clicks: game.clicks,
            time: game.time,
            phase: game.phase,
          });
          lastStats = current;
        }
        lastUpdate = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      canvas.removeEventListener("pointerdown", input);
      canvas.removeEventListener("keydown", input);
    };
  }, [resetKey]);
  return (
    <canvas
      ref={canvasRef}
      tabIndex={blocked ? -1 : 0}
      role="application"
      aria-label="Ripple game. Click or tap to start and move. Arrow keys aim; Enter or Space moves. The first click must be at least 40 units from the edges. Later clicks can reach the screen edge; the dot stays fully inside the arena. Hatched areas cannot be entered. Water waves reflect and diffract around their contours. White warning marks show where random drops will land. Each mark turns red from bottom to top over two seconds; when fully red, a white drop falls and creates a white wave. With reduced motion, the warning still changes color but the falling movement is omitted. The chance starts at 3 percent each second and rises one percentage point every ten seconds. Waves turn deadly two seconds after they appear. Your score is seconds survived."
    />
  );
}
