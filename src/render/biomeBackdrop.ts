/**
 * Slices a generated biome backdrop (sky band / far band / near band stacked
 * vertically, separated by flat magenta) into three textures. Far and near are
 * chroma-keyed; the sky stays opaque.
 */
import Phaser from 'phaser';

export interface BiomeLayers {
  sky: string;
  far: string;
  near: string;
}

const cache = new Map<string, BiomeLayers>();

function isKey(r: number, g: number, b: number): boolean {
  return r > 180 && b > 180 && g < 110;
}

export function sliceBiome(scene: Phaser.Scene, imageKey: string): BiomeLayers | null {
  const hit = cache.get(imageKey);
  if (hit) return hit;
  if (!scene.textures.exists(imageKey)) return null;

  const src = scene.textures.get(imageKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;

  // A row is a gap when nearly all of it is key colour.
  const gap: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (isKey(d[i], d[i + 1], d[i + 2])) n++;
    }
    gap.push(n > (w / 2) * 0.97);
  }
  const bands: [number, number][] = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const g = y === h ? true : gap[y];
    if (!g && start < 0) start = y;
    if (g && start >= 0) {
      if (y - start > 30) bands.push([start, y]);
      start = -1;
    }
  }
  if (bands.length < 3) return null;
  const [skyB, farB, nearB] = [bands[0], bands[1], bands[bands.length - 1]];

  const cut = (name: string, band: [number, number], keyed: boolean): string => {
    const key = `${imageKey}:${name}`;
    if (scene.textures.exists(key)) return key;
    const cc = document.createElement('canvas');
    cc.width = w;
    cc.height = band[1] - band[0];
    const cctx = cc.getContext('2d')!;
    cctx.drawImage(src, 0, band[0], w, cc.height, 0, 0, w, cc.height);
    if (keyed) {
      const img = cctx.getImageData(0, 0, cc.width, cc.height);
      const p = img.data;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const spill = Math.min(r, b) - g;
        if (isKey(r, g, b) || spill > 120) p[i + 3] = 0;
        else if (spill > 30) {
          p[i] = Math.max(0, r - spill * 0.6);
          p[i + 2] = Math.max(0, b - spill * 0.6);
        }
      }
      cctx.putImageData(img, 0, 0);
    }
    scene.textures.addCanvas(key, cc);
    return key;
  };

  const layers: BiomeLayers = { sky: cut('sky', skyB, true), far: cut('far', farB, true), near: cut('near', nearB, true) };
  cache.set(imageKey, layers);
  return layers;
}
