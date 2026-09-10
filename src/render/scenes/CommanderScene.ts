import Phaser from 'phaser';
import { PAL, hex } from '../../core/palette';
import { COMMANDERS } from '../../core/campaign/commanders';
import { DIFFICULTIES } from '../../core/campaign/difficulty';
import { tankClassById } from '../../core/tanks';
import { NATIVE_H, NATIVE_W } from '../config';
import type { BattleSetup } from '../setup';
import { Sfx } from '../audio';
import { atlasHas } from '../atlas';
import { playMusic } from '../music';
import { loadRun, startRun, loadScores } from '../campaignRun';
import { makeButton } from '../ui';

/**
 * Campaign start: pick a commander and a difficulty. If a run is in progress the
 * player may continue it instead. ←→ commander · ↑↓ difficulty · ENTER · ESC.
 */
export class CommanderScene extends Phaser.Scene {
  private setup!: BattleSetup;
  private sel = 0;
  private diff = 1;
  private sfx = new Sfx();
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private hasRun = false;

  constructor() {
    super('commander');
  }

  init(setup: BattleSetup): void {
    this.setup = setup;
    this.dyn = [];
  }

  create(): void {
    const run = loadRun();
    this.hasRun = !!run && run.levelsCleared > 0;
    if (run) {
      this.sel = Math.max(0, COMMANDERS.findIndex((c) => c.id === run.commander));
      this.diff = Math.max(0, DIFFICULTIES.findIndex((d) => d.id === run.difficulty));
    }
    if (this.textures.exists('title')) {
      const t = this.add.image(NATIVE_W / 2, NATIVE_H / 2, 'title').setAlpha(0.35);
      t.setScale(Math.max(NATIVE_W / t.width, NATIVE_H / t.height));
    }
    this.add.graphics().fillStyle(PAL.uiInk, 0.55).fillRect(0, 0, NATIVE_W, NATIVE_H);
    this.add.text(NATIVE_W / 2, 40, 'CHOOSE YOUR COMMANDER', { fontFamily: 'monospace', fontSize: '30px', color: hex(PAL.uiEdge), stroke: hex(PAL.uiInk), strokeThickness: 6 }).setOrigin(0.5, 0);

    // Portrait row
    const cardW = 280;
    const x0 = NATIVE_W / 2 - (COMMANDERS.length * cardW) / 2 + cardW / 2;
    COMMANDERS.forEach((c, i) => {
      const cx = x0 + i * cardW;
      const g = this.add.graphics().setName(`card${i}`);
      g.fillStyle(PAL.uiPanel, 0.95).fillRoundedRect(cx - 125, 120, 250, 250, 6);
      if (atlasHas(c.portrait)) this.add.image(cx, 220, c.portrait).setDisplaySize(160, 160);
      this.add.text(cx, 312, c.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '22px', color: hex(PAL.uiText) }).setOrigin(0.5, 0);
      this.add.text(cx, 340, c.title, { fontFamily: 'monospace', fontSize: '13px', color: hex(PAL.uiTextDim) }).setOrigin(0.5, 0);
      const hit = this.add.zone(cx, 245, 250, 250).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        // Second tap on the chosen commander starts the run.
        if (this.sel === i) return this.go(false);
        this.sel = i;
        this.sfx.play('select');
        this.refresh();
      });
    });

    // High scores panel
    const scores = loadScores();
    const sx = NATIVE_W - 30;
    this.add.text(sx, 120, 'HIGH SCORES', { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiEdge) }).setOrigin(1, 0).setAlpha(scores.length ? 1 : 0);
    scores.slice(0, 5).forEach((s, i) => {
      this.add.text(sx, 142 + i * 18, `${i + 1}. ${String(s.total).padStart(6)}  ${s.commander.padEnd(6)} ${s.difficulty.padEnd(8)} ${Math.floor(s.timeSec / 60)}:${String(s.timeSec % 60).padStart(2, '0')}`, { fontFamily: 'monospace', fontSize: '12px', color: hex(PAL.uiText) }).setOrigin(1, 0);
    });

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.once('pointerdown', () => this.sfx.unlock());
    makeButton(this, NATIVE_W / 2 - (this.hasRun ? 250 : 120), NATIVE_H - 118, 240, 52, 'START NEW RUN', () => this.go(false), { fontSize: '20px', depth: 12, colour: PAL.glow });
    if (this.hasRun) makeButton(this, NATIVE_W / 2 + 10, NATIVE_H - 118, 240, 52, 'CONTINUE RUN', () => this.go(true), { fontSize: '20px', depth: 12 });
    playMusic(this, 'menu');
    this.refresh();
  }

  private onKey(e: KeyboardEvent): void {
    this.sfx.unlock();
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this.sel = (this.sel - 1 + COMMANDERS.length) % COMMANDERS.length; this.sfx.play('tick'); break;
      case 'ArrowRight': case 'KeyD': this.sel = (this.sel + 1) % COMMANDERS.length; this.sfx.play('tick'); break;
      case 'ArrowUp': case 'KeyW': this.diff = (this.diff - 1 + DIFFICULTIES.length) % DIFFICULTIES.length; this.sfx.play('cycle'); break;
      case 'ArrowDown': case 'KeyS': this.diff = (this.diff + 1) % DIFFICULTIES.length; this.sfx.play('cycle'); break;
      case 'Enter': case 'Space': this.go(false); return;
      case 'KeyC': if (this.hasRun) this.go(true); return;
      case 'Escape': this.scene.start('menu'); return;
      default: return;
    }
    this.refresh();
  }

  private go(continueRun: boolean): void {
    this.sfx.play('select');
    const c = COMMANDERS[this.sel];
    const d = DIFFICULTIES[this.diff];
    const run = loadRun();
    let commanderId: string = c.id;
    let difficultyId: string = d.id;
    if (continueRun && run) {
      commanderId = run.commander;
      difficultyId = run.difficulty;
    } else {
      startRun(c.id, d.id);
    }
    this.scene.start('campaignMap', { ...this.setup, kind: 'campaign', commanderId, difficultyId });
  }

  private refresh(): void {
    this.dyn.forEach((o) => o.destroy());
    this.dyn = [];
    const c = COMMANDERS[this.sel];
    const d = DIFFICULTIES[this.diff];
    const cls = tankClassById(c.cls);
    const cardW = 280;
    const x0 = NATIVE_W / 2 - (COMMANDERS.length * cardW) / 2 + cardW / 2;
    const sel = this.add.graphics().lineStyle(3, PAL.uiEdge, 1).strokeRoundedRect(x0 + this.sel * cardW - 125, 120, 250, 250, 6);
    this.dyn.push(sel);

    const py = 400;
    const panel = this.add.graphics();
    panel.fillStyle(PAL.uiInk, 0.9).fillRoundedRect(NATIVE_W / 2 - 560, py, 1120, 230, 6).lineStyle(2, PAL.uiEdge, 0.9).strokeRoundedRect(NATIVE_W / 2 - 560, py, 1120, 230, 6);
    this.dyn.push(panel);
    const p = c.perk;
    const perkLines = [
      `Hull: ${cls.name}  ·  HP ${cls.hp + p.hpBonus}  ·  fuel ${cls.fuel + p.fuelBonus}  ·  armour ×${(cls.armour * p.armourMult).toFixed(2)}  ·  reload ×${p.reloadMult}`,
      `Starts with: ${p.startWeapons.map(([w, n]) => `${w} ×${n}`).join(', ')}${p.crateMult < 1 ? '  ·  more crates' : ''}`,
    ];
    this.dyn.push(this.add.text(NATIVE_W / 2 - 530, py + 18, `${c.name.toUpperCase()} — ${c.title}`, { fontFamily: 'monospace', fontSize: '22px', color: hex(PAL.uiEdge) }));
    this.dyn.push(this.add.text(NATIVE_W / 2 - 530, py + 52, c.blurb, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText), wordWrap: { width: 1060 } }));
    this.dyn.push(this.add.text(NATIVE_W / 2 - 530, py + 84, perkLines.join('\n'), { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiTextDim), lineSpacing: 6 }));

    this.dyn.push(this.add.text(NATIVE_W / 2 - 530, py + 140, 'DIFFICULTY  ↑↓', { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiTextDim) }));
    let dx = NATIVE_W / 2 - 330;
    DIFFICULTIES.forEach((x, i) => {
      const on = i === this.diff;
      const t = this.add
        .text(dx, py + 140, on ? `[ ${x.name.toUpperCase()} ]` : `  ${x.name}  `, { fontFamily: 'monospace', fontSize: '16px', color: hex(on ? (x.ironman ? PAL.uiDanger : PAL.uiEdge) : PAL.uiText) })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.diff = i;
          this.sfx.play('cycle');
          this.refresh();
        });
      this.dyn.push(t);
      dx += t.width + 24;
    });
    this.dyn.push(this.add.text(NATIVE_W / 2 - 530, py + 168, `${d.blurb}  Score ×${d.scoreMult}`, { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiTextDim) }));

    const run = loadRun();
    const cont = this.hasRun && run ? `     C — continue run (${run.commander}, ${run.difficulty}, ${run.levelsCleared} cleared)` : '';
    this.dyn.push(this.add.text(NATIVE_W / 2, NATIVE_H - 50, `←→ commander   ↑↓ difficulty   ENTER start new run${cont}   ESC back   ·   or tap`, { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiTextDim) }).setOrigin(0.5));
  }
}
