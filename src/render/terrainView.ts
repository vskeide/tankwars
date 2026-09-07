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

  constructor(scene: Phaser.Scene, private terrain: Terrain, x: number, y: number) {
    this.key = `terrain-${Phaser.Math.RND.uuid()}`;
    this.canvasTex = scene.textures.createCanvas(this.key, terrain.width, terrain.height)!;
    this.ctx = this.canvasTex.context;
    this.imgData = this.ctx.createImageData(terrain.width, terrain.height);

    if (scene.textures.exists('terrain-tile')) {
      const src = scene.textures.get('terrain-tile').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const cctx = c.getContext('2d')!;
      cctx.drawImage(src, 0, 0);
      this.pattern = cctx.getImageData(0, 0, c.width, c.height);
    }

    this.rasterise(0, 0, terrain.width - 1, terrain.height - 1);
    this.ctx.putImageData(this.imgData, 0, 0);
    this.canvasTex.refresh();
    this.image = scene.add.image(x, y, this.key).setOrigin(0, 0).setDepth(10);
    terrain.clearDirty();
  }

  /** Swap in a new Terrain (new round). */
  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
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
        if (pat && (m === MAT_DIRT || m === MAT_DIRT_DARK)) {
          // Sample the tile pattern, darkening it for the deeper layer.
          const px = x % pat.width;
          const py = y % pat.height;
          const pi = (py * pat.width + px) * 4;
          const shade = m === MAT_DIRT ? 1 : 0.72;
          d[o] = pat.data[pi] * shade;
          d[o + 1] = pat.data[pi + 1] * shade;
          d[o + 2] = pat.data[pi + 2] * shade;
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
