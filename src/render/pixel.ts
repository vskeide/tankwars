/**
 * Low-level pixel drawing onto an offscreen canvas. Every sprite, backdrop and
 * effect texture in the game is authored through this so the whole thing stays
 * on the fixed palette with ordered dithering — no anti-aliasing anywhere.
 */
import { hex } from '../core/palette';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** True when a pixel at (x,y) should take the "second" colour for blend factor t in 0..1. */
export function dither(x: number, y: number, t: number): boolean {
  return t * 16 > BAYER[y & 3][x & 3];
}

export interface TeamRamp {
  lit: number;
  mid: number;
  shade: number;
  dark: number;
}

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  px(x: number, y: number, col: number): void {
    this.ctx.fillStyle = hex(col);
    this.ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, col: number): void {
    this.ctx.fillStyle = hex(col);
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  disc(cx: number, cy: number, r: number, col: number): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.5) this.px(cx + x, cy + y, col);
      }
    }
  }

  ring(cx: number, cy: number, r: number, col: number): void {
    const inner = (r - 1) * (r - 1) + (r - 1) * 0.5;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d <= r * r + r * 0.5 && d > inner) this.px(cx + x, cy + y, col);
      }
    }
  }

  /** Dithered disc — solid to `solid` fraction of the radius, fading to nothing at the rim. */
  softDisc(cx: number, cy: number, r: number, col: number, solid = 0.6): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const t = d / r;
        if (t < solid || dither(cx + x, cy + y, 1 - (t - solid) / (1 - solid))) this.px(cx + x, cy + y, col);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, col: number, thick = 1, hilite?: number): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let k = 0; k < thick; k++) {
        this.px(x + k - Math.floor(thick / 2), y, k === 0 && hilite !== undefined ? hilite : col);
      }
    }
  }

  /**
   * A shaded block: highlight on top, shadow at the bottom, dithered ramps in
   * between and a lit left edge / dark right edge. The workhorse of turrets.
   */
  shadedBox(x: number, y: number, w: number, h: number, ramp: TeamRamp, bevel = 1): void {
    for (let yy = 0; yy < h; yy++) {
      const t = h > 1 ? yy / (h - 1) : 0;
      for (let xx = 0; xx < w; xx++) {
        let col: number;
        if (yy < bevel) col = ramp.lit;
        else if (yy >= h - bevel) col = ramp.dark;
        else if (t < 0.45) col = dither(x + xx, y + yy, (t - 0.2) / 0.25) ? ramp.mid : ramp.lit;
        else if (t < 0.75) col = dither(x + xx, y + yy, (t - 0.45) / 0.3) ? ramp.shade : ramp.mid;
        else col = dither(x + xx, y + yy, (t - 0.75) / 0.25) ? ramp.dark : ramp.shade;
        if (xx === 0) col = ramp.lit;
        if (xx === w - 1) col = ramp.dark;
        this.px(x + xx, y + yy, col);
      }
    }
  }

  /** Trapezoid hull, narrower at the top by `slope` pixels each side. */
  hull(x: number, y: number, w: number, h: number, ramp: TeamRamp, slope: number): void {
    for (let yy = 0; yy < h; yy++) {
      const inset = Math.round(slope * (1 - yy / (h - 1)));
      const x0 = x + inset;
      const ww = w - 2 * inset;
      const t = yy / (h - 1);
      for (let xx = 0; xx < ww; xx++) {
        let col: number;
        if (yy === 0) col = ramp.lit;
        else if (yy === h - 1) col = ramp.dark;
        else if (t < 0.4) col = dither(x0 + xx, y + yy, (t - 0.15) / 0.25) ? ramp.mid : ramp.lit;
        else if (t < 0.7) col = dither(x0 + xx, y + yy, (t - 0.4) / 0.3) ? ramp.shade : ramp.mid;
        else col = dither(x0 + xx, y + yy, (t - 0.7) / 0.3) ? ramp.dark : ramp.shade;
        if (xx === 0) col = ramp.lit;
        if (xx === ww - 1) col = ramp.dark;
        this.px(x0 + xx, y + yy, col);
      }
    }
  }

  rivets(x0: number, x1: number, y: number, step: number, col: number): void {
    for (let x = x0; x <= x1; x += step) this.px(x, y, col);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
