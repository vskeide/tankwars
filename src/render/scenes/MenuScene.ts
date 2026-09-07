import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../../core/palette';
import { GAME_MODES } from '../../core/modes';
import { TERRAIN_STYLES } from '../../core/terrain';
import { tankClassesForMode } from '../../core/tanks';
import type { Difficulty, GameModeId } from '../../core/types';
import { KEY_SETS } from '../../core/input';
import { NATIVE_H, NATIVE_W } from '../config';
import { LEVELS } from '../../core/campaign/levels';
import { DEFAULT_SETUP, type BattleSetup } from '../setup';
import { Sfx } from '../audio';
import { atlasHas } from '../atlas';
import { buildBackdrop } from '../backdrop';
import { playMusic, toggleMusic } from '../music';

/** Menu layout grid; the camera zooms it to fill the native canvas. */
const LAYOUT_W = 640;
const LAYOUT_H = 360;

type ModeOption = { id: GameModeId | 'arena' | 'campaign'; name: string; tagline: string; description: string };

const MODES: ModeOption[] = [
  ...GAME_MODES.map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, description: m.description })),
  {
    id: 'arena',
    name: 'Arena',
    tagline: 'Real time. One keyboard. Everyone at once.',
    description:
      'No turns: every tank drives, aims and fires simultaneously. Hold fire to charge power, release to shoot. ' +
      'Crates parachute in with weapons, repairs and shields. Two to four players on one keyboard plus bots. ' +
      'Controls: P1 WASD + Space/Q · P2 arrows + Enter/RShift · P3 IJKL + O/U · P4 numpad.',
  },
  {
    id: 'campaign',
    name: 'Campaign',
    tagline: 'Twelve levels, three bosses.',
    description:
      'Real-time missions across dunes, mesas, crags and ash spires against scripted enemy armour, ' +
      'with the Iron Behemoth and the Desert Juggernaut waiting at the passes. One or two players ' +
      'on one keyboard. Progress is saved in this browser.',
  },
];

const DIFFS: Difficulty[] = ['rookie', 'gunner', 'veteran', 'deadeye'];
const BOT_NAMES = ['Kilo', 'Vex', 'Sable', 'Rook', 'Ember', 'Tarn'];

type Row = 'mode' | 'players' | 'p0' | 'p1' | 'p2' | 'p3' | 'rounds' | 'terrain' | 'start';

export class MenuScene extends Phaser.Scene {
  private setup: BattleSetup = structuredClone(DEFAULT_SETUP);
  private row: Row = 'mode';
  private col = 0; // sub-field within a player row: 0 human/bot, 1 difficulty, 2 class
  private texts: Phaser.GameObjects.Text[] = [];
  private sfx = new Sfx();
  private modeIndex = 0;

  constructor() {
    super('menu');
  }

  create(): void {
    this.cameras.main.setZoom(NATIVE_W / LAYOUT_W).centerOn(LAYOUT_W / 2, LAYOUT_H / 2);
    // Text is laid out on the 640 grid but rasterised at native resolution.
    this.events.on(Phaser.GameObjects.Events.ADDED_TO_SCENE, (obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(NATIVE_W / LAYOUT_W);
    });
    void NATIVE_H;
    const bd = buildBackdrop(this, LAYOUT_W, LAYOUT_H, LAYOUT_H * 0.78, 1234);
    this.add.image(0, 0, bd.sky).setOrigin(0).setDepth(0);
    this.add.image(-40, 0, bd.farMesas).setOrigin(0).setDepth(1);
    this.add.image(-80, 0, bd.nearMesas).setOrigin(0).setDepth(2);
    if (this.textures.exists('title')) {
      const t = this.add.image(LAYOUT_W / 2, LAYOUT_H / 2, 'title').setDepth(2);
      t.setScale(Math.max(LAYOUT_W / t.width, LAYOUT_H / t.height));
      this.add.graphics().fillStyle(PAL.uiInk, 0.35).fillRect(0, 0, LAYOUT_W, LAYOUT_H).setDepth(3);
      this.add.graphics().fillStyle(PAL.uiInk, 0.82).fillRoundedRect(30, 50, 460, 200, 4).lineStyle(1, PAL.uiEdge, 0.8).strokeRoundedRect(30, 50, 460, 200, 4).setDepth(3);
    } else {
      this.add.graphics().fillStyle(PAL.uiInk, 0.72).fillRect(0, 0, LAYOUT_W, LAYOUT_H).setDepth(3);
      if (atlasHas('boss.behemoth.r')) {
        this.add.image(LAYOUT_W - 90, LAYOUT_H - 8, 'boss.behemoth.r').setOrigin(0.5, 1).setDepth(2).setAlpha(0.55).setScale(1.1);
      }
    }

    this.add.text(LAYOUT_W / 2, 18, 'T A N K W A R S', { fontFamily: 'monospace', fontSize: '22px', color: hex(PAL.uiEdge), stroke: hex(PAL.uiInk), strokeThickness: 5 }).setOrigin(0.5).setDepth(10);
    this.add.text(LAYOUT_W / 2, 36, 'artillery, redrawn', { fontFamily: 'monospace', fontSize: '8px', color: hex(PAL.uiTextDim) }).setOrigin(0.5).setDepth(10);

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.keyboard!.on('keydown-N', () => toggleMusic(this));
    this.input.once('pointerdown', () => this.sfx.unlock());
    this.input.keyboard!.once('keydown', () => playMusic(this, 'menu'));
    this.redraw();
  }

  private onKey(e: KeyboardEvent): void {
    this.sfx.unlock();
    const rows = this.rows();
    const i = rows.indexOf(this.row);
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.row = rows[(i - 1 + rows.length) % rows.length];
        this.col = 0;
        this.sfx.play('tick');
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.row = rows[(i + 1) % rows.length];
        this.col = 0;
        this.sfx.play('tick');
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.adjust(-1);
        this.sfx.play('cycle');
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.adjust(1);
        this.sfx.play('cycle');
        break;
      case 'Tab':
        e.preventDefault();
        if (this.row.startsWith('p')) this.col = (this.col + 1) % 3;
        break;
      case 'Enter':
      case 'Space':
        if (this.row === 'start') this.start();
        else if (this.row.startsWith('p')) this.col = (this.col + 1) % 3;
        else this.adjust(1);
        this.sfx.play('select');
        break;
      default:
        return;
    }
    this.redraw();
  }

  private rows(): Row[] {
    const r: Row[] = ['mode', 'players'];
    for (let i = 0; i < this.setup.players.length; i++) r.push(`p${i}` as Row);
    if (this.setup.kind !== 'campaign') r.push('rounds', 'terrain');
    r.push('start');
    return r;
  }

  private adjust(dir: number): void {
    const s = this.setup;
    switch (this.row) {
      case 'mode': {
        this.modeIndex = (this.modeIndex + dir + MODES.length) % MODES.length;
        const m = MODES[this.modeIndex];
        s.kind = m.id === 'arena' ? 'arena' : m.id === 'campaign' ? 'campaign' : 'turn';
        s.mode = m.id === 'arena' || m.id === 'campaign' ? 'advanced' : m.id;
        if (m.id === 'campaign') {
          s.players = s.players.slice(0, 2).map((p, i) => ({ ...p, isBot: false, name: `Player ${i + 1}` }));
        }
        // Reset classes to something legal for the mode.
        const legal = tankClassesForMode(s.mode).map((c) => c.id);
        s.players.forEach((p) => {
          if (!legal.includes(p.tankClass)) p.tankClass = legal[0];
        });
        break;
      }
      case 'players': {
        const n = s.kind === 'campaign' ? Math.max(1, Math.min(2, s.players.length + dir)) : Math.max(2, Math.min(4, s.players.length + dir));
        while (s.players.length < n) {
          const i = s.players.length;
          s.players.push({ name: `Bot ${BOT_NAMES[i]}`, colour: i, isBot: true, difficulty: 'gunner', tankClass: tankClassesForMode(s.mode)[i % tankClassesForMode(s.mode).length].id });
        }
        while (s.players.length > n) s.players.pop();
        break;
      }
      case 'rounds':
        s.rounds = Math.max(1, Math.min(9, s.rounds + dir));
        break;
      case 'terrain': {
        const ids = ['random', ...TERRAIN_STYLES.map((t) => t.id)];
        s.terrainStyle = ids[(ids.indexOf(s.terrainStyle) + dir + ids.length) % ids.length];
        break;
      }
      default: {
        if (!this.row.startsWith('p')) break;
        const p = s.players[Number(this.row.slice(1))];
        const idx = Number(this.row.slice(1));
        if (this.col === 0) {
          p.isBot = !p.isBot;
          p.name = p.isBot ? `Bot ${BOT_NAMES[idx]}` : `Player ${idx + 1}`;
        } else if (this.col === 1) {
          p.difficulty = DIFFS[(DIFFS.indexOf(p.difficulty) + dir + DIFFS.length) % DIFFS.length];
        } else {
          const classes = tankClassesForMode(s.mode);
          const ci = classes.findIndex((c) => c.id === p.tankClass);
          p.tankClass = classes[(ci + dir + classes.length) % classes.length].id;
        }
      }
    }
  }

  private savedLevel(): string {
    try {
      const v = localStorage.getItem('tankwars.campaign.level');
      if (v && LEVELS.some((l) => l.id === v)) return v;
    } catch { /* private mode */ }
    return LEVELS[0].id;
  }

  private start(): void {
    this.setup.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) & 0x7fffffff;
    if (this.setup.kind === 'campaign') this.setup.levelId = this.savedLevel();
    this.scene.start('battle', structuredClone(this.setup));
  }

  private redraw(): void {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    const s = this.setup;
    const x0 = 40;
    let y = 58;
    const line = (label: string, value: string, row: Row, hint = '') => {
      const active = this.row === row;
      const c = active ? hex(PAL.uiEdge) : hex(PAL.uiText);
      const t1 = this.add.text(x0, y, (active ? '▶ ' : '  ') + label, { fontFamily: 'monospace', fontSize: '9px', color: c }).setDepth(10);
      const t2 = this.add.text(x0 + 130, y, value, { fontFamily: 'monospace', fontSize: '9px', color: active ? hex(PAL.uiText) : hex(PAL.uiTextDim) }).setDepth(10);
      this.texts.push(t1, t2);
      if (hint && active) this.texts.push(this.add.text(x0 + 130, y + 10, hint, { fontFamily: 'monospace', fontSize: '7px', color: hex(PAL.uiTextDim), wordWrap: { width: 300 } }).setDepth(10));
      y += hint && active ? 12 + Math.ceil(hint.length / 60) * 9 : 12;
    };

    const m = MODES[this.modeIndex];
    line('MODE', `‹ ${m.name.toUpperCase()} ›  ${m.tagline}`, 'mode', m.description);
    line('PLAYERS', `‹ ${s.players.length} ›`, 'players');
    s.players.forEach((p, i) => {
      const team = TEAM_COLOURS[p.colour % TEAM_COLOURS.length];
      const cls = tankClassesForMode(s.mode).find((c) => c.id === p.tankClass);
      const showClass = s.kind === 'arena' || GAME_MODES.find((g) => g.id === s.mode)!.tankClasses;
      const f = (k: number, str: string) => (this.row === `p${i}` && this.col === k ? `[${str}]` : ` ${str} `);
      const keys = s.kind === 'arena' && !p.isBot ? `  keys: ${KEY_SETS[i]?.name ?? '-'}` : '';
      const val = `${f(0, p.isBot ? 'BOT' : 'HUMAN')} ${p.isBot ? f(1, p.difficulty.toUpperCase()) : '          '} ${showClass ? f(2, (cls?.name ?? '').toUpperCase()) : ''}${keys}`;
      const t = this.add.text(x0 + 130, y, val, { fontFamily: 'monospace', fontSize: '9px', color: hex(PAL.uiText) }).setDepth(10);
      const l = this.add.text(x0, y, (this.row === `p${i}` ? '▶ ' : '  ') + `■ ${p.name}`, { fontFamily: 'monospace', fontSize: '9px', color: hex(team.lit) }).setDepth(10);
      this.texts.push(t, l);
      y += 12;
    });
    if (s.kind !== 'campaign') {
      line('ROUNDS', `‹ ${s.rounds} ›`, 'rounds');
      const ts = TERRAIN_STYLES.find((t) => t.id === s.terrainStyle);
      line('TERRAIN', `‹ ${ts ? ts.name.toUpperCase() : 'RANDOM'} ›`, 'terrain');
    } else {
      const lv = LEVELS.find((l) => l.id === this.savedLevel())!;
      this.texts.push(this.add.text(x0 + 130, y, `next mission: ${LEVELS.indexOf(lv) + 1}/${LEVELS.length} — ${lv.name}`, { fontFamily: 'monospace', fontSize: '8px', color: hex(PAL.uiTextDim) }).setDepth(10));
      y += 12;
    }
    y += 6;
    line('START BATTLE', this.row === 'start' ? 'press ENTER' : '', 'start');

    this.texts.push(
      this.add.text(LAYOUT_W / 2, LAYOUT_H - 10, '↑↓ select   ←→ change   TAB next field   ENTER confirm', { fontFamily: 'monospace', fontSize: '7px', color: hex(PAL.uiTextDim) }).setOrigin(0.5).setDepth(10),
    );
  }
}
