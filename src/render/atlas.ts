/**
 * Loads the extracted sprite atlas (public/atlas/<sheet>/NN.png + names.json)
 * and exposes sprites by id. Also derives variants the sheets do not provide:
 * a hull with the baked-in barrel cropped off so a rotating barrel can be
 * drawn on top.
 */
import Phaser from 'phaser';
import { TEAM_COLOURS } from '../core/palette';

interface Manifest {
  sheets: string[];
}

const ids = new Set<string>();
/** Display scale per sprite id — sheets differ in how large they drew things. */
const scales = new Map<string, number>();

export function atlasHas(id: string): boolean {
  return ids.has(id);
}

/** Integer scale a sprite should be drawn at on the native grid (default 2). */
export function spriteScale(id: string): number {
  return scales.get(id) ?? 2;
}

/** Queue every atlas file for the loader. Call in a scene's preload(). */
export function queueAtlas(scene: Phaser.Scene, manifest: Manifest, names: Record<string, Record<string, string>>): void {
  // Later sheets in the manifest override earlier ones for the same id.
  const chosen = new Map<string, { sheet: string; index: string; scale: number }>();
  for (const sheet of manifest.sheets) {
    const map = names[sheet];
    if (!map) continue;
    const scale = Number(map['_scale'] ?? 2) || 2;
    for (const [index, id] of Object.entries(map)) {
      if (index.startsWith('_')) continue;
      chosen.set(id, { sheet, index, scale });
    }
  }
  for (const [id, c] of chosen) {
    scene.load.image(id, `atlas/${c.sheet}/${c.index}.png`);
    ids.add(id);
    scales.set(id, c.scale);
  }
}

/** Skin id for a tank class, or '' when only the procedural hull exists. */
export function skinForClass(classId: string, enemy = false): string {
  if (enemy) {
    const m: Record<string, string> = { line: 'enemy.medium', scout: 'enemy.light', bulwark: 'enemy.heavy', battery: 'enemy.missile', aegis: 'enemy.flame', strider: 'enemy.heavy' };
    return atlasHas(`${m[classId]}.r`) ? m[classId] : '';
  }
  const m: Record<string, string> = { line: 'tank.assault', scout: 'tank.scout', bulwark: 'tank.heavy', battery: 'tank.artillery' };
  const id = m[classId];
  return id && atlasHas(`${id}.r`) ? id : '';
}

export interface HullInfo {
  key: string;
  /** Barrel pivot relative to the sprite's bottom-centre origin. */
  pivotX: number;
  pivotY: number;
  width: number;
  height: number;
}

const hullCache = new Map<string, HullInfo>();

/**
 * Build `<skin>.<facing>.hull`: the sheet sprite with the protruding barrel
 * erased. The barrel is whatever sticks out past the hull's horizontal extent
 * in the upper half of the sprite.
 */
export function ensureHull(scene: Phaser.Scene, skin: string, facing: 'r' | 'l', colour = -1): HullInfo {
  const key = `${skin}.${facing}.hull.${colour}`;
  const cached = hullCache.get(key);
  if (cached) return cached;

  const src = scene.textures.get(`${skin}.${facing}`).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Hull extent from the lower 55% of rows (tracks + hull).
  let hullL = w;
  let hullR = -1;
  for (let y = Math.floor(h * 0.45); y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) {
        hullL = Math.min(hullL, x);
        hullR = Math.max(hullR, x);
      }
    }
  }
  // Turret extent from the upper rows: topmost opaque row and its span.
  let turretTop = h;
  for (let y = 0; y < h && turretTop === h; y++) {
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { turretTop = y; break; }
  }
  // Hull deck: first row whose opaque span covers most of the hull width.
  let hullTop = Math.floor(h * 0.45);
  for (let y = turretTop; y < h; y++) {
    let l = w, r = -1;
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { l = Math.min(l, x); r = Math.max(r, x); }
    if (r - l > (hullR - hullL) * 0.7) { hullTop = y; break; }
  }
  // Erase the baked-in barrel: everything above the deck that sits forward of
  // the turret on the barrel side, plus anything protruding past the hull.
  const cx = (hullL + hullR) / 2;
  const turretFront = facing === 'r' ? cx + (hullR - hullL) * 0.2 : cx - (hullR - hullL) * 0.2;
  for (let y = 0; y < Math.floor(h * 0.55); y++) {
    for (let x = 0; x < w; x++) {
      const forward = facing === 'r' ? x > turretFront : x < turretFront;
      const beyond = facing === 'r' ? x > hullR - 2 : x < hullL + 2;
      if ((y < hullTop && forward) || beyond) d[(y * w + x) * 4 + 3] = 0;
    }
  }
  if (colour >= 0) recolour(d, colour);
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);

  // Pivot: roughly the turret's front-centre.
  const turretMid = (turretTop + Math.floor(h * 0.45)) / 2;
  const pivotX = facing === 'r' ? (hullL + hullR) / 2 + (hullR - hullL) * 0.12 - w / 2 : (hullL + hullR) / 2 - (hullR - hullL) * 0.12 - w / 2;
  const info: HullInfo = { key, pivotX: Math.round(pivotX), pivotY: Math.round(turretMid - h), width: w, height: h };
  hullCache.set(key, info);
  return info;
}

/**
 * Push the sprite's saturated armour colours toward the team colour, leaving
 * greys (tracks, steel) and near-blacks alone. Hue comes from TEAM_COLOURS;
 * the sprite keeps its own shading.
 */
function recolour(d: Uint8ClampedArray, colour: number): void {
  const team = TEAM_COLOURS[colour % TEAM_COLOURS.length];
  const [th, ts] = rgbToHsl(team.mid);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    const [hh, ss, ll] = rgbToHsl((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    void hh;
    if (ss < 0.32 || ll < 0.12 || ll > 0.92) continue;
    const [r, g, b] = hslToRgb(th, Math.min(1, ss * (0.6 + ts * 0.6)), ll);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

function rgbToHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dlt = max - min;
  const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
  let h: number;
  if (max === r) h = (g - b) / dlt + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / dlt + 2;
  else h = (r - g) / dlt + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
