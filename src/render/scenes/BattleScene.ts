import Phaser from 'phaser';
import { PAL, TEAM_COLOURS, hex } from '../../core/palette';
import { SIM_DT, launchVelocity, simulateFlight } from '../../core/physics';
import { TurnBasedMatch } from '../../core/rules/turnBased';
import { ArenaMatch } from '../../core/rules/arena';
import { CampaignLevel } from '../../core/rules/campaign';
import { LEVELS } from '../../core/campaign/levels';
import { BotController } from '../../core/ai';
import { emptyIntent, type Intent } from '../../core/input';
import { weaponById } from '../../core/weapons';
import { hullRotation, type Crate, type Hardpoint, type Projectile, type Tank, type World, type WorldEvent } from '../../core/world';
import { HUD_H, NATIVE_H, NATIVE_W, SPRITE_SCALE, TERRAIN_H, TERRAIN_W } from '../config';
import { buildBackdrop } from '../backdrop';
import { TerrainView } from '../terrainView';
import { Hud } from '../hud';
import { Fx } from '../fx';
import { ScreenFx } from '../screenFx';
import { Sfx } from '../audio';
import { InputRouter } from '../inputs';
import { atlasHas, ensureHull, skinForClass, spriteScale } from '../atlas';
import { CLASS_BARREL, ENEMY_PARTS, ensureTeamTexture, hasParts, partMetrics } from '../parts';
import { sliceBiome } from '../biomeBackdrop';
import { playMusic, toggleMusic } from '../music';
import { settings, touchActive } from '../settings';
import { TouchControls } from '../touchControls';
import { makeButton, type Button } from '../ui';
import { addScore, clearRun, loadLoadout, loadRun, saveLoadout, saveRun, setSavedLevel } from '../campaignRun';
import { scoreRun, toHighScore, type RunStats } from '../../core/campaign/score';
import { ensureTankTextures, hullTextureKey, barrelTextureKey } from '../sprites';
import type { BattleSetup } from '../setup';
import { clearSavedMatch, saveMatch } from '../savedMatch';

interface TankView {
  hull: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image | null;
  barrel: Phaser.GameObjects.Image;
  /** Barrel pivot relative to the tank origin, for a right-facing tank. */
  pivotX: number;
  pivotY: number;
  /** Turret anchor relative to the tank origin (parts mode). */
  turretX: number;
  turretY: number;
  skin: string;
  parts: boolean;
  facing: 1 | -1;
  recoil: number;
  smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
}

interface ProjView {
  sprite: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Graphics;
}

/** One projectile in a replay frame. */
interface RecProjectile {
  x: number;
  y: number;
  key: string;
  rot: number;
}

/**
 * One tank in a replay frame. The replay writes these back onto the live tanks
 * so the existing sprite sync draws them — including the one that was destroyed,
 * which is otherwise hidden by the time the round ends.
 */
interface RecTank {
  i: number;
  x: number;
  y: number;
  tilt: number;
  angle: number;
  facing: 1 | -1;
  alive: boolean;
  hp: number;
  shield: number;
}

/**
 * Renders a World and drives one of the two rules layers with a fixed-step
 * accumulator. Human intents come from the InputRouter, bot intents from
 * BotControllers; the scene does not know or care which is which.
 */
export class BattleScene extends Phaser.Scene {
  private setup!: BattleSetup;
  private turn: TurnBasedMatch | null = null;
  private arena: ArenaMatch | null = null;
  private campaign: CampaignLevel | null = null;
  private world!: World;
  private bossViews: { img: Phaser.GameObjects.Image | null; bars: Phaser.GameObjects.Graphics }[] = [];

  private terrainView!: TerrainView;
  private hud!: Hud;
  private fx!: Fx;
  private screenFx!: ScreenFx;
  private sfx = new Sfx();
  private inputs!: InputRouter;
  private bots = new Map<number, BotController>();
  private tankViews = new Map<number, TankView>();
  private projViews = new Map<number, ProjView>();
  private crateViews = new Map<number, Phaser.GameObjects.Container>();
  private hazardViews = new Map<number, Phaser.GameObjects.Image>();
  /** On-screen controls when fingers are driving; null on a keyboard. */
  private touch: TouchControls | null = null;
  /** The pause / leave-the-battle prompt. */
  private pauseUi: Phaser.GameObjects.Container | null = null;
  private pauseButtons: Button[] = [];
  private pauseShownAt = 0;
  /** Last whole second shown of the pre-round countdown, so each fires once. */
  private lastCountdownTick = -1;
  /** Objects making up the campaign intro card, destroyed when it is dismissed. */
  private briefCard: Phaser.GameObjects.GameObject[] = [];
  private droneViews = new Map<number, Phaser.GameObjects.Image>();
  private aimGfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Container;
  private accumulator = 0;
  private lastTurnKey = '';
  private roundOverAt = -1;
  private charge = new Map<number, number>(); // arena: power charge per slot
  /** Candidate drop column during the 'placing' phase, and its marker graphics. */
  private placeX = 0;
  /** Whose drop the marker is currently showing, so each chooser starts fresh. */
  private placingFor = -2;
  private placeGfx!: Phaser.GameObjects.Graphics;
  private placeConfirmLatch = false;
  /** A finger (or button) is down on the battlefield, dragging the ghost. */
  private placeDragging = false;
  private lastPointerX = -1;
  private lastPointerY = -1;
  /** Set by the pointerdown listener; polling isDown() misses a quick click. */
  private placeClick = false;
  /** Seconds an aim key has been held, per control id — drives the slow-start ramp. */
  private aimHold = new Map<string, number>();

  /**
   * Aim ramp: a tap moves about a degree; holding accelerates over half a second
   * to full speed. Returns the multiplier to apply to the raw ±1 input.
   */
  private aimRamp(id: string, active: boolean, dt: number): number {
    if (!active) {
      this.aimHold.set(id, 0);
      return 0;
    }
    const held = (this.aimHold.get(id) ?? 0) + dt;
    this.aimHold.set(id, held);
    const t = Math.min(1, held / 0.55);
    return 0.22 + 0.78 * t * t;
  }
  private prevHeld = new Map<number, boolean>();
  private paused = false;
  private lastRound = 0;
  /**
   * Killing-shot replay (turn-based). While a shot resolves we record every
   * projectile position per sim step plus the explosions; if that shot ended
   * the round we play it back in slow motion before the round-over card.
   */
  private rec: {
    frames: { projs: RecProjectile[]; tanks: RecTank[] }[];
    fx: { step: number; x: number; y: number; radius: number; weapon: import('../../core/weapons').Weapon }[];
    killed: boolean;
  } | null = null;
  private replay: {
    step: number;
    acc: number;
    ghosts: Phaser.GameObjects.Image[];
    trail: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
    /** Tank state at the moment the replay started, restored when it ends. */
    finalTanks: RecTank[];
    /** Set once playback has reached the end and the outro is running. */
    finishing: boolean;
  } | null = null;
  private replayShown = false;
  private backdropKeys: { sky: string; farMesas: string; nearMesas: string } | null = null;
  private bgImages: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('battle');
  }

  init(setup: BattleSetup): void {
    // Phaser reuses the scene instance across scene.start() calls, so every
    // per-match field has to be reset here, not at declaration.
    this.setup = setup;
    this.turn = null;
    this.arena = null;
    this.campaign = null;
    this.bossViews = [];
    this.bots = new Map();
    this.tankViews = new Map();
    this.projViews = new Map();
    this.crateViews = new Map();
    this.accumulator = 0;
    this.lastTurnKey = '';
    this.roundOverAt = -1;
    this.charge = new Map();
    this.prevHeld = new Map();
    this.aimHold = new Map();
    this.paused = false;
    this.touch = null;
    this.pauseUi = null;
    this.pauseButtons = [];
    this.lastRound = 0;
    this.rec = null;
    this.replay = null;
    this.replayShown = false;
    this.backdropKeys = null;
    this.bgImages = [];
    this.sfx = new Sfx();
  }

  create(): void {
    const s = this.setup;
    const common = { players: s.players, rounds: s.rounds, seed: s.seed, width: TERRAIN_W, height: TERRAIN_H, terrainStyle: s.terrainStyle };
    if (s.kind === 'campaign') {
      const humans = s.players.filter((p) => !p.isBot).slice(0, 2);
      this.campaign = new CampaignLevel({ levelId: s.levelId ?? LEVELS[0].id, players: humans.length ? humans : s.players.slice(0, 1), seed: s.seed, width: TERRAIN_W, height: TERRAIN_H, commanderId: s.commanderId, difficultyId: s.difficultyId, loadout: loadLoadout() });
      this.world = this.campaign.world;
    } else if (s.kind === 'arena') {
      this.arena = new ArenaMatch({ ...common, crateInterval: 9, windInterval: 12 });
      this.world = this.arena.world;
    } else {
      // A match restored from a save arrives ready-made; otherwise start a new one.
      this.turn = s.resume ?? new TurnBasedMatch({ ...common, mode: s.mode, placement: s.placement ?? 'drop' });
      this.world = this.turn.world;
    }
    this.lastRound = this.roundNumber();

    this.buildBackdrop();
    this.terrainView = new TerrainView(this, this.world.terrain, 0, HUD_H, this.tileForBiome());
    this.placeDecor();
    this.aimGfx = this.add.graphics().setDepth(35);
    this.placeGfx = this.add.graphics().setDepth(36);
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.replay && !this.pauseUi) {
        this.endReplay();
        return;
      }
      // Placement is a drag: pressing picks the ghost up, releasing drops it.
      if (this.turn?.phase === 'placing' && !this.paused) {
        this.placeDragging = true;
        this.placeX = Math.round(ptr.worldX);
      }
      this.dismissBriefCard();
    });
    const release = (ptr: Phaser.Input.Pointer) => {
      if (!this.placeDragging) return;
      this.placeDragging = false;
      this.placeX = Math.round(ptr.worldX);
      this.placeClick = true;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    // Coming back from the shop, the keypress that closed it may never have
    // reported its keyup here. Start the round with nothing held.
    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      this.inputs.clearHeld();
      this.placeClick = false;
      this.placeDragging = false;
      this.placeConfirmLatch = true;
      this.aimHold.clear();
      this.charge.clear();
      this.prevHeld.clear();
    });
    this.fx = new Fx(this, HUD_H);
    this.screenFx = new ScreenFx(this);
    this.hud = new Hud(this, HUD_H);
    this.inputs = new InputRouter(this, 4);
    this.overlay = this.add.container(0, 0).setDepth(200).setVisible(false);
    if (touchActive()) {
      this.touch = new TouchControls(this, this.world, {
        movement: this.world.mode.movement,
        realTime: !this.turn,
        onMenu: () => this.togglePause('exit'),
      });
      // The status line is keyboard hints; the touch layer draws its own.
      this.hud.setStatusVisible(false);
      this.hud.onRackTap(() => this.touch?.queueCycle());
      const drive = this.world.mode.movement ? '   ·   ◄ ► drive' : '';
      this.touch.setHint(`drag anywhere to aim   ·   hold FIRE to shoot   ·   tap WEAPON to switch${drive}`);
    }

    for (const t of this.world.tanks) {
      this.makeTankView(t);
      if (t.isBot) this.bots.set(t.index, new BotController());
    }
    if (this.campaign) {
      for (const boss of this.campaign.bosses) {
        const key = atlasHas(`${boss.def.skin}.body`)
          ? `${boss.def.skin}.body`
          : atlasHas(`${boss.def.skin}.l`)
            ? `${boss.def.skin}.l`
            : atlasHas(`${boss.def.skin}.r`)
              ? `${boss.def.skin}.r`
              : atlasHas(boss.def.skin)
                ? boss.def.skin
                : null;
        const img = key ? this.add.image(boss.x, boss.y + HUD_H, key).setOrigin(0.5, 1).setDepth(28).setScale(spriteScale(key)) : null;
        // Sheet bodies face right; bosses face the players on their left.
        if (img && key && !key.endsWith('.l')) img.setFlipX(true);
        this.bossViews.push({ img, bars: this.add.graphics().setDepth(62) });
      }
    }

    // ESC asks before leaving — a mid-match exit used to be one stray key away.
    this.input.keyboard!.on('keydown-ESC', () => this.togglePause('exit'));
    this.input.keyboard!.on('keydown-Q', () => {
      if (this.pauseUi) this.exitToMenu();
    });
    // Both the Phaser sugar and a raw key check: some input paths (gamepad
    // bridges, remote keyboards) deliver a keydown with an empty `code`, which
    // the sugar cannot match.
    this.input.keyboard!.on('keydown-SPACE', () => this.dismissBriefCard());
    this.input.keyboard!.on('keydown-ENTER', () => {
      // The guard stops an ENTER that was already coming (P2's fire key) from
      // confirming a prompt that opened a frame earlier.
      if (this.pauseUi) {
        if (this.time.now - this.pauseShownAt > 300) this.exitToMenu();
        return;
      }
      this.dismissBriefCard();
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') this.dismissBriefCard();
    });
    this.input.keyboard!.on('keydown-F2', (e: KeyboardEvent) => {
      e.preventDefault();
      if (!this.turn) return this.hud.showBanner('ONLY TURN-BASED MATCHES SAVE', 1600);
      if (this.turn.phase !== 'aim') return this.hud.showBanner('SAVE WHEN IT IS YOUR SHOT', 1600);
      this.hud.showBanner(saveMatch(this.turn) ? 'MATCH SAVED' : 'SAVE FAILED', 1600);
    });
    this.input.keyboard!.on('keydown-P', () => this.togglePause('pause'));
    this.input.keyboard!.on('keydown-M', () => (this.sfx.muted = !this.sfx.muted));
    this.input.keyboard!.on('keydown-H', () => this.hud.toggleHelp(this.helpLines()));
    this.input.keyboard!.on('keydown-N', () => toggleMusic(this));
    const realBoss = !!this.campaign?.bosses.some((b) => !b.def.quiet);
    playMusic(this, realBoss ? 'boss' : 'battle');
    if (this.campaign) this.showBriefCard();
    this.input.keyboard!.on('keydown-F', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
    this.input.keyboard!.once('keydown', () => this.sfx.unlock());
    this.input.once('pointerdown', () => this.sfx.unlock());

    if (this.campaign) this.hud.showBanner(`${this.campaign.level.name.toUpperCase()}\n${this.campaign.level.brief}`, 3200);
    else this.hud.showBanner(this.arena ? `ROUND ${this.roundNumber()}\nGET READY` : `ROUND ${this.roundNumber()}\n${this.turn!.currentTank.name.toUpperCase()} FIRST`, 1600);
    this.events.on('wake', () => this.onWake());
  }

  private helpLines(): string[] {
    if (this.touch) {
      return [
        'TOUCH — drag anywhere that is not a pad to aim',
        'hold the FIRE pad to charge; lift to fire',
        'a short tap on FIRE does nothing — only a hold shoots',
        ...(this.world.mode.movement ? ['◄ ► pads drive; they still work while the shot is in the air'] : []),
        'tap WEAPON, or the rack top right, to switch',
        'keyboard still works if you have one · P pause · ESC leave',
      ];
    }
    if (this.turn) {
      const move = this.world.mode.movement ? ['A / D            drive along the ground (uses fuel, refills each turn)'] : [];
      return [
        '← / →            aim barrel',
        '↑ / ↓            power',
        ...move,
        'SPACE            fire',
        'TAB / Shift+TAB  next / previous weapon',
        'P  pause    M  mute sfx    N  music    F  fullscreen    ESC  menu    H  close',
      ];
    }
    return [
      'Solo: any set works — A/D or ←→ drive, W/S or ↑↓ aim, SPACE/ENTER hold to charge',
      'P1  WASD move/aim   SPACE fire   Q weapon',
      'P2  arrows          ENTER fire   RShift weapon',
      'P3  IJKL            O fire       U weapon',
      'P4  numpad 4/6 8/5  0 fire       + weapon',
      'left/right drive · up/down aim · HOLD fire to charge, release to shoot',
      'P  pause    M  mute    F  fullscreen    ESC  menu    H  close',
    ];
  }

  private roundNumber(): number {
    return this.turn ? this.turn.round : this.arena ? this.arena.round : 1;
  }

  // ---- backdrop --------------------------------------------------------------

  private tileForBiome(): { surface: string; deep: string } {
    const m: Record<string, { surface: string; deep: string }> = {
      dunes: { surface: 'tile.sand', deep: 'tile.earth' },
      mesas: { surface: 'tile.clay', deep: 'tile.earth' },
      crags: { surface: 'tile.earth', deep: 'tile.ash' },
      basin: { surface: 'tile.salt', deep: 'tile.earth' },
      spires: { surface: 'tile.ash', deep: 'tile.scorched' },
      canyon: { surface: 'tile.earth', deep: 'tile.ash' },
    };
    return m[this.world.terrain.style.id] ?? m.dunes;
  }

  private decor: { img: Phaser.GameObjects.Image; x: number; y: number }[] = [];

  /** Scatter surface decorations for the biome; they vanish when the ground under them goes. */
  private placeDecor(): void {
    this.decor.forEach((d) => d.img.destroy());
    this.decor = [];
    const byBiome: Record<string, string[]> = {
      dunes: ['decor.grass0', 'decor.grass1', 'decor.grass2', 'decor.cactus', 'decor.cactus2', 'decor.rock0', 'decor.shrub'],
      mesas: ['decor.rock0', 'decor.rock1', 'decor.rock2', 'decor.shrub', 'decor.grass2'],
      crags: ['decor.rock1', 'decor.rock2', 'decor.bones'],
      basin: ['decor.bones', 'decor.rock0', 'decor.shrub'],
      spires: ['decor.rock2', 'decor.bones', 'decor.shrub'],
      canyon: ['decor.rock1', 'decor.rock2', 'decor.bones'],
    };
    const pool = (byBiome[this.world.terrain.style.id] ?? byBiome.dunes).filter((k) => atlasHas(k));
    if (!pool.length) return;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const x = Math.round(60 + Math.random() * (this.world.width - 120));
      if (this.world.tanks.some((t) => Math.abs(t.x - x) < 70)) continue;
      const y = this.world.terrain.surfaceY(x);
      const slope = Math.abs(this.world.terrain.surfaceAngle(x, 6));
      if (slope > 0.5) continue;
      const key = pool[Math.floor(Math.random() * pool.length)];
      const img = this.add.image(x, y + HUD_H + 1, key).setOrigin(0.5, 1).setDepth(11).setScale(1).setFlipX(Math.random() < 0.5);
      this.decor.push({ img, x, y });
    }
  }

  private updateDecor(): void {
    for (const d of this.decor) {
      if (!d.img.active) continue;
      if (this.world.terrain.surfaceY(d.x) > d.y + 6) d.img.destroy();
    }
  }

  private buildBackdrop(): void {
    this.bgImages.forEach((i) => i.destroy());
    this.bgImages = [];
    const seed = (this.setup.seed + this.roundNumber() * 7919) & 0x7fffffff;
    const horizon = Math.floor(HUD_H + TERRAIN_H * 0.62);
    // (backdrop is generated at full native size each round; ~2M px, a few ms)
    this.backdropKeys = buildBackdrop(this, NATIVE_W, NATIVE_H, horizon, seed);
    // Styles with no dedicated background art (added after the art pass) reuse
    // the closest existing biome image.
    const BG_ALIAS: Record<string, string> = { canyon: 'crags' };
    const bgId = BG_ALIAS[this.world.terrain.style.id] ?? this.world.terrain.style.id;
    const layers = sliceBiome(this, `bg-${bgId}`);
    if (layers) {
      // Sky at integer 2× fills from the top down past the horizon; the far and near
      // bands sit on the horizon at 1× and repeat mirrored so no seam shows.
      const sky = this.add.image(NATIVE_W / 2, 0, layers.sky).setOrigin(0.5, 0).setDepth(0).setScale(2);
      this.bgImages.push(sky);
      // Anything the sky does not cover above the horizon: the procedural sky.
      this.bgImages.push(this.add.image(0, 0, this.backdropKeys.sky).setOrigin(0).setDepth(-1));
      for (const [key, depth] of [[layers.far, 1], [layers.near, 2]] as [string, number][]) {
        const tex = this.textures.get(key).getSourceImage() as { width: number; height: number };
        const n = Math.ceil(NATIVE_W / tex.width) + 1;
        for (let k = 0; k < n; k++) {
          this.bgImages.push(this.add.image(k * tex.width, horizon + 2, key).setOrigin(0, 1).setDepth(depth).setFlipX(k % 2 === 1));
        }
      }
    } else {
      this.bgImages.push(this.add.image(-80, 0, this.backdropKeys.farMesas).setOrigin(0).setDepth(1));
      this.bgImages.push(this.add.image(-180, 0, this.backdropKeys.nearMesas).setOrigin(0).setDepth(2));
    }
  }

  // ---- tank views ------------------------------------------------------------

  private makeTankView(t: Tank): void {
    if (hasParts(t.cls.id, t.skin)) return this.makePartsView(t);
    const skin = t.skin && atlasHas(`${t.skin}.r`) ? t.skin : skinForClass(t.cls.id);
    let hull: Phaser.GameObjects.Image;
    let pivotX: number;
    let pivotY: number;
    let barrel: Phaser.GameObjects.Image;
    if (skin) {
      const info = ensureHull(this, skin, 'r', t.colour);
      const sc = spriteScale(`${skin}.r`) * settings().tankScale;
      hull = this.add.image(0, 0, info.key).setOrigin(0.5, 1).setScale(sc);
      pivotX = info.pivotX * sc;
      pivotY = info.pivotY * sc;
      // Procedural barrel matched to the class, tinted toward the sprite's colour.
      ensureTankTextures(this, t.cls, t.colour);
      // The procedural barrel is authored at design scale; the hull sets the hitbox.
      barrel = this.add.image(0, 0, barrelTextureKey(t.cls, t.colour)).setOrigin(2 / (t.cls.barrel + 4), 0.5).setScale(SPRITE_SCALE);
      t.halfWidth = Math.round(info.width * 0.42 * sc);
      t.halfHeight = Math.round(info.height * 0.42 * sc);
      t.barrelLen = Math.round(t.cls.barrel * SPRITE_SCALE);
    } else {
      const meta = ensureTankTextures(this, t.cls, t.colour);
      const sc = SPRITE_SCALE * settings().tankScale;
      hull = this.add.image(0, 0, hullTextureKey(t.cls, t.colour)).setOrigin(0.5, 1).setScale(sc);
      pivotX = meta.pivotX * sc;
      pivotY = meta.pivotY * sc;
      barrel = this.add.image(0, 0, barrelTextureKey(t.cls, t.colour)).setOrigin(2 / (meta.barrelLen + 4), 0.5).setScale(sc);
      t.halfWidth = Math.round(t.cls.halfWidth * 2 * settings().tankScale);
      t.halfHeight = Math.round(t.cls.halfHeight * 2 * settings().tankScale);
      t.barrelLen = Math.round(meta.barrelLen * sc);
    }
    hull.setDepth(30);
    barrel.setDepth(29);
    const smoke = this.add.particles(0, 0, 'dot2', {
      lifespan: { min: 600, max: 1400 },
      speed: { min: 4, max: 14 },
      angle: { min: 260, max: 280 },
      scale: { start: 1.6, end: 4 },
      alpha: { start: 0.7, end: 0 },
      tint: [PAL.smoke, PAL.smokeLight],
      frequency: 120,
      emitting: false,
    }).setDepth(31);
    this.tankViews.set(t.index, { hull, turret: null, barrel, pivotX, pivotY, turretX: 0, turretY: 0, skin, parts: false, facing: 1, recoil: 0, smoke });
  }

  /** Hull + turret + barrel from the separated sheets, accents recoloured to the team. */
  private makePartsView(t: Tank): void {
    const enemy = ENEMY_PARTS[t.skin];
    const ids = enemy ?? { hull: `hull.${t.cls.id}`, turret: `turret.${t.cls.id}`, barrel: CLASS_BARREL[t.cls.id] ?? 'barrel.standard' };
    const hullKey = enemy ? ids.hull : ensureTeamTexture(this, ids.hull, t.colour);
    const turretKey = enemy ? ids.turret : ensureTeamTexture(this, ids.turret, t.colour);
    const barrelKey = enemy ? ids.barrel : ensureTeamTexture(this, ids.barrel, t.colour);
    const hm = partMetrics(this, ids.hull);
    const tm = partMetrics(this, ids.turret);
    const bm = partMetrics(this, ids.barrel);

    const sc = settings().tankScale;
    const hull = this.add.image(0, 0, hullKey).setOrigin(0.5, 1).setDepth(30).setScale(sc);
    const turret = this.add.image(0, 0, turretKey).setOrigin(0.5, 1).setDepth(31).setScale(sc);
    const barrel = this.add.image(0, 0, barrelKey).setOrigin(0.1, 0.5).setDepth(29).setScale(sc);

    // Turret sits on the deck, sunk a few pixels; the barrel pivots at the mantlet
    // on the turret's front (right) side. Everything scales with the size setting.
    const turretX = Math.round((hm.massX - hm.width / 2) * 0.4 * sc);
    const turretY = Math.round((-(hm.height - hm.topAtCentre) + 4) * sc);
    const pivotX = turretX + Math.round(tm.width * 0.28 * sc);
    const pivotY = turretY - Math.round(tm.height * 0.5 * sc);

    t.halfWidth = Math.round(hm.width * 0.45 * sc);
    t.halfHeight = Math.round(((hm.height + tm.height * 0.7) / 2) * sc);
    t.pivotDX = pivotX;
    t.pivotDY = pivotY;
    t.barrelLen = Math.round(bm.width * 0.88 * sc);

    const smoke = this.add.particles(0, 0, 'dot2', {
      lifespan: { min: 600, max: 1400 },
      speed: { min: 4, max: 14 },
      angle: { min: 260, max: 280 },
      scale: { start: 1.6, end: 4 },
      alpha: { start: 0.7, end: 0 },
      tint: [PAL.smoke, PAL.smokeLight],
      frequency: 120,
      emitting: false,
    }).setDepth(32);
    this.tankViews.set(t.index, { hull, turret, barrel, pivotX, pivotY, turretX, turretY, skin: t.skin, parts: true, facing: 1, recoil: 0, smoke });
  }

  private syncTankView(t: Tank, dt: number): void {
    const v = this.tankViews.get(t.index)!;
    // A tank waiting to be dropped is not in the world yet; only the one whose
    // turn it is to choose is drawn, as a translucent ghost at the cursor.
    const ghost = !t.placed;
    if (ghost) {
      v.hull.setAlpha(0.5);
      v.turret?.setAlpha(0.5);
      v.barrel.setAlpha(0.5);
    } else if (v.hull.alpha !== 1) {
      v.hull.setAlpha(1);
      v.turret?.setAlpha(1);
      v.barrel.setAlpha(1);
    }
    if (!t.alive || (ghost && this.turn?.placingIndex !== t.index)) {
      v.hull.setVisible(false);
      v.turret?.setVisible(false);
      v.barrel.setVisible(false);
      v.smoke?.stop();
      return;
    }
    v.hull.setVisible(true);
    v.barrel.setVisible(true);
    const facing = t.facing;
    if (v.parts) {
      v.turret!.setVisible(true);
      // Hull follows the slope (clamped); the turret rides with it, the barrel stays absolute.
      const rot = hullRotation(t);
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const x = Math.round(t.x);
      const y = Math.round(t.y + HUD_H);
      const local = (lx: number, ly: number) => ({ x: x + (lx * facing) * ca - ly * sa, y: y + (lx * facing) * sa + ly * ca });
      v.hull.setPosition(x, y).setRotation(rot).setFlipX(facing === -1);
      const tp = local(v.turretX, v.turretY);
      v.turret!.setPosition(Math.round(tp.x), Math.round(tp.y)).setRotation(rot).setFlipX(facing === -1);
      const pp = local(v.pivotX, v.pivotY);
      v.recoil = Math.max(0, v.recoil - dt * 36);
      const a = (-t.angle * Math.PI) / 180;
      v.barrel.setPosition(pp.x - Math.cos(a) * v.recoil, pp.y - Math.sin(a) * v.recoil).setRotation(a).setFlipY(facing === -1);
      if (v.smoke) {
        v.smoke.setPosition(x, y - t.halfHeight * 2);
        if (t.hp < t.maxHp * 0.4 && !v.smoke.emitting) v.smoke.start();
        else if (t.hp >= t.maxHp * 0.4 && v.smoke.emitting) v.smoke.stop();
      }
      const tint = t.hp < t.maxHp * 0.25 ? 0xbbaaaa : 0xffffff;
      v.hull.setTint(tint);
      v.turret!.setTint(tint);
      return;
    }
    if (facing !== v.facing) {
      v.facing = facing;
      if (v.skin) {
        const f = facing === 1 ? 'r' : 'l';
        const info = atlasHas(`${v.skin}.${f}`) ? ensureHull(this, v.skin, f, t.colour) : ensureHull(this, v.skin, 'r', t.colour);
        v.hull.setTexture(info.key);
        v.hull.setFlipX(!atlasHas(`${v.skin}.${f}`) && facing === -1);
        v.pivotX = (atlasHas(`${v.skin}.${f}`) ? info.pivotX : -info.pivotX) * spriteScale(`${v.skin}.r`);
      } else {
        v.hull.setFlipX(facing === -1);
        v.pivotX = Math.abs(v.pivotX) * (facing === 1 ? 1 : -1);
      }
    }
    const x = Math.round(t.x);
    const y = Math.round(t.y + HUD_H);
    // Same lean as the parts hulls (it used to be a softer 0.6x, which meant the
    // muzzle could not share one piece of geometry with the renderer).
    const rot = hullRotation(t);
    v.hull.setPosition(x, y).setRotation(rot);
    // Barrel pivot rotates with the hull tilt. Publish it to the tank so the
    // core spawns the shell from the pivot it is drawn at: core re-applies
    // facing, and pivotX already carries it, hence the round-trip.
    t.pivotDX = v.pivotX * facing;
    t.pivotDY = v.pivotY;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const px = x + v.pivotX * ca - v.pivotY * sa;
    const py = y + v.pivotX * sa + v.pivotY * ca;
    v.recoil = Math.max(0, v.recoil - dt * 18 * SPRITE_SCALE);
    const a = (-t.angle * Math.PI) / 180;
    v.barrel.setPosition(px - Math.cos(a) * v.recoil, py - Math.sin(a) * v.recoil).setRotation(a);
    // Damage smoke
    if (v.smoke) {
      v.smoke.setPosition(x, y - t.halfHeight * 2);
      if (t.hp < t.maxHp * 0.4 && !v.smoke.emitting) v.smoke.start();
      else if (t.hp >= t.maxHp * 0.4 && v.smoke.emitting) v.smoke.stop();
    }
    // Dim dug-in / dead tint
    v.hull.setTint(t.hp < t.maxHp * 0.25 ? 0xbbaaaa : 0xffffff);
  }

  // ---- projectiles & crates ----------------------------------------------------

  private syncProjectiles(): void {
    const seen = new Set<number>();
    for (const p of this.world.projectiles) {
      seen.add(p.id);
      let v = this.projViews.get(p.id);
      if (!v) {
        const key = this.projectileTexture(p);
        const sprite = this.add.image(0, 0, key).setDepth(36).setScale(key === 'shell' ? SPRITE_SCALE : spriteScale(key));
        v = { sprite, trail: this.add.graphics().setDepth(34) };
        this.projViews.set(p.id, v);
      }
      v.sprite.setPosition(p.pos.x, p.pos.y + HUD_H).setRotation(Math.atan2(p.vel.y, p.vel.x));
      v.trail.clear();
      const col = p.weapon.trail === 'plasma' ? PAL.glow : p.weapon.trail === 'fire' ? PAL.fireHot : p.weapon.trail === 'smoke' ? PAL.smokeLight : PAL.glowCore;
      for (let i = 0; i < p.trail.length; i++) {
        const q = p.trail[i];
        const f = i / p.trail.length;
        v.trail.fillStyle(col, 0.15 + f * 0.6).fillRect(Math.round(q.x), Math.round(q.y + HUD_H), 2, 2);
      }
    }
    for (const [id, v] of this.projViews) {
      if (!seen.has(id)) {
        v.sprite.destroy();
        v.trail.destroy();
        this.projViews.delete(id);
      }
    }
  }

  private projectileTexture(p: Projectile): string {
    // Dedicated sprite per weapon from the projectiles sheet; bomblets for submunitions.
    if (p.depth > 0 && atlasHas('proj.bomblet')) return 'proj.bomblet';
    if (atlasHas(`proj.${p.weapon.id}`)) return `proj.${p.weapon.id}`;
    const b = p.weapon.behaviour;
    if (b === 'mirv' && atlasHas('proj.missile')) return 'proj.missile';
    if (b === 'railgun' && atlasHas('proj.plasma')) return 'proj.plasma';
    if ((b === 'nuke' || p.weapon.id === 'heavy') && atlasHas('proj.heshell')) return 'proj.heshell';
    if (b === 'napalm' && atlasHas('proj.rocket')) return 'proj.rocket';
    return 'shell';
  }

  private syncCrates(): void {
    const seen = new Set<number>();
    for (const c of this.world.crates) {
      seen.add(c.id);
      let v = this.crateViews.get(c.id);
      if (!v) v = this.makeCrateView(c);
      v.setPosition(Math.round(c.x), Math.round(c.y + HUD_H));
      const chute = v.getByName('chute') as Phaser.GameObjects.GameObject & { setVisible(v: boolean): unknown } | null;
      const box = v.getByName('box') as Phaser.GameObjects.Image | null;
      if (chute) chute.setVisible(!c.landed);
      if (box && atlasHas('fx.chute.0')) box.setVisible(c.landed);
    }
    for (const [id, v] of this.crateViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.crateViews.delete(id);
      }
    }
  }

  private makeCrateView(c: Crate): Phaser.GameObjects.Container {
    const want = `crate.${c.crateKind}`;
    const key = atlasHas(want) ? want : atlasHas('crate.wood') ? 'crate.wood' : 'debris2';
    const img = this.add.image(0, 0, key).setName('box').setOrigin(0.5, 0.5);
    img.setScale(spriteScale(key));
    // Sheet chute animation (parachute + crate) while falling; else a drawn canopy.
    if (atlasHas('fx.chute.0')) {
      const animKey = 'anim:fx.chute';
      if (!this.anims.exists(animKey)) {
        const frames: { key: string }[] = [];
        for (let i = 0; i < 12 && atlasHas(`fx.chute.${i}`); i++) frames.push({ key: `fx.chute.${i}` });
        this.anims.create({ key: animKey, frames, frameRate: 8, repeat: -1 });
      }
      const chuteSpr = this.add.sprite(0, 0, 'fx.chute.0').setName('chute').setOrigin(0.5, 1).setScale(2);
      chuteSpr.play(animKey);
      chuteSpr.setY(img.displayHeight / 2);
      const cont = this.add.container(0, 0, [chuteSpr, img]).setDepth(33);
      this.crateViews.set(c.id, cont);
      return cont;
    }
    const chute = this.add.graphics().setName('chute');
    chute.fillStyle(PAL.uiText, 1).fillEllipse(0, -44, 60, 28);
    chute.fillStyle(PAL.uiDanger, 1).fillRect(-16, -52, 12, 12);
    chute.lineStyle(2, PAL.uiTextDim, 1);
    chute.lineBetween(-28, -40, -12, -16);
    chute.lineBetween(28, -40, 12, -16);
    chute.lineBetween(0, -44, 0, -16);
    const cont = this.add.container(0, 0, [chute, img]).setDepth(33);
    this.crateViews.set(c.id, cont);
    return cont;
  }

  // ---- events -----------------------------------------------------------------

  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'launch': {
          this.fx.muzzleFlash(e.from.x, e.from.y, e.angle);
          const v = this.tankViews.get(e.shooter);
          if (v) v.recoil = v.parts ? 10 : 4 * SPRITE_SCALE;
          this.sfx.play(e.weapon.behaviour === 'railgun' ? 'railgun' : e.weapon.damage > 45 ? 'fireHeavy' : 'fire', 1, 0.9 + Math.random() * 0.2);
          break;
        }
        case 'explode':
          if (this.rec && this.turn?.phase === 'resolving') this.rec.fx.push({ step: this.rec.frames.length, x: e.at.x, y: e.at.y, radius: e.radius, weapon: e.weapon });
          this.fx.explosion(e.at.x, e.at.y, e.radius, e.weapon);
          this.sfx.play(e.radius > 50 ? 'explodeBig' : e.radius > 24 ? 'explode' : 'explodeSmall', 1, 0.85 + Math.random() * 0.3);
          // Only the genuinely huge ordnance gets the screen-wide flash.
          if (e.weapon.behaviour === 'nuke' || e.radius >= 60) this.screenFx.bigBlast(e.radius >= 80 ? 0.7 : 0.45);
          break;
        case 'fill':
          this.fx.landDust(e.at.x, e.at.y, 3);
          this.sfx.play('land');
          break;
        case 'hazardArmed':
          break;
        case 'hazardBlown':
          this.sfx.play(e.hazardKind === 'mine' ? 'explode' : 'explodeBig', 1, 1.05);
          break;
        case 'burn':
          this.fx.burn(e.at.x, e.at.y);
          this.sfx.play('burn', 0.6);
          this.screenFx.heatHaze();
          break;
        case 'split':
          this.fx.split(e.at.x, e.at.y);
          this.sfx.play('split');
          break;
        case 'bounce':
          this.fx.landDust(e.at.x, e.at.y, 1);
          break;
        case 'damage': {
          const target = this.world.damageables().find((d) => d.id === e.target);
          if (target && target.kind === 'tank') {
            const tk = target as Tank;
            const y = tk.y - tk.halfHeight * 2;
            if (e.shieldAbsorbed > 0) {
              this.fx.damageNumber(tk.x, y, e.shieldAbsorbed, 0x54c8ff);
              this.fx.shieldHit(tk.x, tk.y - tk.halfHeight);
              this.sfx.play('shield');
            }
            if (e.amount > 0) {
              this.fx.damageNumber(tk.x, y - (e.shieldAbsorbed > 0 ? 8 : 0), e.amount, PAL.uiDanger);
              this.sfx.play('hit', 0.8);
            }
          }
          break;
        }
        case 'kill': {
          if (this.rec && this.turn) this.rec.killed = true;
          const target = this.world.damageables().find((d) => d.id === e.target);
          if (target && target.kind === 'hardpoint') {
            this.fx.explosion(target.x, target.y, 26, weaponById('heavy'));
            this.sfx.play('kill', 0.8);
            this.hud.showBanner(`${(target as Hardpoint).name.toUpperCase()} DESTROYED`, 1200);
          }
          if (target && target.kind === 'tank') {
            const tk = target as Tank;
            this.fx.explosion(tk.x, tk.y - tk.halfHeight, 34, weaponById('heavy'));
            this.fx.smokePlume(tk.x, tk.y);
            this.sfx.play('kill');
            const by = this.world.tanks[e.by];
            this.hud.showBanner(by && by.index !== tk.index ? `${by.name.toUpperCase()} DESTROYED ${tk.name.toUpperCase()}` : `${tk.name.toUpperCase()} DESTROYED`, 1500);
          }
          break;
        }
        case 'land': {
          const tk = this.world.tanks[e.tank];
          this.fx.landDust(tk.x, tk.y, Math.min(4, e.impactSpeed / 80));
          if (e.impactSpeed > 60) this.sfx.play('land', Math.min(1, e.impactSpeed / 300));
          if (e.damage > 0) this.fx.damageNumber(tk.x, tk.y - tk.halfHeight * 2, e.damage, PAL.fireHot);
          break;
        }
        case 'cratePickup': {
          const tk = this.world.tanks[e.tank];
          this.sfx.play('crate');
          const label = e.crateKind === 'weapon' || e.crateKind === 'ammo' ? weaponById(e.payload || 'heavy').name : e.crateKind.toUpperCase();
          const txt = this.add.text(tk.x, tk.y + HUD_H - tk.halfHeight * 2 - 24, `+ ${label}`, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.glow), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5).setDepth(80);
          this.tweens.add({ targets: txt, y: txt.y - 20, alpha: 0, duration: 1100, onComplete: () => txt.destroy() });
          break;
        }
        case 'crateLand':
          this.sfx.play('land', 0.4);
          break;
        case 'move':
          if (Math.random() < 0.15) this.sfx.play('drive', 0.5, 0.9 + Math.random() * 0.2);
          break;
        default:
          break;
      }
    }
  }

  // ---- input mapping -----------------------------------------------------------

  /** Hotseat turn-based: ←→ aim, ↑↓ power, A/D drive, Space fire, Tab weapon. */
  /** A/D only, for driving while a shot resolves. */
  private driveOnlyIntent(): Intent {
    const it = emptyIntent();
    it.moveX = (this.inputs.isDown('KeyD') ? 1 : 0) - (this.inputs.isDown('KeyA') ? 1 : 0);
    if (this.touch) it.moveX = it.moveX || this.touch.intent().moveX;
    return it;
  }

  private turnIntent(): Intent {
    const raw = this.inputs.sharedIntent();
    const it = emptyIntent();
    const left = this.inputs.isDown('ArrowLeft');
    const right = this.inputs.isDown('ArrowRight');
    it.aimDelta = (left ? 1 : 0) - (right ? 1 : 0);
    // Fine aim with W/S is power; A/D drives when the mode allows.
    it.powerDelta = raw.powerDelta;
    it.moveX = (this.inputs.isDown('KeyD') ? 1 : 0) - (this.inputs.isDown('KeyA') ? 1 : 0);
    if (!this.world.mode.movement) {
      // Without movement A/D also aim, so both hands work.
      it.aimDelta += -it.moveX;
      it.moveX = 0;
    }
    it.aimDelta *= this.aimRamp('t:aim', it.aimDelta !== 0, SIM_DT);
    it.powerDelta *= this.aimRamp('t:pow', it.powerDelta !== 0, SIM_DT);
    // Touch: drive pads and the weapon pad merge in; the barrel angle has already
    // been written onto the tank by the drag. Fire is always hold-to-charge on
    // touch, whatever the setting says — there is no key to type a power with.
    const tc = this.touch?.intent();
    if (tc) {
      it.moveX = it.moveX || tc.moveX;
      if (tc.cycleWeapon) it.cycleWeapon = tc.cycleWeapon;
    }
    const held = raw.fireHeld || !!tc?.fireHeld;
    if ((settings().chargeFire || tc) && this.turn) {
      // Hold to charge: power climbs from 20 while held, release fires.
      const t = this.turn.currentTank;
      const prev = this.prevHeld.get(-1) ?? false;
      let charge = this.charge.get(-1) ?? 0;
      if (held) {
        charge = Math.min(100, (prev ? charge : 20) + 60 * SIM_DT);
        this.world.setPower(t, charge);
        it.powerDelta = 0;
      } else if (prev) it.fire = true;
      this.charge.set(-1, charge);
      this.prevHeld.set(-1, held);
    } else {
      it.fire = raw.fire;
    }
    it.fireHeld = held;
    it.cycleWeapon = raw.cycleWeapon;
    if (it.aimDelta !== 0 && Math.random() < 0.08) this.sfx.play('aim', 0.6);
    if (it.cycleWeapon !== 0) this.sfx.play('cycle');
    return it;
  }

  /** Arena: ←→ drive, ↑↓ aim, hold fire to charge power, release to fire. */
  private arenaIntent(slot: number, tank: Tank, dt: number): Intent {
    // A lone human may use any key set (WASD or arrows, Space or Enter).
    const humans = this.world.tanks.filter((t) => !t.isBot).length;
    const raw = humans <= 1 ? this.inputs.sharedIntent() : this.inputs.slotIntent(slot);
    // The touch layer drives slot 0 (the only human a touch game has).
    if (this.touch && slot === 0) {
      const tc = this.touch.intent();
      raw.moveX = raw.moveX || tc.moveX;
      raw.fireHeld = raw.fireHeld || tc.fireHeld;
      if (tc.cycleWeapon) raw.cycleWeapon = tc.cycleWeapon;
    }
    const it = emptyIntent();
    it.moveX = raw.moveX;
    // Up = raise barrel whichever way the hull faces; slow start, then accelerate.
    it.aimDelta = raw.powerDelta * this.aimRamp(`a:${slot}`, raw.powerDelta !== 0, dt);
    void tank;
    it.cycleWeapon = raw.cycleWeapon;
    const held = raw.fireHeld;
    const prev = this.prevHeld.get(slot) ?? false;
    let charge = this.charge.get(slot) ?? 0;
    if (held) {
      charge = Math.min(100, (prev ? charge : 35) + 70 * dt);
      this.world.setPower(tank, charge);
    } else if (prev) {
      it.fire = true;
    }
    this.charge.set(slot, charge);
    this.prevHeld.set(slot, held);
    return it;
  }

  // ---- main loop --------------------------------------------------------------------

  override update(_time: number, deltaMs: number): void {
    const frameDt = Math.min(0.1, deltaMs / 1000);
    if (this.replay) {
      // startReplay() sets `paused` to freeze the world while it plays back, so
      // the replay must not wait on that flag — only on the pause menu. (Gating
      // on `paused` here froze every replay solid, with no way out on touch.)
      if (!this.pauseUi) {
        this.advanceReplay(frameDt);
        if (this.inputs.isDown('Space') || this.inputs.isDown('Enter')) this.endReplay();
      }
      this.fx.update(frameDt);
      return;
    }
    this.updateTouch();
    if (this.turn && this.turn.phase === 'aim' && this.rec && !this.rec.killed) this.rec = null;
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < 12) {
        this.simStep(SIM_DT);
        this.accumulator -= SIM_DT;
        steps++;
      }
    }
    this.updatePlacement(frameDt);
    this.handleEvents(this.world.drainEvents());
    this.terrainView.update();
    for (const t of this.world.tanks) this.syncTankView(t, frameDt);
    this.syncProjectiles();
    this.syncCrates();
    this.syncHazards();
    this.syncDrones();
    this.syncBosses();
    this.updateDecor();
    this.drawAimAssist();
    this.fx.update(frameDt);
    const watched = this.currentForHud();
    this.screenFx.setHealth(watched && watched.alive ? watched.hp / Math.max(1, watched.maxHp) : 1);
    this.screenFx.update(frameDt);
    this.hud.update(this.world, watched, this.statusLine());
    this.tickCountdown();
    this.checkPhase(frameDt);
  }

  private simStep(dt: number): void {
    if (this.turn) {
      const m = this.turn;
      if (m.phase === 'resolving') this.recordStep();
      let intent = emptyIntent();
      if (m.phase === 'aim') {
        const t = m.currentTank;
        const key = `${m.round}:${m.turn}:${m.current}:${m.shotsLeftThisTurn}`;
        if (key !== this.lastTurnKey) {
          this.lastTurnKey = key;
          this.bots.get(t.index)?.newTurn();
          if (!t.isBot) this.hud.showBanner(`${t.name.toUpperCase()}`, 700);
        }
        intent = t.isBot ? this.bots.get(t.index)!.turnIntent(this.world, t, dt) : this.turnIntent();
      } else if (m.phase === 'resolving' && !m.currentTank.isBot) {
        // The shell is in the air and the shooter can still drive on the fuel
        // it has left. Drive only: reusing turnIntent() here would let the
        // hold-to-charge branch move the power bar mid-flight.
        intent = this.driveOnlyIntent();
      } else if (m.phase === 'countdown' && !m.currentTank.isBot) {
        // Aim during the hold; the rules ignore fire and drive until it ends.
        intent = this.turnIntent();
      }
      m.update(intent, dt);
    } else if (this.arena) {
      const intents = this.world.tanks.map((t, i) => (t.isBot ? this.bots.get(t.index)!.arenaIntent(this.world, t, dt) : this.arenaIntent(i, t, dt)));
      this.arena.update(intents, dt);
    } else if (this.campaign) {
      const intents = this.world.tanks.map((t, i) => (t.isBot ? this.bots.get(t.index)!.arenaIntent(this.world, t, dt) : this.arenaIntent(i, t, dt)));
      this.campaign.update(intents, dt);
      // Hold the reveal and the taunts until the briefing is out of the way,
      // otherwise all three cards land on top of each other on a boss level.
      if (this.briefCard.length) return;
      for (const msg of this.campaign.banners.splice(0)) {
        this.hud.showBanner(msg, 1800);
        const boss = this.campaign.bosses.find((b) => b.def.name.toUpperCase() === msg);
        if (boss) this.bossCard(boss.def.name, boss.index);
      }
      for (const t of this.campaign.taunts.splice(0)) this.tauntCard(t.name, t.portrait, t.line);
    }
  }

  /** Mines and barrels: static sprites that vanish when they go off. */
  private syncHazards(): void {
    const seen = new Set<number>();
    for (const h of this.world.hazards) {
      seen.add(h.id);
      let v = this.hazardViews.get(h.id);
      if (!v) {
        const key = h.hazardKind === 'mine' ? 'hazard.mine' : 'barrel.explosive';
        if (!atlasHas(key)) continue;
        v = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(24).setScale(spriteScale(key));
        this.hazardViews.set(h.id, v);
      }
      v.setPosition(Math.round(h.x), Math.round(h.y + HUD_H));
      // Barrels take damage before they blow; show it.
      if (h.hazardKind === 'barrel') v.setTint(h.hp < h.maxHp * 0.5 ? 0xffb066 : 0xffffff);
    }
    for (const [id, v] of this.hazardViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.hazardViews.delete(id);
      }
    }
  }

  /** Hive drones: one sprite each, banked in the direction of travel. */
  private syncDrones(): void {
    if (!this.campaign) {
      return;
    }
    const seen = new Set<number>();
    for (const d of this.campaign.drones) {
      if (!d.hp.alive) continue;
      seen.add(d.hp.id);
      let v = this.droneViews.get(d.hp.id);
      if (!v) {
        if (!atlasHas('boss.hive.drone')) continue;
        v = this.add.image(0, 0, 'boss.hive.drone').setOrigin(0.5).setDepth(33).setScale(spriteScale('boss.hive.drone'));
        this.droneViews.set(d.hp.id, v);
      }
      v.setPosition(Math.round(d.hp.x), Math.round(d.hp.y + HUD_H));
      v.setFlipX(d.vx < 0);
      // Small bank angle from the climb rate reads as flight without an animation.
      v.setRotation(Math.max(-0.5, Math.min(0.5, d.vy / 400)) * (d.vx < 0 ? -1 : 1));
    }
    for (const [id, v] of this.droneViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.droneViews.delete(id);
      }
    }
  }

  private syncBosses(): void {
    if (!this.campaign) return;
    this.campaign.bosses.forEach((boss, i) => {
      const v = this.bossViews[i];
      if (!v) return;
      v.bars.clear();
      const alive = this.campaign!.bossAlive(boss);
      if (v.img) {
        v.img.setVisible(alive).setTint(alive ? 0xffffff : 0x553333);
        let hp = 0, max = 0;
        for (const h of boss.hardpoints.values()) { hp += h.hp; max += h.maxHp; }
        const dmgKey = `${boss.def.skin}.damaged`;
        if (atlasHas(dmgKey) && hp < max * 0.5 && v.img.texture.key !== dmgKey) v.img.setTexture(dmgKey);
      }
      if (!alive) return;
      for (const [id, hp] of boss.hardpoints) {
        if (!hp.alive) continue;
        const active = boss.active.has(id) || hp.core;
        const w = 36;
        const x = Math.round(hp.x - w / 2);
        const y = Math.round(hp.y + HUD_H - hp.halfHeight - 10);
        v.bars.fillStyle(PAL.uiInk, 0.85).fillRect(x - 2, y - 2, w + 4, 8);
        v.bars.fillStyle(hp.core ? PAL.uiDanger : active ? PAL.fireHot : PAL.uiTextDim, 1).fillRect(x, y, Math.round(w * (hp.hp / hp.maxHp)), 4);
      }
    });
  }

  /** Snapshot projectiles and tanks for the replay recording. */
  private recordStep(): void {
    if (!this.rec) this.rec = { frames: [], fx: [], killed: false };
    this.rec.frames.push({
      projs: this.world.projectiles.map((p) => ({ x: p.pos.x, y: p.pos.y, key: this.projectileTexture(p), rot: Math.atan2(p.vel.y, p.vel.x) })),
      tanks: this.world.tanks.map((t) => this.snapshotTank(t)),
    });
  }

  private snapshotTank(t: Tank): RecTank {
    return { i: t.index, x: t.x, y: t.y, tilt: t.tilt, angle: t.angle, facing: t.facing, alive: t.alive, hp: t.hp, shield: t.shield };
  }

  private restoreTank(s: RecTank): Tank {
    const t = this.world.tanks[s.i];
    t.x = s.x;
    t.y = s.y;
    t.tilt = s.tilt;
    t.angle = s.angle;
    t.facing = s.facing;
    t.alive = s.alive;
    t.hp = s.hp;
    t.shield = s.shield;
    return t;
  }

  private startReplay(): void {
    const rec = this.rec!;
    // Trim to the interesting part: from launch to a little after the last explosion.
    const lastFx = rec.fx.length ? rec.fx[rec.fx.length - 1].step : rec.frames.length - 1;
    rec.frames.length = Math.min(rec.frames.length, lastFx + 36);
    // Keep at most ~3 s of flight before the final impact.
    const start = Math.max(0, lastFx - 360);
    if (start > 0) {
      rec.frames.splice(0, start);
      for (const f of rec.fx) f.step -= start;
    }
    const label = this.add.text(0, 0, this.touch ? '◄◄ REPLAY  ·  tap to skip' : '◄◄ REPLAY  ·  SPACE to skip', { fontFamily: 'monospace', fontSize: '22px', color: hex(PAL.uiEdge), stroke: hex(PAL.uiInk), strokeThickness: 5 }).setOrigin(0.5).setDepth(140);
    this.replay = {
      step: 0,
      acc: 0,
      ghosts: [],
      trail: this.add.graphics().setDepth(37),
      label,
      finalTanks: this.world.tanks.map((t) => this.snapshotTank(t)),
      finishing: false,
    };
    // Live projectile views would sit frozen on screen behind the ghosts.
    for (const [, v] of this.projViews) {
      v.sprite.setVisible(false);
      v.trail.clear();
    }
    this.paused = true;
    this.cameras.main.setZoom(1.45);
  }

  private advanceReplay(frameDt: number): void {
    const r = this.replay!;
    const rec = this.rec!;
    const speed = 0.4; // slow motion
    r.acc += frameDt * speed;
    while (r.acc >= SIM_DT && r.step < rec.frames.length) {
      r.acc -= SIM_DT;
      r.step++;
      for (const f of rec.fx) if (f.step === r.step) this.fx.explosion(f.x, f.y, f.radius, f.weapon);
    }
    const cur = rec.frames[Math.min(r.step, rec.frames.length - 1)];
    const frame = cur?.projs ?? [];
    // Tanks as they were during the shot — this is what brings the destroyed
    // tank back on screen for the replay.
    for (const s of cur?.tanks ?? []) this.syncTankView(this.restoreTank(s), frameDt);
    this.hud.update(this.world, null, '');
    // Ghost sprites for each projectile in this frame.
    while (r.ghosts.length < frame.length) r.ghosts.push(this.add.image(0, 0, 'shell').setDepth(36).setScale(SPRITE_SCALE));
    r.ghosts.forEach((g, i) => {
      const p = frame[i];
      if (!p) { g.setVisible(false); return; }
      g.setVisible(true).setTexture(p.key).setPosition(p.x, p.y + HUD_H).setRotation(p.rot);
    });
    // Trail so far.
    r.trail.clear();
    for (let s = Math.max(0, r.step - 220); s < r.step; s++) {
      for (const p of rec.frames[s]?.projs ?? []) r.trail.fillStyle(PAL.glow, 0.25 + (0.6 * (s - (r.step - 220))) / 220).fillRect(Math.round(p.x), Math.round(p.y + HUD_H), 2, 2);
    }
    // Camera follows the shell, then settles on the impact for the last stretch so
    // the target — and the tank being destroyed — is in frame when it lands.
    const impact = rec.fx.length ? rec.fx[rec.fx.length - 1] : null;
    const nearEnd = r.step > rec.frames.length - 110;
    const focus = (nearEnd && impact ? { x: impact.x, y: impact.y } : frame[0]) ?? (impact ? { x: impact.x, y: impact.y } : null);
    if (focus) {
      const cam = this.cameras.main;
      const tx = Math.max(NATIVE_W / (2 * cam.zoom), Math.min(NATIVE_W - NATIVE_W / (2 * cam.zoom), focus.x));
      const ty = Math.max(NATIVE_H / (2 * cam.zoom), Math.min(NATIVE_H - NATIVE_H / (2 * cam.zoom), focus.y + HUD_H));
      cam.centerOn(cam.midPoint.x + (tx - cam.midPoint.x) * 0.08, cam.midPoint.y + (ty - cam.midPoint.y) * 0.08);
    }
    // Label pinned to the top of the zoomed view.
    const cam = this.cameras.main;
    r.label.setPosition(cam.midPoint.x, cam.midPoint.y - NATIVE_H / (2 * cam.zoom) + 60 / cam.zoom).setScale(1 / cam.zoom);
    // The kill is part of the recording, so playback ends with the wreck already
    // gone; hold a beat on it before the round-over card.
    if (r.step >= rec.frames.length && !r.finishing) {
      r.finishing = true;
      this.time.delayedCall(700, () => this.endReplay());
    }
  }

  private endReplay(): void {
    const r = this.replay;
    if (!r) return;
    // Put the tanks back where the round actually ended.
    for (const s of r.finalTanks) this.syncTankView(this.restoreTank(s), 0);
    for (const [, v] of this.projViews) v.sprite.setVisible(true);
    r.ghosts.forEach((g) => g.destroy());
    r.trail.destroy();
    r.label.destroy();
    this.replay = null;
    this.replayShown = true;
    this.paused = false;
    this.cameras.main.setZoom(1).centerOn(NATIVE_W / 2, NATIVE_H / 2);
  }

  private currentForHud(): Tank | null {
    if (this.turn) return this.turn.placingTank ?? this.turn.currentTank;
    return this.world.tanks.find((t) => !t.isBot && t.alive) ?? this.world.tanks[0];
  }

  private statusLine(): string {
    if (this.turn) {
      const m = this.turn;
      if (m.phase === 'placing') {
        const t = m.placingTank;
        const left = m.order.filter((i) => !this.world.tanks[i].placed).length;
        return `Round ${m.round}/${this.setup.rounds} · ${t?.name.toUpperCase() ?? ''} — choose your ground · drag your tank into place and let go (or ←→ and ENTER) · ${left} left · first to drop fires first`;
      }
      if (m.phase === 'countdown') {
        return `Round ${m.round}/${this.setup.rounds} · ${m.currentTank.name.toUpperCase()} first · get ready — ${Math.ceil(m.countdown)}`;
      }
      const cls = this.world.mode.tankClasses ? ` · ${m.currentTank.cls.name}` : '';
      const fuel = this.world.mode.movement ? ` · fuel ${m.currentTank.fuel}` : '';
      const drive = this.world.mode.movement ? '  A/D drive' : '';
      const fireHint = settings().chargeFire ? 'hold SPACE to charge, release to fire' : '↑↓ power  SPACE fire';
      // Driving stays live while the shot resolves, so say so rather than just 'firing'.
      const resolving = this.world.mode.movement ? 'shot away — A/D still drive on your remaining fuel' : 'firing…';
      return `Round ${m.round}/${this.setup.rounds} · ${this.world.mode.name}${cls}${fuel} · ${m.phase === 'aim' ? `←→ aim  ${fireHint}${drive}  TAB weapon  H help` : resolving}`;
    }
    if (this.campaign) {
      const c = this.campaign;
      const li = LEVELS.findIndex((l) => l.id === c.level.id) + 1;
      return `Campaign ${li}/${LEVELS.length} · ${c.level.name} · ${c.phase === 'brief' ? c.level.brief : c.phase === 'countdown' ? `get ready — ${Math.ceil(c.countdownLeft)}` : 'A/D or ←→ drive  W/S or ↑↓ aim  hold SPACE to charge, release to fire  TAB weapon'}`;
    }
    const a = this.arena!;
    if (a.phase === 'countdown') return `Round ${a.round}/${this.setup.rounds} · ARENA · starting in ${Math.ceil(a.countdown)}`;
    const solo = this.world.tanks.filter((t) => !t.isBot).length <= 1;
    return `Round ${a.round}/${this.setup.rounds} · ARENA · ${solo ? 'A/D or ←→ drive  W/S or ↑↓ aim  hold SPACE to charge' : 'per-player keys (H)  ←→ drive  ↑↓ aim  hold FIRE to charge'}  H help`;
  }

  // ---- drop placement ---------------------------------------------------------------

  /**
   * The 'placing' phase: the tank on the clock is previewed at the cursor and
   * dropped where the player confirms. Mouse moves the marker, arrows nudge it,
   * ENTER / SPACE / click commits. Illegal spots (too near a tank already down,
   * or off the edges) draw red and refuse the drop.
   */
  private updatePlacement(dt: number): void {
    const m = this.turn;
    this.placeGfx.clear();
    if (!m || m.phase !== 'placing') {
      this.placeConfirmLatch = false;
      return;
    }
    const t = m.placingTank;
    if (!t) return;
    if (this.paused) {
      this.placeClick = false;
      return;
    }
    const { min, max } = m.placeBounds();
    if (this.placeX === 0) this.placeX = Math.round((min + max) / 2);
    // New chooser: swallow anything already held or clicked, so the key that
    // dropped the previous tank cannot drop this one too.
    if (m.placingIndex !== this.placingFor) {
      this.placingFor = m.placingIndex;
      this.placeClick = false;
      this.placeDragging = false;
      this.placeConfirmLatch = true;
    }

    // While dragging, the ghost is under the pointer. A mouse also previews on
    // hover (a finger cannot hover); otherwise the arrows nudge, with the same
    // slow-start ramp the aim controls use.
    const ptr = this.input.activePointer;
    const hovered = !this.touch && (ptr.x !== this.lastPointerX || ptr.y !== this.lastPointerY);
    this.lastPointerX = ptr.x;
    this.lastPointerY = ptr.y;
    if (this.placeDragging || hovered) {
      this.placeX = Math.round(ptr.worldX);
    } else {
      const left = this.inputs.isDown('ArrowLeft') || this.inputs.isDown('KeyA');
      const right = this.inputs.isDown('ArrowRight') || this.inputs.isDown('KeyD');
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir !== 0) this.placeX += dir * 260 * dt * this.aimRamp('place', true, dt);
      else this.aimRamp('place', false, dt);
    }
    this.placeX = Math.max(min, Math.min(max, Math.round(this.placeX)));
    const legal = m.canPlaceAt(this.placeX);

    // Preview: the tank itself is unplaced, so moving it is free — the ghost IS
    // the tank, sitting on the surface it would land on.
    t.x = this.placeX;
    t.y = Math.min(this.world.terrain.surfaceY(this.placeX), this.world.terrain.height - 1);
    t.tilt = this.world.terrain.surfaceAngle(this.placeX, t.cls.halfWidth);
    t.facing = this.placeX < this.world.width / 2 ? 1 : -1;

    const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
    const col = legal ? team.lit : PAL.uiDanger;
    const gy = t.y + HUD_H;
    this.placeGfx.fillStyle(col, 0.5);
    for (let y = HUD_H + 8; y < gy - 30; y += 12) this.placeGfx.fillRect(this.placeX - 1, y, 2, 6);
    this.placeGfx.fillStyle(col, 0.9).fillRect(this.placeX - 16, gy + 2, 32, 2);
    // Keep-out markers for the minimum gap, so the refusal is not a mystery.
    this.placeGfx.fillStyle(col, 0.35);
    this.placeGfx.fillRect(this.placeX - 55, gy + 6, 110, 1);

    const keyHeld = this.inputs.isDown('Enter') || this.inputs.isDown('Space') || this.inputs.isDown('NumpadEnter');
    const clicked = this.placeClick;
    this.placeClick = false;
    if ((keyHeld && !this.placeConfirmLatch) || clicked) {
      this.placeConfirmLatch = keyHeld;
      if (legal && m.placeAt(this.placeX)) {
        this.sfx.play('select');
        this.fx.landDust(this.placeX, t.y, 1);
        const next = m.placingTank;
        if (next) this.hud.showBanner(`${next.name.toUpperCase()} — DROP`, 900);
      } else {
        this.sfx.play('back');
      }
    } else if (!keyHeld) {
      this.placeConfirmLatch = false;
    }
  }

  // ---- touch feed --------------------------------------------------------------------

  /** Tell the touch layer whose tank it is moving and whether it may act at all. */
  private updateTouch(): void {
    if (!this.touch) return;
    let tank: Tank | null = null;
    let phaseOk = false;
    let aimLocked = false;
    if (this.turn) {
      tank = this.turn.currentTank;
      phaseOk = this.turn.phase === 'aim' || this.turn.phase === 'resolving' || this.turn.phase === 'countdown';
      aimLocked = this.turn.phase === 'resolving';
    } else if (this.campaign) {
      tank = this.world.tanks[this.campaign.playerIndices[0]] ?? null;
      phaseOk = this.campaign.phase === 'live' || this.campaign.phase === 'countdown';
    }
    const human = tank && !tank.isBot && tank.alive ? tank : null;
    const enabled = !!human && phaseOk && !this.paused && !this.overlay.visible && !this.briefCard.length && !this.replay;
    this.touch.setEnabled(enabled);
    this.touch.setTarget(enabled ? human : null);
    this.touch.setAimLocked(aimLocked);
    this.touch.update();
  }

  /** "3 · 2 · 1" over the hold before the first shot, one banner per whole second. */
  private tickCountdown(): void {
    let left = -1;
    if (this.turn && this.turn.phase === 'countdown') left = this.turn.countdown;
    else if (this.campaign && this.campaign.phase === 'countdown') left = this.campaign.countdownLeft;
    if (left < 0) {
      this.lastCountdownTick = -1;
      return;
    }
    const whole = Math.ceil(left);
    if (whole !== this.lastCountdownTick) {
      this.lastCountdownTick = whole;
      this.hud.showBanner(whole > 0 ? String(whole) : 'FIRE', 800);
    }
  }

  // ---- pause / leave ---------------------------------------------------------------

  /**
   * ESC and P both land here. On an end-of-match screen there is nothing to
   * protect, so ESC just leaves; anywhere else it opens the prompt, and a second
   * press closes it again.
   */
  private togglePause(reason: 'pause' | 'exit'): void {
    if (this.overlay.visible) {
      if (reason === 'exit') this.exitToMenu();
      return;
    }
    if (this.pauseUi) return this.resume();
    this.showPause(reason);
  }

  private showPause(reason: 'pause' | 'exit'): void {
    this.paused = true;
    this.pauseShownAt = this.time.now;
    const c = this.add.container(0, 0).setDepth(300).setScrollFactor(0);
    const g = this.add.graphics().setScrollFactor(0);
    g.fillStyle(PAL.uiInk, 0.72).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const w = 640;
    const h = 360;
    const x = NATIVE_W / 2 - w / 2;
    const y = NATIVE_H / 2 - h / 2;
    g.fillStyle(PAL.uiPanel, 0.98).fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(2, reason === 'exit' ? PAL.uiDanger : PAL.uiEdge, 1).strokeRoundedRect(x, y, w, h, 8);
    c.add(g);
    const title = reason === 'exit' ? 'LEAVE THE BATTLE?' : 'PAUSED';
    c.add(this.add.text(NATIVE_W / 2, y + 40, title, { fontFamily: 'monospace', fontSize: '34px', color: hex(reason === 'exit' ? PAL.uiDanger : PAL.uiEdge) }).setOrigin(0.5).setScrollFactor(0));
    const sub =
      reason === 'exit'
        ? this.turn
          ? 'The match is lost unless you saved it (F2 on your shot).'
          : 'Progress in this level is lost.'
        : this.touch
          ? 'Tap RESUME to carry on.'
          : 'P or ESC to carry on.';
    c.add(this.add.text(NATIVE_W / 2, y + 90, sub, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText), align: 'center', wordWrap: { width: w - 80 } }).setOrigin(0.5, 0).setScrollFactor(0));
    c.add(
      this.add
        .text(NATIVE_W / 2, y + h - 34, this.touch ? 'or press ESC / P to resume' : 'ESC / P  resume        ENTER / Q  exit to menu', { fontFamily: 'monospace', fontSize: '13px', color: hex(PAL.uiTextDim) })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    this.pauseButtons = [
      makeButton(this, NATIVE_W / 2 - 250, y + 150, 230, 64, 'RESUME', () => this.resume(), { fontSize: '22px', depth: 302, fixed: true, colour: PAL.glow }),
      makeButton(this, NATIVE_W / 2 + 20, y + 150, 230, 64, 'EXIT TO MENU', () => this.exitToMenu(), { fontSize: '22px', depth: 302, fixed: true, colour: PAL.uiDanger }),
    ];
    // A second way in and out of fullscreen, for anyone who cannot find the
    // corner button on a small screen.
    if (this.scale.fullscreen.available) {
      const fsLabel = () => (this.scale.isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN');
      const fsButton = makeButton(this, NATIVE_W / 2 - 250, y + 232, 500, 52, fsLabel(), () => {
        this.scale.toggleFullscreen();
        this.time.delayedCall(150, () => fsButton.setLabel(fsLabel()));
      }, { fontSize: '18px', depth: 302, fixed: true });
      this.pauseButtons.push(fsButton);
    }
    this.pauseUi = c;
  }

  private resume(): void {
    if (!this.pauseUi) return;
    this.pauseUi.destroy(true);
    this.pauseUi = null;
    this.pauseButtons.forEach((b) => b.destroy());
    this.pauseButtons = [];
    this.paused = false;
    // Whatever was pressed to resume must not fire, drive or drop a tank.
    this.inputs.clearHeld();
    this.placeClick = false;
    this.placeConfirmLatch = true;
  }

  private exitToMenu(): void {
    if (this.scene.isActive('shop')) this.scene.stop('shop');
    this.scene.start('menu');
  }

  private drawAimAssist(): void {
    this.aimGfx.clear();
    if (!this.turn || this.turn.phase !== 'aim') return;
    const t = this.turn.currentTank;
    if (t.isBot || this.world.mode.aimAssist === 'off') return;
    const w = weaponById(t.selectedWeapon);
    const from = this.world.muzzle(t);
    const vel = launchVelocity(t.angle, t.power, w.speedScale);
    const r = simulateFlight(from, vel, this.world.terrain, {
      wind: this.world.effectiveWind(t),
      tanks: [],
      mapWidth: this.world.width,
      mapHeight: this.world.height,
      maxSteps: this.world.mode.aimAssist === 'full' ? 3000 : 90,
      piercesTerrain: w.behaviour === 'railgun',
    }, w.windFactor, w.gravityFactor);
    const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
    for (let i = 0; i < r.path.length; i += 5) {
      const p = r.path[i];
      this.aimGfx.fillStyle(team.lit, 0.5 - (i / r.path.length) * 0.4).fillRect(Math.round(p.x), Math.round(p.y + HUD_H), 2, 2);
    }
  }

  // ---- phases -----------------------------------------------------------------------

  private checkPhase(dt: number): void {
    if (this.campaign) {
      const c = this.campaign;
      if ((c.phase === 'won' || c.phase === 'lost') && c.overElapsed > 3 && !this.overlay.visible) this.showCampaignEnd(c.phase === 'won');
      return;
    }
    const phase = this.turn ? this.turn.phase : this.arena!.phase;
    if (phase === 'roundOver') {
      if (this.turn && this.rec && this.rec.killed && !this.replayShown && this.rec.frames.length > 30) {
        this.startReplay();
        return;
      }
      if (this.roundOverAt < 0) {
        this.roundOverAt = 0;
        const w = this.turn ? this.turn.lastRoundWinner : this.arena!.lastRoundWinner;
        const name = w >= 0 ? this.world.tanks[w].name.toUpperCase() : 'NOBODY';
        this.hud.showBanner(`ROUND ${this.roundNumber()} — ${name} WINS`, 2600);
        this.sfx.play('win');
      }
      this.roundOverAt += dt;
      if (this.roundOverAt > 2.8) {
        this.roundOverAt = -1;
        if (this.turn) {
          this.turn.proceedFromRoundOver();
          if (this.turn.phase === 'shop') {
            this.scene.launch('shop', { match: this.turn });
            this.scene.sleep();
            return;
          }
          if (this.turn.phase === 'matchOver') return this.showResults();
          this.onNewRound();
        } else {
          this.arena!.proceedFromRoundOver();
          if (this.arena!.phase === 'matchOver') return this.showResults();
          this.onNewRound();
        }
      }
    }
  }

  private onWake(): void {
    // Back from the shop: the match has already started the next round.
    this.onNewRound();
  }

  private onNewRound(): void {
    if (this.roundNumber() === this.lastRound) return;
    this.lastRound = this.roundNumber();
    this.rec = null;
    this.replayShown = false;
    this.buildBackdrop();
    this.terrainView.setTerrain(this.world.terrain, this.tileForBiome());
    this.placeDecor();
    for (const [, v] of this.projViews) {
      v.sprite.destroy();
      v.trail.destroy();
    }
    this.projViews.clear();
    for (const [, v] of this.crateViews) v.destroy();
    this.crateViews.clear();
    this.hud.showBanner(`ROUND ${this.roundNumber()}`, 1400);
  }

  /**
   * Campaign intro card: commander portrait, mission number and brief, and what
   * is waiting on the level. Dismissed with SPACE/ENTER/click rather than a
   * timer, so a briefing can actually be read.
   */
  private showBriefCard(): void {
    const c = this.campaign!;
    const li = LEVELS.findIndex((l) => l.id === c.level.id) + 1;
    const w = 900;
    const h = 420;
    const x = NATIVE_W / 2 - w / 2;
    const y = NATIVE_H / 2 - h / 2;
    const g = this.add.graphics().setDepth(140).setScrollFactor(0);
    g.fillStyle(PAL.uiInk, 0.94).fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(2, PAL.uiEdge, 1).strokeRoundedRect(x, y, w, h, 8);
    const items: Phaser.GameObjects.GameObject[] = [g];
    const txt = (tx: number, ty: number, str: string, size: string, colour: number, wrap = 0) => {
      const o = this.add
        .text(tx, ty, str, {
          fontFamily: 'monospace',
          fontSize: size,
          color: hex(colour),
          lineSpacing: 6,
          ...(wrap ? { wordWrap: { width: wrap } } : {}),
        })
        .setDepth(141)
        .setScrollFactor(0);
      items.push(o);
      return o;
    };
    const pk = c.commander.portrait;
    if (atlasHas(pk)) items.push(this.add.image(x + 130, y + 150, pk).setDepth(141).setScrollFactor(0).setDisplaySize(180, 180));
    txt(x + 40, y + 254, c.commander.name.toUpperCase(), '20px', PAL.uiEdge);
    txt(x + 40, y + 280, c.commander.title, '13px', PAL.uiTextDim);

    txt(x + 250, y + 34, `MISSION ${li} / ${LEVELS.length}`, '15px', PAL.uiTextDim);
    txt(x + 250, y + 58, c.level.name.toUpperCase(), '32px', PAL.uiText);
    txt(x + 250, y + 108, c.level.brief, '16px', PAL.uiText, w - 300);

    txt(x + 250, y + 200, 'OPPOSITION', '13px', PAL.uiEdge);
    const roster = c.roster();
    const lines = roster.length ? roster.map((r) => `  ${r.count} × ${r.label}`) : ['  nothing on the scans'];
    txt(x + 250, y + 222, lines.join('\n'), '15px', PAL.uiText);

    txt(x + 250, y + h - 56, 'SPACE / ENTER / click — begin', '15px', PAL.uiTextDim);
    this.briefCard = items;
  }

  private dismissBriefCard(): void {
    if (!this.briefCard.length || this.pauseUi) return;
    this.briefCard.forEach((o) => o.destroy());
    this.briefCard = [];
    this.campaign?.beginFight();
  }

  /** Boss speech card on a phase change. */
  private tauntCard(name: string, portrait: string, line: string): void {
    const w = 620;
    const x = NATIVE_W / 2 - w / 2;
    const y = NATIVE_H - 260;
    const g = this.add.graphics().setDepth(132).setScrollFactor(0);
    g.fillStyle(PAL.uiInk, 0.9).fillRoundedRect(x, y, w, 96, 6);
    g.lineStyle(2, PAL.uiDanger, 0.9).strokeRoundedRect(x, y, w, 96, 6);
    const items: Phaser.GameObjects.GameObject[] = [g];
    if (portrait && atlasHas(portrait)) {
      items.push(this.add.image(x + 52, y + 48, portrait).setDepth(133).setScrollFactor(0).setDisplaySize(76, 76));
    }
    items.push(
      this.add
        .text(x + 104, y + 18, name.toUpperCase(), { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiDanger) })
        .setDepth(133)
        .setScrollFactor(0),
    );
    items.push(
      this.add
        .text(x + 104, y + 42, line, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText), wordWrap: { width: w - 130 } })
        .setDepth(133)
        .setScrollFactor(0),
    );
    this.time.delayedCall(3600, () => items.forEach((i) => i.destroy()));
  }

  /** Portrait card for a boss reveal. */
  private bossCard(name: string, index: number): void {
    const pk = `portrait.boss${Math.min(3, index + 1)}`;
    const y = 120;
    const g = this.add.graphics().setDepth(130).setScrollFactor(0);
    g.fillStyle(PAL.uiInk, 0.9).fillRoundedRect(NATIVE_W / 2 - 260, y, 520, 120, 6);
    g.lineStyle(2, PAL.uiDanger, 1).strokeRoundedRect(NATIVE_W / 2 - 260, y, 520, 120, 6);
    const items: Phaser.GameObjects.GameObject[] = [g];
    if (atlasHas(pk)) items.push(this.add.image(NATIVE_W / 2 - 200, y + 60, pk).setDepth(131).setScrollFactor(0).setDisplaySize(100, 100));
    items.push(this.add.text(NATIVE_W / 2 - 130, y + 30, name.toUpperCase(), { fontFamily: 'monospace', fontSize: '26px', color: hex(PAL.uiDanger) }).setDepth(131).setScrollFactor(0));
    items.push(this.add.text(NATIVE_W / 2 - 130, y + 68, 'Destroy the core. Weapon mounts open as it takes damage.', { fontFamily: 'monospace', fontSize: '14px', color: hex(PAL.uiText) }).setDepth(131).setScrollFactor(0));
    this.time.delayedCall(4200, () => items.forEach((i) => i.destroy()));
  }

  private showCampaignEnd(won: boolean): void {
    const c = this.campaign!;
    const next = c.nextLevelId();
    // Fold this level's tallies into the persisted run.
    const run: RunStats = loadRun() ?? { commander: c.commander.id, difficulty: c.difficulty.id, timeSec: 0, shotsFired: 0, hits: 0, damageTaken: 0, crates: 0, retries: 0, levelsCleared: 0, startedAt: Date.now() };
    run.timeSec += c.stats.timeSec;
    run.shotsFired += c.stats.shotsFired;
    run.hits += c.stats.hits;
    run.damageTaken += c.stats.damageTaken;
    run.crates += c.stats.crates;
    const ironmanOver = !won && c.difficulty.ironman;
    // Carry the surviving loadout — credits including the reward, ammo left in
    // the racks, and the bought hull — into the armoury on the map.
    if (won) {
      const lead = c.world.tanks[c.playerIndices[0]];
      if (lead) {
        const ammo: Record<string, number> = {};
        for (const [id, n] of lead.ammo) if (n > 0 && id !== 'shell') ammo[id] = n;
        saveLoadout({ credits: lead.credits, ammo, reinforcedHp: lead.reinforcedHp });
      }
    }
    if (won) {
      run.levelsCleared = Math.max(run.levelsCleared, LEVELS.findIndex((l) => l.id === c.level.id) + 1);
      if (next) setSavedLevel(next);
    } else run.retries += 1;
    saveRun(run);

    const items: Phaser.GameObjects.GameObject[] = [];
    items.push(this.add.graphics().fillStyle(PAL.uiInk, 0.88).fillRect(0, 0, NATIVE_W, NATIVE_H));
    const finished = won && !next;
    const titleText = finished ? 'CAMPAIGN COMPLETE' : won ? `${c.level.name.toUpperCase()} CLEARED` : ironmanOver ? 'IRONMAN RUN OVER' : 'MISSION FAILED';
    items.push(this.add.text(NATIVE_W / 2, 150, titleText, { fontFamily: 'monospace', fontSize: '36px', color: hex(won ? PAL.glow : PAL.uiDanger), stroke: hex(PAL.uiInk), strokeThickness: 5 }).setOrigin(0.5));

    const acc = c.stats.shotsFired ? Math.round((100 * c.stats.hits) / c.stats.shotsFired) : 0;
    const lvl = `This level:  ${c.stats.timeSec.toFixed(0)} s  ·  ${c.stats.shotsFired} shots, ${acc}% hits  ·  ${Math.round(c.stats.damageTaken)} damage taken  ·  ${c.stats.crates} crates`;
    items.push(this.add.text(NATIVE_W / 2, 210, lvl, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText) }).setOrigin(0.5));
    const runAcc = run.shotsFired ? Math.round((100 * run.hits) / run.shotsFired) : 0;
    const runLine = `Run (${c.commander.name}, ${c.difficulty.name}):  ${run.levelsCleared}/${LEVELS.length} levels  ·  ${Math.floor(run.timeSec / 60)}:${String(Math.floor(run.timeSec % 60)).padStart(2, '0')}  ·  ${runAcc}% hits  ·  ${Math.round(run.damageTaken)} damage  ·  ${run.retries} retries`;
    items.push(this.add.text(NATIVE_W / 2, 240, runLine, { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiTextDim) }).setOrigin(0.5));

    if (finished || ironmanOver) {
      const b = scoreRun(run, LEVELS.length);
      const rank = finished ? addScore(toHighScore(run, b)) : 0;
      const rows = [
        ['Levels cleared', b.levels], ['Time bonus', b.time], ['Accuracy', b.accuracy], ['Damage taken', b.damage], ['Crates', b.crates], ['Retries', b.retries],
      ];
      const table = rows.map(([k, v]) => `${String(k).padEnd(16)} ${String(v).padStart(7)}`).join('\n') + `\n${'—'.repeat(24)}\n${'Subtotal'.padEnd(16)} ${String(b.subtotal).padStart(7)}\n${`× ${c.difficulty.name}`.padEnd(16)} ${String(b.multiplier).padStart(7)}`;
      items.push(this.add.text(NATIVE_W / 2, 300, table, { fontFamily: 'monospace', fontSize: '18px', color: hex(PAL.uiText), lineSpacing: 4 }).setOrigin(0.5, 0));
      items.push(this.add.text(NATIVE_W / 2, 560, `SCORE  ${b.total}${rank ? `   ·   high score #${rank}` : ''}`, { fontFamily: 'monospace', fontSize: '34px', color: hex(PAL.uiEdge), stroke: hex(PAL.uiInk), strokeThickness: 5 }).setOrigin(0.5, 0));
      clearRun();
    } else if (!won) {
      items.push(this.add.text(NATIVE_W / 2, 300, c.level.brief, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText) }).setOrigin(0.5));
    } else {
      items.push(this.add.text(NATIVE_W / 2, 300, `+${c.level.reward} credits`, { fontFamily: 'monospace', fontSize: '18px', color: hex(PAL.uiText) }).setOrigin(0.5));
    }
    const goOn = () => {
      if (finished || ironmanOver) this.scene.start('commander', { ...this.setup });
      else if (won && next) this.scene.start('campaignMap', { ...this.setup, levelId: next });
      else this.scene.start('battle', { ...this.setup, seed: (this.setup.seed * 17 + 3) & 0x7fffffff });
    };
    const goLabel = finished || ironmanOver ? 'COMMANDERS' : won ? 'CAMPAIGN MAP' : 'RETRY';
    const hintText = this.touch ? '' : `ENTER — ${goLabel.toLowerCase()}     ESC — menu`;
    items.push(this.add.text(NATIVE_W / 2, NATIVE_H - 130, hintText, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiTextDim) }).setOrigin(0.5));
    this.overlay.add(items).setVisible(true);
    this.paused = true;
    makeButton(this, NATIVE_W / 2 - 300, NATIVE_H - 100, 280, 56, goLabel, goOn, { fontSize: '20px', depth: 210, fixed: true, colour: PAL.glow });
    makeButton(this, NATIVE_W / 2 + 20, NATIVE_H - 100, 280, 56, 'MENU', () => this.scene.start('menu'), { fontSize: '20px', depth: 210, fixed: true });
    this.input.keyboard!.once('keydown-ENTER', goOn);
  }

  private showResults(): void {
    // The match is over: a save of it would only offer to replay the last shot.
    clearSavedMatch();
    const match = this.turn ?? this.arena!;
    const winner = match.matchWinner;
    const w = this.world.tanks[winner];
    const team = TEAM_COLOURS[w.colour % TEAM_COLOURS.length];
    const bg = this.add.graphics().fillStyle(PAL.uiInk, 0.85).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const title = this.add.text(NATIVE_W / 2, 160, `${w.name.toUpperCase()} WINS THE WAR`, { fontFamily: 'monospace', fontSize: '32px', color: hex(team.lit), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
    const rows = [...this.world.tanks].sort((a, b) => b.roundsWon * 1000 + b.kills - (a.roundsWon * 1000 + a.kills));
    const items: Phaser.GameObjects.GameObject[] = [bg, title];
    const cardW = 300;
    const x0 = NATIVE_W / 2 - (rows.length * cardW) / 2 + cardW / 2;
    rows.forEach((t, i) => {
      const cx = x0 + i * cardW;
      const tc = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
      const card = this.add.graphics();
      card.fillStyle(PAL.uiPanel, 1).fillRoundedRect(cx - 130, 260, 260, 390, 6);
      card.lineStyle(2, i === 0 ? PAL.uiEdge : tc.mid, 1).strokeRoundedRect(cx - 130, 260, 260, 390, 6);
      items.push(card);
      const pk = `portrait.p${(t.colour % 6) + 1}`;
      if (atlasHas(pk)) items.push(this.add.image(cx, 330, pk).setDisplaySize(110, 110));
      items.push(this.add.text(cx, 396, `${i + 1}. ${t.name}`, { fontFamily: 'monospace', fontSize: '20px', color: hex(tc.lit) }).setOrigin(0.5, 0));
      const s = match.stats.get(t.index);
      const acc = s && s.shotsFired > 0 ? Math.round((s.hits / s.shotsFired) * 100) : 0;
      const lines = [
        `rounds ${t.roundsWon}   kills ${t.kills}`,
        `credits ${t.credits}`,
        '',
        `shots ${s?.shotsFired ?? 0}   hits ${s?.hits ?? 0}   acc ${acc}%`,
        `dmg dealt ${s?.damageDealt ?? 0}`,
        `dmg taken ${s?.damageTaken ?? 0}`,
      ];
      items.push(
        this.add
          .text(cx, 430, lines.join('\n'), { fontFamily: 'monospace', fontSize: '15px', color: hex(PAL.uiText), align: 'center', lineSpacing: 8 })
          .setOrigin(0.5, 0),
      );
    });
    const hint = this.add.text(NATIVE_W / 2, NATIVE_H - 110, this.touch ? '' : 'ENTER — back to menu', { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiTextDim) }).setOrigin(0.5);
    items.push(hint);
    this.overlay.add(items).setVisible(true);
    this.paused = true;
    // The button is the only way off this screen without a keyboard.
    makeButton(this, NATIVE_W / 2 - 150, NATIVE_H - 90, 300, 56, 'BACK TO MENU', () => this.scene.start('menu'), { fontSize: '20px', depth: 210, fixed: true, colour: PAL.glow });
    this.input.keyboard!.once('keydown-ENTER', () => this.scene.start('menu'));
  }
}
