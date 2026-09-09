import Phaser from 'phaser';
import { PAL, hex } from '../../core/palette';
import { LEVELS } from '../../core/campaign/levels';
import { MAP_NODES } from '../../core/campaign/mapNodes';
import { NATIVE_H, NATIVE_W } from '../config';
import type { BattleSetup } from '../setup';
import { Sfx } from '../audio';
import { atlasHas } from '../atlas';
import { playMusic } from '../music';
import { loadLoadout, loadRun, savedLevelId } from '../campaignRun';
import { campaignHost } from '../shopHost';
import { commanderById } from '../../core/campaign/commanders';
import { difficultyById } from '../../core/campaign/difficulty';

/**
 * Level select on the painted campaign map. Nodes come from the white route
 * markers detected on the art; cleared levels are green, the next one pulses,
 * the rest are locked. ←→ / click to choose, ENTER to deploy, B for the
 * armoury (spend what the last mission paid), ESC back.
 */
export class CampaignMapScene extends Phaser.Scene {
  private setup!: BattleSetup;
  private unlocked = 0;
  private sel = 0;
  private markers: Phaser.GameObjects.Container[] = [];
  private info!: Phaser.GameObjects.Text;
  private brief!: Phaser.GameObjects.Text;
  private sfx = new Sfx();
  private pulse = 0;
  private purse!: Phaser.GameObjects.Text;

  constructor() {
    super('campaignMap');
  }

  init(setup: BattleSetup): void {
    this.setup = setup;
    this.markers = [];
  }

  create(): void {
    const saved = this.savedLevelIndex();
    this.unlocked = saved;
    this.sel = saved;

    if (this.textures.exists('campaign-map')) {
      const m = this.add.image(NATIVE_W / 2, NATIVE_H / 2, 'campaign-map');
      m.setScale(Math.max(NATIVE_W / m.width, NATIVE_H / m.height));
    } else {
      this.add.graphics().fillStyle(PAL.uiPanel, 1).fillRect(0, 0, NATIVE_W, NATIVE_H);
    }

    // Route line between nodes.
    const route = this.add.graphics().setDepth(2);
    route.lineStyle(4, PAL.uiInk, 0.6);
    for (let i = 1; i < MAP_NODES.length; i++) {
      const a = this.nodePos(i - 1), b = this.nodePos(i);
      route.lineBetween(a.x, a.y, b.x, b.y);
    }

    MAP_NODES.forEach((_, i) => {
      if (i >= LEVELS.length) return;
      const p = this.nodePos(i);
      const g = this.add.graphics();
      const label = this.add.text(0, -34, String(i + 1), { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
      const cont = this.add.container(p.x, p.y, [g, label]).setDepth(5);
      cont.setSize(60, 60).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (i <= this.unlocked) {
          this.sel = i;
          this.sfx.play('select');
          this.refresh();
        } else this.sfx.play('back');
      });
      this.markers.push(cont);
    });

    const panel = this.add.graphics().setDepth(8);
    panel.fillStyle(PAL.uiInk, 0.86).fillRoundedRect(NATIVE_W / 2 - 420, NATIVE_H - 150, 840, 118, 6);
    panel.lineStyle(2, PAL.uiEdge, 0.9).strokeRoundedRect(NATIVE_W / 2 - 420, NATIVE_H - 150, 840, 118, 6);
    this.info = this.add.text(NATIVE_W / 2, NATIVE_H - 132, '', { fontFamily: 'monospace', fontSize: '22px', color: hex(PAL.uiEdge) }).setOrigin(0.5, 0).setDepth(9);
    this.brief = this.add.text(NATIVE_W / 2, NATIVE_H - 98, '', { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiText), align: 'center', wordWrap: { width: 780 } }).setOrigin(0.5, 0).setDepth(9);
    this.add.text(NATIVE_W / 2, NATIVE_H - 46, '←→ choose   ENTER deploy   ESC back', { fontFamily: 'monospace', fontSize: '13px', color: hex(PAL.uiTextDim) }).setOrigin(0.5, 0).setDepth(9);
    this.add.text(NATIVE_W / 2, 24, 'C A M P A I G N', { fontFamily: 'monospace', fontSize: '28px', color: hex(PAL.uiEdge), stroke: hex(PAL.uiInk), strokeThickness: 6 }).setOrigin(0.5, 0).setDepth(9);

    // Commander portrait and run summary.
    const cmd = commanderById(this.setup.commanderId);
    const diff = difficultyById(this.setup.difficultyId);
    if (atlasHas(cmd.portrait)) this.add.image(NATIVE_W / 2 - 400 + 52, NATIVE_H - 150 + 59, cmd.portrait).setDepth(9).setDisplaySize(96, 96);
    const run = loadRun();
    const summary = run
      ? `${cmd.name} · ${diff.name} · ${run.levelsCleared}/${LEVELS.length} cleared · ${Math.floor(run.timeSec / 60)}:${String(Math.floor(run.timeSec % 60)).padStart(2, '0')} · ${run.shotsFired ? Math.round((100 * run.hits) / run.shotsFired) : 0}% hits · ${run.retries} retries`
      : `${cmd.name} · ${diff.name}`;
    this.add.text(NATIVE_W / 2, 70, summary, { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiText), backgroundColor: hex(PAL.uiInk) }).setOrigin(0.5, 0).setDepth(9).setPadding(8, 4, 8, 4);

    this.purse = this.add
      .text(NATIVE_W / 2, NATIVE_H - 34, '', { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiEdge) })
      .setOrigin(0.5)
      .setDepth(20);
    this.events.on(Phaser.Scenes.Events.WAKE, () => this.refreshPurse());
    this.refreshPurse();
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.once('pointerdown', () => this.sfx.unlock());
    playMusic(this, 'menu');
    this.refresh();
  }

  private nodePos(i: number): { x: number; y: number } {
    const n = MAP_NODES[i];
    return { x: Math.round(n.x * NATIVE_W), y: Math.round(n.y * NATIVE_H) };
  }

  /** Credits and bought hull waiting to be spent, shown under the map. */
  private refreshPurse(): void {
    const l = loadLoadout();
    const carried = Object.entries(l.ammo).filter(([, n]) => n > 0);
    const kit = carried.length ? `  ·  carrying ${carried.map(([id, n]) => `${id} ×${n}`).join(', ')}` : '';
    const hull = l.reinforcedHp > 0 ? `  ·  reinforced hull +${l.reinforcedHp}` : '';
    this.purse.setText(`${l.credits} cr${hull}${kit}   —   B: armoury`);
  }

  private savedLevelIndex(): number {
    const i = LEVELS.findIndex((l) => l.id === savedLevelId());
    return i >= 0 ? i : 0;
  }

  private onKey(e: KeyboardEvent): void {
    this.sfx.unlock();
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.sel = Math.max(0, this.sel - 1);
        this.sfx.play('tick');
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.sel = Math.min(this.unlocked, this.sel + 1, LEVELS.length - 1);
        this.sfx.play('tick');
        break;
      case 'Enter':
      case 'Space':
        this.sfx.play('select');
        this.scene.start('battle', { ...this.setup, kind: 'campaign', levelId: LEVELS[this.sel].id, seed: (Date.now() ^ 0x5f3759df) & 0x7fffffff });
        // (commanderId / difficultyId ride along in the setup)
        return;
      case 'KeyB':
        this.sfx.play('select');
        this.scene.launch('shop', { host: campaignHost(this.setup.commanderId ?? 'rook') });
        this.scene.sleep();
        return;
      case 'Escape':
        this.scene.start('menu');
        return;
      default:
        return;
    }
    this.refresh();
  }

  private refresh(): void {
    const lv = LEVELS[this.sel];
    this.info.setText(`${this.sel + 1}. ${lv.name.toUpperCase()}${lv.boss ? '  — BOSS' : ''}`);
    this.brief.setText(lv.brief);
    this.markers.forEach((m, i) => {
      const g = m.getAt(0) as Phaser.GameObjects.Graphics;
      g.clear();
      const cleared = i < this.unlocked;
      const next = i === this.unlocked;
      const locked = i > this.unlocked;
      const col = cleared ? PAL.glow : next ? PAL.uiEdge : PAL.uiTextDim;
      g.fillStyle(PAL.uiInk, 0.9).fillCircle(0, 0, 18);
      g.fillStyle(col, locked ? 0.35 : 1).fillCircle(0, 0, 13);
      if (LEVELS[i].boss) g.fillStyle(PAL.uiDanger, locked ? 0.4 : 1).fillCircle(0, 0, 6);
      if (i === this.sel) g.lineStyle(3, PAL.uiText, 1).strokeCircle(0, 0, 22);
    });
  }

  override update(_t: number, dt: number): void {
    this.pulse += dt / 1000;
    const m = this.markers[this.unlocked];
    if (m) m.setScale(1 + Math.sin(this.pulse * 4) * 0.08);
  }
}
