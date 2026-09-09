import { describe, it, expect } from 'vitest';
import {
  GRAVITY,
  SIM_DT,
  SPEED,
  launchVelocity,
  simulateFlight,
  stepProjectile,
  type ProjectileState,
} from '../src/core/physics';
import { Terrain, TERRAIN_STYLES } from '../src/core/terrain';
import { Rng } from '../src/core/rng';
import { flatTerrain, GROUND_Y, MAP_W, MAP_H } from './helpers';

function projectile(vx: number, vy: number, x = 0, y = 0): ProjectileState {
  return { pos: { x, y }, vel: { x: vx, y: vy }, windFactor: 1, gravityFactor: 1, age: 0 };
}

/** Integrate until the shell falls back to its launch height. */
function flyToLevel(p: ProjectileState, wind: number, maxSteps = 4000) {
  const y0 = p.pos.y;
  let apexY = p.pos.y;
  let apexX = p.pos.x;
  for (let i = 0; i < maxSteps; i++) {
    stepProjectile(p, wind);
    if (p.pos.y < apexY) {
      apexY = p.pos.y;
      apexX = p.pos.x;
    }
    if (p.vel.y > 0 && p.pos.y >= y0) break;
  }
  return { apexY, apexX, range: p.pos.x, flightTime: p.age };
}

describe('launchVelocity', () => {
  it('maps angle to a screen-space direction, with +Y downward', () => {
    const flat = launchVelocity(0, 100);
    expect(flat.x).toBeCloseTo(100 * 3.1 * SPEED, 6);
    expect(flat.y).toBeCloseTo(0, 6);

    const up = launchVelocity(90, 50);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(-50 * 3.1 * SPEED, 6);
  });

  it('scales speed linearly in power and in the weapon speedScale', () => {
    const half = launchVelocity(45, 50);
    const full = launchVelocity(45, 100);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(2 * Math.hypot(half.x, half.y), 6);

    const heavy = launchVelocity(45, 60, 2.4);
    const shell = launchVelocity(45, 60, 3.1);
    expect(Math.hypot(heavy.x, heavy.y) / Math.hypot(shell.x, shell.y)).toBeCloseTo(2.4 / 3.1, 6);
  });

  it('mirrors angles about the vertical', () => {
    const right = launchVelocity(35, 70);
    const left = launchVelocity(145, 70);
    expect(left.x).toBeCloseTo(-right.x, 6);
    expect(left.y).toBeCloseTo(right.y, 6);
  });
});

describe('stepProjectile', () => {
  it('traces a parabola whose apex and range match the closed form', () => {
    const v = launchVelocity(45, 60);
    const { apexY, apexX, range, flightTime } = flyToLevel(projectile(v.x, v.y), 0);

    // Analytic values for the same launch; semi-implicit Euler at 120 Hz sits
    // within a fraction of a per cent of them.
    const speed = Math.hypot(v.x, v.y);
    const vy0 = -v.y;
    const expectedApex = -(vy0 * vy0) / (2 * GRAVITY);
    const expectedRange = (speed * speed) / GRAVITY; // 45 degrees
    const expectedTime = (2 * vy0) / GRAVITY;

    expect(apexY / expectedApex).toBeGreaterThan(0.99);
    expect(apexY / expectedApex).toBeLessThan(1.01);
    expect(range).toBeGreaterThan(expectedRange * 0.99);
    expect(range).toBeLessThan(expectedRange * 1.01);
    expect(flightTime).toBeCloseTo(expectedTime, 1);
    // With no wind the arc is symmetric: the apex sits at half the range.
    expect(apexX / range).toBeCloseTo(0.5, 2);
  });

  it('is symmetric under angle reflection when there is no wind', () => {
    const r = flyToLevel(projectile(...vec(launchVelocity(38, 70))), 0);
    const l = flyToLevel(projectile(...vec(launchVelocity(142, 70))), 0);
    expect(l.range).toBeCloseTo(-r.range, 6);
    expect(l.apexY).toBeCloseTo(r.apexY, 6);
  });

  it('lets a tailwind carry the shell downrange and a headwind hold it back', () => {
    const still = flyToLevel(projectile(...vec(launchVelocity(45, 60))), 0).range;
    const tail = flyToLevel(projectile(...vec(launchVelocity(45, 60))), 60).range;
    const head = flyToLevel(projectile(...vec(launchVelocity(45, 60))), -60).range;
    expect(tail).toBeGreaterThan(still);
    expect(head).toBeLessThan(still);
    // Wind is an acceleration, so the two deflections are equal and opposite.
    expect(tail - still).toBeCloseTo(still - head, 3);
  });

  it('leaves a windFactor-0 slug untouched by wind', () => {
    const p = projectile(...vec(launchVelocity(45, 60)));
    p.windFactor = 0;
    const railgun = flyToLevel(p, 90).range;
    const still = flyToLevel(projectile(...vec(launchVelocity(45, 60))), 0).range;
    expect(railgun).toBeCloseTo(still, 6);
  });

  it('advances age by exactly one step', () => {
    const p = projectile(10, -10);
    stepProjectile(p, 0);
    expect(p.age).toBeCloseTo(SIM_DT, 12);
  });
});

describe('simulateFlight', () => {
  const flat = () => flatTerrain();

  it('stops on terrain and reports the apex inside the path', () => {
    const terrain = flat();
    const v = launchVelocity(55, 70);
    const r = simulateFlight({ x: 300, y: GROUND_Y - 40 }, v, terrain, {
      wind: 0,
      tanks: [],
      mapWidth: MAP_W,
      mapHeight: MAP_H,
    });
    expect(r.impact.kind).toBe('terrain');
    expect(terrain.isSolid(r.impact.at.x, r.impact.at.y)).toBe(true);
    expect(r.apexIndex).toBeGreaterThan(0);
    expect(r.apexIndex).toBeLessThan(r.path.length - 1);
    const apex = r.path[r.apexIndex];
    for (const pt of r.path) expect(pt.y).toBeGreaterThanOrEqual(apex.y);
  });

  it('registers a tank hit ahead of the terrain behind it', () => {
    const terrain = flat();
    const v = launchVelocity(50, 62);
    const bare = simulateFlight({ x: 300, y: GROUND_Y - 40 }, v, terrain, {
      wind: 0,
      tanks: [],
      mapWidth: MAP_W,
      mapHeight: MAP_H,
    });
    const withTank = simulateFlight({ x: 300, y: GROUND_Y - 40 }, v, terrain, {
      wind: 0,
      tanks: [{ index: 1, x: bare.impact.at.x, y: GROUND_Y - 14, halfWidth: 22, halfHeight: 14, alive: true }],
      mapWidth: MAP_W,
      mapHeight: MAP_H,
    });
    expect(withTank.impact.kind).toBe('tank');
    expect(withTank.impact.tankIndex).toBe(1);
  });

  it('is deterministic for a given seed: same terrain, same flight', () => {
    const style = TERRAIN_STYLES[0];
    const profile = (t: Terrain) => Array.from({ length: MAP_W }, (_, x) => t.surfaceY(x));
    const a = Terrain.generate(MAP_W, MAP_H, style, 4242);
    const b = Terrain.generate(MAP_W, MAP_H, style, 4242);
    expect(profile(b)).toEqual(profile(a));

    const v = launchVelocity(58, 74);
    const opts = { wind: 33, tanks: [], mapWidth: MAP_W, mapHeight: MAP_H };
    const ra = simulateFlight({ x: 260, y: 300 }, v, a, opts);
    const rb = simulateFlight({ x: 260, y: 300 }, v, b, opts);
    expect(rb.path.length).toBe(ra.path.length);
    expect(rb.impact.at).toEqual(ra.impact.at);
    expect(rb.impact.kind).toBe(ra.impact.kind);

    // A different seed must give a different battlefield, or the seeding is a no-op.
    const c = Terrain.generate(MAP_W, MAP_H, style, 4243);
    expect(profile(c)).not.toEqual(profile(a));
  });

  it('replays an Rng identically from the same seed', () => {
    const draw = (seed: number) => Array.from({ length: 8 }, () => new Rng(seed)).map((r) => r.next());
    const [first] = draw(99);
    expect(draw(99).every((v) => v === first)).toBe(true);
    expect(new Rng(100).next()).not.toBe(first);
  });
});

/** Spread a Vec2 into the (vx, vy) argument pair. */
function vec(v: { x: number; y: number }): [number, number] {
  return [v.x, v.y];
}
