/**
 * Top strip HUD: current player, angle/power, weapon + ammo, wind. Plus the
 * per-tank floating health bars and name tags in the world layer.
 */
import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../core/palette';
import { weaponById } from '../core/weapons';
import type { Tank, World } from '../core/world';
import { HUD_H, NATIVE_H, NATIVE_W } from './config';
import { atlasHas } from './atlas';

const FONT = { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText) };

export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private readonly aim: Phaser.GameObjects.Text;
  private readonly weapon: Phaser.GameObjects.Text;
  private readonly windText: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly rack: Phaser.GameObjects.Text;
  private rackIcons: Phaser.GameObjects.Image[] = [];
  private rackKey = '';
  private readonly help: Phaser.GameObjects.Container;
  private readonly bars = new Map<number, { bg: Phaser.GameObjects.Graphics; tag: Phaser.GameObjects.Text }>();

  constructor(private scene: Phaser.Scene, private worldY: number) {
    this.g = scene.add.graphics().setDepth(100).setScrollFactor(0);
    this.name = scene.add.text(28, 10, '', { ...FONT, fontStyle: 'bold' }).setDepth(101).setScrollFactor(0);
    this.aim = scene.add.text(320, 6, '', FONT).setDepth(101).setScrollFactor(0);
    this.weapon = scene.add.text(760, 10, '', FONT).setDepth(101).setScrollFactor(0);
    this.windText = scene.add.text(NATIVE_W - 330, 10, 'WIND', { ...FONT, color: hex(PAL.uiTextDim) }).setDepth(101).setScrollFactor(0);
    this.status = scene.add.text(8, NATIVE_H - 20, '', { ...FONT, fontSize: '13px', color: hex(PAL.uiTextDim), backgroundColor: hex(PAL.uiInk) }).setDepth(101).setScrollFactor(0);
    this.rack = scene.add.text(NATIVE_W - 12, HUD_H + 8, '', { ...FONT, fontSize: '13px', color: hex(PAL.uiTextDim), align: 'right', backgroundColor: hex(PAL.uiInk) }).setOrigin(1, 0).setDepth(101).setScrollFactor(0).setAlpha(0.9);
    this.help = scene.add.container(0, 0).setDepth(150).setScrollFactor(0).setVisible(false);
    this.banner = scene.add
      .text(NATIVE_W / 2, 330, '', { fontFamily: 'monospace', fontSize: '36px', color: hex(PAL.uiText), stroke: hex(PAL.uiInk), strokeThickness: 6, align: 'center' })
      .setOrigin(0.5)
      .setDepth(120)
      .setScrollFactor(0)
      .setAlpha(0);
  }

  /** Toggle the controls overlay (H). */
  toggleHelp(lines: string[]): void {
    if (this.help.visible) {
      this.help.setVisible(false);
      return;
    }
    this.help.removeAll(true);
    const w = 620;
    const h = 60 + lines.length * 26;
    const x = NATIVE_W / 2 - w / 2;
    const y = NATIVE_H / 2 - h / 2;
    const bg = this.scene.add.graphics();
    bg.fillStyle(PAL.uiInk, 0.94).fillRect(x, y, w, h);
    bg.lineStyle(2, PAL.uiEdge, 1).strokeRect(x, y, w, h);
    const title = this.scene.add.text(NATIVE_W / 2, y + 16, 'CONTROLS', { ...FONT, fontSize: '20px', color: hex(PAL.uiEdge) }).setOrigin(0.5, 0);
    const body = this.scene.add.text(x + 30, y + 54, lines.join('\n'), { ...FONT, fontSize: '16px', color: hex(PAL.uiText), lineSpacing: 8 });
    this.help.add([bg, title, body]).setVisible(true);
  }

  update(world: World, current: Tank | null, statusLine: string): void {
    const g = this.g;
    g.clear();
    g.fillStyle(PAL.uiInk, 1).fillRect(0, 0, NATIVE_W, HUD_H);
    g.fillStyle(PAL.uiEdge, 1).fillRect(0, HUD_H - 4, NATIVE_W, 2);
    g.fillStyle(PAL.uiPanelLit, 1).fillRect(0, HUD_H - 2, NATIVE_W, 2);

    if (current) {
      const team = TEAM_COLOURS[current.colour % TEAM_COLOURS.length];
      g.fillStyle(team.mid, 1).fillRect(10, 10, 12, 26);
      g.fillStyle(team.lit, 1).fillRect(10, 10, 12, 4);
      this.name.setText(current.name.toUpperCase()).setColor(hex(team.lit));
      this.aim.setText(`ANG ${Math.round(current.angle).toString().padStart(3)}°  PWR ${Math.round(current.power).toString().padStart(3)}`);
      // Power bar
      g.fillStyle(PAL.uiPanel, 1).fillRect(320, 28, 300, 10);
      g.fillStyle(PAL.uiEdge, 1).fillRect(322, 30, Math.round(296 * (current.power / 100)), 6);
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

    // Weapon rack for the current tank, with sheet icons where the UI kit has them.
    if (current) {
      const rows: string[] = [];
      const ids: string[] = [];
      for (const [id, n] of current.ammo) {
        if (n === 0) continue;
        const w = weaponById(id);
        const sel = id === current.selectedWeapon;
        rows.push(`${sel ? '▶ ' : '  '}    ${w.name.padEnd(15)} ${n < 0 ? '∞' : String(n).padStart(2)}`);
        ids.push(id);
      }
      this.rack.setText(rows.join('\n'));
      const key = `${current.index}:${ids.join(',')}`;
      if (key !== this.rackKey) {
        this.rackKey = key;
        this.rackIcons.forEach((i) => i.destroy());
        this.rackIcons = [];
        const lineH = this.rack.height / Math.max(1, rows.length);
        ids.forEach((id, i) => {
          const icon = `icon.${id}`;
          if (!atlasHas(icon)) return;
          const img = this.scene.add.image(this.rack.x - this.rack.width + 30, this.rack.y + lineH * (i + 0.5), icon).setDepth(102).setScrollFactor(0).setScale(1);
          img.setDisplaySize(lineH - 2, lineH - 2);
          this.rackIcons.push(img);
        });
      }
    } else {
      this.rack.setText('');
      this.rackIcons.forEach((i) => i.destroy());
      this.rackIcons = [];
      this.rackKey = '';
    }

    // Wind gauge: centred bar, fills left or right.
    const wx = NATIVE_W - 230;
    const ww = 210;
    g.fillStyle(PAL.uiPanel, 1).fillRect(wx, 14, ww, 16);
    g.fillStyle(PAL.uiPanelLit, 1).fillRect(wx + ww / 2, 12, 2, 20);
    const frac = Math.max(-1, Math.min(1, world.wind / world.mode.windMax));
    const len = Math.round(Math.abs(frac) * (ww / 2 - 2));
    g.fillStyle(Math.abs(frac) > 0.6 ? PAL.uiDanger : PAL.uiEdge, 1);
    if (frac >= 0) g.fillRect(wx + ww / 2 + 2, 17, len, 10);
    else g.fillRect(wx + ww / 2 - len, 17, len, 10);
    this.windText.setText(`WIND ${world.wind > 0 ? '→' : world.wind < 0 ? '←' : '·'} ${Math.abs(world.wind)}`);

    // Floating bars
    for (const t of world.tanks) {
      let e = this.bars.get(t.index);
      if (!e) {
        e = {
          bg: this.scene.add.graphics().setDepth(60),
          tag: this.scene.add.text(0, 0, t.name, { ...FONT, fontSize: '13px' }).setOrigin(0.5, 1).setDepth(61),
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
      const bw = 70;
      const x = Math.round(t.x - bw / 2);
      const y = Math.round(t.y + this.worldY - t.halfHeight * 2 - 34);
      e.bg.fillStyle(PAL.uiInk, 0.85).fillRect(x - 2, y - 2, bw + 4, 9);
      const f = t.hp / t.maxHp;
      e.bg.fillStyle(f > 0.5 ? PAL.glow : f > 0.25 ? PAL.fireHot : PAL.uiDanger, 1).fillRect(x, y, Math.round(bw * f), 5);
      if (t.shield > 0) e.bg.fillStyle(0x54c8ff, 1).fillRect(x, y + 6, Math.round(bw * Math.min(1, t.shield / 60)), 2);
      e.tag.setPosition(t.x, y - 4).setColor(hex(team.lit)).setText(current && current.index === t.index ? `▼ ${t.name}` : t.name);
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
