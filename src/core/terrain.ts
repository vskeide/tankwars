import { Rng } from './rng';
import type { TerrainStyle, Vec2 } from './types';

/** Material index stored per pixel. 0 is always air. */
export const MAT_AIR = 0;
export const MAT_DIRT_LIT = 1;
export const MAT_DIRT = 2;
export const MAT_DIRT_DARK = 3;
export const MAT_BEDROCK = 4;
export const MAT_BEDROCK_DARK = 5;
export const MAT_SCORCH = 6;

export const TERRAIN_STYLES: readonly TerrainStyle[] = [
  { id: 'dunes', name: 'Rolling Dunes', roughness: 0.35, baseline: 0.68, crumbles: true },
  { id: 'mesas', name: 'Broken Mesas', roughness: 0.85, baseline: 0.6, crumbles: false },
  { id: 'crags', name: 'Iron Crags', roughness: 1.0, baseline: 0.55, crumbles: false },
  { id: 'basin', name: 'Salt Basin', roughness: 0.15, baseline: 0.78, crumbles: true },
  { id: 'spires', name: 'Ash Spires', roughness: 0.7, baseline: 0.5, crumbles: true },
];

/**
 * A destructible pixel battlefield.
 *
 * The authoritative representation is one byte per pixel in `mat`. Rendering
 * turns that into an image; the renderer is told which region changed via the
 * dirty rectangle so it can re-upload only the damaged band.
 */
export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly mat: Uint8Array;
  readonly style: TerrainStyle;

  /** Bounds of the region changed since the renderer last cleared them. */
  dirtyMinX = 0;
  dirtyMinY = 0;
  dirtyMaxX = -1;
  dirtyMaxY = -1;

  constructor(width: number, height: number, style: TerrainStyle) {
    this.width = width;
    this.height = height;
    this.style = style;
    this.mat = new Uint8Array(width * height);
  }

  static generate(width: number, height: number, style: TerrainStyle, seed: number): Terrain {
    const t = new Terrain(width, height, style);
    const rng = new Rng(seed);
    const surface = buildSurface(width, height, style, rng);

    for (let x = 0; x < width; x++) {
      const top = surface[x];
      for (let y = top; y < height; y++) {
        const depth = y - top;
        let m: number;
        if (depth < 3) m = MAT_DIRT_LIT;
        else if (depth < 14) m = MAT_DIRT;
        else if (y < height - 40) m = MAT_DIRT_DARK;
        else if (y < height - 14) m = MAT_BEDROCK;
        else m = MAT_BEDROCK_DARK;
        t.mat[y * width + x] = m;
      }
    }
    t.markDirty(0, 0, width - 1, height - 1);
    return t;
  }

  isSolid(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y >= this.height) return false;
    if (y < 0) return false;
    return this.mat[(y | 0) * this.width + (x | 0)] !== MAT_AIR;
  }

  /** Topmost solid pixel in a column, or `height` when the column is empty. */
  surfaceY(x: number): number {
    const xi = Math.max(0, Math.min(this.width - 1, x | 0));
    for (let y = 0; y < this.height; y++) {
      if (this.mat[y * this.width + xi] !== MAT_AIR) return y;
    }
    return this.height;
  }

  /**
   * Surface angle in radians at a column, sampled over `span` pixels either
   * side. Used to sit tanks flush on slopes and to roll rollers downhill.
   */
  surfaceAngle(x: number, span = 6): number {
    const left = this.surfaceY(x - span);
    const right = this.surfaceY(x + span);
    return Math.atan2(right - left, span * 2);
  }

  /** Blow a circular hole. Caller runs `settle()` afterwards if it wants dirt to fall. */
  carveCircle(cx: number, cy: number, radius: number, scorch = true): void {
    const r2 = radius * radius;
    const scorchR2 = (radius + 3) * (radius + 3);
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius + 1));

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        const i = y * this.width + x;
        if (d2 <= r2) {
          this.mat[i] = MAT_AIR;
        } else if (scorch && d2 <= scorchR2 && this.mat[i] !== MAT_AIR) {
          this.mat[i] = MAT_SCORCH;
        }
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  /** Add material — used by dirt-mover style weapons. */
  fillCircle(cx: number, cy: number, radius: number, material = MAT_DIRT): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) this.mat[y * this.width + x] = material;
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  /**
   * Let unsupported dirt fall the way the DOS original did: everything in a
   * column drops to close any gap beneath it. Only runs on styles flagged
   * `crumbles`, so rock arches on the hard maps stay standing.
   */
  settle(x0: number, x1: number): void {
    if (!this.style.crumbles) return;
    const lo = Math.max(0, x0 | 0);
    const hi = Math.min(this.width - 1, x1 | 0);
    const col = new Uint8Array(this.height);

    for (let x = lo; x <= hi; x++) {
      let n = 0;
      for (let y = 0; y < this.height; y++) {
        const m = this.mat[y * this.width + x];
        if (m !== MAT_AIR) col[n++] = m;
      }
      if (n === this.height) continue;
      const airRows = this.height - n;
      let y = 0;
      for (; y < airRows; y++) this.mat[y * this.width + x] = MAT_AIR;
      for (let k = 0; k < n; k++, y++) this.mat[y * this.width + x] = col[k];
    }
    this.markDirty(lo, 0, hi, this.height - 1);
  }

  /**
   * March a point along a direction, boring a hole, until it leaves the map or
   * exceeds `maxDepth`. Used by tunnelling weapons.
   */
  tunnel(from: Vec2, dir: Vec2, maxDepth: number, boreRadius: number): Vec2 {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const sx = dir.x / len;
    const sy = dir.y / len;
    let x = from.x;
    let y = from.y;
    for (let step = 0; step < maxDepth; step++) {
      x += sx;
      y += sy;
      if (x < 0 || x >= this.width || y >= this.height) break;
      this.carveCircle(x, y, boreRadius, false);
    }
    return { x, y };
  }

  markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (this.dirtyMaxX < this.dirtyMinX) {
      this.dirtyMinX = x0;
      this.dirtyMinY = y0;
      this.dirtyMaxX = x1;
      this.dirtyMaxY = y1;
      return;
    }
    this.dirtyMinX = Math.min(this.dirtyMinX, x0);
    this.dirtyMinY = Math.min(this.dirtyMinY, y0);
    this.dirtyMaxX = Math.max(this.dirtyMaxX, x1);
    this.dirtyMaxY = Math.max(this.dirtyMaxY, y1);
  }

  clearDirty(): void {
    this.dirtyMinX = 0;
    this.dirtyMinY = 0;
    this.dirtyMaxX = -1;
    this.dirtyMaxY = -1;
  }

  hasDirty(): boolean {
    return this.dirtyMaxX >= this.dirtyMinX;
  }
}

/**
 * Surface heights via midpoint displacement, then a light smoothing pass.
 * Roughness scales the displacement decay; baseline sets the average height.
 */
function buildSurface(width: number, height: number, style: TerrainStyle, rng: Rng): Int32Array {
  // Work on a power-of-two grid, then resample down to pixel columns.
  let size = 1;
  while (size < width) size *= 2;
  const h = new Float64Array(size + 1);

  const base = height * style.baseline;
  const amplitude = height * 0.42 * (0.25 + style.roughness * 0.75);
  h[0] = base + rng.range(-amplitude * 0.3, amplitude * 0.3);
  h[size] = base + rng.range(-amplitude * 0.3, amplitude * 0.3);

  let stride = size;
  let scale = amplitude;
  while (stride > 1) {
    const half = stride / 2;
    for (let i = half; i < size; i += stride) {
      h[i] = (h[i - half] + h[i + half]) / 2 + rng.range(-scale, scale);
    }
    stride = half;
    scale *= Math.pow(0.5, 1.15 - style.roughness * 0.45);
  }

  // Resample and clamp so there is always sky above and rock below.
  const minY = Math.floor(height * 0.16);
  const maxY = Math.floor(height * 0.9);
  const out = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    const t = (x / (width - 1)) * size;
    const i = Math.floor(t);
    const f = t - i;
    const v = h[i] * (1 - f) + h[Math.min(size, i + 1)] * f;
    out[x] = Math.max(minY, Math.min(maxY, Math.round(v)));
  }

  // Two smoothing passes take the worst single-pixel spikes off without
  // flattening the silhouette.
  const tmp = new Int32Array(width);
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 0; x < width; x++) {
      const a = out[Math.max(0, x - 1)];
      const b = out[x];
      const c = out[Math.min(width - 1, x + 1)];
      tmp[x] = Math.round((a + b * 2 + c) / 4);
    }
    out.set(tmp);
  }
  return out;
}
