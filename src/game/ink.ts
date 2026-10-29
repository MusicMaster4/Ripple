export const INK = "#151515";
export const PAPER = "#f5f5f5";
export const INK_RGB = "21, 21, 21";
export const PAPER_RGB = "245, 245, 245";

/**
 * A static field of overlapping plane waves. Rings sample it in world space,
 * so their thickness changes as they cross the "paper", like ink soaking into
 * uneven fibres, instead of every ring sharing the same pattern.
 */
export function fibre(x: number, y: number, seed: number) {
  return (
    (Math.sin(x * 0.061 + y * 0.023 + seed) +
      Math.sin(x * -0.029 + y * 0.072 + seed * 1.7) +
      Math.sin(x * 0.11 - y * 0.097 + seed * 2.9) * 0.6) /
    2.6
  );
}

/**
 * An uneven brush stroke around a circle. Drawn as one filled ribbon so the
 * width can swell and pinch along its length.
 */
export function brushRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  width: number,
  seed: number,
) {
  if (r <= 0.5) return;
  const steps = Math.max(36, Math.min(260, Math.ceil((Math.PI * 2 * r) / 12)));
  const outer: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    const px = x + c * r,
      py = y + s * r;
    const f = fibre(px, py, seed);
    const wobble = fibre(py * 0.5, px * 0.5, seed + 3) * 0.9;
    const half = (width / 2) * (0.62 + 0.38 * f);
    const mid = r + wobble;
    outer.push(x + c * (mid + half), y + s * (mid + half));
    inner.push(
      x + c * Math.max(0, mid - half),
      y + s * Math.max(0, mid - half),
    );
  }
  ctx.beginPath();
  ctx.moveTo(outer[0], outer[1]);
  for (let i = 2; i < outer.length; i += 2) ctx.lineTo(outer[i], outer[i + 1]);
  ctx.closePath();
  // Inner edge in reverse winding cuts the hole under the nonzero rule.
  ctx.moveTo(inner[inner.length - 2], inner[inner.length - 1]);
  for (let i = inner.length - 4; i >= 0; i -= 2)
    ctx.lineTo(inner[i], inner[i + 1]);
  ctx.closePath();
  ctx.fill();
}

/** A stray brush hair beside the main stroke. */
export function hairRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  if (r <= 2) return;
  const steps = Math.max(28, Math.min(160, Math.ceil((Math.PI * 2 * r) / 20)));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = x + Math.cos(a) * r,
      py = y + Math.sin(a) * r;
    const off = 2.6 + fibre(px, py, seed + 7) * 1.6;
    const qx = x + Math.cos(a) * (r + off),
      qy = y + Math.sin(a) * (r + off);
    if (!i) ctx.moveTo(qx, qy);
    else ctx.lineTo(qx, qy);
  }
  ctx.stroke();
}

/** A blot of ink with a slightly torn edge. */
export function inkBlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  ctx.beginPath();
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr =
      r *
      (1 +
        Math.sin(a * 3 + seed) * 0.06 +
        Math.sin(a * 7 - seed * 2) * 0.05 +
        Math.sin(a * 13 + seed) * 0.03);
    const px = x + Math.cos(a) * rr,
      py = y + Math.sin(a) * rr;
    if (!i) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** The closed outline of spreading ink, with a ragged, fingered edge. */
export function floodPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  ctx.beginPath();
  const steps = 140;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr =
      r *
      (1 +
        Math.sin(a * 5 + seed) * 0.05 +
        Math.sin(a * 11 - seed * 1.3) * 0.035 +
        Math.max(0, Math.sin(a * 23 + seed * 3)) ** 6 * 0.09);
    const px = x + Math.cos(a) * rr,
      py = y + Math.sin(a) * rr;
    if (!i) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Stipple grain for the whole page: dense flecks of ink and paper, like a
 * photocopied zine. Returned as a data URL for a tiled CSS layer.
 */
export function grainTexture(size = 220) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let state = 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const roll = random();
    const o = i * 4;
    if (roll < 0.055) {
      image.data[o] = image.data[o + 1] = image.data[o + 2] = 21;
      image.data[o + 3] = 40 + random() * 70;
    } else if (roll > 0.955) {
      image.data[o] = image.data[o + 1] = image.data[o + 2] = 245;
      image.data[o + 3] = 30 + random() * 60;
    }
  }
  ctx.putImageData(image, 0, 0);
  // A few heavier specks, like dust on the copier glass.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle =
      random() > 0.4 ? "rgba(21,21,21,.5)" : "rgba(245,245,245,.5)";
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, 0.6 + random() * 0.9, 0, 7);
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
}

/** A cursor that matches the player's dot. */
export function dotCursor(radius: number, color: string, ring = false) {
  const r = Math.max(3, Math.min(12, radius));
  const size = Math.ceil(r * 2 + (ring ? 14 : 4));
  const c = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" fill-opacity=".38"/>` +
    (ring
      ? `<circle cx="${c}" cy="${c}" r="${r + 5}" fill="none" stroke="${color}" stroke-opacity=".38" stroke-width="1.4"/>`
      : "") +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}`;
}
