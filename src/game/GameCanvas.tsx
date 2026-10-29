import { useEffect, useRef } from "react";
import {
  Game,
  WIDTH,
  SPEED,
  LIFETIME,
  type Bounds,
  type Move,
  type Phase,
} from "./engine";
import { sound } from "../lib/audio";
export type GameResult = {
  score: number;
  clicks: number;
  milliseconds: number;
  moves: Move[];
  interrupted: boolean;
  bounds: Bounds;
};
export type GameStats = {
  score: number;
  clicks: number;
  time: number;
  phase: Phase;
};

function sketchCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
  opacity: number,
  scale: number,
) {
  if (r <= 0) return;
  ctx.strokeStyle = `rgba(198, 216, 185, ${opacity})`;
  ctx.lineWidth = 1.04 / scale;
  ctx.beginPath();
  const steps = Math.max(52, Math.ceil(r / 4));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      Math.sin(a * 5 + seed) * 0.85 + Math.sin(a * 11 - seed) * 0.35;
    const px = x + Math.cos(a) * (r + wobble),
      py = y + Math.sin(a) * (r + wobble);
    if (!i) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = `rgba(198, 216, 185, ${opacity * 0.22})`;
  ctx.lineWidth = 0.65 / scale;
  ctx.beginPath();
  ctx.ellipse(x + 0.65, y - 0.45, r + 1.7, r + 0.4, 0.007, 0, Math.PI * 2);
  ctx.stroke();
}

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
  onStart: (bounds: Bounds) => void;
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
    const ctx = canvas.getContext("2d")!;
    let game = new Game();
    let origin = 0,
      frame = 0,
      ended = false,
      lastUpdate = 0,
      lastStats = "";
    let cssWidth = 1000,
      cssHeight = 640,
      dpr = 1,
      keyboardMode = false;
    let keyboardX = 500,
      keyboardY = 320;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    function finish() {
      if (ended || game.phase !== "over") return;
      ended = true;
      sound.drip(game.player.x / game.width, true);
      sound.stop();
      callbacks.current.onEnd({
        score: game.score,
        clicks: game.clicks,
        milliseconds: Math.round(game.time),
        moves: [...game.moves],
        interrupted: game.endReason === "interrupted",
        bounds: { width: game.width, height: game.height },
      });
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
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
        );
        keyboardX = game.width / 2;
        keyboardY = game.height / 2;
      }
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
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
          6,
          Math.min(
            game.width - 6,
            keyboardX +
              (event.key === "ArrowRight"
                ? 45
                : event.key === "ArrowLeft"
                  ? -45
                  : 0),
          ),
        );
        keyboardY = Math.max(
          6,
          Math.min(
            game.height - 6,
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
      const x =
        event instanceof PointerEvent
          ? ((event.clientX - rect.left) / rect.width) * game.width
          : keyboardX;
      const y =
        event instanceof PointerEvent
          ? ((event.clientY - rect.top) / rect.height) * game.height
          : keyboardY;
      if (x < 6 || x > game.width - 6 || y < 6 || y > game.height - 6) return;
      const starting = game.phase === "idle";
      if (starting) {
        origin = performance.now();
        void sound.start();
      }
      if (game.move(x, y, starting ? 0 : performance.now() - origin)) {
        if (starting)
          callbacks.current.onStart({ width: game.width, height: game.height });
        sound.drip(x / game.width);
        callbacks.current.onStats({
          score: game.score,
          clicks: game.clicks,
          time: game.time,
          phase: game.phase,
        });
      }
      finish();
    };
    canvas.addEventListener("pointerdown", input);
    canvas.addEventListener("keydown", input);
    const render = (now: number) => {
      if (game.phase === "playing") game.advance(now - origin);
      finish();
      const scaleX = cssWidth / game.width,
        scaleY = cssHeight / game.height;
      const scale = Math.min(scaleX, scaleY);
      ctx.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
      ctx.clearRect(0, 0, game.width, game.height);
      ctx.save();
      if (game.phase === "idle") {
        const shift = motionQuery.matches ? 0 : Math.sin(now / 4500) * 2;
        const cx = game.width * 0.73,
          cy = game.height * 0.49;
        for (const [i, r] of [
          25, 57, 105, 166, 244, 340, 455, 590, 744,
        ].entries()) {
          sketchCircle(
            ctx,
            cx,
            cy,
            r + shift * (i / 9),
            i * 1.9,
            0.22 - i * 0.017,
            scale,
          );
        }
        ctx.fillStyle = "#dce5d2";
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (const wave of game.waves) {
          const age = game.time - wave.t;
          const r = (age / 1000) * SPEED;
          const opacity = 0.6 * Math.min(1, (LIFETIME - age) / 1000);
          for (const source of wave.sources) {
            if (
              source.x + r < 0 ||
              source.x - r > game.width ||
              source.y + r < 0 ||
              source.y - r > game.height
            )
              continue;
            sketchCircle(
              ctx,
              source.x,
              source.y,
              r,
              wave.id * 1.5,
              opacity,
              scale,
            );
          }
        }
        const px = game.player.x,
          py = game.player.y;
        ctx.fillStyle = "#e6ecdf";
        ctx.beginPath();
        ctx.ellipse(px, py, 4.0, 3.8, 0.3, 0, Math.PI * 2);
        ctx.fill();
        if (game.phase === "over") {
          ctx.strokeStyle = "#9eae90";
          ctx.lineWidth = 1 / scale;
          ctx.beginPath();
          ctx.arc(px, py, 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (
        keyboardMode &&
        document.activeElement === canvas &&
        game.phase !== "over"
      ) {
        ctx.strokeStyle = "rgba(173, 194, 154, .65)";
        ctx.lineWidth = 0.9 / scale;
        ctx.beginPath();
        ctx.arc(keyboardX, keyboardY, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      if (now - lastUpdate > 40) {
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
      aria-label="Ripple game. Click or tap to start and move. Arrow keys aim; Enter or Space moves. Avoid the circular waves. Your score is clicks times seconds."
    />
  );
}
