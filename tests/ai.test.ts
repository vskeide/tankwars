/**
 * The bot solver is a stochastic search, so these tests drive it with a seeded
 * Rng rather than Math.random and then fire the solution through the real World.
 * Nothing here inspects the search internals: the only interesting question is
 * whether the shot it hands back actually lands on the thing it aimed at.
 */
import { describe, it, expect } from 'vitest';
import { solveFrom, BotController } from '../src/core/ai';
import { Rng } from '../src/core/rng';
import { weaponById } from '../src/core/weapons';
import { launchVelocity } from '../src/core/physics';
import { addLineTank, flatWorld, settleWorld } from './helpers';

/** A seeded rand() drop-in with the same contract as Math.random. */
const seeded = (seed: number) => {
  const rng = new Rng(seed);
  return () => rng.next();
};

/** Solve, fire and report where the shell actually went. */
function shootAt(seed: number, shooterX: number, targetX: number, wind = 0, samples = 600) {
  const world = flatWorld(seed);
  world.wind = wind;
  const shooter = addLineTank(world, 0, shooterX);
  const target = addLineTank(world, 1, targetX);
  world.drainEvents();

  const from = world.muzzle(shooter);
  const aimAt = { x: target.x, y: target.y - target.halfHeight };
  const weapon = weaponById('shell');
  const solution = solveFrom(world, from, aimAt, weapon, samples, seeded(seed));
  expect(solution).not.toBeNull();

  // Fire the solution for real: same launch maths the World uses in fire().
  const vel = launchVelocity(solution!.angle, solution!.power, weapon.speedScale);
  world.fireFrom(from, vel, weapon, shooter.index);
  settleWorld(world);

  const explosion = world.drainEvents().find((e) => e.kind === 'explode');
  return { world, shooter, target, solution: solution!, explosion };
}

describe('solveFrom', () => {
  it('converges on a stationary target across flat ground', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const { target, explosion, solution } = shootAt(seed, 400, 1200);
      expect(explosion, `seed ${seed}: nothing exploded`).toBeDefined();
      // Within a tank's width of the aim point is a hit, not a near miss.
      const dx = Math.abs(explosion!.at.x - target.x);
      expect(dx, `seed ${seed}: landed ${dx.toFixed(0)} px off`).toBeLessThan(target.halfWidth * 2);
      expect(target.hp, `seed ${seed}: target unscathed`).toBeLessThan(target.maxHp);
      // A shot to the right must be aimed to the right.
      expect(solution.angle).toBeGreaterThan(0);
      expect(solution.angle).toBeLessThan(90);
    }
  });

  it('aims left for a target to the left', () => {
    const { target, explosion, solution } = shootAt(5, 1500, 500);
    expect(solution.angle).toBeGreaterThan(90);
    expect(explosion).toBeDefined();
    expect(Math.abs(explosion!.at.x - target.x)).toBeLessThan(target.halfWidth * 2);
  });

  it('compensates for a crosswind rather than ignoring it', () => {
    for (const wind of [-70, 70]) {
      const { target, explosion } = shootAt(13, 500, 1300, wind);
      expect(explosion, `wind ${wind}: nothing exploded`).toBeDefined();
      expect(Math.abs(explosion!.at.x - target.x)).toBeLessThan(target.halfWidth * 2);
      expect(target.hp).toBeLessThan(target.maxHp);
    }
    // The wind is real: replaying the still-air solution into a gale misses.
    const still = shootAt(13, 500, 1300, 0);
    const windy = flatWorld(13);
    windy.wind = 70;
    const shooter = addLineTank(windy, 0, 500);
    const target = addLineTank(windy, 1, 1300);
    const weapon = weaponById('shell');
    windy.fireFrom(windy.muzzle(shooter), launchVelocity(still.solution.angle, still.solution.power, weapon.speedScale), weapon, 0);
    settleWorld(windy);
    expect(target.hp).toBe(target.maxHp);
  });

  it('is deterministic: the same seed yields the same solution', () => {
    const a = shootAt(21, 400, 1100);
    const b = shootAt(21, 400, 1100);
    expect(b.solution).toEqual(a.solution);
    expect(b.explosion!.at).toEqual(a.explosion!.at);
  });

  it('returns null when every sampled shot leaves the map', () => {
    const world = flatWorld(1);
    // A muzzle a long way off the right edge: nothing can come back in bounds.
    const from = { x: world.width + 4000, y: -4000 };
    const solution = solveFrom(world, from, { x: 100, y: 700 }, weaponById('shell'), 40, seeded(4));
    expect(solution).toBeNull();
  });

  it('spreads the shot when asked for noise, and not otherwise', () => {
    const world = flatWorld(2);
    const shooter = addLineTank(world, 0, 400);
    addLineTank(world, 1, 1200);
    const from = world.muzzle(shooter);
    const at = { x: 1200, y: 690 };
    const weapon = weaponById('shell');

    const clean = solveFrom(world, from, at, weapon, 300, seeded(9), 0)!;
    const noisy = solveFrom(world, from, at, weapon, 300, seeded(9), 12)!;
    expect(noisy.angle).not.toBeCloseTo(clean.angle, 3);
    expect(noisy.angle).toBeGreaterThanOrEqual(0);
    expect(noisy.angle).toBeLessThanOrEqual(180);
    expect(noisy.power).toBeGreaterThanOrEqual(5);
    expect(noisy.power).toBeLessThanOrEqual(100);
  });
});

describe('BotController turn intent', () => {
  it('steers onto its solution and then fires exactly once', () => {
    const world = flatWorld(31);
    const bot = addLineTank(world, 0, 400, 'Bot');
    bot.isBot = true;
    const target = addLineTank(world, 1, 1300);
    world.drainEvents();

    const controller = new BotController(seeded(31));
    controller.newTurn();

    let fired = 0;
    // Aim converges well inside a simulated second of steering.
    for (let i = 0; i < 400 && fired === 0; i++) {
      const intent = controller.turnIntent(world, bot, 1 / 120);
      if (intent.fire) {
        fired++;
        world.fire(bot);
      } else {
        world.aim(bot, bot.angle + intent.aimDelta * 0.6);
        bot.power = Math.max(5, Math.min(100, bot.power + intent.powerDelta * 0.6));
      }
    }
    expect(fired).toBe(1);
    // Having fired, it must not ask to fire again this turn.
    expect(controller.turnIntent(world, bot, 1 / 120).fire).toBe(false);

    settleWorld(world);
    const events = world.drainEvents();
    expect(events.some((e) => e.kind === 'launch')).toBe(true);
    // A deadeye at this range should be doing damage, not landing in the desert.
    expect(target.hp).toBeLessThan(target.maxHp);
  });
});
