/**
 * Visual effects: explosions, smoke, debris, muzzle flash, damage numbers,
 * screen shake. Uses atlas animation frames when the sheet provides them and
 * falls back to palette particles otherwise.
 */
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import type { Weapon } from '../core/weapons';
import { atlasHas, spriteScale } from './atlas';

export class Fx {
  private readonly particles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashes: Phaser.GameObjects.Graphics;
  private flashAlpha = 0;

  /**
   * Play a frame sequence `prefix.0 … prefix.N` from the atlas at a world point.
   * Returns null when the sheet is missing so callers can fall back.
   */
  anim(prefix: string, x: number, y: number, opts: { scale?: number; frameRate?: number; rotation?: number; originX?: number; originY?: number; depth?: number; loopMs?: number; flipX?: boolean } = {}): Phaser.GameObjects.Sprite | null {
    if (!atlasHas(`${prefix}.0`)) return null;
    const key = `anim:${prefix}`;
    if (!this.scene.anims.exists(key)) {
      const frames: { key: string }[] = [];
      for (let i = 0; i < 16 && atlasHas(`${prefix}.${i}`); i++) frames.push({ key: `${prefix}.${i}` });
      this.scene.anims.create({ key, frames, frameRate: opts.frameRate ?? 16, repeat: opts.loopMs ? -1 : 0 });
    }
    const spr = this.scene.add.sprite(x, this.y(y), `${prefix}.0`).setDepth(opts.depth ?? 42);
    spr.setScale(opts.scale ?? spriteScale(`${prefix}.0`));
    spr.setOrigin(opts.originX ?? 0.5, opts.originY ?? 0.5);
    if (opts.rotation !== undefined) spr.setRotation(opts.rotation);
    if (opts.flipX) spr.setFlipX(true);
    spr.play(key);
    if (opts.loopMs) this.scene.time.delayedCall(opts.loopMs, () => spr.destroy());
    else spr.once('animationcomplete', () => spr.destroy());
    return spr;
  }

  constructor(private scene: Phaser.Scene, private worldY: number) {
    // Fire particles
    this.particles = scene.add.particles(0, 0, 'dot2', {
      lifespan: { min: 250, max: 650 },
      speed: { min: 40, max: 180 },
      scale: { start: 4.4, end: 0 },
      tint: [PAL.fireCore, PAL.fireHot, PAL.fireMid, PAL.fireDeep],
      gravityY: -30,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(40);
    this.smoke = scene.add.particles(0, 0, 'dot3', {
      lifespan: { min: 900, max: 2200 },
      speed: { min: 12, max: 56 },
      angle: { min: 250, max: 290 },
      scale: { start: 2.4, end: 6.4 },
      alpha: { start: 0.85, end: 0 },
      tint: [PAL.smoke, PAL.smokeLight],
      gravityY: -18,
      emitting: false,
    }).setDepth(38);
    this.debris = scene.add.particles(0, 0, 'debris0', {
      lifespan: { min: 600, max: 1400 },
      speed: { min: 120, max: 400 },
      angle: { min: 200, max: 340 },
      gravityY: 520,
      rotate: { start: 0, end: 360 },
      emitting: false,
      frame: undefined,
    }).setDepth(39);
    this.sparks = scene.add.particles(0, 0, 'dot', {
      lifespan: { min: 120, max: 400 },
      speed: { min: 160, max: 440 },
      scale: { start: 3, end: 0 },
      tint: [PAL.glowCore, PAL.glow, PAL.fireHot],
      gravityY: 240,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(41);
    this.flashes = scene.add.graphics().setDepth(90).setScrollFactor(0);
  }

  private y(y: number): number {
    return y + this.worldY;
  }

  explosion(x: number, y: number, radius: number, weapon: Weapon): void {
    const yy = this.y(y);
    const big = radius > 50;
    void big;
    const size = weapon.behaviour === 'nuke' ? 'nuke' : radius > 110 ? 'large' : radius > 60 ? 'medium' : 'small';
    const size2 = atlasHas(`fx.explosion.${size}.0`) ? size : 'medium';
    if (atlasHas(`fx.explosion.${size2}.0`)) {
      // Frame sheets are small; pick an integer scale so the blast roughly spans the radius.
      const probe = this.scene.textures.get(`fx.explosion.${size2}.3`).getSourceImage() as { width: number };
      const scale = Math.max(2, Math.min(6, Math.round((radius * 2.2) / Math.max(probe.width, 1))));
      this.anim(`fx.explosion.${size2}`, x, y, { scale, frameRate: 16, originY: size2 === 'nuke' ? 0.9 : 0.5, depth: 42 });
    } else {
      // Fallback: a couple of expanding palette rings.
      const g = this.scene.add.graphics().setDepth(42);
      const rings = [PAL.fireDeep, PAL.fireMid, PAL.fireHot, PAL.fireCore];
      let t = 0;
      const ev = this.scene.time.addEvent({
        delay: 30,
        repeat: 12,
        callback: () => {
          t += 1;
          g.clear();
          rings.forEach((c, i) => {
            const r = Math.max(0, radius * Math.min(1, t / 5) * (1 - i * 0.22) - (t > 7 ? (t - 7) * radius * 0.2 : 0));
            if (r > 0) g.fillStyle(c, 1).fillCircle(x, yy, r);
          });
          if (t >= 12) {
            g.destroy();
            ev.remove();
          }
        },
      });
    }
    this.particles.explode(Math.round(radius * 0.7), x, yy);
    this.smoke.explode(Math.round(radius * 0.25), x, yy - radius * 0.3);
    this.debris.explode(Math.round(radius * 0.4), x, yy);
    this.shake(Math.min(0.02, radius / 5000), 120 + radius * 1.5);
    if (weapon.behaviour === 'nuke') this.whiteFlash(0.9);
  }

  muzzleFlash(x: number, y: number, angleDeg: number): void {
    const yy = this.y(y);
    const a = (angleDeg * Math.PI) / 180;
    if (this.anim('fx.flash', x, y, { scale: 2, frameRate: 30, rotation: -a, originX: 0.12, originY: 0.5, depth: 44 })) {
      this.shake(0.004, 60);
      return;
    }
    this.sparks.setAngle(-angleDeg);
    this.sparks.explode(14, x + Math.cos(a) * 4, yy - Math.sin(a) * 4);
    this.sparks.setAngle(0);
    const g = this.scene.add.graphics().setDepth(43);
    g.fillStyle(PAL.fireCore, 1).fillCircle(x, yy, 6);
    g.fillStyle(PAL.fireHot, 0.8).fillCircle(x, yy, 12);
    this.scene.time.delayedCall(60, () => g.destroy());
    this.shake(0.004, 60);
  }

  burn(x: number, y: number): void {
    const yy = this.y(y);
    if (this.anim('fx.burn', x, y, { scale: 2, frameRate: 12, originY: 1, loopMs: 4500, depth: 40 })) return;
    const e = this.scene.add.particles(x, yy, 'dot2', {
      lifespan: { min: 300, max: 700 },
      speed: { min: 10, max: 50 },
      angle: { min: 250, max: 290 },
      scale: { start: 3.2, end: 0 },
      tint: [PAL.fireHot, PAL.fireMid, PAL.fireDeep],
      frequency: 40,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(40);
    this.scene.time.delayedCall(4500, () => {
      e.stop();
      this.scene.time.delayedCall(800, () => e.destroy());
    });
  }

  split(x: number, y: number): void {
    if (!this.anim('fx.sparks', x, y, { scale: 2, frameRate: 20 })) this.sparks.explode(10, x, this.y(y));
  }

  landDust(x: number, y: number, strength: number): void {
    if (this.anim('fx.dust', x, y, { scale: Math.round(1 + strength * 0.5) + 1, frameRate: 14, originY: 1 })) return;
    this.smoke.explode(Math.round(3 + strength * 6), x, this.y(y));
  }

  /** Shield ripple on a tank. */
  shieldHit(x: number, y: number): void {
    this.anim('fx.shield', x, y, { scale: 2, frameRate: 18, depth: 45 });
  }

  /** Steel-on-steel impact (direct hit with no explosion frame yet). */
  impact(x: number, y: number): void {
    this.anim('fx.impact', x, y, { scale: 2, frameRate: 22, depth: 44 });
  }

  /** Lingering smoke plume (destroyed hull). */
  smokePlume(x: number, y: number): void {
    this.anim('fx.smoke', x, y, { scale: 3, frameRate: 6, originY: 1, depth: 39 });
  }

  damageNumber(x: number, y: number, amount: number, colour: number = PAL.uiText): void {
    const t = this.scene.add
      .text(x, this.y(y) - 30, `-${amount}`, { fontFamily: 'monospace', fontSize: '18px', color: '#' + colour.toString(16).padStart(6, '0'), stroke: '#0d0709', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(80);
    this.scene.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  shake(intensity: number, ms: number): void {
    this.scene.cameras.main.shake(ms, intensity);
  }

  whiteFlash(alpha: number): void {
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  update(dt: number): void {
    if (this.flashAlpha > 0) {
      this.flashes.clear();
      this.flashes.fillStyle(0xffffff, this.flashAlpha).fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.6);
      if (this.flashAlpha === 0) this.flashes.clear();
    }
  }
}
