import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../../core/palette';
import { weaponsForMode } from '../../core/weapons';
import { botShop } from '../../core/ai';
import type { TurnBasedMatch } from '../../core/rules/turnBased';
import { NATIVE_H, NATIVE_W } from '../config';
import { Sfx } from '../audio';

/** Menu layout grid; the camera zooms it to fill the native canvas. */
const LAYOUT_W = 640;
const LAYOUT_H = 360;

/**
 * Between-round armoury. Each human tank shops in turn; bots shop instantly.
 * ↑↓ select · ENTER buy · R repair · SPACE done.
 */
export class ShopScene extends Phaser.Scene {
  private match!: TurnBasedMatch;
  private queue: number[] = [];
  private sel = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private sfx = new Sfx();

  constructor() {
    super('shop');
  }

  init(data: { match: TurnBasedMatch }): void {
    this.match = data.match;
  }

  create(): void {
    this.cameras.main.setZoom(NATIVE_W / LAYOUT_W).centerOn(LAYOUT_W / 2, LAYOUT_H / 2);
    // Text is laid out on the 640 grid but rasterised at native resolution.
    this.events.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, (obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(NATIVE_W / LAYOUT_W);
    });
    void NATIVE_H;
    this.add.graphics().fillStyle(PAL.uiInk, 0.92).fillRect(0, 0, LAYOUT_W, LAYOUT_H);
    this.add.text(LAYOUT_W / 2, 12, 'A R M O U R Y', { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiEdge) }).setOrigin(0.5);
    for (const t of this.match.world.tanks) {
      if (t.isBot) botShop(t, this.match.mode.id, (tk, id) => this.match.buy(tk, id), (tk) => this.match.repairCost(tk), (tk) => this.match.repair(tk));
      else this.queue.push(t.index);
    }
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    if (this.queue.length === 0) this.finish();
    else this.redraw();
  }

  private get tank() {
    return this.match.world.tanks[this.queue[0]];
  }

  private items() {
    return weaponsForMode(this.match.mode.id).filter((w) => w.cost > 0);
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
        this.sfx.play(this.match.buy(this.tank, items[this.sel].id) ? 'select' : 'back');
        break;
      case 'KeyR':
        this.sfx.play(this.match.repair(this.tank) ? 'crate' : 'back');
        break;
      case 'Space':
      case 'Escape':
        e.preventDefault();
        this.queue.shift();
        this.sel = 0;
        this.sfx.play('select');
        if (this.queue.length === 0) return this.finish();
        break;
      default:
        return;
    }
    this.redraw();
  }

  private finish(): void {
    this.match.finishShop();
    this.scene.stop();
    this.scene.wake('battle');
  }

  private redraw(): void {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    const t = this.tank;
    const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
    const add = (x: number, y: number, s: string, color = hex(PAL.uiText), size = '9px') => {
      const o = this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: size, color });
      this.texts.push(o);
      return o;
    };
    add(30, 34, `${t.name.toUpperCase()}  —  ${t.credits} cr`, hex(team.lit), '11px');
    add(30, 48, `hull ${t.hp}/${t.maxHp}   repair costs ${this.match.repairCost(t)} cr  (R)`, hex(PAL.uiTextDim), '8px');

    const items = this.items();
    let y = 66;
    items.forEach((w, i) => {
      const have = t.ammo.get(w.id) ?? 0;
      const active = i === this.sel;
      const afford = t.credits >= w.cost;
      const c = active ? hex(PAL.uiEdge) : afford ? hex(PAL.uiText) : hex(PAL.uiTextDim);
      add(30, y, `${active ? '▶' : ' '} ${w.name.padEnd(16)} ${String(w.cost).padStart(5)} cr  ×${w.ammoPerBuy}   owned ${have < 0 ? '∞' : have}`, c);
      if (active) add(30, y + 10, `  ${w.blurb}   dmg ${w.damage}  radius ${w.radius}`, hex(PAL.uiTextDim), '7px');
      y += active ? 22 : 12;
    });
    add(LAYOUT_W / 2 - 150, LAYOUT_H - 16, '↑↓ select   ENTER buy   R repair   SPACE done', hex(PAL.uiTextDim), '8px');
  }
}
