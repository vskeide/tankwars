/**
 * Campaign rules: one scripted level, real time. The player (or two co-op
 * players) against enemy bot tanks and, on boss levels, one or two bosses made
 * of hardpoints with scripted attacks. Win when every enemy and every boss core
 * is destroyed; lose when every player tank is gone.
 */
import { World, type Tank, type Hardpoint, AIM_SPEED, POWER_SPEED, DRIVE_SPEED, type CrateKind } from '../world';
import { Terrain, TERRAIN_STYLES } from '../terrain';
import { gameMode } from '../modes';
import { tankClassById } from '../tanks';
import { weaponById, weaponsForMode } from '../weapons';
import { UNIT, launchVelocity } from '../physics';
import { Rng } from '../rng';
import { solveFrom } from '../ai';
import type { Intent } from '../input';
import type { PlayerSetup } from './turnBased';
import { LEVELS, ENEMY_CLASS, levelById, type LevelDef } from '../campaign/levels';
import { bossById, type BossDef, type HardpointDef } from '../campaign/bosses';
import { BOSS_MOUNTS } from '../campaign/mounts';
import { commanderById, type Commander } from '../campaign/commanders';
import { difficultyById, shiftTier, type CampaignDifficulty } from '../campaign/difficulty';

export interface CampaignConfig {
  levelId: string;
  players: PlayerSetup[];
  seed: number;
  width: number;
  height: number;
  /** Commander id (perks, hull); undefined = default commander. */
  commanderId?: string;
  /** Difficulty tier id; undefined = soldier. */
  difficultyId?: string;
}

/** Per-level tallies for the campaign score. */
export interface LevelStats {
  timeSec: number;
  shotsFired: number;
  hits: number;
  damageTaken: number;
  crates: number;
}

export type CampaignPhase = 'brief' | 'live' | 'won' | 'lost';

export interface BossState {
  def: BossDef;
  index: number;
  x: number;
  y: number;
  hardpoints: Map<string, Hardpoint>;
  active: Set<string>;
  timers: Map<string, number>;
  phaseIndex: number;
  maxHp: number;
  facing: 1 | -1;
}

function cooldownFor(weaponId: string): number {
  const w = weaponById(weaponId);
  if (w.id === 'shell') return 1.1;
  if (w.behaviour === 'nuke') return 4.5;
  if (w.behaviour === 'mirv' || w.behaviour === 'cluster') return 2.6;
  return 1.8;
}

export class CampaignLevel {
  readonly world: World;
  readonly level: LevelDef;
  readonly config: CampaignConfig;
  readonly rng: Rng;
  readonly bosses: BossState[] = [];
  /** Indices of player-controlled tanks. */
  readonly playerIndices: number[] = [];
  /** Indices of enemy bot tanks. */
  readonly enemyIndices: number[] = [];
  readonly commander: Commander;
  readonly difficulty: CampaignDifficulty;
  readonly stats: LevelStats = { timeSec: 0, shotsFired: 0, hits: 0, damageTaken: 0, crates: 0 };
  /** Cooldown multiplier for the players' weapons (commander perk). */
  private reloadMult = 1;

  phase: CampaignPhase = 'brief';
  briefTimer = 3.5;
  /** Banner requests for the renderer (phase changes). */
  banners: string[] = [];
  private crateTimer = 0;
  private windTimer = 12;
  private driveAccum: number[] = [];
  private overTimer = 0;

  constructor(config: CampaignConfig) {
    this.config = config;
    this.level = levelById(config.levelId);
    this.rng = new Rng(config.seed);
    this.commander = commanderById(config.commanderId);
    this.difficulty = difficultyById(config.difficultyId);
    this.reloadMult = this.commander.perk.reloadMult;
    const mode = { ...gameMode('advanced'), retainAim: true };
    this.world = new World({ width: config.width, height: config.height, mode, seed: this.rng.int(1, 2 ** 31 - 1) });

    // Players first so their indices match the input slots. The commander sets the
    // hull and perks; a second (co-op) player gets the same hull without perks.
    const perk = this.commander.perk;
    const base = tankClassById(this.commander.cls);
    const cls = { ...base, hp: base.hp + perk.hpBonus, fuel: base.fuel + perk.fuelBonus, armour: base.armour * perk.armourMult };
    config.players.forEach((p, i) => {
      const t = this.world.addTank({ index: i, name: p.name, colour: p.colour, isBot: p.isBot, difficulty: p.difficulty, cls: i === 0 ? cls : base, skin: p.skin, credits: 0, team: 0 });
      this.playerIndices.push(t.index);
    });
    this.level.enemies.forEach((e, k) => {
      const def = ENEMY_CLASS[e.kind];
      const ecls = tankClassById(def.cls);
      const t = this.world.addTank({ index: this.world.tanks.length, name: `${e.kind[0].toUpperCase()}${e.kind.slice(1)} ${k + 1}`, colour: 5, isBot: true, difficulty: shiftTier(e.difficulty, this.difficulty.enemyShift), cls: ecls, skin: def.skin, credits: 0, team: 1 });
      t.maxHp = Math.round(ecls.hp * def.hpScale * this.difficulty.enemyHpMult);
      this.enemyIndices.push(t.index);
    });
    this.driveAccum = this.world.tanks.map(() => 0);
    this.start();
  }

  private start(): void {
    const style = TERRAIN_STYLES.find((s) => s.id === this.level.biome) ?? TERRAIN_STYLES[0];
    this.world.setTerrain(Terrain.generate(this.config.width, this.config.height, style, this.rng.int(1, 2 ** 31 - 1)));
    const w = this.config.width;

    this.playerIndices.forEach((idx, k) => {
      const t = this.world.tanks[idx];
      this.world.respawnTank(t, Math.round(w * this.level.playerAt) + k * 40 * UNIT);
      t.ammo.clear();
      t.ammo.set('shell', -1);
      t.ammo.set('heavy', 2);
      for (const [wid, n] of this.commander.perk.startWeapons) t.ammo.set(wid, (t.ammo.get(wid) ?? 0) + n);
      t.selectedWeapon = 'shell';
      t.facing = 1;
      t.angle = 60;
    });
    this.enemyIndices.forEach((idx, k) => {
      const t = this.world.tanks[idx];
      const e = this.level.enemies[k];
      this.world.respawnTank(t, Math.round(w * e.at));
      t.hp = t.maxHp;
      t.ammo.clear();
      t.ammo.set('shell', -1);
      if (e.kind === 'heavy') t.ammo.set('heavy', 6);
      if (e.kind === 'missile') t.ammo.set('mirv', 3), t.ammo.set('cluster', 4);
      if (e.kind === 'flame') t.ammo.set('napalm', 5);
      if (e.kind === 'light') t.ammo.set('sabot', 6);
      t.facing = -1;
      t.angle = 120;
    });

    if (this.level.boss) {
      const ids = this.level.boss.split('+');
      ids.forEach((id, k) => {
        const x = Math.round(w * (ids.length === 1 ? 0.78 : 0.62 + k * 0.28));
        this.spawnBoss(bossById(id), x);
      });
    }
    this.world.rollWind();
    this.phase = 'brief';
    this.briefTimer = 3.5;
    this.crateTimer = this.crateInterval();
    this.banners.push(this.level.name.toUpperCase());
  }

  private spawnBoss(def: BossDef, x: number): void {
    // Flatten a wide shelf so the boss sits level.
    const surf = this.world.terrain.surfaceY(x);
    const bw = def.width * UNIT;
    this.world.terrain.fillCircle(x, surf + bw * 0.35, bw * 0.6);
    this.world.terrain.carveCircle(x, surf - 60 * UNIT, bw * 0.62, false);
    const y = this.world.terrain.surfaceY(x);
    const state: BossState = { def, index: this.bosses.length, x, y, hardpoints: new Map(), active: new Set(), timers: new Map(), phaseIndex: -1, maxHp: 0, facing: -1 };
    // Weapon hardpoints snap to the cyan mount markers read off the body sprite
    // (sprite pixels, drawn at 1×); core and drive train derive from the body size.
    const mounts = BOSS_MOUNTS[def.id];
    let mountIdx = 0;
    for (const h of def.hardpoints) {
      let dx = h.dx * UNIT;
      let dy = h.dy * UNIT;
      let hw = h.halfWidth * UNIT;
      let hh = h.halfHeight * UNIT;
      if (mounts) {
        if (h.attack && mountIdx < mounts.mounts.length) {
          const m = mounts.mounts[mountIdx++];
          dx = m.dx;
          dy = m.dy;
          hw = 22;
          hh = 16;
        } else if (h.core) {
          dx = Math.round(mounts.width * 0.02);
          dy = -Math.round(mounts.height * 0.5);
          hw = 20;
          hh = 16;
        } else {
          dx = 0;
          dy = -Math.round(mounts.height * 0.14);
          hw = Math.round(mounts.width * 0.45);
          hh = Math.round(mounts.height * 0.14);
        }
      }
      const hpv = Math.round(h.hp * this.difficulty.bossHpMult);
      const hp = this.world.addHardpoint({ bossIndex: state.index, name: h.name, dx, dy, core: h.core, x: x + dx * state.facing, y: y + dy, halfWidth: hw, halfHeight: hh, hp: hpv, maxHp: hpv });
      state.hardpoints.set(h.id, hp);
      state.maxHp += h.hp;
    }
    this.bosses.push(state);
    this.advanceBossPhase(state);
  }

  private bossHpFraction(b: BossState): number {
    let hp = 0;
    for (const h of b.hardpoints.values()) hp += h.hp;
    return hp / b.maxHp;
  }

  private advanceBossPhase(b: BossState): void {
    const frac = this.bossHpFraction(b);
    while (b.phaseIndex + 1 < b.def.phases.length && frac <= b.def.phases[b.phaseIndex + 1].belowHp) {
      b.phaseIndex += 1;
      const ph = b.def.phases[b.phaseIndex];
      for (const id of ph.activate) {
        b.active.add(id);
        b.timers.set(id, 1.5 + this.rng.range(0, 2));
      }
      this.banners.push(ph.banner);
    }
  }

  bossAlive(b: BossState): boolean {
    for (const h of b.hardpoints.values()) if (h.core && h.alive) return true;
    return false;
  }

  // ---- update ------------------------------------------------------------------

  update(intents: readonly Intent[], dt: number): void {
    const w = this.world;
    if (this.phase === 'brief') {
      this.briefTimer -= dt;
      if (this.briefTimer <= 0) {
        this.phase = 'live';
        this.banners.push('ENGAGE');
      }
      // Aim during the brief.
      for (const idx of this.playerIndices) this.applyAim(w.tanks[idx], intents[idx], dt);
      return;
    }
    if (this.phase !== 'live') {
      w.step(dt);
      this.overTimer += dt;
      return;
    }

    w.tanks.forEach((t, i) => {
      if (!t.alive) return;
      const it = intents[i];
      if (!it) return;
      this.applyAim(t, it, dt);
      if (it.cycleWeapon !== 0) w.cycleWeapon(t, it.cycleWeapon);
      if (it.moveX !== 0) {
        w.face(t, it.moveX > 0 ? 1 : -1);
        this.driveAccum[i] += it.moveX * DRIVE_SPEED * dt;
        const whole = Math.trunc(this.driveAccum[i]);
        if (whole !== 0) {
          w.drive(t, whole, false);
          this.driveAccum[i] -= whole;
        }
      }
      if ((it.fire || it.fireHeld) && t.cooldown <= 0 && w.fire(t)) t.cooldown = cooldownFor(t.selectedWeapon) * (this.playerIndices.includes(t.index) ? this.reloadMult : 1);
    });

    for (const b of this.bosses) this.updateBoss(b, dt);

    if (this.level.crateInterval > 0) {
      this.crateTimer -= dt;
      if (this.crateTimer <= 0) {
        this.dropCrate();
        this.crateTimer = this.crateInterval() * this.rng.range(0.7, 1.3);
      }
    }
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      w.rollWind();
      this.windTimer = 12;
    }

    w.step(dt);
    this.stats.timeSec += dt;
    this.tally();

    // Kill hardpoints when their boss dies, so stray guns stop shooting.
    for (const b of this.bosses) {
      if (!this.bossAlive(b)) for (const h of b.hardpoints.values()) h.alive = false;
    }

    const playersAlive = this.playerIndices.some((i) => w.tanks[i].alive);
    const enemiesAlive = this.enemyIndices.some((i) => w.tanks[i].alive) || this.bosses.some((b) => this.bossAlive(b));
    if (!playersAlive) {
      this.phase = 'lost';
      this.banners.push('DESTROYED');
      this.overTimer = 0;
    } else if (!enemiesAlive) {
      this.phase = 'won';
      this.banners.push('LEVEL CLEAR');
      this.overTimer = 0;
      for (const i of this.playerIndices) w.tanks[i].credits += this.level.reward;
    }
  }

  private crateInterval(): number {
    if (!this.level.crateInterval) return Infinity;
    return this.level.crateInterval * this.difficulty.crateMult * this.commander.perk.crateMult;
  }

  /** Read the world's pending events for score-relevant facts (renderer drains them later). */
  private tally(): void {
    const players = new Set(this.playerIndices);
    const playerIds = new Set(this.playerIndices.map((i) => this.world.tanks[i].id));
    for (const e of this.world.peekEvents()) {
      if (e.kind === 'launch' && players.has(e.shooter)) this.stats.shotsFired += 1;
      else if (e.kind === 'damage') {
        if (playerIds.has(e.target)) this.stats.damageTaken += e.amount + e.shieldAbsorbed;
        else if (players.has(e.by) && e.amount > 0) this.stats.hits += 1;
      } else if (e.kind === 'cratePickup' && players.has(e.tank)) this.stats.crates += 1;
    }
  }

  get overElapsed(): number {
    return this.overTimer;
  }

  private applyAim(t: Tank, it: Intent | undefined, dt: number): void {
    if (!it || !t.alive) return;
    if (it.aimDelta !== 0) this.world.aimElevation(t, it.aimDelta * AIM_SPEED * dt);
    if (it.powerDelta !== 0) this.world.setPower(t, t.power + it.powerDelta * POWER_SPEED * dt);
  }

  private updateBoss(b: BossState, dt: number): void {
    if (!this.bossAlive(b)) return;
    this.advanceBossPhase(b);
    const tempo = b.def.phases[Math.max(0, b.phaseIndex)].tempo;
    const target = this.nearestPlayer(b.x);
    if (!target) return;

    for (const id of b.active) {
      const hp = b.hardpoints.get(id);
      const def = b.def.hardpoints.find((h) => h.id === id)!;
      if (!hp || !hp.alive || !def.attack) continue;
      const t = (b.timers.get(id) ?? 0) - dt;
      if (t > 0) {
        b.timers.set(id, t);
        continue;
      }
      b.timers.set(id, def.attack.interval * tempo * this.difficulty.bossTempo * this.rng.range(0.85, 1.15));
      this.bossAttack(b, hp, def, target);
    }
  }

  private bossAttack(b: BossState, hp: Hardpoint, def: HardpointDef, target: Tank): void {
    const at = def.attack!;
    const from = { x: hp.x, y: hp.y - hp.halfHeight - 2 };
    const owner = -100 - b.index;
    switch (at.kind) {
      case 'barrage': {
        const weapon = weaponById(at.weapon);
        const sol = solveFrom(this.world, from, { x: target.x, y: target.y - target.halfHeight }, weapon, 90, () => this.rng.next(), 4);
        if (!sol) return;
        for (let i = 0; i < at.count; i++) {
          const ang = sol.angle + this.rng.range(-at.spread, at.spread) * 0.15;
          const pow = sol.power + this.rng.range(-at.spread, at.spread) * 0.2;
          this.world.fireFrom(from, launchVelocity(ang, pow, weapon.speedScale), weapon, owner);
        }
        break;
      }
      case 'mortar': {
        const weapon = weaponById(at.weapon);
        // Straight up with a lean toward the target; the split does the rest.
        const lean = target.x > from.x ? 78 : 102;
        this.world.fireFrom(from, launchVelocity(lean + this.rng.range(-4, 4), 92, weapon.speedScale), weapon, owner);
        break;
      }
      case 'direct': {
        const weapon = weaponById(at.weapon);
        const dx = target.x - from.x;
        const dy = target.y - target.halfHeight - from.y;
        const ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
        this.world.fireFrom(from, launchVelocity(ang + this.rng.range(-2, 2), 100, weapon.speedScale), weapon, owner);
        break;
      }
      case 'drop': {
        this.world.spawnCrate(Math.round(this.rng.range(target.x - 60 * UNIT, target.x + 60 * UNIT)), 'ammo', 'heavy');
        break;
      }
    }
  }

  private nearestPlayer(x: number): Tank | null {
    let best: Tank | null = null;
    let bd = Infinity;
    for (const i of this.playerIndices) {
      const t = this.world.tanks[i];
      if (!t.alive) continue;
      const d = Math.abs(t.x - x);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private dropCrate(): void {
    const kinds: CrateKind[] = ['weapon', 'weapon', 'repair', 'shield', 'ammo'];
    const kind = this.rng.pick(kinds);
    let payload = '';
    if (kind === 'weapon' || kind === 'ammo') {
      const pool = weaponsForMode('advanced').filter((w) => w.cost > 0 && w.behaviour !== 'nuke');
      payload = this.rng.pick(pool).id;
    }
    const p = this.nearestPlayer(0);
    const x = p ? Math.round(p.x + this.rng.range(40, 160) * UNIT) : Math.round(this.config.width * 0.3);
    this.world.spawnCrate(Math.max(60, Math.min(this.config.width - 60, x)), kind, payload);
  }

  /** Next level id after this one, or null at the end of the campaign. */
  nextLevelId(): string | null {
    const i = LEVELS.findIndex((l) => l.id === this.level.id);
    return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1].id : null;
  }
}
