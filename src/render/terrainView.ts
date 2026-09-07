/**
 * Draws the core Terrain byte-map into a canvas texture. Only the dirty band
 * is re-rasterised each frame, so a 1920×1008 map stays cheap.
 *
 * Material colours come from the palette; when a `terrain-tile` texture is
 * present (from the asset sheets) the dirt layers are patterned from it.
 */
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import {
  MAT_AIR,
  MAT_BEDROCK,
  MAT_BEDROCK_DARK,
  MAT_DIRT,
  MAT_DIRT_DARK,
  MAT_DIRT_LIT,
  MAT_SCORCH,
  type Terrain,
} from '../core/terrain';
import { dither } from './pixel';

/** Cheap 2-D integer hash → [0, 1). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const MAT_RGB: Record<number, number> = {
  [MAT_DIRT_LIT]: PAL.dirtLit,
  [MAT_DIRT]: PAL.dirt,
  [MAT_DIRT_DARK]: PAL.dirtDark,
  [MAT_BEDROCK]: PAL.bedrock,
  [MAT_BEDROCK_DARK]: PAL.bedrockDark,
  [MAT_SCORCH]: PAL.smoke,
};

export class TerrainView {
  readonly key: string;
  readonly image: Phaser.GameObjects.Image;
  private readonly canvasTex: Phaser.Textures.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imgData: ImageData;
  private pattern: ImageData | null = null;

  constructor(private scene: Phaser.Scene, private terrain: Terrain, x: number, y: number, tileKey?: string) {
    this.key = `terrain-${Phaser.Math.RND.uuid()}`;
    this.canvasTex = scene.textures.createCanvas(this.key, terrain.width, terrain.height)!;
    this.ctx = this.canvasTex.context;
    this.imgData = this.ctx.createImageData(terrain.width, terrain.height);

    this.setTile(tileKey);

    this.rasterise(0, 0, terrain.width - 1, terrain.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0);
    this.canvasTex.refresh();
    this.image = scene.add.image(x, y, this.key).setOrigin(0, 0).setDepth(10);
    terrain.clearDirty();
  }

  /** Choose the dirt texture: a sheet tile if present, else flat palette dither. */
  setTile(tileKey?: string): void {
    const key = [tileKey ?? '', 'tile.sand', 'terrain-tile', 'tile.sand.1'].find((k) => k && this.scene.textures.exists(k));
    this.pattern = null;
    if (!key) return;
    const src = this.scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    // Extracted tiles carry a transparent/keyed border and are not truly seamless:
    // keep the opaque interior only, then build a 2×2 mirrored super-tile so every
    // edge meets its own reflection.
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
    this.pattern = sup;
  }

  /** Swap in a new Terrain (new round). */
  setTerrain(terrain: Terrain, tileKey?: string): void {
    this.terrain = terrain;
    if (tileKey) this.setTile(tileKey);
    this.rasterise(0, 0, terrain.width - 1, terrain.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0);
    this.canvasTex.refresh();
    terrain.clearDirty();
  }

  update(): void {
    const t = this.terrain;
    if (!t.hasDirty()) return;
    const x0 = Math.max(0, t.dirtyMinX);
    const y0 = Math.max(0, t.dirtyMinY);
    const x1 = Math.min(t.width - 1, t.dirtyMaxX);
    const y1 = Math.min(t.height - 1, t.dirtyMaxY);
    this.rasterise(x0, y0, x1, y1);
    this.ctx.putImageData(this.imgData, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.canvasTex.refresh();
    t.clearDirty();
  }

  private rasterise(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const d = this.imgData.data;
    const w = t.width;
    const pat = this.pattern;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const m = t.mat[i];
        const o = i * 4;
        if (m === MAT_AIR) {
          d[o + 3] = 0;
          continue;
        }
        let c = MAT_RGB[m] ?? PAL.dirt;
        if (pat && (m === MAT_DIRT_LIT || m === MAT_DIRT || m === MAT_DIRT_DARK || m === MAT_BEDROCK)) {
          // Two texture samples at different scales/offsets blended by a hash, plus a
          // slow depth darkening, so the repeat is not readable as a grid.
          const px = (x >> 1) % pat.width;
          const py = (y >> 1) % pat.height;
          const qx = ((x + 37) >> 2) % pat.width;
          const qy = ((y + 53) >> 2) % pat.height;
          const pi = (py * pat.width + px) * 4;
          const qi = (qy * pat.width + qx) * 4;
          const h = hash2(x >> 3, y >> 3);
          const mix = 0.25 + h * 0.5;
          const depth = Math.min(1, (y - t.surfaceY(x)) / 220);
          const base = m === MAT_DIRT_LIT ? 1.12 : m === MAT_DIRT ? 1.0 : m === MAT_DIRT_DARK ? 0.78 : 0.55;
          const shade = base * (1 - depth * 0.22) * (0.93 + hash2(x, y) * 0.14);
          d[o] = Math.min(255, (pat.data[pi] * (1 - mix) + pat.data[qi] * mix) * shade);
          d[o + 1] = Math.min(255, (pat.data[pi + 1] * (1 - mix) + pat.data[qi + 1] * mix) * shade);
          d[o + 2] = Math.min(255, (pat.data[pi + 2] * (1 - mix) + pat.data[qi + 2] * mix) * shade);
          d[o + 3] = 255;
          continue;
        }
        // Dithered transitions between layers so the strata do not band.
        if (m === MAT_DIRT && dither(x, y, 0.18)) c = PAL.dirtLit;
        else if (m === MAT_DIRT_DARK && dither(x, y, 0.12)) c = PAL.dirt;
        else if (m === MAT_BEDROCK && dither(x, y, 0.1)) c = PAL.dirtDark;
        d[o] = (c >> 16) & 255;
        d[o + 1] = (c >> 8) & 255;
        d[o + 2] = c & 255;
        d[o + 3] = 255;
      }
    }
  }

  destroy(): void {
    this.image.destroy();
    this.canvasTex.destroy();
  }
}
