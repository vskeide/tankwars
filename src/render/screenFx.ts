/**
 * Camera-wide screen effects: the nuke flash, heat haze over burning napalm,
 * and a vignette that closes in as the tank on the clock gets shot to pieces.
 *
 * All three use Phaser's built-in post-FX pipelines rather than custom shaders,
 * so there is nothing to compile and nothing to fall back to. Every effect is
 * added lazily and removed again when idle: an always-on post-FX stack costs a
 * full-screen pass per effect, which is wasted on a mostly-static battlefield.
 */
import Phaser from 'phaser';

/** Rebuilt noise texture used as the displacement map for the heat haze. */
const HAZE_KEY = 'fx.haze';

export class ScreenFx {
  private vignette: Phaser.FX.Vignette | null = null;
  private haze: Phaser.FX.Displacement | null = null;
  private colour: Phaser.FX.ColorMatrix | null = null;
  private bloom: Phaser.FX.Bloom | null = null;

  /** Seconds left of each timed effect. */
  private hazeLeft = 0;
  private flashLeft = 0;
  private flashTotal = 0;
  /** 0 = healthy, 1 = about to die. Smoothed so the vignette does not pop. */
  private hurt = 0;

  constructor(private scene: Phaser.Scene) {
    ensureHazeTexture(scene);
  }

  /**
   * Nuke/thermobaric detonation: a hard white bloom with the colour channels
   * pulled apart, so the frame reads as an overexposed blast rather than a
   * bigger version of the normal explosion puff.
   */
  bigBlast(seconds = 0.55): void {
    this.flashLeft = Math.max(this.flashLeft, seconds);
    this.flashTotal = this.flashLeft;
  }

  /** Napalm is burning somewhere: shimmer the frame while it does. */
  heatHaze(seconds = 2.2): void {
    this.hazeLeft = Math.max(this.hazeLeft, seconds);
  }

  /** Called every frame with the HP fraction of the tank the player is watching. */
  setHealth(fraction: number): void {
    // Only the last third of the bar drives the vignette; above that, nothing.
    const target = fraction >= 0.35 ? 0 : Math.min(1, (0.35 - fraction) / 0.35);
    this.hurt += (target - this.hurt) * 0.08;
  }

  update(dt: number): void {
    const fx = this.scene.cameras.main.postFX;

    // ---- low-HP vignette
    if (this.hurt > 0.02) {
      if (!this.vignette) this.vignette = fx.addVignette(0.5, 0.5, 0.9, 0.15);
      // Darkens the corners and breathes; deliberately mild, because the camera
      // post-FX covers the HUD too and the battlefield has to stay readable at
      // 1 HP. Radius closes only a little as the hull goes.
      const pulse = 0.97 + 0.03 * Math.sin(this.scene.time.now / 300);
      this.vignette.radius = (0.9 - 0.28 * this.hurt) * pulse;
      this.vignette.strength = 0.15 + 0.3 * this.hurt;
    } else if (this.vignette) {
      fx.remove(this.vignette);
      this.vignette = null;
    }

    // ---- napalm heat haze
    if (this.hazeLeft > 0) {
      this.hazeLeft -= dt;
      if (!this.haze) this.haze = fx.addDisplacement(HAZE_KEY, 0.012, 0.012);
      // Fade the distortion out as the fire dies, and wobble it so it breathes.
      const k = Math.min(1, this.hazeLeft / 1.2);
      const wobble = 0.008 + 0.006 * Math.sin(this.scene.time.now / 180);
      this.haze.x = wobble * k;
      this.haze.y = (wobble * 1.6) * k;
    } else if (this.haze) {
      fx.remove(this.haze);
      this.haze = null;
    }

    // ---- nuke flash
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      const k = Math.max(0, this.flashLeft / Math.max(0.001, this.flashTotal));
      if (!this.colour) this.colour = fx.addColorMatrix();
      if (!this.bloom) this.bloom = fx.addBloom(0xffffff, 1, 1, 1.1, 1);
      // Brightness spike decaying to normal, with the hue swept as it falls —
      // channels drift apart, which is what sells the blast as chromatic.
      // Kept short of a full white-out so the shot stays readable.
      this.colour.brightness(1 + 0.9 * k * k);
      this.colour.hue(30 * k * Math.sin(this.scene.time.now / 40));
      this.bloom.strength = 0.9 * k;
    } else if (this.colour || this.bloom) {
      // FX.ColorMatrix extends Display.ColorMatrix rather than FX.Controller in
      // Phaser's typings, so removing it needs the cast; it is a real controller
      // in the FX list at runtime.
      if (this.colour) fx.remove(this.colour as unknown as Phaser.FX.Controller);
      if (this.bloom) fx.remove(this.bloom);
      this.colour = null;
      this.bloom = null;
    }
  }

  /** Drop every pipeline — the scene is shutting down or restarting. */
  destroy(): void {
    this.scene.cameras.main.postFX.clear();
    this.vignette = null;
    this.haze = null;
    this.colour = null;
    this.bloom = null;
  }
}

/**
 * Smooth-ish value noise baked once into a texture. Phaser's displacement FX
 * reads the red/green channels as an offset vector, so the two channels get
 * independent noise fields.
 */
function ensureHazeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HAZE_KEY)) return;
  const size = 128;
  const cell = 16;
  const grid = size / cell + 1;
  const field = (seed: number) => {
    const g: number[] = [];
    let s = seed;
    for (let i = 0; i < grid * grid; i++) {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      g.push((s / 0x7fffffff) * 255);
    }
    return g;
  };
  const a = field(12345);
  const b = field(98765);
  const tex = scene.textures.createCanvas(HAZE_KEY, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const img = ctx.createImageData(size, size);
  const sample = (g: number[], x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    // Smoothstep the interpolation so the field has no visible grid lines.
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number) => g[Math.min(grid - 1, iy) * grid + Math.min(grid - 1, ix)];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.data[i] = sample(a, x, y);
      img.data[i + 1] = sample(b, x, y);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}
