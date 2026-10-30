import { pointInObstacle, type Obstacle, type Point } from "./arena";

// Fixed physical timesteps make browser play and server replay identical.
// c*dt*sqrt(1/dx² + 1/dy²) stays below 1 (the 2-D CFL stability bound).
export const WATER_STEP = 50;
export const WATER_CELL = 4;
export const WATER_PULSE = 12;
export const WATER_LEVEL = 0.055;
/** Weak velocity diffusion damps grid-scale ringing rather than creating extra crests. */
export const WATER_VISCOSITY = 6.4;

const MIN_FRONT_LENGTH = WATER_PULSE * 3;
const FRONT_STRIDE = 24; // Four corners, six temporal coefficients per corner.
const CORNER_X = [0, 1, 1, 0];
const CORNER_Y = [0, 0, 1, 1];
const PROBE_X = new Float64Array(17);
const PROBE_Y = new Float64Array(17);
for (let i = 0; i < 16; i++) {
  PROBE_X[i + 1] = Math.cos((i * Math.PI) / 8);
  PROBE_Y[i + 1] = Math.sin((i * Math.PI) / 8);
}

/** Exact contour/AABB intersection keeps sub-cell walls in the physical grid. */
function cellIntersectsObstacle(
  left: number,
  top: number,
  right: number,
  bottom: number,
  b: Obstacle,
) {
  if (
    right < b.x ||
    left > b.x + b.width ||
    bottom < b.y ||
    top > b.y + b.height
  )
    return false;
  if (!b.shape && !b.vertices) return true;
  if (b.shape === "circle") {
    const cx = b.x + b.width / 2,
      cy = b.y + b.height / 2,
      x = Math.max(left, Math.min(right, cx)),
      y = Math.max(top, Math.min(bottom, cy));
    return (x - cx) ** 2 + (y - cy) ** 2 <= (b.width / 2) ** 2;
  }
  const vertices = b.vertices!;
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  if (pointInObstacle(cx, cy, b)) return true;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      c = vertices[(i + 1) % vertices.length];
    if (a.x >= left && a.x <= right && a.y >= top && a.y <= bottom) return true;
    // Liang-Barsky clips the contour edge against this grid cell.
    let enter = 0,
      leave = 1;
    const dx = c.x - a.x,
      dy = c.y - a.y;
    if (Math.abs(dx) < 1e-12) {
      if (a.x < left || a.x > right) continue;
    } else {
      let near = (left - a.x) / dx,
        far = (right - a.x) / dx;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      leave = Math.min(leave, far);
      if (enter > leave) continue;
    }
    if (Math.abs(dy) < 1e-12) {
      if (a.y >= top && a.y <= bottom) return true;
      continue;
    }
    let near = (top - a.y) / dy,
      far = (bottom - a.y) / dy;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    leave = Math.min(leave, far);
    if (enter <= leave) return true;
  }
  return false;
}

/** Linear, nondispersive shallow-water wave equation with zero normal flow at solids. */
export class WaterArena {
  readonly cols: number;
  readonly rows: number;
  readonly dx: number;
  readonly dy: number;
  readonly solid: Uint8Array;
  readonly left: Int32Array;
  readonly right: Int32Array;
  readonly up: Int32Array;
  readonly down: Int32Array;
  readonly fluid: Int32Array;
  readonly interior: Uint8Array;
  readonly frontVelocity: Float32Array;
  readonly frontAmplitude: Float32Array;
  readonly frontAcceleration: Float32Array;
  readonly frontVelocityEnd: Float32Array;
  readonly frontAmplitudeEnd: Float32Array;
  readonly frontAccelerationEnd: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly obstacles: Obstacle[],
    readonly speed: number,
  ) {
    this.cols = Math.ceil(width / WATER_CELL);
    this.rows = Math.ceil(height / WATER_CELL);
    this.dx = width / this.cols;
    this.dy = height / this.rows;
    const size = this.cols * this.rows;
    this.solid = new Uint8Array(size);
    this.interior = new Uint8Array(size);
    this.frontVelocity = new Float32Array(size);
    this.frontAmplitude = new Float32Array(size);
    this.frontAcceleration = new Float32Array(size);
    this.frontVelocityEnd = new Float32Array(size);
    this.frontAmplitudeEnd = new Float32Array(size);
    this.frontAccelerationEnd = new Float32Array(size);
    this.left = new Int32Array(size);
    this.right = new Int32Array(size);
    this.up = new Int32Array(size);
    this.down = new Int32Array(size);
    const fluid: number[] = [];
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        this.solid[i] = Number(
          obstacles.some((b) =>
            cellIntersectsObstacle(
              x * this.dx,
              y * this.dy,
              (x + 1) * this.dx,
              (y + 1) * this.dy,
              b,
            ),
          ),
        );
        if (!this.solid[i]) fluid.push(i);
      }
    this.fluid = new Int32Array(fluid);
    for (let i = 0; i < size; i++) {
      this.left[i] = this.right[i] = this.up[i] = this.down[i] = i;
    }
    for (const i of fluid) {
      const x = i % this.cols,
        y = Math.floor(i / this.cols);
      // A solid or outside neighbor mirrors the water cell: Neumann boundary,
      // zero flux through the face, and a reflected wave without phase inversion.
      this.left[i] = x > 0 && !this.solid[i - 1] ? i - 1 : i;
      this.right[i] = x + 1 < this.cols && !this.solid[i + 1] ? i + 1 : i;
      this.up[i] = y > 0 && !this.solid[i - this.cols] ? i - this.cols : i;
      this.down[i] =
        y + 1 < this.rows && !this.solid[i + this.cols] ? i + this.cols : i;
      this.interior[i] = Number(
        this.left[i] !== i &&
          this.right[i] !== i &&
          this.up[i] !== i &&
          this.down[i] !== i,
      );
    }
  }
}

export class WaterWave {
  private previous: Float32Array;
  private current: Float32Array;
  private next: Float32Array;
  /** The sparse initial pulse uses 25% less memory than a fourth full grid. */
  private readonly initial: Float32Array;
  private readonly initialWidth: number;
  private readonly initialMinX: number;
  private readonly initialMaxX: number;
  private readonly initialMinY: number;
  private readonly initialMaxY: number;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private reach = WATER_PULSE * 3;
  private step = 0;
  private readonly cx: number;
  private readonly cy: number;
  private readonly damping: number;
  private frontCache?: { age: number; segments: number[] };
  private candidateStep = -1;
  private spareCandidateStep = -1;
  private spareCandidateCount = 0;
  private spareCandidateCells = new Int32Array(0);
  private spareCandidateData = new Float32Array(0);
  private candidateCount = 0;
  private candidateCells = new Int32Array(0);
  private candidateData = new Float32Array(0);
  private readonly frontWorkspace = new FrontWorkspace();
  private readonly contactCache = new Map<number, number>();
  private contactPlayerX = NaN;
  private contactPlayerY = NaN;
  private contactRadius = NaN;

  constructor(
    readonly arena: WaterArena,
    readonly origin: Point,
  ) {
    const { cols, rows, dx, dy, solid } = arena;
    const size = cols * rows,
      reach = WATER_PULSE * 3;
    this.initialMinX = Math.max(0, Math.floor((origin.x - reach) / dx - 0.5));
    this.initialMaxX = Math.min(
      cols - 1,
      Math.ceil((origin.x + reach) / dx - 0.5),
    );
    this.initialMinY = Math.max(0, Math.floor((origin.y - reach) / dy - 0.5));
    this.initialMaxY = Math.min(
      rows - 1,
      Math.ceil((origin.y + reach) / dy - 0.5),
    );
    this.initialWidth = this.initialMaxX - this.initialMinX + 1;
    this.initial = new Float32Array(
      this.initialWidth * (this.initialMaxY - this.initialMinY + 1),
    );
    for (let y = this.initialMinY; y <= this.initialMaxY; y++)
      for (let x = this.initialMinX; x <= this.initialMaxX; x++) {
        const i = y * cols + x;
        if (solid[i]) continue;
        const px = (x + 0.5) * dx,
          py = (y + 0.5) * dy,
          distance = Math.hypot(px - origin.x, py - origin.y);
        if (distance > reach) continue;
        // Exact segment clipping cannot skip a wall thinner than a sampling step.
        let visible = true;
        for (const b of arena.obstacles) {
          if (
            Math.max(px, origin.x) < b.x ||
            Math.min(px, origin.x) > b.x + b.width ||
            Math.max(py, origin.y) < b.y ||
            Math.min(py, origin.y) > b.y + b.height
          )
            continue;
          const pieces = outsideObstacle(
            origin.x,
            origin.y,
            px - origin.x,
            py - origin.y,
            b,
          );
          let outside = 0;
          for (let k = 0; k < pieces.length; k += 2)
            outside += pieces[k + 1] - pieces[k];
          if (outside < 1 - 1e-8) {
            visible = false;
            break;
          }
        }
        if (visible)
          this.initial[
            (y - this.initialMinY) * this.initialWidth + x - this.initialMinX
          ] = Math.exp(
            (-distance * distance) / (2 * WATER_PULSE * WATER_PULSE),
          );
      }
    this.previous = new Float32Array(size);
    this.current = new Float32Array(size);
    this.next = new Float32Array(size);
    this.cx = ((arena.speed * WATER_STEP) / 1000 / dx) ** 2;
    this.cy = ((arena.speed * WATER_STEP) / 1000 / dy) ** 2;
    this.damping = WATER_VISCOSITY / ((arena.speed ** 2 * WATER_STEP) / 1000);
    this.reset();
  }

  private reset() {
    this.frontCache = undefined;
    this.candidateStep = -1;
    this.spareCandidateStep = -1;
    this.contactCache.clear();
    this.step = 0;
    this.current.fill(0);
    this.previous.fill(0);
    this.next.fill(0);
    for (let y = this.initialMinY; y <= this.initialMaxY; y++)
      for (let x = this.initialMinX; x <= this.initialMaxX; x++)
        this.current[y * this.arena.cols + x] =
          this.initial[
            (y - this.initialMinY) * this.initialWidth + x - this.initialMinX
          ];
    this.minX = this.initialMinX;
    this.maxX = this.initialMaxX;
    this.minY = this.initialMinY;
    this.maxY = this.initialMaxY;
    this.reach = WATER_PULSE * 3;
    // Zero initial velocity, using the symmetric half-Laplacian start.
    const a = this.arena,
      u = this.current;
    for (
      let y = Math.max(0, this.minY - 1);
      y <= Math.min(a.rows - 1, this.maxY + 1);
      y++
    )
      for (
        let x = Math.max(0, this.minX - 1);
        x <= Math.min(a.cols - 1, this.maxX + 1);
        x++
      ) {
        const i = y * a.cols + x;
        if (a.solid[i]) continue;
        this.previous[i] =
          u[i] +
          0.5 *
            (this.cx * (u[a.left[i]] + u[a.right[i]] - 2 * u[i]) +
              this.cy * (u[a.up[i]] + u[a.down[i]] - 2 * u[i]));
      }
  }

  private tick() {
    const a = this.arena,
      u = this.current,
      p = this.previous,
      n = this.next,
      left = a.left,
      right = a.right,
      up = a.up,
      down = a.down,
      solid = a.solid,
      cx = this.cx,
      cy = this.cy,
      damping = this.damping,
      interior = a.interior,
      cols = a.cols;
    // The five-point stencil can only advance one cell per tick. Restricting
    // work to this causal box is exact, including around reflected fronts.
    this.minX = Math.max(0, this.minX - 1);
    this.maxX = Math.min(a.cols - 1, this.maxX + 1);
    this.minY = Math.max(0, this.minY - 1);
    this.maxY = Math.min(a.rows - 1, this.maxY + 1);
    this.reach += Math.max(a.dx, a.dy);
    for (let y = this.minY; y <= this.maxY; y++) {
      const py = (y + 0.5) * a.dy - this.origin.y,
        remaining = this.reach * this.reach - py * py + 1e-6;
      if (remaining < 0) continue;
      const span = Math.sqrt(remaining),
        firstX = Math.max(
          this.minX,
          Math.ceil((this.origin.x - span) / a.dx - 0.5),
        ),
        lastX = Math.min(
          this.maxX,
          Math.floor((this.origin.x + span) / a.dx - 0.5),
        );
      for (let x = firstX; x <= lastX; x++) {
        const i = y * a.cols + x;
        if (solid[i]) continue;
        let lapU: number, lapP: number;
        if (interior[i]) {
          // The overwhelmingly common open-water stencil uses contiguous
          // offsets, avoiding eight dependent neighbor-index lookups per cell.
          lapU =
            cx * (u[i - 1] + u[i + 1] - 2 * u[i]) +
            cy * (u[i - cols] + u[i + cols] - 2 * u[i]);
          lapP =
            cx * (p[i - 1] + p[i + 1] - 2 * p[i]) +
            cy * (p[i - cols] + p[i + cols] - 2 * p[i]);
        } else {
          lapU =
            cx * (u[left[i]] + u[right[i]] - 2 * u[i]) +
            cy * (u[up[i]] + u[down[i]] - 2 * u[i]);
          lapP =
            cx * (p[left[i]] + p[right[i]] - 2 * p[i]) +
            cy * (p[up[i]] + p[down[i]] - 2 * p[i]);
        }
        n[i] = 2 * u[i] - p[i] + lapU + damping * (lapU - lapP);
      }
    }
    this.previous = u;
    this.current = n;
    this.next = p;
    this.step++;
  }

  setAge(age: number) {
    const step = Math.max(0, Math.ceil(age / WATER_STEP));
    if (step < this.step - 1) this.reset();
    while (this.step < step) this.tick();
  }

  // Cylindrical spreading is compensated only for drawing and game contact.
  // The solver itself retains physical attenuation and diffraction.
  private gain(age: number) {
    return Math.sqrt(
      1 + (this.arena.speed * Math.max(0, age)) / 1000 / WATER_PULSE,
    );
  }

  private sample(field: Float32Array, p: Point) {
    const a = this.arena;
    const gx = Math.max(0, Math.min(a.cols - 1, p.x / a.dx - 0.5));
    const gy = Math.max(0, Math.min(a.rows - 1, p.y / a.dy - 0.5));
    const x = Math.floor(gx),
      y = Math.floor(gy),
      tx = gx - x,
      ty = gy - y;
    const i = y * a.cols + x,
      right = Math.min(x + 1, a.cols - 1) + y * a.cols;
    const down = x + Math.min(y + 1, a.rows - 1) * a.cols;
    const corner =
      Math.min(x + 1, a.cols - 1) + Math.min(y + 1, a.rows - 1) * a.cols;
    return (
      field[i] * (1 - tx) * (1 - ty) +
      field[right] * tx * (1 - ty) +
      field[down] * (1 - tx) * ty +
      field[corner] * tx * ty
    );
  }

  /** Surface displacement for diagnostics; interpolated on the fixed simulation clock. */
  valueAt(p: Point, age: number) {
    this.setAge(age);
    const step = Math.max(0, Math.ceil(age / WATER_STEP));
    if (step === 0)
      return this.sample(this.step ? this.previous : this.current, p);
    const previous = step < this.step ? this.next : this.previous;
    const current = step < this.step ? this.previous : this.current;
    const f = age / WATER_STEP - (step - 1);
    return this.sample(previous, p) * (1 - f) + this.sample(current, p) * f;
  }

  private laplacian(field: Float32Array, p: Point) {
    const a = this.arena;
    const gx = Math.max(0, Math.min(a.cols - 1, p.x / a.dx - 0.5));
    const gy = Math.max(0, Math.min(a.rows - 1, p.y / a.dy - 0.5));
    const x = Math.floor(gx),
      y = Math.floor(gy),
      tx = gx - x,
      ty = gy - y;
    const lap = (i: number) =>
      this.cx * (field[a.left[i]] + field[a.right[i]] - 2 * field[i]) +
      this.cy * (field[a.up[i]] + field[a.down[i]] - 2 * field[i]);
    const i = y * a.cols + x,
      r = Math.min(x + 1, a.cols - 1) + y * a.cols;
    const d = x + Math.min(y + 1, a.rows - 1) * a.cols;
    const c =
      Math.min(x + 1, a.cols - 1) + Math.min(y + 1, a.rows - 1) * a.cols;
    return (
      lap(i) * (1 - tx) * (1 - ty) +
      lap(r) * tx * (1 - ty) +
      lap(d) * (1 - tx) * ty +
      lap(c) * tx * ty
    );
  }

  private velocityAt(
    p: Point,
    fraction: number,
    previous = this.previous,
    current = this.current,
  ) {
    const lapP = this.laplacian(previous, p),
      lapU = this.laplacian(current, p);
    const damping = this.damping * (lapU - lapP);
    return (
      this.sample(current, p) -
      this.sample(previous, p) +
      0.5 * (fraction * (lapU + damping) - (1 - fraction) * (lapP + damping))
    );
  }

  // A temporal maximum is not necessarily a traveling crest. Interference can
  // turn a whole patch around at once and make its zero-velocity contour jump.
  // The level-set transport speed must agree with the water propagation speed.
  private travelsAtWaterSpeed(acceleration: number, gx: number, gy: number) {
    const gradientSquare = gx * gx + gy * gy;
    const transportSquare = (acceleration / (WATER_STEP / 1000)) ** 2;
    return (
      gradientSquare > 0 &&
      Number.isFinite(transportSquare) &&
      transportSquare >= (this.arena.speed * 0.3) ** 2 * gradientSquare &&
      transportSquare <= (this.arena.speed * 1.6) ** 2 * gradientSquare
    );
  }

  private travelingAt(
    p: Point,
    fraction: number,
    acceleration: number,
    previous = this.previous,
    current = this.current,
  ) {
    const { dx, dy } = this.arena;
    const gx =
      (this.velocityAt({ x: p.x + dx, y: p.y }, fraction, previous, current) -
        this.velocityAt({ x: p.x - dx, y: p.y }, fraction, previous, current)) /
      (2 * dx);
    const gy =
      (this.velocityAt({ x: p.x, y: p.y + dy }, fraction, previous, current) -
        this.velocityAt({ x: p.x, y: p.y - dy }, fraction, previous, current)) /
      (2 * dy);
    return this.travelsAtWaterSpeed(acceleration, gx, gy);
  }

  /** Collision follows a single positive crest, never both sides of an amplitude band. */
  firstContact(
    p: Point,
    from: number,
    to: number,
    armed: number,
    radius: number,
  ) {
    const start = Math.max(from, armed);
    if (to < start) {
      this.setAge(Math.max(0, to));
      return Infinity;
    }
    if (from === to)
      return this.distanceToFront(p, to, radius + WATER_CELL * 2) <= radius
        ? to
        : Infinity;
    if (
      from < armed &&
      this.distanceToFront(p, armed, radius + WATER_CELL * 2) <= radius
    )
      return armed;
    if (
      this.contactPlayerX !== p.x ||
      this.contactPlayerY !== p.y ||
      this.contactRadius !== radius
    ) {
      this.contactCache.clear();
      this.contactPlayerX = p.x;
      this.contactPlayerY = p.y;
      this.contactRadius = radius;
    }
    const probe = { x: p.x, y: p.y };
    let cursor = start;
    do {
      const upper = Math.floor(cursor / WATER_STEP) + 1;
      this.setAge(upper * WATER_STEP);
      const previous = upper < this.step ? this.next : this.previous;
      const current = upper < this.step ? this.previous : this.current;
      const lowerTime = (upper - 1) * WATER_STEP,
        upperTime = upper * WATER_STEP,
        end = Math.min(to, upperTime);
      let contact = this.contactCache.get(upper);
      if (contact === undefined) {
        contact = Infinity;
        for (let k = 0; k < PROBE_X.length; k++) {
          probe.x = p.x + PROBE_X[k] * radius;
          probe.y = p.y + PROBE_Y[k] * radius;
          const lo = this.sample(previous, probe),
            hi = this.sample(current, probe);
          const rawLo = this.laplacian(previous, probe),
            rawHi = this.laplacian(current, probe);
          const diffusion = this.damping * (rawHi - rawLo);
          const lapLo = rawLo + diffusion,
            lapHi = rawHi + diffusion;
          const vLo = hi - lo - 0.5 * lapLo,
            vHi = hi - lo + 0.5 * lapHi;
          // The positive maximum is the traveling water crest. Negative troughs,
          // its leading/trailing amplitude edges, and numerical tails are excluded.
          if (vLo <= 0 || vHi > 0 || vLo === vHi) continue;
          const f = vLo / (vLo - vHi);
          const crossing = lowerTime + f * WATER_STEP;
          const amplitude = (lo + (hi - lo) * f) * this.gain(crossing);
          const acceleration = lapLo + (lapHi - lapLo) * f;
          if (
            amplitude >= WATER_LEVEL &&
            this.travelingAt(probe, f, acceleration, previous, current)
          )
            contact = Math.min(contact, crossing);
        }
        if (
          !Number.isFinite(contact) ||
          this.distanceToFront(p, contact, radius + WATER_CELL * 2) >
            radius + WATER_CELL / 8
        )
          contact = Infinity;
        // A stationary player sees the same fixed-timestep crossing on every
        // animation frame. Cache the physical result, not the requested range.
        this.contactCache.set(upper, contact);
      }
      if (contact >= cursor && contact <= end) return contact;
      cursor = upperTime;
      if (cursor >= to) break;
    } while (true);
    return Infinity;
  }

  /**
   * Only cells whose velocity can cross zero during this fixed timestep can
   * contain a crest. Compact their temporal coefficients once, then interpolate
   * this narrow band at the display's refresh rate, without scanning the grid.
   * The scratch grids belong to the arena; each wave retains only its band.
   */
  private prepareFront(step: number, p: Float32Array, u: Float32Array) {
    if (this.candidateStep === step) return;
    [this.candidateStep, this.spareCandidateStep] = [
      this.spareCandidateStep,
      this.candidateStep,
    ];
    [this.candidateCount, this.spareCandidateCount] = [
      this.spareCandidateCount,
      this.candidateCount,
    ];
    [this.candidateCells, this.spareCandidateCells] = [
      this.spareCandidateCells,
      this.candidateCells,
    ];
    [this.candidateData, this.spareCandidateData] = [
      this.spareCandidateData,
      this.candidateData,
    ];
    if (this.candidateStep === step) return;
    const a = this.arena;
    const reach = ((step * WATER_STEP) / 1000) * a.speed + WATER_PULSE * 4;
    const firstX = Math.max(
      0,
      Math.floor((this.origin.x - reach) / a.dx - 0.5),
    );
    const lastX = Math.min(
      a.cols - 1,
      Math.ceil((this.origin.x + reach) / a.dx) + 1,
    );
    const firstY = Math.max(
      0,
      Math.floor((this.origin.y - reach) / a.dy - 0.5),
    );
    const lastY = Math.min(
      a.rows - 1,
      Math.ceil((this.origin.y + reach) / a.dy) + 1,
    );
    const v0 = a.frontVelocity,
      v1 = a.frontVelocityEnd;
    const h0 = a.frontAmplitude,
      h1 = a.frontAmplitudeEnd;
    const acc0 = a.frontAcceleration,
      acc1 = a.frontAccelerationEnd;
    this.candidateCount = 0;
    const level = WATER_LEVEL / this.gain(step * WATER_STEP);
    // A height bound cheaply rejects whole tiles before any Laplacians are
    // evaluated. The halo includes every corner and its solid-face mirror,
    // so a skipped tile provably cannot contain an above-threshold crest.
    for (let tileY = firstY; tileY < lastY; tileY += 8) {
      for (let tileX = firstX; tileX < lastX; tileX += 8) {
        const minX = tileX,
          maxX = Math.min(lastX, tileX + 8);
        const minY = tileY,
          maxY = Math.min(lastY, tileY + 8);
        let active = false;
        for (
          let y = Math.max(0, minY - 1);
          y <= Math.min(a.rows - 1, maxY + 1) && !active;
          y++
        ) {
          for (
            let x = Math.max(0, minX - 1);
            x <= Math.min(a.cols - 1, maxX + 1);
            x++
          ) {
            const i = y * a.cols + x;
            if (p[i] >= level || u[i] >= level) {
              active = true;
              break;
            }
          }
        }
        if (!active) continue;
        // One-cell halo supplies the mirror extension at solid contour vertices.
        for (
          let y = Math.max(0, minY - 1);
          y <= Math.min(a.rows - 1, maxY + 1);
          y++
        ) {
          for (
            let x = Math.max(0, minX - 1);
            x <= Math.min(a.cols - 1, maxX + 1);
            x++
          ) {
            const i = y * a.cols + x;
            if (a.solid[i]) continue;
            const lapP =
              this.cx * (p[a.left[i]] + p[a.right[i]] - 2 * p[i]) +
              this.cy * (p[a.up[i]] + p[a.down[i]] - 2 * p[i]);
            const lapU =
              this.cx * (u[a.left[i]] + u[a.right[i]] - 2 * u[i]) +
              this.cy * (u[a.up[i]] + u[a.down[i]] - 2 * u[i]);
            const diffusion = this.damping * (lapU - lapP);
            v0[i] = u[i] - p[i] - 0.5 * (lapP + diffusion);
            v1[i] = u[i] - p[i] + 0.5 * (lapU + diffusion);
            h0[i] = p[i];
            h1[i] = u[i];
            acc0[i] = lapP + diffusion;
            acc1[i] = lapU + diffusion;
          }
        }
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const i = y * a.cols + x;
            if (!a.solid[i]) continue;
            let count = 0,
              lo = 0,
              hi = 0,
              pl = 0,
              ph = 0,
              al = 0,
              ah = 0;
            for (let side = 0; side < 4; side++) {
              if (
                (side === 0 && x === 0) ||
                (side === 1 && x + 1 === a.cols) ||
                (side === 2 && y === 0) ||
                (side === 3 && y + 1 === a.rows)
              )
                continue;
              const j =
                side === 0
                  ? i - 1
                  : side === 1
                    ? i + 1
                    : side === 2
                      ? i - a.cols
                      : i + a.cols;
              if (a.solid[j]) continue;
              count++;
              lo += v0[j];
              hi += v1[j];
              pl += h0[j];
              ph += h1[j];
              al += acc0[j];
              ah += acc1[j];
            }
            v0[i] = count ? lo / count : 0;
            v1[i] = count ? hi / count : 0;
            h0[i] = count ? pl / count : 0;
            h1[i] = count ? ph / count : 0;
            acc0[i] = count ? al / count : 0;
            acc1[i] = count ? ah / count : 0;
          }
        for (let y = minY; y < maxY; y++)
          for (let x = minX; x < maxX; x++) {
            const i = y * a.cols + x,
              r = i + 1,
              d = i + a.cols,
              c = d + 1;
            if (a.solid[i] && a.solid[r] && a.solid[d] && a.solid[c]) continue;
            if (
              Math.max(h0[i], h1[i], h0[r], h1[r], h0[d], h1[d], h0[c], h1[c]) <
              level
            )
              continue;
            if (
              Math.min(v0[i], v1[i], v0[r], v1[r], v0[d], v1[d], v0[c], v1[c]) >
                0 ||
              Math.max(
                v0[i],
                v1[i],
                v0[r],
                v1[r],
                v0[d],
                v1[d],
                v0[c],
                v1[c],
              ) <= 0
            )
              continue;
            if (this.candidateCount === this.candidateCells.length) {
              const capacity = Math.max(128, this.candidateCount * 2);
              const cells = new Int32Array(capacity),
                data = new Float32Array(capacity * FRONT_STRIDE);
              cells.set(this.candidateCells);
              data.set(this.candidateData);
              this.candidateCells = cells;
              this.candidateData = data;
            }
            const candidate = this.candidateCount++;
            this.candidateCells[candidate] = i;
            for (let corner = 0; corner < 4; corner++) {
              const j =
                corner === 0 ? i : corner === 1 ? r : corner === 2 ? c : d;
              const at = candidate * FRONT_STRIDE + corner * 6,
                data = this.candidateData;
              data[at] = v0[j];
              data[at + 1] = v1[j];
              data[at + 2] = h0[j];
              data[at + 3] = h1[j];
              data[at + 4] = acc0[j];
              data[at + 5] = acc1[j];
            }
          }
      }
    }
    this.candidateStep = step;
  }

  /**
   * Physics is independent for each drop. Spread the next fixed step and crest
   * preparation across display frames instead of making all drops stall on the
   * same 50 ms boundary. Two compact bands retain the current and future mesh;
   * the existing third height buffer supplies the previous interval exactly.
   */
  prefetch(age: number, phase: number) {
    if (age < 0 || age % WATER_STEP < phase) return;
    this.setAge(age);
    const step = Math.ceil(age / WATER_STEP);
    if (this.step <= step) this.tick();
    this.prepareFront(this.step, this.previous, this.current);
  }

  /** A positive velocity maximum is one crest, rather than two amplitude outlines. */
  front(age: number) {
    if (this.frontCache?.age === age) return this.frontCache.segments;
    this.setAge(age);
    if (age <= 0) return [];
    // At an exact boundary, always use the interval ending there. Collision
    // may already have advanced one tick; the third buffer still holds the
    // earlier field, so no replay/reset or frame-dependent contour is needed.
    const step = Math.ceil(age / WATER_STEP);
    this.prepareFront(
      step,
      step < this.step ? this.next : this.previous,
      step < this.step ? this.previous : this.current,
    );
    const a = this.arena;
    const f = age / WATER_STEP - (step - 1);
    const gain = this.gain(age),
      data = this.candidateData;
    const segments: number[] = [],
      traveling: number[] = [];
    const {
      velocity,
      amplitude,
      acceleration,
      crossX,
      crossY,
      crossAmplitude,
      crossAcceleration,
    } = this.frontWorkspace;
    for (let cell = 0; cell < this.candidateCount; cell++) {
      const i = this.candidateCells[cell],
        x = i % a.cols,
        y = (i / a.cols) | 0;
      for (let corner = 0; corner < 4; corner++) {
        const at = cell * FRONT_STRIDE + corner * 6;
        velocity[corner] = data[at] + f * (data[at + 1] - data[at]);
        amplitude[corner] =
          (data[at + 2] + f * (data[at + 3] - data[at + 2])) * gain;
        acceleration[corner] = data[at + 4] + f * (data[at + 5] - data[at + 4]);
      }
      if (
        Math.max(amplitude[0], amplitude[1], amplitude[2], amplitude[3]) <
        WATER_LEVEL
      )
        continue;
      let count = 0;
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4,
          v1 = velocity[side],
          v2 = velocity[next];
        if (v1 > 0 === v2 > 0 || v1 === v2) continue;
        const t = v1 / (v1 - v2);
        crossX[count] =
          (x + 0.5 + CORNER_X[side] + t * (CORNER_X[next] - CORNER_X[side])) *
          a.dx;
        crossY[count] =
          (y + 0.5 + CORNER_Y[side] + t * (CORNER_Y[next] - CORNER_Y[side])) *
          a.dy;
        crossAmplitude[count] =
          amplitude[side] + t * (amplitude[next] - amplitude[side]);
        crossAcceleration[count] =
          acceleration[side] + t * (acceleration[next] - acceleration[side]);
        count++;
      }
      const separate =
        count === 4 && velocity[0] * velocity[2] > velocity[1] * velocity[3];
      for (let pair = 0; pair < count; pair += 2) {
        const j = separate ? (pair === 0 ? 0 : 1) : pair;
        const k = separate ? (pair === 0 ? 3 : 2) : pair + 1;
        if (
          (crossAmplitude[j] + crossAmplitude[k]) / 2 < WATER_LEVEL ||
          crossAcceleration[j] + crossAcceleration[k] >= 0
        )
          continue;
        const mx = (crossX[j] + crossX[k]) / 2,
          my = (crossY[j] + crossY[k]) / 2;
        const tx = Math.max(0, Math.min(1, mx / a.dx - (x + 0.5)));
        const ty = Math.max(0, Math.min(1, my / a.dy - (y + 0.5)));
        const gx =
          ((1 - ty) * (velocity[1] - velocity[0]) +
            ty * (velocity[2] - velocity[3])) /
          a.dx;
        const gy =
          ((1 - tx) * (velocity[3] - velocity[0]) +
            tx * (velocity[2] - velocity[1])) /
          a.dy;
        segments.push(crossX[j], crossY[j], crossX[k], crossY[k]);
        traveling.push(
          Number(
            this.travelsAtWaterSpeed(
              (crossAcceleration[j] + crossAcceleration[k]) / 2,
              gx,
              gy,
            ),
          ),
        );
      }
    }
    const cleaned = cleanFront(segments, a, traveling, this.frontWorkspace);
    this.frontCache = { age, segments: cleaned };
    return cleaned;
  }

  distanceToFront(p: Point, age: number, search = Infinity) {
    // Connectivity must be decided on the entire crest. Cropping before cleanup
    // would discard a lethal arc near the player as an artificially short piece.
    return frontDistance(this.front(age), p, search);
  }
}

function addEdgeCuts(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  cuts: number[],
) {
  const ex = bx - ax,
    ey = by - ay,
    denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) < 1e-12) return;
  const t = ((ax - x) * ey - (ay - y) * ex) / denominator,
    u = ((ax - x) * dy - (ay - y) * dx) / denominator;
  if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
}

function outsideObstacle(
  x: number,
  y: number,
  dx: number,
  dy: number,
  b: Obstacle,
) {
  const cuts = [0, 1];
  if (b.shape === "circle") {
    const cx = b.x + b.width / 2,
      cy = b.y + b.height / 2,
      ox = x - cx,
      oy = y - cy,
      a = dx * dx + dy * dy,
      bb = 2 * (ox * dx + oy * dy),
      c = ox * ox + oy * oy - (b.width / 2) ** 2,
      discriminant = bb * bb - 4 * a * c;
    if (discriminant >= 0 && a > 0) {
      const root = Math.sqrt(discriminant);
      cuts.push((-bb - root) / (2 * a), (-bb + root) / (2 * a));
    }
  } else if (b.vertices) {
    for (let i = 0; i < b.vertices.length; i++) {
      const a = b.vertices[i],
        c = b.vertices[(i + 1) % b.vertices.length];
      addEdgeCuts(a.x, a.y, c.x, c.y, x, y, dx, dy, cuts);
    }
  } else {
    const right = b.x + b.width,
      bottom = b.y + b.height;
    addEdgeCuts(b.x, b.y, right, b.y, x, y, dx, dy, cuts);
    addEdgeCuts(right, b.y, right, bottom, x, y, dx, dy, cuts);
    addEdgeCuts(right, bottom, b.x, bottom, x, y, dx, dy, cuts);
    addEdgeCuts(b.x, bottom, b.x, b.y, x, y, dx, dy, cuts);
  }
  cuts.sort((a, b) => a - b);
  const pieces: number[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = Math.max(0, cuts[i]),
      hi = Math.min(1, cuts[i + 1]);
    if (hi - lo < 1e-8) continue;
    const middle = (lo + hi) / 2;
    if (!pointInObstacle(x + dx * middle, y + dy * middle, b))
      pieces.push(lo, hi);
  }
  return pieces;
}

function appendClippedSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Obstacle[],
  from: number,
  output: number[],
) {
  const dx = x2 - x1,
    dy = y2 - y1,
    left = Math.min(x1, x2),
    right = Math.max(x1, x2),
    top = Math.min(y1, y2),
    bottom = Math.max(y1, y2);
  for (let i = from; i < obstacles.length; i++) {
    const b = obstacles[i];
    if (
      right < b.x ||
      left > b.x + b.width ||
      bottom < b.y ||
      top > b.y + b.height
    )
      continue;
    const pieces = outsideObstacle(x1, y1, dx, dy, b);
    if (pieces.length === 2 && pieces[0] === 0 && pieces[1] === 1) continue;
    for (let j = 0; j < pieces.length; j += 2) {
      const lo = pieces[j],
        hi = pieces[j + 1];
      appendClippedSegment(
        x1 + dx * lo,
        y1 + dy * lo,
        x1 + dx * hi,
        y1 + dy * hi,
        obstacles,
        i + 1,
        output,
      );
    }
    return;
  }
  output.push(x1, y1, x2, y2);
}

/** Reused small buffers avoid typed-array garbage on every animation frame. */
class FrontWorkspace {
  readonly velocity = new Float64Array(4);
  readonly amplitude = new Float64Array(4);
  readonly acceleration = new Float64Array(4);
  readonly crossX = new Float64Array(4);
  readonly crossY = new Float64Array(4);
  readonly crossAmplitude = new Float64Array(4);
  readonly crossAcceleration = new Float64Array(4);
  readonly endpoints = new Map<number, number>();
  parent = new Int32Array(0);
  lengths = new Float64Array(0);
  traveling = new Float64Array(0);
  reserve(count: number) {
    if (this.parent.length < count) {
      const capacity = Math.max(128, 2 ** Math.ceil(Math.log2(count)));
      this.parent = new Int32Array(capacity);
      this.lengths = new Float64Array(capacity);
      this.traveling = new Float64Array(capacity);
    }
    this.lengths.fill(0, 0, count);
    this.traveling.fill(0, 0, count);
    this.endpoints.clear();
  }
}

/**
 * Filter coherent connected crests, not individual grid edges. An occasional
 * noisy speed estimate must not tear a real arc into flickering short pieces.
 * Reject small fragments and components dominated by stationary interference.
 */
function cleanFront(
  segments: number[],
  arena: WaterArena,
  travel: number[],
  workspace: FrontWorkspace,
) {
  let clipped = segments,
    traveling = travel;
  if (arena.obstacles.length) {
    clipped = [];
    traveling = [];
    for (let i = 0; i + 3 < segments.length; i += 4) {
      const before = clipped.length;
      appendClippedSegment(
        segments[i],
        segments[i + 1],
        segments[i + 2],
        segments[i + 3],
        arena.obstacles,
        0,
        clipped,
      );
      for (let j = before; j < clipped.length; j += 4)
        traveling.push(travel[i / 4]);
    }
  }
  const count = clipped.length / 4;
  if (!count) return clipped;
  workspace.reserve(count);
  const { parent, lengths, endpoints } = workspace,
    valid = workspace.traveling;
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== i) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (let i = 0; i < count; i++)
    for (let end = 0; end < 2; end++) {
      const at = i * 4 + end * 2;
      const key =
        Math.round(clipped[at] * 256) * 4_194_304 +
        Math.round(clipped[at + 1] * 256);
      const other = endpoints.get(key);
      if (other === undefined) endpoints.set(key, i);
      else {
        const a = find(i),
          b = find(other);
        if (a !== b) parent[b] = a;
      }
    }
  for (let i = 0; i < count; i++) {
    const length = Math.hypot(
      clipped[i * 4 + 2] - clipped[i * 4],
      clipped[i * 4 + 3] - clipped[i * 4 + 1],
    );
    const root = find(i);
    lengths[root] += length;
    valid[root] += length * traveling[i];
  }
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (lengths[root] < MIN_FRONT_LENGTH || valid[root] < lengths[root] * 0.6)
      continue;
    result.push(
      clipped[i * 4],
      clipped[i * 4 + 1],
      clipped[i * 4 + 2],
      clipped[i * 4 + 3],
    );
  }
  return result;
}

export function frontDistance(segments: number[], p: Point, search = Infinity) {
  let distance = Infinity;
  for (let i = 0; i + 3 < segments.length; i += 4) {
    if (
      Math.min(segments[i], segments[i + 2]) > p.x + search ||
      Math.max(segments[i], segments[i + 2]) < p.x - search ||
      Math.min(segments[i + 1], segments[i + 3]) > p.y + search ||
      Math.max(segments[i + 1], segments[i + 3]) < p.y - search
    )
      continue;
    const x = segments[i],
      y = segments[i + 1],
      dx = segments[i + 2] - x,
      dy = segments[i + 3] - y;
    const square = dx * dx + dy * dy;
    const t = square
      ? Math.max(0, Math.min(1, ((p.x - x) * dx + (p.y - y) * dy) / square))
      : 0;
    const ox = p.x - x - t * dx,
      oy = p.y - y - t * dy;
    distance = Math.min(distance, ox * ox + oy * oy);
  }
  return Math.sqrt(distance);
}
