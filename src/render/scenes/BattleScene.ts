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
import type { Crate, Hardpoint, Projectile, Tank, World, WorldEvent } from '../../core/world';
import { HUD_H, NATIVE_H, NATIVE_W, SPRITE_SCALE, TERRAIN_H, TERRAIN_W } from '../config';
import { buildBackdrop } from '../backdrop';
import { TerrainView } from '../terrainView';
import { Hud } from '../hud';
import { Fx } from '../fx';
import { Sfx } from '../audio';
import { InputRouter } from '../inputs';
import { atlasHas, ensureHull, skinForClass, spriteScale } from '../atlas';
import { CLASS_BARREL, ENEMY_PARTS, ensureTeamTexture, hasParts, partMetrics } from '../parts';
import { sliceBiome } from '../biomeBackdrop';
import { playMusic, toggleMusic } from '../music';
import { settings } from '../settings';
import { ensureTankTextures, hullTextureKey, barrelTextureKey } from '../sprites';
import type { BattleSetup } from '../setup';

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
  private sfx = new Sfx();
  private inputs!: InputRouter;
  private bots = new Map<number, BotController>();
  private tankViews = new Map<number, TankView>();
  private projViews = new Map<number, ProjView>();
  private crateViews = new Map<number, Phaser.GameObjects.Container>();
  private aimGfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Container;
  private accumulator = 0;
  private lastTurnKey = '';
  private roundOverAt = -1;
  private charge = new Map<number, number>(); // arena: power charge per slot
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
    this.lastRound = 0;
    this.backdropKeys = null;
    this.bgImages = [];
    this.sfx = new Sfx();
  }

  create(): void {
    const s = this.setup;
    const common = { players: s.players, rounds: s.rounds, seed: s.seed, width: TERRAIN_W, height: TERRAIN_H, terrainStyle: s.terrainStyle };
    if (s.kind === 'campaign') {
      const humans = s.players.filter((p) => !p.isBot).slice(0, 2);
      this.campaign = new CampaignLevel({ levelId: s.levelId ?? LEVELS[0].id, players: humans.length ? humans : s.players.slice(0, 1), seed: s.seed, width: TERRAIN_W, height: TERRAIN_H });
      this.world = this.campaign.world;
    } else if (s.kind === 'arena') {
      this.arena = new ArenaMatch({ ...common, crateInterval: 9, windInterval: 12 });
      this.world = this.arena.world;
    } else {
      this.turn = new TurnBasedMatch({ ...common, mode: s.mode });
      this.world = this.turn.world;
    }
    this.lastRound = this.roundNumber();

    this.buildBackdrop();
    this.terrainView = new TerrainView(this, this.world.terrain, 0, HUD_H, this.tileForBiome());
    this.placeDecor();
    this.aimGfx = this.add.graphics().setDepth(35);
    this.fx = new Fx(this, HUD_H);
    this.hud = new Hud(this, HUD_H);
    this.inputs = new InputRouter(this, 4);
    this.overlay = this.add.container(0, 0).setDepth(200).setVisible(false);

    for (const t of this.world.tanks) {
      this.makeTankView(t);
      if (t.isBot) this.bots.set(t.index, new BotController());
    }
    if (this.campaign) {
      for (const boss of this.campaign.bosses) {
        const key = atlasHas(`${boss.def.skin}.body`) ? `${boss.def.skin}.body` : atlasHas(`${boss.def.skin}.l`) ? `${boss.def.skin}.l` : atlasHas(`${boss.def.skin}.r`) ? `${boss.def.skin}.r` : null;
        const img = key ? this.add.image(boss.x, boss.y + HUD_H, key).setOrigin(0.5, 1).setDepth(28).setScale(spriteScale(key)) : null;
        // Sheet bodies face right; bosses face the players on their left.
        if (img && key && !key.endsWith('.l')) img.setFlipX(true);
        this.bossViews.push({ img, bars: this.add.graphics().setDepth(62) });
      }
    }

    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.scene.isActive('shop')) this.scene.stop('shop');
      this.scene.start('menu');
    });
    this.input.keyboard!.on('keydown-P', () => (this.paused = !this.paused));
    this.input.keyboard!.on('keydown-M', () => (this.sfx.muted = !this.sfx.muted));
    this.input.keyboard!.on('keydown-H', () => this.hud.toggleHelp(this.helpLines()));
    this.input.keyboard!.on('keydown-N', () => toggleMusic(this));
    playMusic(this, this.campaign && this.campaign.bosses.length ? 'boss' : 'battle');
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
    const layers = sliceBiome(this, `bg-${this.world.terrain.style.id}`);
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
    } else {
      const meta = ensureTankTextures(this, t.cls, t.colour);
      const sc = SPRITE_SCALE * settings().tankScale;
      hull = this.add.image(0, 0, hullTextureKey(t.cls, t.colour)).setOrigin(0.5, 1).setScale(sc);
      pivotX = meta.pivotX * sc;
      pivotY = meta.pivotY * sc;
      barrel = this.add.image(0, 0, barrelTextureKey(t.cls, t.colour)).setOrigin(2 / (meta.barrelLen + 4), 0.5).setScale(sc);
      t.halfWidth = Math.round(t.cls.halfWidth * 2 * settings().tankScale);
      t.halfHeight = Math.round(t.cls.halfHeight * 2 * settings().tankScale);
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
    if (!t.alive) {
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
      const rot = Math.max(-0.45, Math.min(0.45, t.tilt));
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
    v.hull.setPosition(x, y).setRotation(t.tilt * 0.6);
    // Barrel pivot rotates with the hull tilt.
    const ca = Math.cos(t.tilt * 0.6);
    const sa = Math.sin(t.tilt * 0.6);
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
          this.fx.explosion(e.at.x, e.at.y, e.radius, e.weapon);
          this.sfx.play(e.radius > 50 ? 'explodeBig' : e.radius > 24 ? 'explode' : 'explodeSmall', 1, 0.85 + Math.random() * 0.3);
          break;
        case 'fill':
          this.fx.landDust(e.at.x, e.at.y, 3);
          this.sfx.play('land');
          break;
        case 'burn':
          this.fx.burn(e.at.x, e.at.y);
          this.sfx.play('burn', 0.6);
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
    if (settings().chargeFire && this.turn) {
      // Hold to charge: power climbs from 20 while held, release fires.
      const t = this.turn.currentTank;
      const prev = this.prevHeld.get(-1) ?? false;
      let charge = this.charge.get(-1) ?? 0;
      if (raw.fireHeld) {
        charge = Math.min(100, (prev ? charge : 20) + 60 * SIM_DT);
        this.world.setPower(t, charge);
        it.powerDelta = 0;
      } else if (prev) it.fire = true;
      this.charge.set(-1, charge);
      this.prevHeld.set(-1, raw.fireHeld);
    } else {
      it.fire = raw.fire;
    }
    it.fireHeld = raw.fireHeld;
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
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < 12) {
        this.simStep(SIM_DT);
        this.accumulator -= SIM_DT;
        steps++;
      }
    }
    this.handleEvents(this.world.drainEvents());
    this.terrainView.update();
    for (const t of this.world.tanks) this.syncTankView(t, frameDt);
    this.syncProjectiles();
    this.syncCrates();
    this.syncBosses();
    this.updateDecor();
    this.drawAimAssist();
    this.fx.update(frameDt);
    this.hud.update(this.world, this.currentForHud(), this.statusLine());
    this.checkPhase(frameDt);
  }

  private simStep(dt: number): void {
    if (this.turn) {
      const m = this.turn;
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
      }
      m.update(intent, dt);
    } else if (this.arena) {
      const intents = this.world.tanks.map((t, i) => (t.isBot ? this.bots.get(t.index)!.arenaIntent(this.world, t, dt) : this.arenaIntent(i, t, dt)));
      this.arena.update(intents, dt);
    } else if (this.campaign) {
      const intents = this.world.tanks.map((t, i) => (t.isBot ? this.bots.get(t.index)!.arenaIntent(this.world, t, dt) : this.arenaIntent(i, t, dt)));
      this.campaign.update(intents, dt);
      for (const msg of this.campaign.banners.splice(0)) {
        this.hud.showBanner(msg, 1800);
        const boss = this.campaign.bosses.find((b) => b.def.name.toUpperCase() === msg);
        if (boss) this.bossCard(boss.def.name, boss.index);
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

  private currentForHud(): Tank | null {
    if (this.turn) return this.turn.currentTank;
    return this.world.tanks.find((t) => !t.isBot && t.alive) ?? this.world.tanks[0];
  }

  private statusLine(): string {
    if (this.turn) {
      const m = this.turn;
      const cls = this.world.mode.tankClasses ? ` · ${m.currentTank.cls.name}` : '';
      const fuel = this.world.mode.movement ? ` · fuel ${m.currentTank.fuel}` : '';
      const drive = this.world.mode.movement ? '  A/D drive' : '';
      const fireHint = settings().chargeFire ? 'hold SPACE to charge, release to fire' : '↑↓ power  SPACE fire';
      return `Round ${m.round}/${this.setup.rounds} · ${this.world.mode.name}${cls}${fuel} · ${m.phase === 'aim' ? `←→ aim  ${fireHint}${drive}  TAB weapon  H help` : 'firing…'}`;
    }
    if (this.campaign) {
      const c = this.campaign;
      const li = LEVELS.findIndex((l) => l.id === c.level.id) + 1;
      return `Campaign ${li}/${LEVELS.length} · ${c.level.name} · ${c.phase === 'brief' ? c.level.brief : 'A/D or ←→ drive  W/S or ↑↓ aim  hold SPACE to charge, release to fire  TAB weapon'}`;
    }
    const a = this.arena!;
    if (a.phase === 'countdown') return `Round ${a.round}/${this.setup.rounds} · ARENA · starting in ${Math.ceil(a.countdown)}`;
    const solo = this.world.tanks.filter((t) => !t.isBot).length <= 1;
    return `Round ${a.round}/${this.setup.rounds} · ARENA · ${solo ? 'A/D or ←→ drive  W/S or ↑↓ aim  hold SPACE to charge' : 'per-player keys (H)  ←→ drive  ↑↓ aim  hold FIRE to charge'}  H help`;
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
    if (won && next) {
      try { localStorage.setItem('tankwars.campaign.level', next); } catch { /* private mode */ }
    }
    const bg = this.add.graphics().fillStyle(PAL.uiInk, 0.85).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const title = this.add.text(NATIVE_W / 2, 260, won ? (next ? `${c.level.name.toUpperCase()} CLEARED` : 'CAMPAIGN COMPLETE') : 'MISSION FAILED', { fontFamily: 'monospace', fontSize: '32px', color: hex(won ? PAL.glow : PAL.uiDanger), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
    const sub = this.add.text(NATIVE_W / 2, 320, won ? `+${c.level.reward} credits` : c.level.brief, { fontFamily: 'monospace', fontSize: '18px', color: hex(PAL.uiText) }).setOrigin(0.5);
    const hint = this.add.text(NATIVE_W / 2, NATIVE_H - 60, won ? (next ? 'ENTER — campaign map     ESC — menu' : 'ENTER — menu') : 'ENTER — retry     ESC — menu', { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiTextDim) }).setOrigin(0.5);
    this.overlay.add([bg, title, sub, hint]).setVisible(true);
    this.paused = true;
    this.input.keyboard!.once('keydown-ENTER', () => {
      if (won && next) this.scene.start('campaignMap', { ...this.setup, levelId: next });
      else if (won) this.scene.start('menu');
      else this.scene.start('battle', { ...this.setup, seed: (this.setup.seed * 17 + 3) & 0x7fffffff });
    });
  }

  private showResults(): void {
    const winner = this.turn ? this.turn.matchWinner : this.arena!.matchWinner;
    const w = this.world.tanks[winner];
    const team = TEAM_COLOURS[w.colour % TEAM_COLOURS.length];
    const bg = this.add.graphics().fillStyle(PAL.uiInk, 0.85).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const title = this.add.text(NATIVE_W / 2, 200, `${w.name.toUpperCase()} WINS THE WAR`, { fontFamily: 'monospace', fontSize: '32px', color: hex(team.lit), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
    const rows = [...this.world.tanks].sort((a, b) => b.roundsWon * 1000 + b.kills - (a.roundsWon * 1000 + a.kills));
    const items: Phaser.GameObjects.GameObject[] = [bg, title];
    const cardW = 300;
    const x0 = NATIVE_W / 2 - (rows.length * cardW) / 2 + cardW / 2;
    rows.forEach((t, i) => {
      const cx = x0 + i * cardW;
      const tc = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
      const card = this.add.graphics();
      card.fillStyle(PAL.uiPanel, 1).fillRoundedRect(cx - 130, 300, 260, 330, 6);
      card.lineStyle(2, i === 0 ? PAL.uiEdge : tc.mid, 1).strokeRoundedRect(cx - 130, 300, 260, 330, 6);
      items.push(card);
      const pk = `portrait.p${(t.colour % 6) + 1}`;
      if (atlasHas(pk)) items.push(this.add.image(cx, 380, pk).setDisplaySize(140, 140));
      items.push(this.add.text(cx, 462, `${i + 1}. ${t.name}`, { fontFamily: 'monospace', fontSize: '20px', color: hex(tc.lit) }).setOrigin(0.5, 0));
      items.push(this.add.text(cx, 496, `rounds ${t.roundsWon}\nkills ${t.kills}\ncredits ${t.credits}`, { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiText), align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0));
    });
    const hint = this.add.text(NATIVE_W / 2, NATIVE_H - 60, 'ENTER — back to menu', { fontFamily: 'monospace', fontSize: '16px', color: hex(PAL.uiTextDim) }).setOrigin(0.5);
    items.push(hint);
    this.overlay.add(items).setVisible(true);
    this.paused = true;
    this.input.keyboard!.once('keydown-ENTER', () => this.scene.start('menu'));
  }
}
