/**
 * Procedural pixel-art tank sprites. Each hull is drawn from primitives
 * (tracks, trapezoid hull, shaded turret, fittings) so it can be recoloured
 * per team, re-shaded, and later animated without any binary asset files.
 *
 * Sprite frame: SPR_W × SPR_H, tank standing on the bottom row, x-centred.
 */
import Phaser from 'phaser';
import { PAL, TEAM_COLOURS } from '../core/palette';
import type { TankClass } from '../core/tanks';
import { PixelCanvas, type TeamRamp } from './pixel';

export const SPR_W = 96;
export const SPR_H = 64;

export interface HullMeta {
  /** Barrel pivot relative to the sprite's bottom-centre origin. */
  pivotX: number;
  pivotY: number;
  barrelLen: number;
  barrelThick: number;
  brake: boolean;
}

export function teamRamp(colourIndex: number): TeamRamp {
  const c = TEAM_COLOURS[colourIndex % TEAM_COLOURS.length];
  // Insert a "shade" tone between mid and dark by averaging.
  const mix = (a: number, b: number) => {
    const r = (((a >> 16) & 255) + ((b >> 16) & 255)) >> 1;
    const g = (((a >> 8) & 255) + ((b >> 8) & 255)) >> 1;
    const bl = ((a & 255) + (b & 255)) >> 1;
    return (r << 16) | (g << 8) | bl;
  };
  return { lit: c.lit, mid: mix(c.lit, c.mid), shade: c.mid, dark: c.dark };
}

// ---- fittings ----------------------------------------------------------

function tracks(p: PixelCanvas, x: number, y: number, w: number, h: number, wheelR: number, nWheels: number, phase = 0): void {
  p.rect(x + 2, y, w - 4, h, PAL.steelBlack);
  p.rect(x, y + 2, w, h - 4, PAL.steelBlack);
  p.rect(x + 1, y + 1, w - 2, h - 2, PAL.steelBlack);
  for (let xx = 1; xx < w - 1; xx++) {
    const on = ((xx + phase) >> 1) & 1;
    p.px(x + xx, y, on ? PAL.steel : PAL.steelDark);
    p.px(x + xx, y + 1, on ? PAL.steelDark : PAL.steelBlack);
    p.px(x + xx, y + h - 1, on ? PAL.steel : PAL.steelDark);
    p.px(x + xx, y + h - 2, on ? PAL.steelDark : PAL.steelBlack);
  }
  const span = w - 2 * (wheelR + 3);
  const cy = y + Math.floor(h / 2);
  for (let i = 0; i < nWheels; i++) {
    const cx = x + wheelR + 3 + Math.round((span * i) / (nWheels - 1));
    p.disc(cx, cy, wheelR, PAL.steelDark);
    p.ring(cx, cy, wheelR, PAL.steel);
    p.disc(cx, cy, Math.max(1, wheelR - 3), PAL.steelBlack);
    p.px(cx, cy, PAL.steel);
    p.px(cx - 1, cy - 1, PAL.steelLit);
  }
  p.px(x, y + 2, PAL.steel);
  p.px(x + w - 1, y + 2, PAL.steel);
}

function exhaust(p: PixelCanvas, x: number, y: number): void {
  p.rect(x, y, 3, 7, PAL.steelDark);
  p.px(x, y, PAL.steel);
  p.rect(x - 1, y - 2, 5, 2, PAL.steelBlack);
}

function lamp(p: PixelCanvas, x: number, y: number): void {
  p.rect(x, y, 3, 3, PAL.steelBlack);
  p.px(x + 1, y + 1, PAL.fireHot);
  p.px(x + 1, y, PAL.fireCore);
}

function antenna(p: PixelCanvas, x: number, y: number, h: number, ramp: TeamRamp): void {
  for (let i = 0; i < h; i++) p.px(x, y - i, i & 1 ? PAL.steel : PAL.steelDark);
  p.px(x, y - h, ramp.lit);
}

function hatch(p: PixelCanvas, cx: number, y: number, w: number, ramp: TeamRamp): void {
  p.rect(cx - Math.floor(w / 2), y, w, 2, ramp.shade);
  p.rect(cx - Math.floor(w / 2) + 1, y, w - 2, 1, ramp.lit);
}

// ---- hull designs. Origin (0,0) = bottom-centre of the sprite. ------------

type Design = (p: PixelCanvas, cx: number, by: number, ramp: TeamRamp) => HullMeta;

const DESIGNS: Record<TankClass['silhouette'], Design> = {
  line(p, cx, by, ramp) {
    const w = 72, th = 13, hh = 13, hw = 60, tw = 30, tth = 11;
    tracks(p, cx - w / 2, by - th, w, th, 5, 6);
    const hy = by - th - hh + 2;
    p.hull(cx - hw / 2, hy, hw, hh, ramp, 5);
    p.rivets(cx - hw / 2 + 8, cx + hw / 2 - 8, hy + 3, 6, ramp.dark);
    p.rect(cx - hw / 2 + 6, hy + 7, hw - 12, 1, ramp.dark);
    p.rect(cx + 6, hy + 8, 7, 3, ramp.shade);
    p.ring(cx + 9, hy + 9, 1, ramp.dark);
    exhaust(p, cx - hw / 2 + 4, hy - 6);
    lamp(p, cx + hw / 2 - 6, hy + 2);
    const ty = hy - tth;
    p.shadedBox(cx - tw / 2, ty, tw, tth, ramp);
    p.rect(cx - tw / 2 + 2, ty, tw - 4, 1, ramp.lit);
    hatch(p, cx + 1, ty - 1, 10, ramp);
    p.rivets(cx - tw / 2 + 3, cx + tw / 2 - 3, ty + 4, 5, ramp.dark);
    antenna(p, cx - tw / 2 + 3, ty, 9, ramp);
    const px = cx + tw / 2 - 4, py = ty + 5;
    p.disc(px, py, 3, ramp.shade);
    p.px(px - 1, py - 1, ramp.lit);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 30, barrelThick: 3, brake: true };
  },

  light(p, cx, by, ramp) {
    const w = 56, th = 10, hh = 10, hw = 48, tw = 20, tth = 8;
    tracks(p, cx - w / 2, by - th, w, th, 4, 4);
    const hy = by - th - hh + 2;
    p.hull(cx - hw / 2, hy, hw, hh, ramp, 7);
    p.rivets(cx - hw / 2 + 9, cx + hw / 2 - 9, hy + 3, 5, ramp.dark);
    lamp(p, cx + hw / 2 - 8, hy + 2);
    exhaust(p, cx - hw / 2 + 6, hy - 5);
    const ty = hy - tth;
    p.shadedBox(cx - tw / 2, ty, tw, tth, ramp);
    hatch(p, cx, ty - 1, 7, ramp);
    antenna(p, cx - tw / 2 + 2, ty, 11, ramp);
    const px = cx + tw / 2 - 3, py = ty + 4;
    p.disc(px, py, 2, ramp.shade);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 22, barrelThick: 3, brake: false };
  },

  heavy(p, cx, by, ramp) {
    const w = 84, th = 15, hh = 16, hw = 74, tw = 36, tth = 12;
    tracks(p, cx - w / 2, by - th, w, th, 6, 6);
    const hy = by - th - hh + 2;
    p.hull(cx - hw / 2, hy, hw, hh, ramp, 3);
    p.rivets(cx - hw / 2 + 6, cx + hw / 2 - 6, hy + 3, 5, ramp.dark);
    p.rivets(cx - hw / 2 + 6, cx + hw / 2 - 6, hy + 11, 5, ramp.dark);
    p.rect(cx - hw / 2 + 4, hy + 7, hw - 8, 1, ramp.dark);
    for (let i = 0; i < 4; i++) {
      p.rect(cx - hw / 2 + 10 + i * 16, hy + 8, 12, 5, ramp.shade);
      p.rect(cx - hw / 2 + 10 + i * 16, hy + 8, 12, 1, ramp.mid);
    }
    exhaust(p, cx - hw / 2 + 6, hy - 6);
    exhaust(p, cx - hw / 2 + 11, hy - 6);
    lamp(p, cx + hw / 2 - 7, hy + 2);
    lamp(p, cx + hw / 2 - 12, hy + 2);
    const ty = hy - tth;
    p.shadedBox(cx - tw / 2, ty, tw, tth, ramp);
    p.rect(cx - tw / 2 + 2, ty, tw - 4, 1, ramp.lit);
    hatch(p, cx + 1, ty - 1, 12, ramp);
    p.rivets(cx - tw / 2 + 3, cx + tw / 2 - 3, ty + 4, 4, ramp.dark);
    p.rivets(cx - tw / 2 + 3, cx + tw / 2 - 3, ty + 9, 4, ramp.dark);
    antenna(p, cx - tw / 2 + 4, ty, 7, ramp);
    const px = cx + tw / 2 - 5, py = ty + 6;
    p.disc(px, py, 4, ramp.shade);
    p.px(px - 1, py - 1, ramp.lit);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 28, barrelThick: 5, brake: true };
  },

  artillery(p, cx, by, ramp) {
    const w = 76, th = 12, hh = 12, hw = 66, tw = 24, tth = 9;
    tracks(p, cx - w / 2, by - th, w, th, 5, 5);
    const hy = by - th - hh + 2;
    p.hull(cx - hw / 2, hy, hw, hh, ramp, 6);
    p.rivets(cx - hw / 2 + 9, cx + hw / 2 - 9, hy + 3, 6, ramp.dark);
    p.rect(cx - hw / 2 + 7, hy + 6, hw - 14, 1, ramp.dark);
    p.rect(cx - hw / 2 - 4, by - 4, 6, 4, PAL.steelDark);
    p.px(cx - hw / 2 - 4, by - 4, PAL.steel);
    exhaust(p, cx - hw / 2 + 8, hy - 6);
    lamp(p, cx + hw / 2 - 7, hy + 2);
    const ty = hy - tth;
    p.shadedBox(cx - tw / 2 - 6, ty, tw, tth, ramp);
    p.rect(cx - tw / 2 - 4, ty, tw - 4, 1, ramp.lit);
    antenna(p, cx - tw / 2 - 4, ty, 12, ramp);
    const px = cx + tw / 2 - 8, py = ty + 4;
    p.rect(px - 1, py - 1, 4, 5, ramp.shade);
    p.px(px - 1, py - 1, ramp.lit);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 44, barrelThick: 3, brake: true };
  },

  hover(p, cx, by, ramp) {
    const hh = 12, hw = 64, tw = 26, tth = 9;
    const by2 = by - 6;
    for (const dx of [-22, 0, 22]) {
      p.rect(cx + dx - 4, by2 - 2, 9, 3, PAL.steelBlack);
      p.rect(cx + dx - 3, by2 - 2, 7, 1, PAL.steelDark);
    }
    p.hull(cx - hw / 2, by2 - hh, hw, hh, ramp, 9);
    p.rivets(cx - hw / 2 + 11, cx + hw / 2 - 11, by2 - hh + 3, 6, ramp.dark);
    p.rect(cx - hw / 2 + 9, by2 - hh + 6, hw - 18, 1, ramp.dark);
    for (const dx of [-hw / 2 + 6, hw / 2 - 8]) {
      p.rect(cx + dx, by2 - hh - 3, 3, 3, PAL.steelDark);
      p.px(cx + dx + 1, by2 - hh - 4, PAL.glow);
      p.px(cx + dx + 1, by2 - hh - 5, PAL.glowCore);
    }
    const ty = by2 - hh - tth;
    p.shadedBox(cx - tw / 2, ty, tw, tth, ramp);
    p.rect(cx - tw / 2 + 2, ty, tw - 4, 1, ramp.lit);
    hatch(p, cx, ty - 1, 9, ramp);
    const px = cx + tw / 2 - 4, py = ty + 4;
    p.disc(px, py, 3, ramp.shade);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 26, barrelThick: 3, brake: false };
  },

  walker(p, cx, by, ramp) {
    const hh = 13, hw = 54, tw = 24, tth = 9;
    const by2 = by - 14;
    const legs: [number, number, number][] = [[-20, -30, -38], [-6, -14, -20], [8, 18, 24], [22, 34, 42]];
    for (const [hx, kx, fx] of legs) {
      p.line(cx + hx, by2 - 2, cx + kx, by2 + 7, PAL.steelDark, 3, PAL.steelLit);
      p.line(cx + kx, by2 + 7, cx + fx, by - 1, PAL.steel, 2, PAL.steelLit);
      p.rect(cx + fx - 3, by - 2, 7, 2, PAL.steelBlack);
      p.disc(cx + kx, by2 + 7, 2, PAL.steelDark);
      p.px(cx + kx, by2 + 7, PAL.steelLit);
      p.disc(cx + hx, by2 - 2, 2, ramp.dark);
    }
    p.hull(cx - hw / 2, by2 - hh, hw, hh, ramp, 4);
    p.rivets(cx - hw / 2 + 7, cx + hw / 2 - 7, by2 - hh + 3, 6, ramp.dark);
    p.rect(cx - hw / 2 + 5, by2 - hh + 7, hw - 10, 1, ramp.dark);
    lamp(p, cx + hw / 2 - 7, by2 - hh + 3);
    exhaust(p, cx - hw / 2 + 5, by2 - hh - 7);
    const ty = by2 - hh - tth;
    p.shadedBox(cx - tw / 2, ty, tw, tth, ramp);
    p.rect(cx - tw / 2 + 2, ty, tw - 4, 1, ramp.lit);
    hatch(p, cx, ty - 1, 9, ramp);
    antenna(p, cx - tw / 2 + 3, ty, 8, ramp);
    const px = cx + tw / 2 - 4, py = ty + 4;
    p.disc(px, py, 3, ramp.shade);
    return { pivotX: px - cx, pivotY: py - by, barrelLen: 28, barrelThick: 3, brake: true };
  },
};

// ---- texture generation -------------------------------------------------

const metaCache = new Map<string, HullMeta>();

export function hullTextureKey(cls: TankClass, colour: number): string {
  return `hull-${cls.id}-${colour}`;
}

export function barrelTextureKey(cls: TankClass, colour: number): string {
  return `barrel-${cls.id}-${colour}`;
}

export function hullMeta(cls: TankClass, colour: number): HullMeta {
  const m = metaCache.get(hullTextureKey(cls, colour));
  if (!m) throw new Error('hull texture not built yet');
  return m;
}

/** Build (once) the hull and barrel textures for a class/colour pair. */
export function ensureTankTextures(scene: Phaser.Scene, cls: TankClass, colour: number): HullMeta {
  const key = hullTextureKey(cls, colour);
  const cached = metaCache.get(key);
  if (cached && scene.textures.exists(key)) return cached;

  const ramp = teamRamp(colour);
  const p = new PixelCanvas(SPR_W, SPR_H);
  const meta = DESIGNS[cls.silhouette](p, SPR_W / 2, SPR_H - 1, ramp);
  scene.textures.addCanvas(key, p.canvas);
  metaCache.set(key, meta);

  // Barrel: drawn pointing right, pivot at the left edge, vertically centred.
  const len = meta.barrelLen;
  const th = meta.barrelThick + 2;
  const b = new PixelCanvas(len + 4, th + 2);
  const midY = Math.floor(b.height / 2);
  for (let i = 0; i < len; i++) {
    for (let t = -Math.floor(meta.barrelThick / 2); t <= Math.floor(meta.barrelThick / 2); t++) {
      const col = t < 0 ? PAL.steelLit : t === 0 ? PAL.steel : PAL.steelDark;
      b.px(2 + i, midY + t, i < 4 ? ramp.shade : col);
    }
  }
  if (meta.brake) {
    for (let i = len - 5; i < len; i++) {
      for (let t = -Math.floor(meta.barrelThick / 2) - 1; t <= Math.floor(meta.barrelThick / 2) + 1; t++) {
        b.px(2 + i, midY + t, i & 1 ? PAL.steelDark : PAL.steelBlack);
      }
    }
  }
  scene.textures.addCanvas(barrelTextureKey(cls, colour), b.canvas);
  return meta;
}

// ---- small shared textures ----------------------------------------------

export function ensureCommonTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('dot')) return;

  // Generic 1px-friendly particle discs in a few sizes.
  for (const r of [1, 2, 3, 4, 6]) {
    const p = new PixelCanvas(r * 2 + 1, r * 2 + 1);
    p.disc(r, r, r, 0xffffff);
    scene.textures.addCanvas(`dot${r}`, p.canvas);
  }
  const one = new PixelCanvas(1, 1);
  one.px(0, 0, 0xffffff);
  scene.textures.addCanvas('dot', one.canvas);

  // Shell: a 5x3 pill with a hot tip.
  const shell = new PixelCanvas(6, 3);
  shell.rect(0, 1, 5, 1, PAL.steel);
  shell.rect(1, 0, 3, 3, PAL.steelLit);
  shell.px(5, 1, PAL.fireHot);
  scene.textures.addCanvas('shell', shell.canvas);

  // Chunky debris bits.
  for (let i = 0; i < 4; i++) {
    const d = new PixelCanvas(3, 3);
    const cols = [PAL.dirt, PAL.dirtDark, PAL.bedrock, PAL.steelDark];
    d.rect(0, 0, 2 + (i & 1), 2 + ((i >> 1) & 1), cols[i]);
    scene.textures.addCanvas(`debris${i}`, d.canvas);
  }
}
