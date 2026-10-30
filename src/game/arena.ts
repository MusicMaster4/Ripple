export type Point = { x: number; y: number };
export type Obstacle = Point & {
  width: number;
  height: number;
  shape?: "circle";
  vertices?: Point[];
};
export type WaveSource = Point;

export function validateSeed(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("Invalid map seed.");
}

function edgeDistance(x: number, y: number, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const square = dx * dx + dy * dy;
  const t = square
    ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / square))
    : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

/** The same contour controls clicks, solid fluid cells, and the canvas silhouette. */
export function pointInObstacle(
  x: number,
  y: number,
  b: Obstacle,
  padding = 0,
) {
  if (
    x < b.x - padding ||
    x > b.x + b.width + padding ||
    y < b.y - padding ||
    y > b.y + b.height + padding
  )
    return false;
  if (b.shape === "circle")
    return (
      Math.hypot(x - b.x - b.width / 2, y - b.y - b.height / 2) <=
      b.width / 2 + padding
    );
  if (!b.vertices) return true;
  let inside = false;
  for (let i = 0, j = b.vertices.length - 1; i < b.vertices.length; j = i++) {
    const a = b.vertices[j],
      c = b.vertices[i];
    if (edgeDistance(x, y, a, c) <= padding + 1e-8) return true;
    if (
      a.y > y !== c.y > y &&
      x < ((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function obstacleArea(b: Obstacle) {
  if (b.shape === "circle") return Math.PI * (b.width / 2) ** 2;
  if (!b.vertices) return b.width * b.height;
  let area = 0;
  for (let i = 0; i < b.vertices.length; i++) {
    const a = b.vertices[i],
      c = b.vertices[(i + 1) % b.vertices.length];
    area += a.x * c.y - c.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Same seed and viewport always reproduce the same arbitrary blocked areas. */
export function generateObstacles(width: number, height: number, seed: number) {
  validateSeed(seed);
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  if (random() < 0.18) return [];
  const count = 2 + Math.floor(random() * 3);
  const short = Math.min(width, height),
    gap = Math.max(24, short * 0.065);
  const obstacles: Obstacle[] = [];
  let area = 0;
  for (let attempt = 0; attempt < 140 && obstacles.length < count; attempt++) {
    const kind = Math.floor(random() * 10);
    const size = short * (0.1 + random() * 0.26);
    const angle = random() * Math.PI * 2;
    let points: Point[] | undefined,
      diameter = 0;
    if (kind === 0) diameter = size;
    else if (kind >= 6) {
      // Long walls, tapered needles, arcs, and sinuous ribbons. Their thickness
      // is independent of length, so maps are not just scattered chunky blocks.
      const length = Math.max(48, short * (0.3 + random() * 0.48));
      const thickness = Math.max(10, short * (0.018 + random() * 0.035));
      if (kind === 6)
        points = [
          { x: 0, y: -thickness / 2 },
          { x: length, y: -thickness / 2 },
          { x: length, y: thickness / 2 },
          { x: 0, y: thickness / 2 },
        ];
      else if (kind === 7)
        points = [
          { x: 0, y: -thickness / 2 },
          { x: length, y: 0 },
          { x: 0, y: thickness / 2 },
        ];
      else {
        const bend = length * (0.12 + random() * 0.18);
        const turns = kind === 8 ? 1 : 1.7;
        const upper: Point[] = [],
          lower: Point[] = [];
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const y = Math.sin(t * Math.PI * turns) * bend;
          const slope =
            (Math.cos(t * Math.PI * turns) * bend * Math.PI * turns) / length;
          const nx = -slope / Math.hypot(1, slope),
            ny = 1 / Math.hypot(1, slope);
          upper.push({
            x: t * length + (nx * thickness) / 2,
            y: y + (ny * thickness) / 2,
          });
          lower.push({
            x: t * length - (nx * thickness) / 2,
            y: y - (ny * thickness) / 2,
          });
        }
        points = [...upper, ...lower.reverse()];
      }
    } else if (kind <= 2) {
      const w = size * (kind === 1 ? 1.5 : 1),
        h = size * (kind === 1 ? 0.55 : 1);
      points = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    } else {
      const count =
        kind === 3 ? 3 : kind === 4 ? 5 : 8 + Math.floor(random() * 5);
      points = Array.from({ length: count }, (_, i) => {
        const a = (i * Math.PI * 2) / count;
        const r = (size / 2) * (kind === 5 ? 0.5 + random() * 0.5 : 1);
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
    }
    if (points)
      points = points.map((p) => ({
        x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
        y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
      }));
    const minX = points ? Math.min(...points.map((p) => p.x)) : 0;
    const minY = points ? Math.min(...points.map((p) => p.y)) : 0;
    let w = points ? Math.max(...points.map((p) => p.x)) - minX : diameter;
    let h = points ? Math.max(...points.map((p) => p.y)) - minY : diameter;
    const scale = Math.min(
      1,
      (width - 2 * gap) / w,
      (height - 2 * gap) / h,
      (width * (kind >= 6 ? 0.6 : 0.32)) / w,
      (height * (kind >= 6 ? 0.6 : 0.32)) / h,
    );
    w *= scale;
    h *= scale;
    const b: Obstacle = {
      x: gap + random() * (width - w - 2 * gap),
      y: gap + random() * (height - h - 2 * gap),
      width: w,
      height: h,
    };
    if (points)
      b.vertices = points.map((p) => ({
        x: b.x + (p.x - minX) * scale,
        y: b.y + (p.y - minY) * scale,
      }));
    else b.shape = "circle";
    const blocked = obstacleArea(b);
    if (area + blocked > width * height * 0.16) continue;
    if (pointInObstacle(width / 2, height / 2, b, 28)) continue;
    if (
      obstacles.some(
        (other) =>
          b.x < other.x + other.width + gap &&
          b.x + w + gap > other.x &&
          b.y < other.y + other.height + gap &&
          b.y + h + gap > other.y,
      )
    )
      continue;
    obstacles.push(b);
    area += blocked;
  }
  return obstacles;
}
