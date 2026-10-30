import { PAPER, PAPER_RGB, fibre, inkBlot } from "./ink";
import { RAIN_FALL, RAIN_WARNING, type RainDrop } from "./rain";

const TAU = Math.PI * 2;
// The same vermilion used when a wave approaches the player.
const WARNING_RGB = "238, 55, 55";
const WARNING = `rgb(${WARNING_RGB})`;

/** Open, slightly uneven ink outline: no badge or opaque backing. */
function warningMark(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.3, -11);
  ctx.lineTo(11.5, 9);
  ctx.quadraticCurveTo(12.2, 10.5, 10.5, 10.5);
  ctx.lineTo(-10.8, 10.1);
  ctx.quadraticCurveTo(-12.3, 10, -11.4, 8.6);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.2, -3.5);
  ctx.lineTo(0.1, 2.4);
  ctx.stroke();
  inkBlot(ctx, 0, 6.2, 1.15, 3);
}

/** A white alert fills red from the bottom, then releases a white droplet. */
export function drawRain(
  ctx: CanvasRenderingContext2D,
  drops: RainDrop[],
  time: number,
  reducedMotion: boolean,
) {
  for (const drop of drops) {
    const age = time - drop.t;
    if (age < 0 || time >= drop.impactAt) continue;
    const falling = age >= RAIN_WARNING;
    const progress = Math.max(0, Math.min(1, (age - RAIN_WARNING) / RAIN_FALL));
    const warningProgress = Math.max(0, Math.min(1, age / RAIN_WARNING));
    ctx.save();
    ctx.translate(drop.x, drop.y);

    ctx.save();
    // Once full, keep the red landing mark visible as the white drop falls.
    ctx.globalAlpha = falling ? 1 - progress * progress : 1;
    ctx.fillStyle = ctx.strokeStyle = PAPER;
    warningMark(ctx);
    // Repaint only the lower part of the mark, leaving the water visible through it.
    ctx.beginPath();
    ctx.rect(-14, 12 - warningProgress * 24, 28, warningProgress * 24);
    ctx.clip();
    ctx.fillStyle = ctx.strokeStyle = WARNING;
    warningMark(ctx);
    ctx.restore();

    if (falling && !reducedMotion) {
      const y = (-drop.y - 24) * (1 - progress * progress);
      const stretch = 1 + Math.sin(progress * Math.PI) * 0.85;
      // Unequal, broken brush hairs follow the same vertical trajectory as the drop.
      for (let i = 3; i >= 1; i--) {
        ctx.save();
        ctx.translate((i % 2 ? -1 : 1) * 0.8, y - 16 - i * 7);
        ctx.scale(0.35, 1.5 + progress);
        ctx.fillStyle = `rgba(${PAPER_RGB}, ${(4 - i) * 0.16})`;
        inkBlot(ctx, 0, 0, 1.8 - i * 0.25, drop.id + i);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(0, y - 5);
      ctx.scale(1, stretch);
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * TAU;
        const grain =
          1 +
          fibre(Math.sin(a) * 40, Math.cos(a) * 48, drop.id) * 0.07 +
          Math.sin(a * 11 + drop.id) * 0.018;
        const x = Math.sin(a) * 4.6 * (1 - 0.65 * Math.cos(a)) * grain;
        const dy = -Math.cos(a) * 8 * grain;
        if (i === 0) ctx.moveTo(x, dy);
        else ctx.lineTo(x, dy);
      }
      ctx.closePath();
      ctx.fill();
      // A graphite incision makes the droplet feel printed rather than glossy.
      ctx.strokeStyle = `rgba(21, 21, 21, .65)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-1, -2);
      ctx.quadraticCurveTo(-3, 2, -1.5, 5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}
