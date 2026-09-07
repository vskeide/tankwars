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
import { HUD_H, NATIVE_H, NATIVE_W, TERRAIN_H, TERRAIN_W } from '../config';
import { buildBackdrop } from '../backdrop';
import { TerrainView } from '../terrainView';
import { Hud } from '../hud';
import { Fx } from '../fx';
import { Sfx } from '../audio';
import { InputRouter } from '../inputs';
import { atlasHas, ensureHull, skinForClass } from '../atlas';
import { ensureTankTextures, hullTextureKey, barrelTextureKey } from '../sprites';
import type { BattleSetup } from '../setup';

interface TankView {
  hull: Phaser.GameObjects.Image;
  barrel: Phaser.GameObjects.Image;
  pivotX: number;
  pivotY: number;
  skin: string;
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
    this.terrainView = new TerrainView(this, this.world.terrain, 0, HUD_H);
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
        const key = atlasHas(`${boss.def.skin}.l`) ? `${boss.def.skin}.l` : atlasHas(`${boss.def.skin}.r`) ? `${boss.def.skin}.r` : null;
        const img = key ? this.add.image(boss.x, boss.y + HUD_H, key).setOrigin(0.5, 1).setDepth(28) : null;
        if (img && key && key.endsWith('.r')) img.setFlipX(true);
        this.bossViews.push({ img, bars: this.add.graphics().setDepth(62) });
      }
    }

    this.input.keyboard!.on('keydown-ESC', () => this.scene.start('menu'));
    this.input.keyboard!.on('keydown-P', () => (this.paused = !this.paused));
    this.input.keyboard!.on('keydown-M', () => (this.sfx.muted = !this.sfx.muted));
    this.input.keyboard!.once('keydown', () => this.sfx.unlock());
    this.input.once('pointerdown', () => this.sfx.unlock());

    if (this.campaign) this.hud.showBanner(`${this.campaign.level.name.toUpperCase()}\n${this.campaign.level.brief}`, 3200);
    else this.hud.showBanner(this.arena ? `ROUND ${this.roundNumber()}\nGET READY` : `ROUND ${this.roundNumber()}\n${this.turn!.currentTank.name.toUpperCase()} FIRST`, 1600);
    this.events.on('wake', () => this.onWake());
  }

  private roundNumber(): number {
    return this.turn ? this.turn.round : this.arena ? this.arena.round : 1;
  }

  // ---- backdrop --------------------------------------------------------------

  private buildBackdrop(): void {
    this.bgImages.forEach((i) => i.destroy());
    this.bgImages = [];
    const seed = (this.setup.seed + this.roundNumber() * 7919) & 0x7fffffff;
    const horizon = Math.floor(HUD_H + TERRAIN_H * 0.62);
    this.backdropKeys = buildBackdrop(this, NATIVE_W, NATIVE_H, horizon, seed);
    this.bgImages.push(this.add.image(0, 0, this.backdropKeys.sky).setOrigin(0).setDepth(0));
    this.bgImages.push(this.add.image(-40, 0, this.backdropKeys.farMesas).setOrigin(0).setDepth(1));
    this.bgImages.push(this.add.image(-90, 0, this.backdropKeys.nearMesas).setOrigin(0).setDepth(2));
  }

  // ---- tank views ------------------------------------------------------------

  private makeTankView(t: Tank): void {
    const skin = t.skin && atlasHas(`${t.skin}.r`) ? t.skin : skinForClass(t.cls.id);
    let hull: Phaser.GameObjects.Image;
    let pivotX: number;
    let pivotY: number;
    let barrel: Phaser.GameObjects.Image;
    if (skin) {
      const info = ensureHull(this, skin, 'r', t.colour);
      hull = this.add.image(0, 0, info.key).setOrigin(0.5, 1);
      pivotX = info.pivotX;
      pivotY = info.pivotY;
      // Procedural barrel matched to the class, tinted toward the sprite's colour.
      ensureTankTextures(this, t.cls, t.colour);
      barrel = this.add.image(0, 0, barrelTextureKey(t.cls, t.colour)).setOrigin(2 / (t.cls.barrel + 4), 0.5);
      // Hitbox from the sprite so shots register on what the player sees.
      t.halfWidth = Math.round(info.width * 0.42);
      t.halfHeight = Math.round(info.height * 0.42);
    } else {
      const meta = ensureTankTextures(this, t.cls, t.colour);
      hull = this.add.image(0, 0, hullTextureKey(t.cls, t.colour)).setOrigin(0.5, 1);
      pivotX = meta.pivotX;
      pivotY = meta.pivotY;
      barrel = this.add.image(0, 0, barrelTextureKey(t.cls, t.colour)).setOrigin(2 / (meta.barrelLen + 4), 0.5);
    }
    hull.setDepth(30);
    barrel.setDepth(29);
    const smoke = this.add.particles(0, 0, 'dot2', {
      lifespan: { min: 600, max: 1400 },
      speed: { min: 4, max: 14 },
      angle: { min: 260, max: 280 },
      scale: { start: 0.8, end: 2 },
      alpha: { start: 0.7, end: 0 },
      tint: [PAL.smoke, PAL.smokeLight],
      frequency: 120,
      emitting: false,
    }).setDepth(31);
    this.tankViews.set(t.index, { hull, barrel, pivotX, pivotY, skin, facing: 1, recoil: 0, smoke });
  }

  private syncTankView(t: Tank, dt: number): void {
    const v = this.tankViews.get(t.index)!;
    if (!t.alive) {
      v.hull.setVisible(false);
      v.barrel.setVisible(false);
      v.smoke?.stop();
      return;
    }
    v.hull.setVisible(true);
    v.barrel.setVisible(true);
    const facing = t.facing;
    if (facing !== v.facing) {
      v.facing = facing;
      if (v.skin) {
        const f = facing === 1 ? 'r' : 'l';
        const info = atlasHas(`${v.skin}.${f}`) ? ensureHull(this, v.skin, f, t.colour) : ensureHull(this, v.skin, 'r', t.colour);
        v.hull.setTexture(info.key);
        v.hull.setFlipX(!atlasHas(`${v.skin}.${f}`) && facing === -1);
        v.pivotX = atlasHas(`${v.skin}.${f}`) ? info.pivotX : -info.pivotX;
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
    v.recoil = Math.max(0, v.recoil - dt * 18);
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
        const sprite = this.add.image(0, 0, key).setDepth(36);
        if (key.startsWith('proj.')) sprite.setScale(0.5);
        v = { sprite, trail: this.add.graphics().setDepth(34) };
        this.projViews.set(p.id, v);
      }
      v.sprite.setPosition(p.pos.x, p.pos.y + HUD_H).setRotation(Math.atan2(p.vel.y, p.vel.x));
      v.trail.clear();
      const col = p.weapon.trail === 'plasma' ? PAL.glow : p.weapon.trail === 'fire' ? PAL.fireHot : p.weapon.trail === 'smoke' ? PAL.smokeLight : PAL.glowCore;
      for (let i = 0; i < p.trail.length; i++) {
        const q = p.trail[i];
        const f = i / p.trail.length;
        v.trail.fillStyle(col, 0.15 + f * 0.6).fillRect(Math.round(q.x), Math.round(q.y + HUD_H), 1, 1);
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
      const chute = v.getByName('chute') as Phaser.GameObjects.Graphics | null;
      if (chute) chute.setVisible(!c.landed);
    }
    for (const [id, v] of this.crateViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.crateViews.delete(id);
      }
    }
  }

  private makeCrateView(c: Crate): Phaser.GameObjects.Container {
    const key =
      c.crateKind === 'repair' && atlasHas('powerup.repair') ? 'powerup.repair'
      : c.crateKind === 'shield' && atlasHas('powerup.shield') ? 'powerup.shield'
      : c.crateKind === 'ammo' && atlasHas('crate.ammo') ? 'crate.ammo'
      : c.crateKind === 'credits' && atlasHas('crate.metal') ? 'crate.metal'
      : atlasHas('crate.wood') ? 'crate.wood' : 'debris2';
    const img = this.add.image(0, 0, key);
    const s = 20 / Math.max(img.width, img.height);
    img.setScale(s);
    const chute = this.add.graphics().setName('chute');
    chute.fillStyle(PAL.uiText, 1).fillEllipse(0, -22, 30, 14);
    chute.fillStyle(PAL.uiDanger, 1).fillRect(-8, -26, 6, 6);
    chute.lineStyle(1, PAL.uiTextDim, 1);
    chute.lineBetween(-14, -20, -6, -8);
    chute.lineBetween(14, -20, 6, -8);
    chute.lineBetween(0, -22, 0, -8);
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
          if (v) v.recoil = 4;
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
          const txt = this.add.text(tk.x, tk.y + HUD_H - tk.halfHeight * 2 - 24, `+ ${label}`, { fontFamily: 'monospace', fontSize: '11px', color: hex(PAL.glow), stroke: hex(PAL.uiInk), strokeThickness: 3 }).setOrigin(0.5).setDepth(80);
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
    it.fire = raw.fire;
    it.fireHeld = raw.fireHeld;
    it.cycleWeapon = raw.cycleWeapon;
    if (it.aimDelta !== 0 && Math.random() < 0.08) this.sfx.play('aim', 0.6);
    if (it.cycleWeapon !== 0) this.sfx.play('cycle');
    return it;
  }

  /** Arena: ←→ drive, ↑↓ aim, hold fire to charge power, release to fire. */
  private arenaIntent(slot: number, tank: Tank, dt: number): Intent {
    const raw = this.inputs.slotIntent(slot);
    const it = emptyIntent();
    it.moveX = raw.moveX;
    it.aimDelta = raw.powerDelta * (tank.facing === 1 ? 1 : -1);
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
      for (const msg of this.campaign.banners.splice(0)) this.hud.showBanner(msg, 1800);
    }
  }

  private syncBosses(): void {
    if (!this.campaign) return;
    this.campaign.bosses.forEach((boss, i) => {
      const v = this.bossViews[i];
      if (!v) return;
      v.bars.clear();
      const alive = this.campaign!.bossAlive(boss);
      if (v.img) v.img.setVisible(alive).setTint(alive ? 0xffffff : 0x553333);
      if (!alive) return;
      for (const [id, hp] of boss.hardpoints) {
        if (!hp.alive) continue;
        const active = boss.active.has(id) || hp.core;
        const w = 18;
        const x = Math.round(hp.x - w / 2);
        const y = Math.round(hp.y + HUD_H - hp.halfHeight - 6);
        v.bars.fillStyle(PAL.uiInk, 0.85).fillRect(x - 1, y - 1, w + 2, 4);
        v.bars.fillStyle(hp.core ? PAL.uiDanger : active ? PAL.fireHot : PAL.uiTextDim, 1).fillRect(x, y, Math.round(w * (hp.hp / hp.maxHp)), 2);
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
      return `Round ${m.round}/${this.setup.rounds} · ${this.world.mode.name}${cls}${fuel} · ${m.phase === 'aim' ? '←→ aim  ↑↓ power  SPACE fire  TAB weapon' : 'firing…'}`;
    }
    if (this.campaign) {
      const c = this.campaign;
      const li = LEVELS.findIndex((l) => l.id === c.level.id) + 1;
      return `Campaign ${li}/${LEVELS.length} · ${c.level.name} · ${c.phase === 'brief' ? c.level.brief : '←→ drive  ↑↓ aim  hold FIRE to charge  TAB weapon'}`;
    }
    const a = this.arena!;
    if (a.phase === 'countdown') return `Round ${a.round}/${this.setup.rounds} · ARENA · starting in ${Math.ceil(a.countdown)}`;
    return `Round ${a.round}/${this.setup.rounds} · ARENA · ←→ drive  ↑↓ aim  hold FIRE to charge`;
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
      maxSteps: this.world.mode.aimAssist === 'full' ? 3000 : 70,
      piercesTerrain: w.behaviour === 'railgun',
    }, w.windFactor, w.gravityFactor);
    const team = TEAM_COLOURS[t.colour % TEAM_COLOURS.length];
    for (let i = 0; i < r.path.length; i += 6) {
      const p = r.path[i];
      this.aimGfx.fillStyle(team.lit, 0.5 - (i / r.path.length) * 0.4).fillRect(Math.round(p.x), Math.round(p.y + HUD_H), 1, 1);
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
    this.terrainView.setTerrain(this.world.terrain);
    for (const [, v] of this.projViews) {
      v.sprite.destroy();
      v.trail.destroy();
    }
    this.projViews.clear();
    for (const [, v] of this.crateViews) v.destroy();
    this.crateViews.clear();
    this.hud.showBanner(`ROUND ${this.roundNumber()}`, 1400);
  }

  private showCampaignEnd(won: boolean): void {
    const c = this.campaign!;
    const next = c.nextLevelId();
    if (won && next) {
      try { localStorage.setItem('tankwars.campaign.level', next); } catch { /* private mode */ }
    }
    const bg = this.add.graphics().fillStyle(PAL.uiInk, 0.85).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const title = this.add.text(NATIVE_W / 2, 90, won ? (next ? `${c.level.name.toUpperCase()} CLEARED` : 'CAMPAIGN COMPLETE') : 'MISSION FAILED', { fontFamily: 'monospace', fontSize: '22px', color: hex(won ? PAL.glow : PAL.uiDanger), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
    const sub = this.add.text(NATIVE_W / 2, 120, won ? `+${c.level.reward} credits` : c.level.brief, { fontFamily: 'monospace', fontSize: '12px', color: hex(PAL.uiText) }).setOrigin(0.5);
    const hint = this.add.text(NATIVE_W / 2, NATIVE_H - 30, won ? (next ? 'ENTER — next level     ESC — menu' : 'ENTER — menu') : 'ENTER — retry     ESC — menu', { fontFamily: 'monospace', fontSize: '11px', color: hex(PAL.uiTextDim) }).setOrigin(0.5);
    this.overlay.add([bg, title, sub, hint]).setVisible(true);
    this.paused = true;
    this.input.keyboard!.once('keydown-ENTER', () => {
      if (won && next) this.scene.start('battle', { ...this.setup, levelId: next, seed: (this.setup.seed * 31 + 7) & 0x7fffffff });
      else if (won) this.scene.start('menu');
      else this.scene.start('battle', { ...this.setup, seed: (this.setup.seed * 17 + 3) & 0x7fffffff });
    });
  }

  private showResults(): void {
    const winner = this.turn ? this.turn.matchWinner : this.arena!.matchWinner;
    const w = this.world.tanks[winner];
    const team = TEAM_COLOURS[w.colour % TEAM_COLOURS.length];
    const bg = this.add.graphics().fillStyle(PAL.uiInk, 0.85).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const title = this.add.text(NATIVE_W / 2, 70, `${w.name.toUpperCase()} WINS THE WAR`, { fontFamily: 'monospace', fontSize: '22px', color: hex(team.lit), stroke: hex(PAL.uiInk), strokeThickness: 4 }).setOrigin(0.5);
    const rows = [...this.world.tanks].sort((a, b) => b.roundsWon * 1000 + b.kills - (a.roundsWon * 1000 + a.kills));
    const lines = rows.map((t, i) => `${i + 1}. ${t.name.padEnd(12)}  rounds ${t.roundsWon}  kills ${t.kills}  credits ${t.credits}`).join('\n');
    const table = this.add.text(NATIVE_W / 2, 130, lines, { fontFamily: 'monospace', fontSize: '12px', color: hex(PAL.uiText), align: 'left' }).setOrigin(0.5, 0);
    const hint = this.add.text(NATIVE_W / 2, NATIVE_H - 30, 'ENTER — back to menu', { fontFamily: 'monospace', fontSize: '11px', color: hex(PAL.uiTextDim) }).setOrigin(0.5);
    this.overlay.add([bg, title, table, hint]).setVisible(true);
    this.paused = true;
    this.input.keyboard!.once('keydown-ENTER', () => this.scene.start('menu'));
  }
}
