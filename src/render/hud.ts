/**
 * Top strip HUD: current player, angle/power, weapon + ammo, wind. Plus the
 * per-tank floating health bars and name tags in the world layer.
 */
import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../core/palette';
import { weaponById } from '../core/weapons';
import type { Tank, World } from '../core/world';
import { HUD_H, NATIVE_H, NATIVE_W } from './config';

const FONT = { fontFamily: 'monospace', fontSize: '11px', color: hex(PAL.uiText) };

export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private readonly aim: Phaser.GameObjects.Text;
  private readonly weapon: Phaser.GameObjects.Text;
  private readonly windText: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly bars = new Map<number, { bg: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text }>();

  constructor(private scene: Phaser.Scene, private worldY: number) {
    this.g = scene.add.graphics().setDepth(100).setScrollFactor(0);
    this.name = scene.add.text(18, 6, '', { ...FONT, fontStyle: 'bold' }).setDepth(101).setScrollFactor(0);
    this.aim = scene.add.text(200, 6, '', FONT).setDepth(101).setScrollFactor(0);
    this.weapon = scene.add.text(430, 6, '', FONT).setDepth(101).setScrollFactor(0);
    this.windText = scene.add.text(NATIVE_W - 210, 6, 'WIND', { ...FONT, color: hex(PAL.uiTextDim) }).setDepth(101).setScrollFactor(0);
    this.status = scene.add.text(6, NATIVE_H - 13, '', { ...FONT, fontSize: '9px', color: hex(PAL.uiTextDim), backgroundColor: hex(PAL.uiInk) }).setDepth(101).setScrollFactor(0);
    this.banner = scene.add
      .text(NATIVE_W / 2, 170, '', { fontFamily: 'monospace', fontSize: '24px', color: hex(PAL.uiText), stroke: hex(PAL.uiInk), strokeThickness: 5, align: 'center' })
      .setOrigin(0.5)
      .setDepth(120)
      .setScrollFactor(0)
      .setAlpha(0);
  }

  update(world: World, current: Tank | null, statusLine: string): void {
    const g = this.g;
    g.clear();
    g.fillStyle(PAL.uiInk, 1).fillRect(0, 0, NATIVE_W, HUD_H);
    g.fillStyle(PAL.uiEdge, 1).fillRect(0, HUD_H - 2, NATIVE_W, 1);
    g.fillStyle(PAL.uiPanelLit, 1).fillRect(0, HUD_H - 1, NATIVE_W, 1);

    if (current) {
      const team = TEAM_COLOURS[current.colour % TEAM_COLOURS.length];
      g.fillStyle(team.mid, 1).fillRect(6, 6, 8, 18);
      g.fillStyle(team.lit, 1).fillRect(6, 6, 8, 3);
      this.name.setText(current.name.toUpperCase()).setColor(hex(team.lit));
      this.aim.setText(`ANG ${Math.round(current.angle).toString().padStart(3)}°  PWR ${Math.round(current.power).toString().padStart(3)}`);
      // Power bar
      g.fillStyle(PAL.uiPanel, 1).fillRect(200, 20, 180, 6);
      g.fillStyle(PAL.uiEdge, 1).fillRect(201, 21, Math.round(178 * (current.power / 100)), 4);
      const w = weaponById(current.selectedWeapon);
      const n = world.ammoFor(current, w.id);
      this.weapon.setText(`${w.name.toUpperCase()}  ${n < 0 ? '∞' : '×' + n}`);
      if (current.hp < current.maxHp * 0.3) this.weapon.setColor(hex(PAL.uiText));
    } else {
      this.name.setText('');
      this.aim.setText('');
      this.weapon.setText('');
    }
    this.status.setText(statusLine);

    // Wind gauge: centred bar, fills left or right.
    const wx = NATIVE_W - 150;
    const ww = 136;
    g.fillStyle(PAL.uiPanel, 1).fillRect(wx, 9, ww, 10);
    g.fillStyle(PAL.uiPanelLit, 1).fillRect(wx + ww / 2, 8, 1, 12);
    const frac = Math.max(-1, Math.min(1, world.wind / world.mode.windMax));
    const len = Math.round(Math.abs(frac) * (ww / 2 - 2));
    g.fillStyle(Math.abs(frac) > 0.6 ? PAL.uiDanger : PAL.uiEdge, 1);
    if (frac >= 0) g.fillRect(wx + ww / 2 + 1, 11, len, 6);
    else g.fillRect(wx + ww / 2 - len, 11, len, 6);
    this.windText.setText(`WIND ${world.wind > 0 ? '→' : world.wind < 0 ? '←' : '·'} ${Math.abs(world.wind)}`);

    // Floating bars
    for (const t of world.tanks) {
      let e = this.bars.get(t.index);
      if (!e) {
        e = {
          bg: this.scene.add.graphics().setDepth(60),
          tag: this.scene.add.text(0, 0, t.name, { ...FONT, fontSize: '9px' }).setOrigin(0.5, 1).setDepth(61),
        };
        this.bars.set(t.index, e);
      }
      e.bg.clear();
      if (!t.alive) {
        e.tag.setVisible(false);
        continue;
      }
      e.tag.setVisible(true);
      const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
      const bw = 40;
      const x = Math.round(t.x - bw / 2);
      const y = Math.round(t.y + this.worldY - t.halfHeight * 2 - 26);
      e.bg.fillStyle(PAL.uiInk, 0.85).fillRect(x - 1, y - 1, bw + 2, 5);
      const f = t.hp / t.maxHp;
      e.bg.fillStyle(f > 0.5 ? PAL.glow : f > 0.25 ? PAL.fireHot : PAL.uiDanger, 1).fillRect(x, y, Math.round(bw * f), 3);
      if (t.shield > 0) e.bg.fillStyle(0x54c8ff, 1).fillRect(x, y + 4, Math.round(bw * Math.min(1, t.shield / 60)), 1);
      e.tag.setPosition(t.x, y - 2).setColor(hex(team.lit)).setText(current && current.index === t.index ? `▼ ${t.name}` : t.name);
    }
  }

  showBanner(text: string, ms = 1400): void {
    this.banner.setText(text).setAlpha(1);
    this.scene.tweens.killTweensOf(this.banner);
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: ms, duration: 400 });
  }

  destroy(): void {
    this.bars.forEach((b) => {
      b.bg.destroy();
      b.tag.destroy();
    });
    this.bars.clear();
  }
}
