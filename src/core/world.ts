/**
 * The simulated battlefield: terrain, tanks, live projectiles, crates and
 * boss hardpoints, advanced in fixed steps. Rules layers (turn-based match,
 * real-time arena, campaign levels) sit on top and decide WHO may act WHEN;
 * the World only knows physics and damage.
 *
 * Deterministic for a given seed and input sequence. No Phaser, no DOM.
 */
import { Rng } from './rng';
import { Terrain } from './terrain';
import type { GameMode } from './modes';
import type { TankClass } from './tanks';
import { weaponById, defaultWeaponId, type Weapon } from './weapons';
import { GRAVITY, SIM_DT, UNIT, blastFalloff, launchVelocity, stepProjectile, type ProjectileState } from './physics';
import type { Difficulty, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** Anything that can take blast damage and be targeted. */
export interface Damageable {
  id: number;
  kind: 'tank' | 'hardpoint' | 'crate' | 'hazard';
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Owner index for tanks; boss index for hardpoints; -1 otherwise. */
  owner: number;
  /**
   * Who this fights for. In free-for-all modes every tank gets its own team, so
   * everyone is hostile to everyone; in the campaign the players share team 0 and
   * the enemies (including boss hardpoints) share team 1. Bots only target other
   * teams — without this, campaign enemies shoot each other.
   */
  team: number;
}

export interface Tank extends Damageable {
  kind: 'tank';
  index: number;
  name: string;
  colour: number;
  isBot: boolean;
  difficulty: Difficulty;
  cls: TankClass;
  /** Sprite id from the asset atlas, or '' for the procedural hull. */
  skin: string;

  /** Hull tilt in radians, from the terrain slope. */
  tilt: number;
  /** Vertical velocity while airborne. */
  vy: number;
  airborne: boolean;
  facing: 1 | -1;

  shield: number;
  /** Barrel angle in degrees from +X (0 = right, 90 = up, 180 = left). */
  angle: number;
  /** 0..100 */
  power: number;
  fuel: number;
  movedThisTurn: boolean;
  /** Seconds until this tank may fire again (arena mode). */
  cooldown: number;
  /**
   * Barrel geometry supplied by the renderer once it knows the sprite: pivot
   * offset from (x, y) for a right-facing tank, and barrel length. 0 = use the
   * class defaults. Pure geometry, so the core stays renderer-agnostic.
   */
  pivotDX: number;
  pivotDY: number;
  barrelLen: number;

  credits: number;
  /**
   * Reinforced Hull: shop-bought bonus HP on top of the class base (cls.hp).
   * Persists across rounds — respawnTank() heals the base to full every round
   * but only restores this to whatever remains after damage, not a fresh full
   * amount. Damage eats into it before it eats into the base; if the tank dies,
   * whatever damage overkilled through it already drove it to 0.
   */
  reinforcedHp: number;
  /**
   * False while the tank is waiting to be dropped onto the map in the 'placing'
   * phase. Physics and the renderer both skip it until it lands somewhere.
   */
  placed: boolean;
  /** weapon id -> shots remaining (-1 = unlimited). */
  ammo: Map<string, number>;
  selectedWeapon: string;

  kills: number;
  roundsWon: number;
}

export interface Projectile extends ProjectileState {
  id: number;
  owner: number;
  weapon: Weapon;
  /** 0 for the shell that left the barrel, 1+ for submunitions. */
  depth: number;
  state: 'flying' | 'rolling' | 'tunnelling' | 'done';
  /** Highest point reached, for apex-splitting weapons. */
  apexY: number;
  /** True once the shell has left its owner's hull; only then can it hit the owner. */
  leftOwner: boolean;
  /** Minimum steps of flight before an owner hit counts, on top of leftOwner. */
  grace: number;
  /** Rolling state. */
  rollDir: number;
  rollSteps: number;
  tunnelLeft: number;
  tunnelDir: Vec2;
  /** Recent positions for the renderer's trail. */
  trail: Vec2[];
}

export type CrateKind = 'ammo' | 'repair' | 'shield' | 'credits' | 'weapon';

export interface Crate extends Damageable {
  kind: 'crate';
  crateKind: CrateKind;
  /** Weapon id for 'weapon' / 'ammo' crates. */
  payload: string;
  vy: number;
  landed: boolean;
  /** Seconds left before it despawns. */
  ttl: number;
}

export type HazardKind = 'mine' | 'barrel';

/**
 * Scripted level furniture that goes off: a mine that trips when a tank drives
 * over it, and an explosive barrel that detonates when shot — and whose blast
 * sets off its neighbours, so a row of them chains.
 */
export interface Hazard extends Damageable {
  kind: 'hazard';
  hazardKind: HazardKind;
  /** Weapon whose damage/radius the detonation borrows. */
  weapon: string;
  /** Mines only: a tank within this many px trips it. */
  trigger: number;
  /** Set once it has gone off, so it cannot detonate twice. */
  spent: boolean;
  vy: number;
  landed: boolean;
}

/** A boss is a large scripted entity made of hardpoints. */
export interface Hardpoint extends Damageable {
  kind: 'hardpoint';
  bossIndex: number;
  name: string;
  /** Offset from the boss anchor. */
  dx: number;
  dy: number;
  /** Does destroying this end the boss? */
  core: boolean;
}

// ---------------------------------------------------------------------------
// Events emitted by a step. The renderer turns these into sound and particles.
// ---------------------------------------------------------------------------

export type WorldEvent =
  | { kind: 'launch'; from: Vec2; weapon: Weapon; shooter: number; angle: number }
  | { kind: 'split'; at: Vec2; count: number; weapon: Weapon }
  | { kind: 'bounce'; at: Vec2 }
  | { kind: 'explode'; at: Vec2; radius: number; weapon: Weapon }
  | { kind: 'fill'; at: Vec2; radius: number }
  | { kind: 'burn'; at: Vec2; weapon: Weapon }
  | { kind: 'damage'; target: number; amount: number; shieldAbsorbed: number; hpAfter: number; at: Vec2; by: number }
  | { kind: 'kill'; target: number; by: number }
  | { kind: 'land'; tank: number; impactSpeed: number; damage: number }
  | { kind: 'offmap'; at: Vec2 }
  | { kind: 'crateSpawn'; crate: number }
  | { kind: 'crateLand'; crate: number }
  | { kind: 'cratePickup'; crate: number; tank: number; crateKind: CrateKind; payload: string }
  | { kind: 'move'; tank: number; dx: number }
  | { kind: 'hazardArmed'; hazard: number; hazardKind: HazardKind }
  | { kind: 'hazardBlown'; hazard: number; hazardKind: HazardKind; at: Vec2 };

// ---------------------------------------------------------------------------

export interface WorldOptions {
  width: number;
  height: number;
  mode: GameMode;
  seed: number;
}

/** Arena-mode tank drive speed in px/s. */
/** Real-time drive speed (Arena/Campaign), px/s. Lowered twice on feedback that driving felt too fast. */
export const DRIVE_SPEED = 110 * UNIT;
/** What a shield crate tops a tank up to, for hulls with no shield perk of their own. */
export const SHIELD_CRATE_AMOUNT = 40;

/**
 * Full charge of a tank's shield, for the HUD bar and any UI that shows it.
 * Hulls with the shield perk use their own capacity; anyone else can only have
 * a shield from a crate, so that is the reference. Never below what the tank is
 * actually carrying, so a bar can't overflow.
 */
export function shieldCapacity(t: Tank): number {
  const own = t.cls.perk.kind === 'shield' ? t.cls.perk.capacity : SHIELD_CRATE_AMOUNT;
  return Math.max(own, t.shield);
}

/** Arena-mode barrel rotation speed cap, deg/s. */
export const AIM_SPEED = 70;
export const POWER_SPEED = 60;

export class World {
  readonly width: number;
  readonly height: number;
  readonly mode: GameMode;
  readonly rng: Rng;

  terrain!: Terrain;
  tanks: Tank[] = [];
  projectiles: Projectile[] = [];
  crates: Crate[] = [];
  hardpoints: Hardpoint[] = [];
  hazards: Hazard[] = [];
  /** Hazards whose HP hit zero this step; detonated after the loop so chains terminate. */
  private pendingBlasts: Hazard[] = [];

  wind = 0;
  /** Simulated seconds since the round started. */
  time = 0;

  private nextId = 1;
  private events: WorldEvent[] = [];

  constructor(opts: WorldOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.mode = opts.mode;
    this.rng = new Rng(opts.seed);
  }

  // ---- lifecycle -------------------------------------------------------

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.projectiles = [];
    this.crates = [];
    this.hardpoints = [];
    this.hazards = [];
    this.pendingBlasts = [];
    this.time = 0;
  }

  /** Spawn a projectile from an arbitrary point — boss weapons, defences, scripted events. */
  fireFrom(from: Vec2, vel: Vec2, weapon: Weapon, owner: number): void {
    this.spawnProjectile(from, vel, weapon, owner, 0);
    const angle = (Math.atan2(-vel.y, vel.x) * 180) / Math.PI;
    this.events.push({ kind: 'launch', from, weapon, shooter: owner, angle });
  }

  addTank(setup: {
    index: number;
    name: string;
    colour: number;
    isBot: boolean;
    difficulty: Difficulty;
    cls: TankClass;
    skin?: string;
    credits: number;
    /** Defaults to the tank's own index: free-for-all. */
    team?: number;
  }): Tank {
    const ammo = new Map<string, number>();
    ammo.set(defaultWeaponId(), -1);
    const t: Tank = {
      id: this.nextId++,
      kind: 'tank',
      index: setup.index,
      name: setup.name,
      colour: setup.colour,
      isBot: setup.isBot,
      difficulty: setup.difficulty,
      cls: setup.cls,
      skin: setup.skin ?? '',
      x: 0,
      y: 0,
      halfWidth: setup.cls.halfWidth * UNIT,
      halfHeight: setup.cls.halfHeight * UNIT,
      hp: setup.cls.hp,
      maxHp: setup.cls.hp,
      alive: true,
      owner: setup.index,
      team: setup.team ?? setup.index,
      tilt: 0,
      vy: 0,
      airborne: false,
      facing: 1,
      shield: 0,
      angle: 60,
      power: 55,
      fuel: setup.cls.fuel,
      movedThisTurn: false,
      cooldown: 0,
      pivotDX: 0,
      pivotDY: 0,
      barrelLen: 0,
      credits: setup.credits,
      reinforcedHp: 0,
      placed: true,
      ammo,
      selectedWeapon: defaultWeaponId(),
      kills: 0,
      roundsWon: 0,
    };
    this.tanks.push(t);
    return t;
  }

  /** Reset a tank for a new round at column x. */
  respawnTank(t: Tank, x: number): void {
    this.resetTankForRound(t);
    this.placeTankAt(t, x);
  }

  /**
   * Round reset without a position: HP, fuel, shield and flags. Split out from
   * respawnTank so drop placement can reset everyone at the start of the round
   * and let the players choose where they land afterwards.
   */
  resetTankForRound(t: Tank): void {
    // The class base always heals fully; only the Reinforced Hull bonus carries
    // over at whatever it was left at (see the `reinforcedHp` doc comment).
    t.maxHp = t.cls.hp + t.reinforcedHp;
    t.hp = t.maxHp;
    t.alive = true;
    t.vy = 0;
    t.airborne = false;
    t.fuel = t.cls.fuel;
    t.movedThisTurn = false;
    t.cooldown = 0;
    t.shield = this.mode.perks && t.cls.perk.kind === 'shield' ? t.cls.perk.capacity : 0;
  }

  /** Drop a tank onto column x, flattening a shelf so it does not start on a knife edge. */
  placeTankAt(t: Tank, x: number): void {
    t.x = x;
    t.facing = x < this.width / 2 ? 1 : -1;
    if (!this.mode.retainAim) {
      t.angle = t.facing === 1 ? 60 : 120;
      t.power = 55;
    }
    this.terrain.fillCircle(x, this.terrain.surfaceY(x) + 8 * UNIT, 12 * UNIT);
    this.terrain.carveCircle(x, this.terrain.surfaceY(x) - 30 * UNIT, 26 * UNIT, false);
    this.snapToGround(t);
    t.placed = true;
  }

  /** Hold a tank out of the world until a player drops it (see TurnBasedMatch 'placing'). */
  unplaceTank(t: Tank): void {
    t.placed = false;
    t.airborne = false;
    t.vy = 0;
  }

  addHardpoint(h: Omit<Hardpoint, 'id' | 'kind' | 'alive' | 'owner' | 'team'> & { team?: number }): Hardpoint {
    const hp: Hardpoint = { ...h, id: this.nextId++, kind: 'hardpoint', alive: true, owner: -100 - h.bossIndex, team: h.team ?? 1 };
    this.hardpoints.push(hp);
    return hp;
  }

  /** Drain events accumulated since the last call. */
  /** Pending events without clearing them — rules layers tally before the renderer drains. */
  peekEvents(): readonly WorldEvent[] {
    return this.events;
  }

  drainEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get busy(): boolean {
    return this.projectiles.length > 0 || this.tanks.some((t) => t.alive && t.airborne);
  }

  aliveTanks(): Tank[] {
    return this.tanks.filter((t) => t.alive);
  }

  damageables(): Damageable[] {
    return [...this.tanks.filter((t) => t.placed), ...this.hardpoints, ...this.crates, ...this.hazards];
  }

  // ---- queries -----------------------------------------------------------

  /** Where a shot leaves the barrel, in world pixels. */
  muzzle(t: Tank): Vec2 {
    const a = (t.angle * Math.PI) / 180;
    if (t.barrelLen > 0) {
      const px = t.x + t.pivotDX * t.facing;
      const py = t.y + t.pivotDY;
      return { x: px + Math.cos(a) * t.barrelLen, y: py - Math.sin(a) * t.barrelLen };
    }
    const pivotY = t.y - t.halfHeight * 2 - 2;
    const len = t.cls.barrel * UNIT;
    return { x: t.x + Math.cos(a) * len, y: pivotY - Math.sin(a) * len };
  }

  /** Wind as this tank's shells experience it, after any stabiliser perk. */
  effectiveWind(t: Tank): number {
    if (this.mode.perks && t.cls.perk.kind === 'stabilised') return this.wind * (1 - t.cls.perk.windReduction);
    return this.wind;
  }

  ammoFor(t: Tank, weaponId: string): number {
    return t.ammo.get(weaponId) ?? 0;
  }

  rollWind(): void {
    const u = this.rng.next() * 2 - 1;
    this.wind = Math.round(Math.sign(u) * Math.pow(Math.abs(u), 1.6) * this.mode.windMax);
  }

  // ---- tank control --------------------------------------------------------

  aim(t: Tank, angleDeg: number, autoFace = true): void {
    t.angle = Math.max(0, Math.min(180, angleDeg));
    if (!autoFace) return;
    if (t.angle < 88) t.facing = 1;
    else if (t.angle > 92) t.facing = -1;
  }

  /**
   * Real-time aiming: raise/lower the barrel relative to the hull's facing, so
   * "up" always means up whichever way the tank points. Elevation may dip a
   * little below level and pass slightly beyond vertical.
   */
  aimElevation(t: Tank, deltaDeg: number): void {
    const elev = t.facing === 1 ? t.angle : 180 - t.angle;
    const next = Math.max(-12, Math.min(96, elev + deltaDeg));
    t.angle = t.facing === 1 ? next : 180 - next;
  }

  /** Real-time driving: the hull turns to face the drive direction, mirroring the barrel. */
  face(t: Tank, dir: 1 | -1): void {
    if (t.facing === dir) return;
    t.facing = dir;
    t.angle = 180 - t.angle;
  }

  setPower(t: Tank, p: number): void {
    t.power = Math.max(5, Math.min(100, p));
  }

  selectWeapon(t: Tank, weaponId: string): boolean {
    if (this.ammoFor(t, weaponId) === 0) return false;
    t.selectedWeapon = weaponId;
    return true;
  }

  cycleWeapon(t: Tank, dir: 1 | -1): void {
    const ids = [...t.ammo.entries()].filter(([, n]) => n !== 0).map(([id]) => id);
    if (ids.length === 0) return;
    const i = ids.indexOf(t.selectedWeapon);
    t.selectedWeapon = ids[(i + dir + ids.length) % ids.length];
  }

  /**
   * Drive by dx pixels along the surface, respecting the hull's climb limit.
   * `useFuel` is true in turn-based modes. Returns pixels actually moved.
   */
  drive(t: Tank, dx: number, useFuel: boolean): number {
    if (!t.alive || t.airborne) return 0;
    const dir = Math.sign(dx);
    if (dir === 0) return 0;
    let moved = 0;
    const steps = Math.abs(dx);
    const whole = Math.floor(steps);
    const maxClimb = t.cls.perk.kind === 'hover' ? 999 : Math.tan((t.cls.climb * Math.PI) / 180) * 1.5;
    // Rugged styles (crags, mesas) leave single-pixel jaggies in the generated
    // surface even after smoothing; checking one column at a time against the
    // raw climb limit made tanks stall on those, not just on real cliffs. A
    // small flat tolerance absorbs the noise without changing what a genuine
    // slope blocks.
    const STEP_ASSIST = 4 * UNIT;
    for (let i = 0; i < whole; i++) {
      if (useFuel && t.fuel <= 0) break;
      const nx = t.x + dir;
      if (nx < 14 * UNIT || nx > this.terrain.width - 14 * UNIT) break;
      const hereY = this.terrain.surfaceY(t.x);
      const nextY = this.terrain.surfaceY(nx);
      if (hereY - nextY > maxClimb * UNIT + STEP_ASSIST) break; // too steep uphill
      t.x = nx;
      if (useFuel) t.fuel -= 1;
      moved += 1;
      t.movedThisTurn = true;
    }
    if (moved > 0) {
      // Follow the surface downhill; if the drop is big, go airborne.
      const surf = this.terrain.surfaceY(t.x);
      if (surf - t.y > 10 * UNIT) t.airborne = true;
      else this.snapToGround(t);
      this.events.push({ kind: 'move', tank: t.index, dx: moved * dir });
    }
    return moved * dir;
  }

  /** Fire the selected weapon. Returns false if no ammo. */
  fire(t: Tank): boolean {
    if (!t.alive) return false;
    const weapon = weaponById(t.selectedWeapon);
    const n = this.ammoFor(t, weapon.id);
    if (n === 0) return false;
    if (n > 0) t.ammo.set(weapon.id, n - 1);
    if (n === 1) t.selectedWeapon = defaultWeaponId();

    const from = this.muzzle(t);
    const vel = launchVelocity(t.angle, t.power, weapon.speedScale);
    this.spawnProjectile(from, vel, weapon, t.index, 0);
    this.events.push({ kind: 'launch', from, weapon, shooter: t.index, angle: t.angle });
    return true;
  }

  private spawnProjectile(pos: Vec2, vel: Vec2, weapon: Weapon, owner: number, depth: number): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      owner,
      weapon,
      depth,
      pos: { ...pos },
      vel: { ...vel },
      windFactor: weapon.windFactor,
      gravityFactor: weapon.gravityFactor,
      age: 0,
      state: 'flying',
      apexY: pos.y,
      grace: depth === 0 ? 40 : 6,
      leftOwner: depth > 0,
      rollDir: 0,
      rollSteps: 0,
      tunnelLeft: 0,
      tunnelDir: { x: 0, y: 1 },
      trail: [{ ...pos }],
    };
    this.projectiles.push(p);
    return p;
  }

  // ---- crates ----------------------------------------------------------------

  spawnCrate(x: number, crateKind: CrateKind, payload = ''): Crate {
    const c: Crate = {
      id: this.nextId++,
      kind: 'crate',
      crateKind,
      payload,
      x,
      y: -20,
      halfWidth: 12 * UNIT,
      halfHeight: 12 * UNIT,
      hp: 1,
      maxHp: 1,
      alive: true,
      owner: -1,
      team: -1,
      vy: 0,
      landed: false,
      ttl: 45,
    };
    this.crates.push(c);
    this.events.push({ kind: 'crateSpawn', crate: c.id });
    return c;
  }

  // ---- simulation --------------------------------------------------------------

  /** Advance the world by one fixed step. */
  /**
   * Drop a mine or a barrel on the surface at column x. Mines are small and
   * nearly invisible until tripped; barrels are shootable and chain.
   */
  spawnHazard(x: number, hazardKind: HazardKind): Hazard {
    const surf = this.terrain.surfaceY(x);
    const mine = hazardKind === 'mine';
    const h: Hazard = {
      id: this.nextId++,
      kind: 'hazard',
      hazardKind,
      x,
      y: surf,
      halfWidth: (mine ? 5 : 7) * UNIT,
      halfHeight: (mine ? 3 : 9) * UNIT,
      hp: mine ? 12 : 26,
      maxHp: mine ? 12 : 26,
      alive: true,
      owner: -1,
      // Neutral: a mine does not care who drives over it.
      team: -2,
      // A drum going up is worse than a mine, and the bigger radius is what
      // makes a row of drums chain rather than fizzle at the second one.
      weapon: mine ? 'shell' : 'heavy',
      trigger: mine ? 13 * UNIT : 0,
      spent: false,
      vy: 0,
      landed: true,
    };
    this.hazards.push(h);
    this.events.push({ kind: 'hazardArmed', hazard: h.id, hazardKind });
    return h;
  }

  step(dt = SIM_DT): void {
    this.time += dt;
    this.stepProjectiles(dt);
    this.stepTanks(dt);
    this.stepCrates(dt);
    this.stepHazards();
  }

  /**
   * Trip mines under tanks, then set off anything whose HP ran out. Detonating
   * from a queue rather than inside damage() keeps a chain of barrels from
   * recursing through the blast code.
   */
  private stepHazards(): void {
    for (const h of this.hazards) {
      if (!h.alive || h.spent || h.trigger <= 0) continue;
      const tripped = this.tanks.some(
        (t) => t.alive && t.placed && Math.abs(t.x - h.x) <= h.trigger + t.halfWidth && Math.abs(t.y - h.y) <= h.trigger + t.halfHeight * 2,
      );
      if (tripped) this.pendingBlasts.push(h);
    }
    if (this.pendingBlasts.length === 0) return;
    // Detonate breadth-first: each blast may queue more, and the loop drains
    // them until the chain runs out.
    let guard = 0;
    while (this.pendingBlasts.length > 0 && guard++ < 64) {
      const batch = this.pendingBlasts;
      this.pendingBlasts = [];
      for (const h of batch) this.detonateHazard(h);
    }
    this.hazards = this.hazards.filter((h) => h.alive);
  }

  private detonateHazard(h: Hazard): void {
    if (h.spent) return;
    h.spent = true;
    h.alive = false;
    h.hp = 0;
    const at = { x: h.x, y: h.y - h.halfHeight };
    this.events.push({ kind: 'hazardBlown', hazard: h.id, hazardKind: h.hazardKind, at });
    this.explode(at, weaponById(h.weapon), -1);
  }

  private stepProjectiles(dt: number): void {
    const wind = this.wind;
    for (const p of this.projectiles) {
      if (p.state === 'done') continue;
      const shooter = p.owner >= 0 ? this.tanks[p.owner] : undefined;
      const w = shooter ? this.effectiveWindFor(shooter) : wind;

      if (p.state === 'rolling') {
        this.stepRoll(p);
        continue;
      }
      if (p.state === 'tunnelling') {
        this.stepTunnel(p);
        continue;
      }

      stepProjectile(p, w, dt);
      if (p.grace > 0) p.grace -= 1;
      if (p.trail.length === 0 || Math.hypot(p.pos.x - p.trail[p.trail.length - 1].x, p.pos.y - p.trail[p.trail.length - 1].y) > 3 * UNIT) {
        p.trail.push({ ...p.pos });
        if (p.trail.length > 40) p.trail.shift();
      }

      // Apex split for cluster / MIRV.
      const splits = p.weapon.behaviour === 'cluster' || p.weapon.behaviour === 'mirv';
      if (splits && p.depth === 0 && p.vel.y > 0 && p.age > 0.15) {
        this.split(p);
        continue;
      }
      if (p.pos.y < p.apexY) p.apexY = p.pos.y;

      // Off map?
      if (p.pos.x < -120 || p.pos.x > this.width + 120 || p.pos.y > this.height + 60) {
        p.state = 'done';
        this.events.push({ kind: 'offmap', at: { ...p.pos } });
        continue;
      }

      // Hit a damageable?
      const hit = this.findHit(p);
      if (hit) {
        this.impact(p, hit);
        continue;
      }

      // Hit terrain?
      if (p.weapon.behaviour !== 'railgun' && this.terrain.isSolid(p.pos.x, p.pos.y)) {
        this.impact(p, null);
        continue;
      }
      // Railguns fly until they hit something or leave; carve as they pass through rock.
      if (p.weapon.behaviour === 'railgun' && this.terrain.isSolid(p.pos.x, p.pos.y)) {
        this.terrain.carveCircle(p.pos.x, p.pos.y, 3 * UNIT, false);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.state !== 'done');
  }

  private effectiveWindFor(t: Tank): number {
    return this.effectiveWind(t);
  }

  private findHit(p: Projectile): Damageable | null {
    for (const d of this.damageables()) {
      if (!d.alive) continue;
      const cy = d.kind === 'tank' ? d.y - d.halfHeight : d.y;
      const inside =
        p.pos.x >= d.x - d.halfWidth - 2 &&
        p.pos.x <= d.x + d.halfWidth + 2 &&
        p.pos.y >= cy - d.halfHeight - 2 &&
        p.pos.y <= cy + d.halfHeight + 2;
      if (d.kind === 'tank' && d.owner === p.owner) {
        if (!inside) p.leftOwner = true;
        if (!p.leftOwner || p.grace > 0) continue;
      }
      if (inside) return d;
    }
    return null;
  }

  private split(p: Projectile): void {
    const w = p.weapon;
    p.state = 'done';
    this.events.push({ kind: 'split', at: { ...p.pos }, count: w.submunitions, weapon: w });
    for (let i = 0; i < w.submunitions; i++) {
      const spread = w.behaviour === 'mirv' ? 0.28 : 0.55;
      const f = w.submunitions === 1 ? 0 : i / (w.submunitions - 1) - 0.5;
      const vel: Vec2 = {
        x: p.vel.x * (1 + f * spread) + (w.behaviour === 'cluster' ? this.rng.range(-25, 25) : 0),
        y: p.vel.y + (w.behaviour === 'cluster' ? this.rng.range(-40, 10) : f * 30),
      };
      this.spawnProjectile(p.pos, vel, w, p.owner, p.depth + 1);
    }
  }

  private impact(p: Projectile, hit: Damageable | null): void {
    const w = p.weapon;
    const at = { ...p.pos };
    switch (w.behaviour) {
      case 'roller':
        if (!hit) {
          p.state = 'rolling';
          p.rollSteps = 0;
          p.pos.y = this.terrain.surfaceY(p.pos.x) - 2;
          const l = this.terrain.surfaceY(p.pos.x - 3 * UNIT);
          const r = this.terrain.surfaceY(p.pos.x + 3 * UNIT);
          p.rollDir = r > l ? 1 : l > r ? -1 : Math.sign(p.vel.x) || 1;
          this.events.push({ kind: 'bounce', at });
          return;
        }
        break;
      case 'digger':
        if (!hit) {
          p.state = 'tunnelling';
          p.tunnelLeft = 34 * UNIT;
          const len = Math.hypot(p.vel.x, p.vel.y) || 1;
          p.tunnelDir = { x: p.vel.x / len, y: p.vel.y / len };
          return;
        }
        break;
      case 'napalm':
        this.napalm(p);
        p.state = 'done';
        return;
    }
    p.state = 'done';
    if (w.id === 'earthmover') {
      this.terrain.fillCircle(at.x, at.y + w.radius * UNIT * 0.45, w.radius * UNIT);
      this.events.push({ kind: 'fill', at, radius: w.radius * UNIT });
      this.applyBlast(at, w, p.owner);
      this.wakeTanks();
    } else if (w.id === 'airburst') {
      const up = { x: at.x, y: at.y - 10 * UNIT };
      this.terrain.carveCircle(up.x, up.y, w.radius * UNIT * 0.35);
      this.events.push({ kind: 'explode', at: up, radius: w.radius * UNIT, weapon: w });
      this.applyBlast(up, w, p.owner);
      this.wakeTanks();
    } else {
      this.explode(at, w, p.owner);
    }
  }

  private stepRoll(p: Projectile): void {
    p.rollSteps += 1;
    const x = p.pos.x;
    const here = this.terrain.surfaceY(x);
    const ahead = this.terrain.surfaceY(x + p.rollDir * 3 * UNIT);
    // Roll until we would go uphill, or have rolled a long way.
    if (ahead < here - 2 || p.rollSteps > 700 || x < 2 || x > this.width - 2) {
      p.state = 'done';
      this.explode({ x, y: here - 1 }, p.weapon, p.owner);
      return;
    }
    p.pos.x += p.rollDir * 1.4 * UNIT;
    p.pos.y = this.terrain.surfaceY(p.pos.x) - 2;
    if (p.rollSteps % 3 === 0) {
      p.trail.push({ ...p.pos });
      if (p.trail.length > 40) p.trail.shift();
    }
    const hit = this.findHit(p);
    if (hit) {
      p.state = 'done';
      this.explode({ ...p.pos }, p.weapon, p.owner);
    }
  }

  private stepTunnel(p: Projectile): void {
    p.pos.x += p.tunnelDir.x * 1.2 * UNIT;
    p.pos.y += p.tunnelDir.y * 1.2 * UNIT;
    this.terrain.carveCircle(p.pos.x, p.pos.y, 4 * UNIT, false);
    p.tunnelLeft -= 1;
    const hit = this.findHit(p);
    const outside = !this.terrain.isSolid(p.pos.x + p.tunnelDir.x * 5 * UNIT, p.pos.y + p.tunnelDir.y * 5 * UNIT);
    if (p.tunnelLeft <= 0 || hit || outside || p.pos.y > this.height - 4) {
      p.state = 'done';
      this.explode({ ...p.pos }, p.weapon, p.owner);
    }
  }

  private napalm(p: Projectile): void {
    const w = p.weapon;
    // Burning fluid runs downhill from the impact in several streams. The
    // starting points are spread deterministically rather than jittered around
    // the impact: on flat ground the fluid has nowhere to run, and clustered
    // streams all landed on whatever was standing there.
    const spread = 8 * UNIT;
    for (let i = 0; i < w.submunitions; i++) {
      let x = p.pos.x + (i - (w.submunitions - 1) / 2) * spread + this.rng.range(-2, 2) * UNIT;
      let y = this.terrain.surfaceY(x) - 2;
      for (let k = 0; k < 40 + i * 6; k++) {
        const l = this.terrain.surfaceY(x - 2 * UNIT);
        const r = this.terrain.surfaceY(x + 2 * UNIT);
        const here = this.terrain.surfaceY(x);
        if (l >= here && r >= here) break;
        x += (r < l ? 1.6 : -1.6) * UNIT;
        if (x < 0 || x >= this.width) break;
        y = this.terrain.surfaceY(x) - 2;
      }
      const at = { x, y };
      this.terrain.carveCircle(x, y, 4 * UNIT, true);
      this.applyBlast(at, w, p.owner);
      this.events.push({ kind: 'burn', at, weapon: w });
    }
    this.wakeTanks();
  }

  private explode(at: Vec2, w: Weapon, owner: number): void {
    const r = w.radius * UNIT;
    this.terrain.carveCircle(at.x, at.y, r);
    this.events.push({ kind: 'explode', at, radius: r, weapon: w });
    this.applyBlast(at, w, owner);
    if (this.mode.terrainCollapse) this.terrain.settle(at.x - r - 2, at.x + r + 2);
    this.wakeTanks();
  }

  private applyBlast(at: Vec2, w: Weapon, owner: number): void {
    for (const d of this.damageables()) {
      if (!d.alive) continue;
      // A boss does not blow up its own mounts. Hardpoints and boss-fired
      // projectiles share the owner id (-100 - bossIndex), so this also stops a
      // Hive drone detonating against the bay that launched it. Tanks still take
      // their own splash: that is the game.
      if (d.kind === 'hardpoint' && d.owner === owner) continue;
      const cy = d.kind === 'tank' ? d.y - d.halfHeight : d.y;
      const dx = Math.max(Math.abs(at.x - d.x) - d.halfWidth, 0);
      const dy = Math.max(Math.abs(at.y - cy) - d.halfHeight, 0);
      const f = blastFalloff(Math.hypot(dx, dy), w.radius * UNIT);
      if (f <= 0) continue;

      let dmg = w.damage * f;
      if (d.kind === 'tank') {
        const t = d as Tank;
        dmg *= t.cls.armour;
        if (this.mode.perks && t.cls.perk.kind === 'dugIn' && !t.movedThisTurn) dmg *= 1 - t.cls.perk.reduction;
      }
      dmg = Math.round(dmg);
      if (dmg <= 0) continue;
      this.damage(d, dmg, owner, at);
    }
  }

  damage(d: Damageable, dmg: number, by: number, at: Vec2): void {
    let absorbed = 0;
    if (d.kind === 'tank') {
      const t = d as Tank;
      if (t.shield > 0) {
        absorbed = Math.min(t.shield, dmg);
        t.shield -= absorbed;
        dmg -= absorbed;
      }
    }
    const hpBefore = d.hp;
    d.hp = Math.max(0, d.hp - dmg);
    if (d.kind === 'tank') {
      // Reinforced Hull bonus is not permanent — damage burns it down, and it
      // never regenerates on its own (only a shop purchase raises it back up).
      const t = d as Tank;
      t.reinforcedHp = Math.max(0, t.reinforcedHp - (hpBefore - d.hp));
    }
    this.events.push({ kind: 'damage', target: d.id, amount: dmg, shieldAbsorbed: absorbed, hpAfter: d.hp, at, by });
    if (d.hp <= 0) {
      d.alive = false;
      this.events.push({ kind: 'kill', target: d.id, by });
      if (d.kind === 'hazard') {
        const h = d as Hazard;
        if (!h.spent) this.pendingBlasts.push(h);
      }
      const killer = by >= 0 ? this.tanks[by] : undefined;
      if (d.kind === 'tank' && killer && killer.index !== d.owner && killer.team !== d.team) {
        killer.kills += 1;
        killer.credits += this.mode.killReward;
      }
    }
  }

  // ---- tanks: gravity and ground -----------------------------------------------

  /** Terrain changed: any tank now hanging in the air starts to fall. */
  private wakeTanks(): void {
    for (const t of this.tanks) {
      if (!t.alive || t.airborne || !t.placed) continue;
      if (this.terrain.surfaceY(t.x) > t.y + 1) {
        t.airborne = true;
        t.vy = 0;
      }
    }
  }

  private stepTanks(dt: number): void {
    for (const t of this.tanks) {
      if (!t.alive || !t.placed) continue;
      if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
      if (!t.airborne) continue;
      const startY = t.y;
      t.vy += GRAVITY * dt;
      t.y += t.vy * dt;
      const surf = this.terrain.surfaceY(t.x);
      if (t.y >= surf) {
        t.y = surf;
        t.airborne = false;
        const speed = t.vy;
        t.vy = 0;
        t.tilt = this.terrain.surfaceAngle(t.x, t.cls.halfWidth);
        let dmg = 0;
        if (this.mode.fallDamage && t.cls.perk.kind !== 'hover' && speed > 120 * UNIT) {
          dmg = Math.round(Math.min(40, (speed - 120 * UNIT) * (0.12 / UNIT)));
          if (dmg > 0) this.damage(t, dmg, -1, { x: t.x, y: t.y });
        }
        this.events.push({ kind: 'land', tank: t.index, impactSpeed: speed, damage: dmg });
      } else if (t.y >= this.height) {
        // Fell out of the world.
        t.y = this.height;
        t.airborne = false;
        this.damage(t, t.hp + t.shield, -1, { x: t.x, y: t.y });
      }
      void startY;
    }
  }

  snapToGround(t: Tank): void {
    t.y = Math.min(this.terrain.surfaceY(t.x), this.terrain.height - 1);
    t.airborne = false;
    t.vy = 0;
    t.tilt = this.terrain.surfaceAngle(t.x, t.cls.halfWidth);
  }

  // ---- crates ------------------------------------------------------------------

  private stepCrates(dt: number): void {
    for (const c of this.crates) {
      if (!c.alive) continue;
      if (!c.landed) {
        // Parachute: slow constant descent.
        c.vy = 55 * UNIT;
        c.y += c.vy * dt;
        const surf = this.terrain.surfaceY(c.x);
        if (c.y + c.halfHeight >= surf) {
          c.y = surf - c.halfHeight;
          c.landed = true;
          this.events.push({ kind: 'crateLand', crate: c.id });
        }
      } else {
        // Follow the ground if it disappears.
        const surf = this.terrain.surfaceY(c.x);
        if (c.y + c.halfHeight < surf - 1) c.y = Math.min(c.y + 200 * UNIT * dt, surf - c.halfHeight);
        c.ttl -= dt;
        if (c.ttl <= 0) c.alive = false;
      }
      // Pickup by overlap.
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (Math.abs(t.x - c.x) < t.halfWidth + c.halfWidth && Math.abs(t.y - t.halfHeight - c.y) < t.halfHeight + c.halfHeight) {
          this.pickup(c, t);
          break;
        }
      }
    }
    this.crates = this.crates.filter((c) => c.alive);
  }

  private pickup(c: Crate, t: Tank): void {
    c.alive = false;
    switch (c.crateKind) {
      case 'repair':
        t.hp = Math.min(t.maxHp, t.hp + Math.round(t.maxHp * 0.4));
        break;
      case 'shield':
        t.shield = Math.max(t.shield, SHIELD_CRATE_AMOUNT);
        break;
      case 'credits':
        t.credits += 800;
        break;
      case 'ammo':
      case 'weapon': {
        const w = weaponById(c.payload || 'heavy');
        const have = t.ammo.get(w.id) ?? 0;
        t.ammo.set(w.id, have < 0 ? -1 : have + Math.max(1, Math.ceil(w.ammoPerBuy / 2)));
        break;
      }
    }
    this.events.push({ kind: 'cratePickup', crate: c.id, tank: t.index, crateKind: c.crateKind, payload: c.payload });
  }
}
