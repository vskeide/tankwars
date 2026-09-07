/**
 * Draws the core Terrain byte-map into a canvas texture. Only the dirty band
 * is re-rasterised each frame, so a 1920×1036 map stays cheap.
 *
 * Look: a surface tile for the top layers and a deeper rock tile below, with a
 * noise-perturbed boundary so strata wander instead of running in straight
 * lines; a lit crust along the surface; darkening with depth; scorch marks
 * from the core material map.
 */
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import { MAT_AIR, MAT_SCORCH, type Terrain } from '../core/terrain';
import { dither } from './pixel';

/** Cheap 2-D integer hash → [0, 1). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1) from the hash, period `cell` px. */
function noise(x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy), b = hash2(gx + 1, gy), c = hash2(gx, gy + 1), d = hash2(gx + 1, gy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export interface TerrainLook {
  /** Atlas id of the surface tile. */
  surface: string;
  /** Atlas id of the deep rock tile. */
  deep: string;
}

export class TerrainView {
  readonly key: string;
  readonly image: Phaser.GameObjects.Image;
  private readonly canvasTex: Phaser.Textures.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imgData: ImageData;
  private surface: ImageData | null = null;
  private deep: ImageData | null = null;
  private colTop = new Int32Array(0);

  constructor(private scene: Phaser.Scene, private terrain: Terrain, x: number, y: number, look?: TerrainLook) {
    this.key = `terrain-${Phaser.Math.RND.uuid()}`;
    this.canvasTex = scene.textures.createCanvas(this.key, terrain.width, terrain.height)!;
    this.ctx = this.canvasTex.context;
    this.imgData = this.ctx.createImageData(terrain.width, terrain.height);
    this.setLook(look);
    this.rasterise(0, 0, terrain.width - 1, terrain.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0);
    this.canvasTex.refresh();
    this.image = scene.add.image(x, y, this.key).setOrigin(0, 0).setDepth(10);
    terrain.clearDirty();
  }

  setLook(look?: TerrainLook): void {
    this.surface = this.tilePattern(look?.surface ?? 'tile.sand');
    this.deep = this.tilePattern(look?.deep ?? 'tile.bedrock');
  }

  /**
   * Extracted tiles carry a keyed border and are not truly seamless: keep the
   * opaque interior, then build a 2×2 mirrored super-tile so every edge meets
   * its own reflection.
   */
  private tilePattern(key: string): ImageData | null {
    if (!this.scene.textures.exists(key)) return null;
    const src = this.scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const cctx = c.getContext('2d', { willReadFrequently: true })!;
    cctx.drawImage(src, 0, 0);
    const raw = cctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (raw.data[(y * c.width + x) * 4 + 3] > 200) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 < 0) return null;
    const inset = 3;
    x0 += inset; y0 += inset; x1 -= inset; y1 -= inset;
    const tw = Math.max(4, x1 - x0 + 1), th = Math.max(4, y1 - y0 + 1);
    const sup = new ImageData(tw * 2, th * 2);
    for (let y = 0; y < th * 2; y++) for (let x = 0; x < tw * 2; x++) {
      const sx = x < tw ? x : tw * 2 - 1 - x;
      const sy = y < th ? y : th * 2 - 1 - y;
      const si = ((y0 + sy) * c.width + (x0 + sx)) * 4;
      const di = (y * tw * 2 + x) * 4;
      sup.data[di] = raw.data[si]; sup.data[di + 1] = raw.data[si + 1]; sup.data[di + 2] = raw.data[si + 2]; sup.data[di + 3] = 255;
    }
    return sup;
  }

  /** Swap in a new Terrain (new round). */
  setTerrain(terrain: Terrain, look?: TerrainLook): void {
    this.terrain = terrain;
    if (look) this.setLook(look);
    this.rasterise(0, 0, terrain.width - 1, terrain.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0);
    this.canvasTex.refresh();
    terrain.clearDirty();
  }

  update(): void {
    const t = this.terrain;
    if (!t.hasDirty()) return;
    const x0 = Math.max(0, t.dirtyMinX);
    const x1 = Math.min(t.width - 1, t.dirtyMaxX);
    // Surface may have moved for these columns: repaint the whole column band so
    // the crust highlight and depth shading follow the new surface.
    this.rasterise(x0, 0, x1, t.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0, x0, 0, x1 - x0 + 1, t.height);
    this.canvasTex.refresh();
    t.clearDirty();
  }

  private sample(pat: ImageData, x: number, y: number, scaleShift: number): [number, number, number] {
    const px = (x >> scaleShift) % pat.width;
    const py = (y >> scaleShift) % pat.height;
    const i = (py * pat.width + px) * 4;
    return [pat.data[i], pat.data[i + 1], pat.data[i + 2]];
  }

  private rasterise(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const d = this.imgData.data;
    const w = t.width;
    const h = t.height;
    const surf = this.surface;
    const deep = this.deep;

    // Column surface heights once per pass, not per pixel.
    if (this.colTop.length !== w) this.colTop = new Int32Array(w);
    for (let x = x0; x <= x1; x++) this.colTop[x] = t.surfaceY(x);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const m = t.mat[i];
        const o = i * 4;
        if (m === MAT_AIR) {
          d[o + 3] = 0;
          continue;
        }
        const depth = y - this.colTop[x];
        let r: number, g: number, b: number;

        if (surf && deep) {
          // Strata boundary wanders with low-frequency noise; a dithered blend
          // band hides the seam.
          const boundary = 110 + (noise(x, y, 120) - 0.5) * 90 + (noise(x, y, 23) - 0.5) * 16;
          const useDeep = depth > boundary + (dither(x, y, 0.5) ? 6 : -6);
          const pat = useDeep ? deep : surf;
          const [sr, sg, sb] = this.sample(pat, x, y, 0);
          // Second sample at another scale/offset, blended by slow noise: breaks the repeat.
          const [tr, tg, tb] = this.sample(pat, x + 41, y + 17, 1);
          const mix = noise(x, y, 61) * 0.55;
          r = sr * (1 - mix) + tr * mix;
          g = sg * (1 - mix) + tg * mix;
          b = sb * (1 - mix) + tb * mix;
        } else {
          const c = depth < 4 ? PAL.dirtLit : depth < 60 ? PAL.dirt : depth < 140 ? PAL.dirtDark : PAL.bedrock;
          r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
        }

        // Shading: lit crust along the surface, gentle darkening with depth,
        // fine grain so large flat areas are not dead.
        let shade: number;
        if (depth < 2) shade = 1.35;
        else if (depth < 5) shade = 1.15;
        else shade = 1 - Math.min(1, depth / (h * 0.9)) * 0.38;
        shade *= 0.94 + hash2(x, y) * 0.12;
        if (m === MAT_SCORCH) shade *= 0.45;

        d[o] = Math.min(255, r * shade);
        d[o + 1] = Math.min(255, g * shade);
        d[o + 2] = Math.min(255, b * shade);
        d[o + 3] = 255;
      }
    }
  }

  destroy(): void {
    this.image.destroy();
    this.canvasTex.destroy();
  }
}
