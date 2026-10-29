import { useEffect, useRef } from "react";
import { INK_RGB, PAPER_RGB } from "../game/ink";
import { sound } from "../lib/audio";

type Ring = { x: number; y: number; born: number; amp: number };

/** Separable box blur, applied twice: a cheap stand-in for a Gaussian. */
function blur(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const tmp = new Float32Array(src.length);
  let out: Float32Array = src;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -radius; x <= radius; x++)
        acc += out[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (radius * 2 + 1);
        acc +=
          out[y * w + Math.min(w - 1, x + radius + 1)] -
          out[y * w + Math.max(0, x - radius)];
      }
    }
    const next = new Float32Array(src.length);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++)
        acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        next[y * w + x] = acc / (radius * 2 + 1);
        acc +=
          tmp[Math.min(h - 1, y + radius + 1) * w + x] -
          tmp[Math.max(0, y - radius) * w + x];
      }
    }
    out = next;
  }
  return out;
}

/**
 * A dark page of ruled chalk-white lines. The title is embossed into them, and ripples
 * pass through like a stone dropped into a drawing. Lower lines occlude the
 * ones behind them, so the raised letters read as relief.
 */
export function LineField({
  title,
  inverted = false,
  interactive = true,
  strength = 1,
}: {
  title?: string;
  inverted?: boolean;
  interactive?: boolean;
  strength?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Dark page, light lines; `inverted` flips to ink on paper.
    const ink = inverted ? INK_RGB : PAPER_RGB;
    const paper = inverted ? PAPER_RGB : INK_RGB;
    let width = 0,
      height = 0,
      dpr = 1,
      frame = 0,
      gap = 9,
      step = 4,
      lift = 12;
    // Low-resolution title masks: crisp for line weight, blurred for relief.
    let maskW = 0,
      maskH = 0,
      maskScale = 3;
    let mask: Float32Array = new Float32Array(0),
      relief: Float32Array = new Float32Array(0);
    let centerX = 0,
      centerY = 0;
    const rings: Ring[] = [];
    let lastAmbient = -Infinity,
      lastTrail = 0,
      trailX = -1e9,
      trailY = -1e9;
    let disposed = false;

    const buildMasks = () => {
      maskScale = width > 900 ? 3 : 2;
      maskW = Math.ceil(width / maskScale);
      maskH = Math.ceil(height / maskScale);
      mask = new Float32Array(maskW * maskH);
      relief = mask;
      if (!title) return;
      const off = document.createElement("canvas");
      off.width = maskW;
      off.height = maskH;
      const o = off.getContext("2d")!;
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.font = `100px Anton, Impact, sans-serif`;
      const measured = o.measureText(title).width / 100;
      const size = Math.min((maskW * 0.84) / measured, maskH * 0.5);
      o.font = `${size}px Anton, Impact, sans-serif`;
      o.fillText(title, maskW / 2, centerY / maskScale);
      const data = o.getImageData(0, 0, maskW, maskH).data;
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] / 255;
      relief = blur(mask, maskW, maskH, Math.max(2, Math.round(size / 26)));
    };
    const sample = (field: Float32Array, x: number, y: number) => {
      const mx = Math.min(maskW - 1, Math.max(0, Math.round(x / maskScale)));
      const my = Math.min(maskH - 1, Math.max(0, Math.round(y / maskScale)));
      return field[my * maskW + mx] || 0;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gap = Math.max(6.5, Math.min(11, height / 96));
      step = width > 1400 ? 4 : 3;
      lift = gap * 1.45;
      centerX = width / 2;
      centerY = height * 0.42;
      buildMasks();
    };
    const drop = (x: number, y: number, amp: number, born: number) => {
      rings.push({ x, y, born, amp });
      if (rings.length > 14) rings.shift();
    };
    const displacement = (x: number, y: number, now: number) => {
      let h = 0;
      for (const ring of rings) {
        const age = (now - ring.born) / 1000;
        const front = age * 150;
        const d = Math.hypot(x - ring.x, y - ring.y) - front;
        if (d > 90 || d < -260) continue;
        const env = Math.exp(-age / 2.6) * ring.amp;
        // A leading crest followed by a few trailing wavelets.
        h +=
          env *
          Math.exp(-((d / 70) ** 2)) *
          Math.cos(d / 11) *
          (d > 0 ? Math.exp(-d / 25) : 1);
      }
      return h;
    };
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${paper})`;
      ctx.fillRect(0, 0, width, height);
      for (let i = rings.length - 1; i >= 0; i--)
        if (now - rings[i].born > 9000) rings.splice(i, 1);
      const xs: number[] = [];
      const ys: number[] = [];
      const ws: number[] = [];
      const base = 0.9 * strength;
      for (let y0 = gap * 0.6; y0 < height + gap * 3; y0 += gap) {
        xs.length = ys.length = ws.length = 0;
        for (let x = -step; x <= width + step; x += step) {
          const raised = sample(relief, x, y0);
          const inside = sample(mask, x, y0 - raised * lift);
          const y =
            y0 - raised * lift - displacement(x, y0, now) * (1 - raised * 0.5);
          xs.push(x);
          ys.push(y);
          ws.push(base + inside * gap * 0.42 + raised * 0.5);
        }
        // Paper under the line hides whatever lies behind a raised crest.
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
        ctx.lineTo(width + step, height + gap * 4);
        ctx.lineTo(-step, height + gap * 4);
        ctx.closePath();
        ctx.fillStyle = `rgb(${paper})`;
        ctx.fill();
        // The line itself is a ribbon so its weight can swell inside the letters.
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0] - ws[0] / 2);
        for (let i = 1; i < xs.length; i++)
          ctx.lineTo(xs[i], ys[i] - ws[i] / 2);
        for (let i = xs.length - 1; i >= 0; i--)
          ctx.lineTo(xs[i], ys[i] + ws[i] / 2);
        ctx.closePath();
        ctx.fillStyle = `rgb(${ink})`;
        ctx.fill();
      }
    };
    const loop = (now: number) => {
      if (disposed) return;
      if (!reduced.matches && now - lastAmbient > 2600) {
        lastAmbient = now;
        drop(centerX, centerY, 9 * strength, now);
      }
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    const move = (event: PointerEvent) => {
      if (!interactive || reduced.matches) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      const now = performance.now();
      if (now - lastTrail < 110 || Math.hypot(x - trailX, y - trailY) < 40)
        return;
      lastTrail = now;
      trailX = x;
      trailY = y;
      drop(x, y, 3.2, now);
    };
    const press = (event: PointerEvent) => {
      if (!interactive || event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      drop(x, y, 13, performance.now());
      void sound.drip(x / rect.width);
      if (reduced.matches) draw(performance.now());
    };
    const observer = new ResizeObserver(() => {
      resize();
      if (reduced.matches) draw(performance.now());
    });
    observer.observe(canvas);
    resize();
    // The title mask needs the display face; rebuild once it has loaded.
    void document.fonts?.load("100px Anton").then(() => {
      if (disposed) return;
      buildMasks();
      if (reduced.matches) draw(performance.now());
    });
    window.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", press);
    if (reduced.matches) draw(performance.now());
    else frame = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", press);
    };
  }, [title, inverted, interactive, strength]);
  return <canvas ref={ref} className="line-field" aria-hidden="true" />;
}
