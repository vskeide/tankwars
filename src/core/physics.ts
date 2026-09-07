import type { Vec2 } from './types';
import type { Terrain } from './terrain';

/** Pixels per second squared. Tuned so a full-power shot arcs across a screen. */
export const GRAVITY = 220;

/** Launch-speed multiplier applied on top of each weapon's speedScale. Max-power
 *  range at 45° is (100·3.1·SPEED)²/GRAVITY ≈ 920 px — most of a 960-px map. */
export const SPEED = 1.45;

/** Fixed simulation step. Trajectories are deterministic and replayable. */
export const SIM_DT = 1 / 120;

export interface ProjectileState {
  pos: Vec2;
  vel: Vec2;
  /** 0 = unaffected by wind, 1 = full wind. Railgun slugs sit near 0. */
  windFactor: number;
  /** Extra downward pull multiplier; heavy shells fall harder. */
  gravityFactor: number;
  /** Seconds the projectile has been in flight. */
  age: number;
}

export type ImpactKind = 'terrain' | 'tank' | 'offmap' | 'expired';

export interface Impact {
  kind: ImpactKind;
  at: Vec2;
  /** Velocity at the moment of impact — drives debris direction and rollers. */
  vel: Vec2;
  /** Index into the match player list when `kind === 'tank'`. */
  tankIndex: number;
}

export interface TankHitbox {
  index: number;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  alive: boolean;
}

/** Convert an artillery aim into a launch velocity. Angle is degrees from +X, CCW. */
export function launchVelocity(angleDeg: number, power: number, speedScale = 3.1): Vec2 {
  const a = (angleDeg * Math.PI) / 180;
  const speed = power * speedScale * SPEED;
  return { x: Math.cos(a) * speed, y: -Math.sin(a) * speed };
}

/**
 * Advance a projectile one fixed step. Pure — the caller owns the state object
 * and decides whether to keep the sampled point for the trail.
 */
export function stepProjectile(p: ProjectileState, wind: number, dt = SIM_DT): void {
  p.vel.x += wind * p.windFactor * dt;
  p.vel.y += GRAVITY * p.gravityFactor * dt;
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  p.age += dt;
}

export interface FlightResult {
  /** Sampled flight path, one point per simulation step. */
  path: Vec2[];
  impact: Impact;
  /** Index into `path` at which the projectile passed its highest point. */
  apexIndex: number;
}

export interface FlightOptions {
  wind: number;
  /** Tanks that can be hit. The firing tank is normally excluded for the first few steps. */
  tanks: readonly TankHitbox[];
  /** Steps of grace before the shooter can hit itself, so the muzzle does not self-detonate. */
  selfGraceSteps?: number;
  shooterIndex?: number;
  /** Hard cap so a shot fired straight up into a vacuum still terminates. */
  maxSteps?: number;
  /** Projectiles above the map keep flying; below/off the sides they are gone. */
  mapWidth: number;
  mapHeight: number;
  /** When true the projectile ignores terrain (railgun). */
  piercesTerrain?: boolean;
}

/**
 * Simulate a whole shot to its conclusion. Returning the full path rather than
 * animating step by step keeps the core renderer-free: the render layer replays
 * `path` at whatever speed it likes, and the outcome is already known.
 */
export function simulateFlight(
  start: Vec2,
  vel: Vec2,
  terrain: Terrain,
  opts: FlightOptions,
  windFactor = 1,
  gravityFactor = 1,
): FlightResult {
  const p: ProjectileState = {
    pos: { x: start.x, y: start.y },
    vel: { x: vel.x, y: vel.y },
    windFactor,
    gravityFactor,
    age: 0,
  };
  const path: Vec2[] = [{ x: p.pos.x, y: p.pos.y }];
  const maxSteps = opts.maxSteps ?? 3600; // 30 s of flight
  const grace = opts.selfGraceSteps ?? 10;

  let apexIndex = 0;
  let apexY = p.pos.y;
  let impact: Impact | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    stepProjectile(p, opts.wind);
    path.push({ x: p.pos.x, y: p.pos.y });

    if (p.pos.y < apexY) {
      apexY = p.pos.y;
      apexIndex = step;
    }

    if (p.pos.x < -80 || p.pos.x > opts.mapWidth + 80 || p.pos.y > opts.mapHeight + 40) {
      impact = { kind: 'offmap', at: { ...p.pos }, vel: { ...p.vel }, tankIndex: -1 };
      break;
    }

    const hitTank = findTankHit(p.pos, opts, step, grace);
    if (hitTank >= 0) {
      impact = { kind: 'tank', at: { ...p.pos }, vel: { ...p.vel }, tankIndex: hitTank };
      break;
    }

    if (!opts.piercesTerrain && terrain.isSolid(p.pos.x, p.pos.y)) {
      impact = { kind: 'terrain', at: { ...p.pos }, vel: { ...p.vel }, tankIndex: -1 };
      break;
    }
  }

  if (!impact) {
    impact = { kind: 'expired', at: { ...p.pos }, vel: { ...p.vel }, tankIndex: -1 };
  }
  return { path, impact, apexIndex };
}

function findTankHit(
  pos: Vec2,
  opts: FlightOptions,
  step: number,
  grace: number,
): number {
  for (const t of opts.tanks) {
    if (!t.alive) continue;
    if (t.index === opts.shooterIndex && step <= grace) continue;
    if (
      pos.x >= t.x - t.halfWidth &&
      pos.x <= t.x + t.halfWidth &&
      pos.y >= t.y - t.halfHeight &&
      pos.y <= t.y + t.halfHeight
    ) {
      return t.index;
    }
  }
  return -1;
}

/**
 * Explosion damage falls off from full at the centre to zero at the rim, with a
 * soft shoulder so a near miss still stings. Returns 0..1 of the weapon damage.
 */
export function blastFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t); // smoothstep
}

/**
 * Roll a projectile downhill from an impact point until it reaches a local
 * minimum or falls off the map. Returns the resting position and the path taken
 * so the renderer can animate the roll.
 */
export function rollDownhill(
  from: Vec2,
  terrain: Terrain,
  maxSteps = 600,
): { path: Vec2[]; rest: Vec2 } {
  const path: Vec2[] = [{ x: from.x, y: from.y }];
  let x = from.x;
  let y = Math.max(0, terrain.surfaceY(x) - 2);

  for (let i = 0; i < maxSteps; i++) {
    const leftY = terrain.surfaceY(x - 2);
    const rightY = terrain.surfaceY(x + 2);
    const here = terrain.surfaceY(x);

    // A local minimum, or a flat shelf: stop.
    if (leftY >= here && rightY >= here) break;
    x += rightY < leftY ? 1.6 : -1.6;
    if (x < 0 || x >= terrain.width) break;
    y = Math.max(0, terrain.surfaceY(x) - 2);
    path.push({ x, y });
  }
  return { path, rest: { x, y } };
}
