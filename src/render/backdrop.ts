/**
 * Procedural backdrop: dithered sunset sky, stars, high cloud, retro sun with
 * horizon bars, two layers of parallax mesas, and horizon haze. Rendered once
 * per round into textures; the mesa layers scroll a few pixels with the camera.
 *
 * Slot for ChatGPT/Midjourney art: if a texture named `backdrop-custom` is
 * loaded, BattleScene uses it instead of the procedural sky.
 */
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import { Rng } from '../core/rng';
import { PixelCanvas, dither } from './pixel';

export interface BackdropTextures {
  sky: string;
  farMesas: string;
  nearMesas: string;
}

export function buildBackdrop(scene: Phaser.Scene, width: number, height: number, horizon: number, seed: number): BackdropTextures {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const skyKey = `sky-${seed}`;
  const farKey = `mesa-far-${seed}`;
  const nearKey = `mesa-near-${seed}`;

  if (!scene.textures.exists(skyKey)) {
    scene.textures.addCanvas(skyKey, sky(width, height, horizon, rng).canvas);
    scene.textures.addCanvas(farKey, mesas(width + 120, horizon, rng, PAL.farRock, undefined, [
      [0.23, 0.26], [0.12, 0.13], [0.27, 0.19], [0.29, 0.29],
    ]).canvas);
    scene.textures.addCanvas(nearKey, mesas(width + 240, horizon, rng, PAL.midRock, PAL.nearRock, [
      [0.16, 0.15], [0.2, 0.12], [0.17, 0.17],
    ]).canvas);
  }
  return { sky: skyKey, farMesas: farKey, nearMesas: nearKey };
}

function sky(width: number, height: number, horizon: number, rng: Rng): PixelCanvas {
  const p = new PixelCanvas(width, height);
  const img = p.ctx.createImageData(width, height);
  const d = img.data;
  const put = (x: number, y: number, c: number) => {
    const i = (y * width + x) * 4;
    d[i] = (c >> 16) & 255;
    d[i + 1] = (c >> 8) & 255;
    d[i + 2] = c & 255;
    d[i + 3] = 255;
  };
  const bands = [PAL.skyTop, PAL.skyHigh, PAL.skyMid, PAL.skyLow, PAL.skyHorizon];
  for (let y = 0; y < height; y++) {
    const t = Math.min(1, y / horizon) * (bands.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < width; x++) {
      put(x, y, i < bands.length - 1 && dither(x, y, f) ? bands[i + 1] : bands[i]);
    }
  }
  // Wispy high cloud
  for (let k = 0; k < 6; k++) {
    const cy = height * 0.08 + k * height * 0.065 + rng.range(0, 30);
    const len = rng.range(500, 1400);
    const x0 = rng.range(-300, width);
    const hgt = rng.range(6, 16);
    for (let x = 0; x < len; x++) {
      const X = Math.floor(x0 + x);
      if (X < 0 || X >= width) continue;
      const env = Math.sin((x / len) * Math.PI);
      for (let y = 0; y < hgt * env; y++) {
        const Y = Math.floor(cy + y - (hgt * env) / 2 + Math.sin(x / 60) * 4);
        if (Y >= 0 && Y < height && dither(X, Y, 0.35 * env)) put(X, Y, PAL.skyMid);
      }
    }
  }
  // Stars in the dark band
  for (let i = 0; i < 260; i++) {
    const x = rng.int(0, width - 1);
    const y = rng.int(0, Math.floor(height * 0.24));
    put(x, y, rng.next() < 0.25 ? PAL.uiText : PAL.uiTextDim);
  }
  p.ctx.putImageData(img, 0, 0);

  // Retro sun
  const sx = Math.floor(width * rng.range(0.6, 0.8));
  const sy = Math.floor(horizon - height * 0.11);
  const R = Math.floor(height * 0.12);
  for (let y = -R - 30; y <= R + 30; y++) {
    for (let x = -R - 30; x <= R + 30; x++) {
      const dd = Math.hypot(x, y);
      if (dd <= R) p.px(sx + x, sy + y, dd < R - 16 ? PAL.sunCore : PAL.sunGlow);
      else if (dd <= R + 30 && dither(sx + x, sy + y, 1 - (dd - R) / 30)) p.px(sx + x, sy + y, PAL.sunGlow);
    }
  }
  for (let y = sy + 8, gap = 7; y <= sy + R; y += gap, gap += 2) {
    const th = Math.min(9, 2 + Math.floor((y - sy) / 22));
    for (let x = sx - R - 2; x <= sx + R + 2; x++) {
      if (Math.hypot(x - sx, y - sy) <= R + 1) p.rect(x, y, 1, th, PAL.skyLow);
    }
  }
  // Horizon haze
  for (let y = horizon - 36; y < Math.min(height, horizon + 8); y++) {
    for (let x = 0; x < width; x++) {
      if (dither(x, y, ((y - (horizon - 36)) / 44) * 0.75)) p.px(x, y, PAL.skyHorizon);
    }
  }
  return p;
}

/** A transparent strip of mesas whose bottom edge sits at `horizon`. */
function mesas(
  width: number,
  horizon: number,
  rng: Rng,
  col: number,
  tex: number | undefined,
  shapes: [number, number][],
): PixelCanvas {
  const p = new PixelCanvas(width, horizon + 8);
  let x = rng.range(-80, 40);
  for (const [wFrac, hFrac] of shapes) {
    const w = Math.floor(width * wFrac);
    const h = Math.floor(horizon * hFrac);
    const topW = Math.floor(w * rng.range(0.4, 0.55));
    mesa(p, Math.floor(x), w, h, horizon, col, topW, tex, rng);
    x += w + rng.range(40, width * 0.12);
    if (x > width) break;
  }
  return p;
}

function mesa(p: PixelCanvas, x0: number, w: number, h: number, horizon: number, col: number, topW: number, tex: number | undefined, rng: Rng): void {
  for (let x = 0; x < w; x++) {
    const edge = Math.min(x, w - 1 - x);
    const hh = edge < (w - topW) / 2 ? Math.round(h * Math.pow(edge / ((w - topW) / 2), 0.45)) : h;
    for (let y = 0; y < hh + 8; y++) {
      const Y = horizon - hh + y;
      let c = col;
      if (tex !== undefined) {
        if (y < 4) c = tex;
        if ((y + ((x / 9) | 0)) % 17 === 0 && dither(x0 + x, Y, 0.6)) c = tex;
        if (rng.next() < 0.01) c = tex;
      }
      p.px(x0 + x, Y, c);
    }
  }
}
