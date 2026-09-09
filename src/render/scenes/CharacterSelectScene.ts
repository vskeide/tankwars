import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../../core/palette';
import { COMMANDERS } from '../../core/campaign/commanders';
import { tankClassesForMode } from '../../core/tanks';
import { NATIVE_H, NATIVE_W } from '../config';
import type { BattleSetup } from '../setup';
import { Sfx } from '../audio';
import { atlasHas } from '../atlas';
import { playMusic } from '../music';

/**
 * Street-Fighter-style roster pick before Arena / Classic / Modern / Advanced
 * battles (Campaign already has its own commander pick in CommanderScene).
 * Human slots go in turn: pick one of the six portraits, then type a name.
 * Bot slots are auto-assigned instantly. ←→ pick · ENTER confirm · ESC skip.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private setup!: BattleSetup;
  private humanSlots: number[] = [];
  private turn = 0;
  private mode: 'grid' | 'name' = 'grid';
  private gridSel = 0;
  private nameBuf = '';
  private sfx = new Sfx();
  private taken = new Set<number>();
  private dyn: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('charselect');
  }

  init(setup: BattleSetup): void {
    this.setup = setup;
    this.humanSlots = setup.players.map((p, i) => (p.isBot ? -1 : i)).filter((i) => i >= 0);
    this.turn = 0;
    this.mode = 'grid';
    this.gridSel = 0;
    this.nameBuf = '';
    this.taken = new Set();
  }

  create(): void {
    if (this.humanSlots.length === 0) {
      // Nobody to ask — assign bots and move straight on.
      this.setup.players.forEach((p, i) => this.autoAssign(i));
      this.scene.start('battle', structuredClone(this.setup));
      return;
    }
    if (this.textures.exists('title')) {
      const t = this.add.image(NATIVE_W / 2, NATIVE_H / 2, 'title').setAlpha(0.3);
      t.setScale(Math.max(NATIVE_W / t.width, NATIVE_H / t.height));
    }
    this.add.graphics().fillStyle(PAL.uiInk, 0.6).fillRect(0, 0, NATIVE_W, NATIVE_H);
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.once('pointerdown', () => this.sfx.unlock());
    playMusic(this, 'menu');
    this.refresh();
  }

  private currentPlayer() {
    return this.setup.players[this.humanSlots[this.turn]];
  }

  private onKey(e: KeyboardEvent): void {
    this.sfx.unlock();
    // Some input paths (gamepad-to-keyboard bridges, certain synthetic events)
    // leave `code` empty; `key` is the reliable fallback for the named keys.
    const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter';
    const isEscape = e.code === 'Escape' || e.key === 'Escape';
    const isBackspace = e.code === 'Backspace' || e.key === 'Backspace';
    const isLeft = e.code === 'ArrowLeft' || e.code === 'KeyA' || e.key === 'ArrowLeft';
    const isRight = e.code === 'ArrowRight' || e.code === 'KeyD' || e.key === 'ArrowRight';
    const isSpace = e.code === 'Space' || e.key === ' ';
    if (this.mode === 'grid') {
      if (isLeft) {
        this.gridSel = (this.gridSel - 1 + COMMANDERS.length) % COMMANDERS.length;
        this.sfx.play('tick');
      } else if (isRight) {
        this.gridSel = (this.gridSel + 1) % COMMANDERS.length;
        this.sfx.play('tick');
      } else if (isEnter || isSpace) {
        this.nameBuf = this.currentPlayer().name;
        this.mode = 'name';
        this.sfx.play('select');
      } else if (isEscape) {
        this.autoAssign(this.humanSlots[this.turn]);
        this.advance();
        return;
      } else {
        return;
      }
      this.refresh();
      return;
    }
    // Name entry.
    if (isEnter) {
      this.applyPick(this.humanSlots[this.turn], this.gridSel, this.nameBuf.trim());
      this.advance();
      return;
    }
    if (isEscape) {
      this.mode = 'grid';
      this.sfx.play('back');
      this.refresh();
      return;
    }
    if (isBackspace) {
      this.nameBuf = this.nameBuf.slice(0, -1);
      this.refresh();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && /[A-Za-z0-9 ]/.test(e.key) && this.nameBuf.length < 14) {
      this.nameBuf += e.key;
      this.refresh();
    }
  }

  /** Bot slots, or a human who skipped: nearest untaken character, default name kept. */
  private autoAssign(slot: number): void {
    const free = COMMANDERS.map((_, i) => i).find((i) => !this.taken.has(i)) ?? 0;
    this.applyPick(slot, free, this.setup.players[slot].name);
  }

  private applyPick(slot: number, commanderIndex: number, name: string): void {
    const c = COMMANDERS[commanderIndex];
    const p = this.setup.players[slot];
    p.name = name || c.name;
    p.colour = commanderIndex;
    p.skin = '';
    const legal = tankClassesForMode(this.setup.mode).map((cl) => cl.id);
    p.tankClass = legal.includes(c.cls) ? c.cls : legal[0] ?? p.tankClass;
    this.taken.add(commanderIndex);
  }

  private advance(): void {
    this.turn += 1;
    if (this.turn >= this.humanSlots.length) {
      this.setup.players.forEach((p, i) => {
        if (p.isBot) this.autoAssign(i);
      });
      this.scene.start('battle', structuredClone(this.setup));
      return;
    }
    this.mode = 'grid';
    this.gridSel = COMMANDERS.findIndex((_, i) => !this.taken.has(i));
    if (this.gridSel < 0) this.gridSel = 0;
    this.refresh();
  }

  private refresh(): void {
    this.dyn.forEach((o) => o.destroy());
    this.dyn = [];
    const slot = this.humanSlots[this.turn];
    const p = this.setup.players[slot];
    const team = TEAM_COLOURS[slot % TEAM_COLOURS.length];

    this.dyn.push(
      this.add
        .text(NATIVE_W / 2, 40, `${p.name.toUpperCase()} — CHOOSE YOUR TANK`, { fontFamily: 'monospace', fontSize: '28px', color: hex(team.lit), stroke: hex(PAL.uiInk), strokeThickness: 5 })
        .setOrigin(0.5, 0),
    );

    const cardW = 260;
    const x0 = NATIVE_W / 2 - (COMMANDERS.length * cardW) / 2 + cardW / 2;
    COMMANDERS.forEach((c, i) => {
      const cx = x0 + i * cardW;
      const takenByOther = this.taken.has(i);
      const g = this.add.graphics();
      g.fillStyle(PAL.uiPanel, takenByOther ? 0.4 : 0.95).fillRoundedRect(cx - 115, 120, 230, 230, 6);
      g.lineStyle(i === this.gridSel && this.mode === 'grid' ? 3 : 1, i === this.gridSel && this.mode === 'grid' ? PAL.uiEdge : 0x000000, i === this.gridSel && this.mode === 'grid' ? 1 : 0);
      if (i === this.gridSel && this.mode === 'grid') g.strokeRoundedRect(cx - 115, 120, 230, 230, 6);
      this.dyn.push(g);
      if (atlasHas(c.portrait)) {
        const img = this.add.image(cx, 210, c.portrait).setDisplaySize(140, 140);
        if (takenByOther) img.setAlpha(0.35);
        this.dyn.push(img);
      }
      this.dyn.push(
        this.add
          .text(cx, 292, c.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '18px', color: hex(takenByOther ? PAL.uiTextDim : PAL.uiText) })
          .setOrigin(0.5, 0),
      );
      this.dyn.push(
        this.add
          .text(cx, 316, takenByOther ? 'taken' : c.title, { fontFamily: 'monospace', fontSize: '11px', color: hex(PAL.uiTextDim) })
          .setOrigin(0.5, 0),
      );
      const hit = this.add.zone(cx, 205, 230, 230).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        this.sfx.play('tick');
        this.gridSel = i;
        if (this.mode === 'grid') {
          this.nameBuf = p.name;
          this.mode = 'name';
        }
        this.refresh();
      });
      this.dyn.push(hit);
    });

    if (this.mode === 'name') {
      const c = COMMANDERS[this.gridSel];
      const py = 400;
      const panel = this.add.graphics();
      panel.fillStyle(PAL.uiInk, 0.92).fillRoundedRect(NATIVE_W / 2 - 300, py, 600, 100, 6).lineStyle(2, PAL.uiEdge, 1).strokeRoundedRect(NATIVE_W / 2 - 300, py, 600, 100, 6);
      this.dyn.push(panel);
      this.dyn.push(
        this.add.text(NATIVE_W / 2, py + 14, `PLAYING AS ${c.name.toUpperCase()} — TYPE A NAME`, { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiTextDim) }).setOrigin(0.5, 0),
      );
      this.dyn.push(
        this.add.text(NATIVE_W / 2, py + 40, `${this.nameBuf}_`, { fontFamily: 'monospace', fontSize: '26px', color: hex(PAL.uiEdge) }).setOrigin(0.5, 0),
      );
    }

    const hint =
      this.mode === 'grid'
        ? '←→ pick   ENTER confirm & name   ESC skip (auto-assign)'
        : 'type a name   ENTER confirm   BACKSPACE edit   ESC back to grid';
    this.dyn.push(this.add.text(NATIVE_W / 2, NATIVE_H - 40, hint, { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiTextDim) }).setOrigin(0.5));
    this.dyn.push(
      this.add
        .text(NATIVE_W / 2, NATIVE_H - 64, `player ${this.turn + 1} of ${this.humanSlots.length}`, { fontFamily: 'monospace', fontSize: '13px', color: hex(PAL.uiTextDim) })
        .setOrigin(0.5),
    );
  }
}
