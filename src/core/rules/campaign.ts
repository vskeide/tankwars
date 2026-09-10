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
import { bossById, defenceById, type BossDef, type HardpointDef } from '../campaign/bosses';
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
  /**
   * What the players carry in from the campaign armoury: unspent credits, ammo
   * left over or bought between missions, and Reinforced Hull. Undefined on the
   * first mission of a run.
   */
  loadout?: { credits: number; ammo: Record<string, number>; reinforcedHp: number };
  /** Seconds between the briefing closing and the first shell. Default 3; 0 skips it. */
  countdown?: number;
}

/** Per-level tallies for the campaign score. */
export interface LevelStats {
  timeSec: number;
  shotsFired: number;
  hits: number;
  damageTaken: number;
  crates: number;
}

export type CampaignPhase = 'brief' | 'countdown' | 'live' | 'won' | 'lost';

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

/**
 * A Hive drone: a small hardpoint that flies at the nearest player and goes off
 * on contact. It is deliberately NOT in the boss's hardpoint map, so shooting
 * drones does not count towards the boss's HP fraction or its phase changes.
 */
export interface DroneState {
  hp: Hardpoint;
  bossIndex: number;
  vx: number;
  vy: number;
  /** Seconds left before it gives up and self-destructs. */
  life: number;
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
  /** Emplacements share the boss machinery; kept apart so the UI can tell them apart. */
  readonly defences: BossState[] = [];
  drones: DroneState[] = [];
  /** Taunt cards for the renderer: {name, portrait, line} pushed on phase changes. */
  readonly taunts: { name: string; portrait: string; line: string }[] = [];
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
  /** The intro card is dismissed by the player; this is only a long backstop. */
  briefTimer = 20;
  /** Seconds left of the hold before the fight goes live. */
  countdownLeft = 0;
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

    const carried = this.config.loadout;
    this.playerIndices.forEach((idx, k) => {
      const t = this.world.tanks[idx];
      // Reinforced Hull is bought in the armoury and survives the mission, so it
      // has to be on the tank before the respawn heals it to full.
      t.reinforcedHp = carried?.reinforcedHp ?? 0;
      this.world.respawnTank(t, Math.round(w * this.level.playerAt) + k * 40 * UNIT);
      t.ammo.clear();
      t.ammo.set('shell', -1);
      t.ammo.set('heavy', 2);
      for (const [wid, n] of this.commander.perk.startWeapons) t.ammo.set(wid, (t.ammo.get(wid) ?? 0) + n);
      if (carried) {
        for (const [wid, n] of Object.entries(carried.ammo)) {
          if (wid === 'shell') continue; // always unlimited
          const have = t.ammo.get(wid) ?? 0;
          t.ammo.set(wid, have < 0 ? -1 : have + n);
        }
        t.credits = carried.credits;
      }
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
    for (const d of this.level.defences ?? []) {
      const state = this.spawnBoss(defenceById(d.kind), Math.round(w * d.at));
      this.defences.push(state);
    }
    // Mines and barrels last, so they sit on the terrain the bosses flattened.
    for (const h of this.level.hazards ?? []) {
      const count = h.count ?? 1;
      const spread = 26 * UNIT;
      for (let k = 0; k < count; k++) {
        const centre = w * h.at + (k - (count - 1) / 2) * spread;
        const x = Math.round(Math.max(20, Math.min(w - 20, centre + this.rng.range(-8, 8))));
        this.world.spawnHazard(x, h.kind);
      }
    }
    this.world.rollWind();
    this.phase = 'brief';
    this.briefTimer = 20;
    this.crateTimer = this.crateInterval();
    this.banners.push(this.level.name.toUpperCase());
  }

  private spawnBoss(def: BossDef, x: number): BossState {
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
    return state;
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
      if (ph.banner) this.banners.push(ph.banner);
      if (ph.taunt && !b.def.quiet) this.taunts.push({ name: b.def.name, portrait: b.def.portrait ?? '', line: ph.taunt });
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
      if (this.briefTimer <= 0) this.startCountdown();
      // Aim during the brief.
      for (const idx of this.playerIndices) this.applyAim(w.tanks[idx], intents[idx], dt);
      return;
    }
    if (this.phase === 'countdown') {
      // Same as the brief: aim, but nothing fires or moves until it is over.
      for (const idx of this.playerIndices) this.applyAim(w.tanks[idx], intents[idx], dt);
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) {
        this.phase = 'live';
        this.banners.push('ENGAGE');
      }
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
    this.updateDrones(dt);

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

  /** Close the intro card. The fight goes live after the countdown. */
  beginFight(): void {
    if (this.phase !== 'brief') return;
    this.briefTimer = 0;
    this.startCountdown();
  }

  /** The hold between the briefing and the first shell: the enemy fired instantly before. */
  private startCountdown(): void {
    const hold = this.config.countdown ?? 3;
    if (hold <= 0) {
      this.phase = 'live';
      this.banners.push('ENGAGE');
      return;
    }
    this.countdownLeft = hold;
    this.phase = 'countdown';
  }

  /**
   * What the level puts in front of the player, for the intro card: enemy
   * armour by kind, emplacements, hazards and the boss.
   */
  roster(): { label: string; count: number }[] {
    const out = new Map<string, number>();
    const bump = (label: string, n = 1) => out.set(label, (out.get(label) ?? 0) + n);
    for (const e of this.level.enemies) bump(`${e.kind} armour`);
    for (const d of this.level.defences ?? []) bump(d.kind === 'turret' ? 'gun emplacement' : 'missile emplacement');
    for (const h of this.level.hazards ?? []) bump(h.kind === 'mine' ? 'mines' : 'fuel drums', h.count ?? 1);
    for (const b of this.bosses) if (!b.def.quiet) bump(b.def.name);
    return [...out.entries()].map(([label, count]) => ({ label, count }));
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
      case 'drone': {
        // Cap the swarm so a long fight cannot fill the screen with drones.
        const live = this.drones.filter((d) => d.hp.alive).length;
        for (let i = 0; i < at.count && live + i < 6; i++) {
          const hpv = Math.round(at.hp * this.difficulty.bossHpMult);
          const drone = this.world.addHardpoint({
            bossIndex: b.index,
            name: 'Drone',
            dx: 0,
            dy: 0,
            core: false,
            x: from.x + this.rng.range(-10, 10),
            y: from.y - 8 * UNIT - i * 10 * UNIT,
            halfWidth: 6 * UNIT,
            halfHeight: 5 * UNIT,
            hp: hpv,
            maxHp: hpv,
          });
          this.drones.push({ hp: drone, bossIndex: b.index, vx: 0, vy: 0, life: 22 });
        }
        break;
      }
    }
  }

  /**
   * Drones steer towards the nearest player at a capped speed and detonate on
   * contact, on running out of life, or when shot down.
   */
  private updateDrones(dt: number): void {
    const SPEED = 62 * UNIT;
    for (const d of this.drones) {
      const h = d.hp;
      if (!h.alive) continue;
      d.life -= dt;
      const target = this.nearestPlayer(h.x);
      if (!target || d.life <= 0) {
        this.blowDrone(d);
        continue;
      }
      const tx = target.x;
      const ty = target.y - target.halfHeight;
      const dist = Math.hypot(tx - h.x, ty - h.y) || 1;
      // Steer rather than snap, so they arc in and can be led away.
      d.vx += ((tx - h.x) / dist * SPEED - d.vx) * Math.min(1, dt * 2.4);
      d.vy += ((ty - h.y) / dist * SPEED - d.vy) * Math.min(1, dt * 2.4);
      h.x += d.vx * dt;
      h.y += d.vy * dt;
      // Contact with the target, or with the ground it is skimming.
      const hitTarget = Math.abs(tx - h.x) <= target.halfWidth + h.halfWidth && Math.abs(ty - h.y) <= target.halfHeight + h.halfHeight;
      const hitGround = this.world.terrain.isSolid(h.x, h.y + h.halfHeight);
      if (hitTarget || hitGround) this.blowDrone(d);
    }
    this.drones = this.drones.filter((d) => d.hp.alive);
    // Shot-down drones leave a small blast too, so the hardpoint list stays clean.
    this.world.hardpoints = this.world.hardpoints.filter((h) => h.alive || h.name !== 'Drone');
  }

  private blowDrone(d: DroneState): void {
    const h = d.hp;
    if (!h.alive) return;
    h.alive = false;
    h.hp = 0;
    this.world.fireFrom({ x: h.x, y: h.y }, { x: 0, y: 40 * UNIT }, weaponById('shell'), -100 - d.bossIndex);
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
