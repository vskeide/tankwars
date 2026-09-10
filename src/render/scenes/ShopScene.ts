import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../../core/palette';
import { weaponsForMode } from '../../core/weapons';
import { tankClassById } from '../../core/tanks';
import { UNIT } from '../../core/physics';
import { botShop } from '../../core/ai';
import { turnBasedHost, type ShopHost } from '../shopHost';
import type { TurnBasedMatch } from '../../core/rules/turnBased';
import { NATIVE_H, NATIVE_W } from '../config';
import { Sfx } from '../audio';
import { atlasHas } from '../atlas';
import { makeButton, type Button } from '../ui';

/** Menu layout grid; the camera zooms it to fill the native canvas. */
const LAYOUT_W = 640;
const LAYOUT_H = 360;

/**
 * Between-round armoury. Each human tank shops in turn; bots shop instantly.
 * ↑↓ select · ENTER buy · R reinforce hull +10 hp · SPACE done.
 */
export class ShopScene extends Phaser.Scene {
  private host!: ShopHost;
  private queue: number[] = [];
  private sel = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  /** Rebuilt every redraw alongside the text: rack icons and the blast preview. */
  private art: Phaser.GameObjects.GameObject[] = [];
  private buttons: Button[] = [];
  private sfx = new Sfx();

  constructor() {
    super('shop');
  }

  init(data: { match?: TurnBasedMatch; host?: ShopHost }): void {
    this.host = data.host ?? turnBasedHost(data.match!);
    this.queue = [];
    this.sel = 0;
  }

  create(): void {
    this.cameras.main.setZoom(NATIVE_W / LAYOUT_W).centerOn(LAYOUT_W / 2, LAYOUT_H / 2);
    // Text is laid out on the 640 grid but rasterised at native resolution.
    this.events.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, (obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(NATIVE_W / LAYOUT_W);
    });
    void NATIVE_H;
    this.add.graphics().fillStyle(PAL.uiInk, 0.92).fillRect(0, 0, LAYOUT_W, LAYOUT_H);
    this.add.text(LAYOUT_W / 2, 12, this.host.title, { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiEdge) }).setOrigin(0.5);
    this.host.shoppers.forEach((t, i) => {
      if (t.isBot) botShop(t, this.host.modeId, (tk, id) => this.host.buy(tk, id), (tk) => this.host.hullUpgradeCost(tk), (tk) => this.host.upgradeHull(tk));
      else this.queue.push(i);
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    if (this.queue.length === 0) return this.finish();
    // Pointer path, so the armoury works without a keyboard. Rows select on tap
    // (and buy on a second tap); these do the rest.
    const res = NATIVE_W / LAYOUT_W;
    const by = LAYOUT_H - 46;
    this.buttons = [
      makeButton(this, 30, by, 96, 22, 'BUY', () => this.buySelected(), { fontSize: '9px', resolution: res }),
      makeButton(this, 136, by, 150, 22, 'HULL +10 HP', () => this.reinforce(), { fontSize: '9px', resolution: res }),
      makeButton(this, 296, by, 96, 22, 'DONE', () => this.nextShopper(), { fontSize: '9px', resolution: res, colour: PAL.glow }),
    ];
    this.redraw();
  }

  private buySelected(): void {
    this.sfx.unlock();
    this.sfx.play(this.host.buy(this.tank, this.items()[this.sel].id) ? 'select' : 'back');
    this.redraw();
  }

  private reinforce(): void {
    this.sfx.unlock();
    this.sfx.play(this.host.upgradeHull(this.tank) ? 'crate' : 'back');
    this.redraw();
  }

  private nextShopper(): void {
    this.sfx.unlock();
    this.queue.shift();
    this.sel = 0;
    this.sfx.play('select');
    if (this.queue.length === 0) {
      this.buttons.forEach((b) => b.destroy());
      this.buttons = [];
      return this.finish();
    }
    this.redraw();
  }

  private get tank() {
    return this.host.shoppers[this.queue[0]];
  }

  private items() {
    return weaponsForMode(this.host.modeId).filter((w) => w.cost > 0);
  }

  private onKey(e: KeyboardEvent): void {
    this.sfx.unlock();
    const items = this.items();
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.sel = (this.sel - 1 + items.length) % items.length;
        this.sfx.play('tick');
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.sel = (this.sel + 1) % items.length;
        this.sfx.play('tick');
        break;
      case 'Enter':
        return this.buySelected();
      case 'KeyR':
        return this.reinforce();
      case 'Space':
      case 'Escape':
        e.preventDefault();
        return this.nextShopper();
      default:
        return;
    }
    this.redraw();
  }

  private finish(): void {
    this.host.finish(this);
  }

  private redraw(): void {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    this.art.forEach((o) => o.destroy());
    this.art = [];
    const t = this.tank;
    const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
    const add = (x: number, y: number, s: string, color = hex(PAL.uiText), size = '9px') => {
      const o = this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: size, color });
      this.texts.push(o);
      return o;
    };
    add(30, 34, `${t.name.toUpperCase()}  —  ${t.credits} cr`, hex(team.lit), '11px');
    const hullCost = this.host.hullUpgradeCost(t);
    const hullLine =
      hullCost < 0 ? `reinforced hull ${t.reinforcedHp}/100 (maxed)` : `reinforced hull ${t.reinforcedHp}/100   +10 for ${hullCost} cr  (R)`;
    add(30, 48, hullLine, hex(PAL.uiTextDim), '8px');

    const items = this.items();
    let y = 66;
    items.forEach((w, i) => {
      const have = t.ammo.get(w.id) ?? 0;
      const active = i === this.sel;
      const afford = t.credits >= w.cost;
      const c = active ? hex(PAL.uiEdge) : afford ? hex(PAL.uiText) : hex(PAL.uiTextDim);
      const row = add(30, y, `${active ? '▶' : ' '}     ${w.name.padEnd(16)} ${String(w.cost).padStart(5)} cr  ×${w.ammoPerBuy}   owned ${have < 0 ? '∞' : have}`, c);
      row.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.sfx.unlock();
        if (this.sel === i) return this.buySelected();
        this.sel = i;
        this.sfx.play('tick');
        this.redraw();
      });
      const icon = `icon.${w.id}`;
      if (atlasHas(icon)) {
        const img = this.add.image(46, y + 5, icon).setOrigin(0.5).setDisplaySize(11, 11).setAlpha(afford ? 1 : 0.4);
        this.art.push(img);
      }
      if (active) {
        // The blurb is part of the selected row: a second tap anywhere on it buys.
        add(30, y + 10, `      ${w.blurb}   dmg ${w.damage}  radius ${w.radius}`, hex(PAL.uiTextDim), '7px')
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.buySelected());
      }
      y += active ? 22 : 12;
    });
    this.drawBlastPreview(items[this.sel]);
    add(LAYOUT_W / 2 - 150, LAYOUT_H - 16, '↑↓ select   ENTER buy   R reinforce +10hp   SPACE done   ·   or tap', hex(PAL.uiTextDim), '8px');
  }

  /**
   * Blast radius of the highlighted weapon, drawn to scale against a tank
   * silhouette of the same scale, so the numbers in the list mean something.
   * The shop grid is 640 wide against a 1920 battlefield, hence the /3.
   */
  private drawBlastPreview(w: ReturnType<typeof weaponsForMode>[number] | undefined): void {
    if (!w) return;
    const cx = LAYOUT_W - 130;
    const cy = 150;
    const scale = UNIT / 3;
    const g = this.add.graphics();
    g.fillStyle(PAL.uiInk, 0.55).fillRoundedRect(cx - 105, 60, 210, 190, 4);
    g.lineStyle(1, PAL.uiEdge, 0.5).strokeRoundedRect(cx - 105, 60, 210, 190, 4);
    // Ground line, then the crater the weapon would leave on it.
    g.fillStyle(PAL.uiPanelLit, 1).fillRect(cx - 95, cy, 190, 1);
    const r = Math.min(92, w.radius * scale);
    g.fillStyle(PAL.fireHot, 0.16).fillCircle(cx, cy, r);
    g.lineStyle(1, PAL.fireHot, 0.85).strokeCircle(cx, cy, r);
    // A line-tank hull at the same scale for comparison.
    const hw = tankClassById('line').halfWidth * UNIT * scale;
    const hh = tankClassById('line').halfHeight * UNIT * scale * 2;
    g.fillStyle(PAL.uiText, 0.75).fillRect(cx - hw, cy - hh, hw * 2, hh);
    this.art.push(g);
    const cap = this.add
      .text(cx, 66, `BLAST TO SCALE  ·  r ${w.radius}  ·  dmg ${w.damage}${w.submunitions ? ` ×${w.submunitions}` : ''}`, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: hex(PAL.uiTextDim),
      })
      .setOrigin(0.5, 0);
    this.texts.push(cap);
  }
}
