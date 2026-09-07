/**
 * Composite tank parts from the separated sheets: hull + turret + barrel, with
 * the #00FF00 accent stripes remapped to the team colour. Also measures each
 * part so the turret sits on the hull deck and the barrel pivots at the mantlet.
 */
import Phaser from 'phaser';
import { TEAM_COLOURS } from '../core/palette';
import { atlasHas } from './atlas';

export interface PartMetrics {
  width: number;
  height: number;
  /** Topmost opaque row near the horizontal centre (the deck / turret ring). */
  topAtCentre: number;
  /** Horizontal centre of mass of the opaque pixels, in px from the left. */
  massX: number;
}

const metrics = new Map<string, PartMetrics>();
const teamKeys = new Map<string, string>();

function pixels(scene: Phaser.Scene, key: string): { w: number; h: number; d: Uint8ClampedArray; canvas: HTMLCanvasElement } {
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data, canvas: c };
}

export function partMetrics(scene: Phaser.Scene, key: string): PartMetrics {
  const cached = metrics.get(key);
  if (cached) return cached;
  const { w, h, d } = pixels(scene, key);
  let top = h;
  const c0 = Math.floor(w * 0.35);
  const c1 = Math.ceil(w * 0.65);
  for (let y = 0; y < h && top === h; y++) {
    for (let x = c0; x < c1; x++) if (d[(y * w + x) * 4 + 3] > 40) { top = y; break; }
  }
  let sx = 0;
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { sx += x; n++; }
  const m: PartMetrics = { width: w, height: h, topAtCentre: top, massX: n ? sx / n : w / 2 };
  metrics.set(key, m);
  return m;
}

/**
 * Texture with the green accent stripes (#00FF00-ish) recoloured to the team.
 * Only strongly green pixels change; camo greens on the hull are too muted to match.
 */
export function ensureTeamTexture(scene: Phaser.Scene, key: string, colour: number): string {
  const out = `${key}.team${colour}`;
  const cached = teamKeys.get(out);
  if (cached && scene.textures.exists(cached)) return cached;
  if (!atlasHas(key) && !scene.textures.exists(key)) return key;

  const team = TEAM_COLOURS[colour % TEAM_COLOURS.length];
  const { w, h, canvas } = pixels(scene, key);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const tr = (team.mid >> 16) & 255, tg = (team.mid >> 8) & 255, tb = team.mid & 255;
  const lr = (team.lit >> 16) & 255, lg = (team.lit >> 8) & 255, lb = team.lit & 255;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // Accent test: green dominates both other channels by a wide margin.
    if (g > 140 && g - Math.max(r, b) > 70) {
      const bright = g / 255;
      const f = Math.max(0, Math.min(1, (bright - 0.55) / 0.45)); // brighter accents → lit tone
      d[i] = Math.round(tr + (lr - tr) * f);
      d[i + 1] = Math.round(tg + (lg - tg) * f);
      d[i + 2] = Math.round(tb + (lb - tb) * f);
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(out, canvas);
  teamKeys.set(out, out);
  return out;
}

/** Which barrel sprite a class fires from. */
export const CLASS_BARREL: Record<string, string> = {
  line: 'barrel.standard',
  scout: 'barrel.light',
  bulwark: 'barrel.heavy',
  battery: 'barrel.artillery',
  aegis: 'barrel.plasma',
  strider: 'barrel.railgun',
};

/** Enemy kinds map to their own part set (no recolour). */
export const ENEMY_PARTS: Record<string, { hull: string; turret: string; barrel: string }> = {
  'enemy.light': { hull: 'ehull.light', turret: 'eturret.light', barrel: 'ebarrel.light' },
  'enemy.medium': { hull: 'ehull.medium', turret: 'eturret.medium', barrel: 'ebarrel.medium' },
  'enemy.heavy': { hull: 'ehull.heavy', turret: 'eturret.heavy', barrel: 'ebarrel.heavy' },
  'enemy.missile': { hull: 'ehull.missile', turret: 'eturret.missile', barrel: 'ebarrel.missile' },
  'enemy.flame': { hull: 'ehull.flame', turret: 'eturret.flame', barrel: 'ebarrel.flame' },
};

export function hasParts(classId: string, skin: string): boolean {
  if (skin && ENEMY_PARTS[skin]) {
    const p = ENEMY_PARTS[skin];
    return atlasHas(p.hull) && atlasHas(p.turret) && atlasHas(p.barrel);
  }
  return atlasHas(`hull.${classId}`) && atlasHas(`turret.${classId}`) && atlasHas(CLASS_BARREL[classId] ?? 'barrel.standard');
}
