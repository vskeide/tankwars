/**
 * Visual effects: explosions, smoke, debris, muzzle flash, damage numbers,
 * screen shake. Uses atlas animation frames when the sheet provides them and
 * falls back to palette particles otherwise.
 */
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import type { Weapon } from '../core/weapons';
import { atlasHas } from './atlas';

export class Fx {
  private readonly particles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashes: Phaser.GameObjects.Graphics;
  private flashAlpha = 0;

  constructor(private scene: Phaser.Scene, private worldY: number) {
    // Fire particles
    this.particles = scene.add.particles(0, 0, 'dot2', {
      lifespan: { min: 250, max: 650 },
      speed: { min: 20, max: 90 },
      scale: { start: 2.2, end: 0 },
      tint: [PAL.fireCore, PAL.fireHot, PAL.fireMid, PAL.fireDeep],
      gravityY: -30,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(40);
    this.smoke = scene.add.particles(0, 0, 'dot3', {
      lifespan: { min: 900, max: 2200 },
      speed: { min: 6, max: 28 },
      angle: { min: 250, max: 290 },
      scale: { start: 1.2, end: 3.2 },
      alpha: { start: 0.85, end: 0 },
      tint: [PAL.smoke, PAL.smokeLight],
      gravityY: -18,
      emitting: false,
    }).setDepth(38);
    this.debris = scene.add.particles(0, 0, 'debris0', {
      lifespan: { min: 600, max: 1400 },
      speed: { min: 60, max: 200 },
      angle: { min: 200, max: 340 },
      gravityY: 260,
      rotate: { start: 0, end: 360 },
      emitting: false,
      frame: undefined,
    }).setDepth(39);
    this.sparks = scene.add.particles(0, 0, 'dot', {
      lifespan: { min: 120, max: 400 },
      speed: { min: 80, max: 220 },
      scale: { start: 1.5, end: 0 },
      tint: [PAL.glowCore, PAL.glow, PAL.fireHot],
      gravityY: 120,
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
    const wanted = big ? 'large' : radius > 28 ? 'medium' : 'small';
    // Until the dedicated explosion sheet exists, one frame set serves all sizes.
    const size = atlasHas(`fx.explosion.${wanted}.0`) ? wanted : 'medium';
    if (atlasHas(`fx.explosion.${size}.0`)) {
      const spr = this.scene.add.sprite(x, yy, `fx.explosion.${size}.0`).setDepth(42);
      const frames = 10;
      const key = `anim-explosion-${size}`;
      if (!this.scene.anims.exists(key)) {
        this.scene.anims.create({
          key,
          frames: Array.from({ length: frames }, (_, i) => ({ key: `fx.explosion.${size}.${i}` })).filter((f) => atlasHas(f.key)),
          frameRate: 18,
        });
      }
      spr.setScale(Math.max(0.5, (radius * 2.4) / Math.max(spr.width, 1)));
      spr.play(key).once('animationcomplete', () => spr.destroy());
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
    this.particles.explode(Math.round(radius * 1.4), x, yy);
    this.smoke.explode(Math.round(radius * 0.5), x, yy - radius * 0.3);
    this.debris.explode(Math.round(radius * 0.8), x, yy);
    this.shake(Math.min(0.02, radius / 2500), 120 + radius * 3);
    if (weapon.behaviour === 'nuke') this.whiteFlash(0.9);
  }

  muzzleFlash(x: number, y: number, angleDeg: number): void {
    const yy = this.y(y);
    const a = (angleDeg * Math.PI) / 180;
    this.sparks.setAngle(-angleDeg);
    this.sparks.explode(14, x + Math.cos(a) * 4, yy - Math.sin(a) * 4);
    this.sparks.setAngle(0);
    const g = this.scene.add.graphics().setDepth(43);
    g.fillStyle(PAL.fireCore, 1).fillCircle(x, yy, 3);
    g.fillStyle(PAL.fireHot, 0.8).fillCircle(x, yy, 6);
    this.scene.time.delayedCall(60, () => g.destroy());
    this.shake(0.004, 60);
  }

  burn(x: number, y: number): void {
    const yy = this.y(y);
    const e = this.scene.add.particles(x, yy, 'dot2', {
      lifespan: { min: 300, max: 700 },
      speed: { min: 5, max: 25 },
      angle: { min: 250, max: 290 },
      scale: { start: 1.6, end: 0 },
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
    this.sparks.explode(10, x, this.y(y));
  }

  landDust(x: number, y: number, strength: number): void {
    this.smoke.explode(Math.round(3 + strength * 6), x, this.y(y));
  }

  damageNumber(x: number, y: number, amount: number, colour: number = PAL.uiText): void {
    const t = this.scene.add
      .text(x, this.y(y) - 16, `-${amount}`, { fontFamily: 'monospace', fontSize: '10px', color: '#' + colour.toString(16).padStart(6, '0'), stroke: '#0d0709', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(80);
    this.scene.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
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
