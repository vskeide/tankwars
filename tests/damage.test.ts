import { describe, it, expect } from 'vitest';
import { blastFalloff } from '../src/core/physics';
import type { WorldEvent } from '../src/core/world';
import { weaponById } from '../src/core/weapons';
import { addLineTank, flatWorld, settleWorld } from './helpers';

function eventsOfKind<K extends WorldEvent['kind']>(events: readonly WorldEvent[], kind: K) {
  return events.filter((e): e is Extract<WorldEvent, { kind: K }> => e.kind === kind);
}

describe('blastFalloff', () => {
  it('is full at the centre and nothing at or beyond the rim', () => {
    expect(blastFalloff(0, 50)).toBe(1);
    expect(blastFalloff(50, 50)).toBe(0);
    expect(blastFalloff(75, 50)).toBe(0);
  });

  it('decreases monotonically across the radius', () => {
    let previous = Infinity;
    for (let d = 0; d < 50; d += 0.5) {
      const f = blastFalloff(d, 50);
      expect(f).toBeLessThan(previous);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
      previous = f;
    }
  });

  it('has the soft shoulder a smoothstep gives: a near miss still stings', () => {
    // Half way out, smoothstep is still exactly half — a linear falloff would
    // also be, but the quarter and three-quarter points show the S curve.
    expect(blastFalloff(25, 50)).toBeCloseTo(0.5, 6);
    expect(blastFalloff(12.5, 50)).toBeGreaterThan(0.75);
    expect(blastFalloff(37.5, 50)).toBeLessThan(0.25);
  });

  it('scales with radius rather than absolute distance', () => {
    expect(blastFalloff(20, 40)).toBeCloseTo(blastFalloff(40, 80), 12);
  });
});

describe('World.damage', () => {
  const setup = () => {
    const world = flatWorld();
    const shooter = addLineTank(world, 0, 400);
    const target = addLineTank(world, 1, 900);
    world.drainEvents();
    return { world, shooter, target };
  };

  it('spends the shield before it touches HP', () => {
    const { world, shooter, target } = setup();
    target.shield = 20;
    const hp0 = target.hp;

    world.damage(target, 50, shooter.index, { x: target.x, y: target.y });

    expect(target.shield).toBe(0);
    expect(target.hp).toBe(hp0 - 30);
    const [ev] = eventsOfKind(world.drainEvents(), 'damage');
    expect(ev).toMatchObject({ target: target.id, amount: 30, shieldAbsorbed: 20, hpAfter: hp0 - 30, by: shooter.index });
  });

  it('takes a hit entirely on the shield when the shield is deep enough', () => {
    const { world, shooter, target } = setup();
    target.shield = 90;
    const hp0 = target.hp;

    world.damage(target, 40, shooter.index, { x: target.x, y: target.y });

    expect(target.shield).toBe(50);
    expect(target.hp).toBe(hp0);
    const [ev] = eventsOfKind(world.drainEvents(), 'damage');
    expect(ev.amount).toBe(0);
    expect(ev.shieldAbsorbed).toBe(40);
  });

  it('burns Reinforced Hull down by the HP actually lost', () => {
    const { world, shooter, target } = setup();
    target.reinforcedHp = 40;
    world.resetTankForRound(target); // rolls the bonus into maxHp / hp
    expect(target.maxHp).toBe(target.cls.hp + 40);
    expect(target.hp).toBe(target.maxHp);

    world.damage(target, 25, shooter.index, { x: target.x, y: target.y });
    expect(target.reinforcedHp).toBe(15);

    // The shield eats first, so the bonus only loses what got through to HP.
    target.shield = 10;
    world.damage(target, 20, shooter.index, { x: target.x, y: target.y });
    expect(target.reinforcedHp).toBe(5);

    // It floors at zero rather than going negative on an overkill.
    world.damage(target, 500, shooter.index, { x: target.x, y: target.y });
    expect(target.reinforcedHp).toBe(0);
  });

  it('keeps the bonus across a round reset but never regenerates it', () => {
    const { world, shooter, target } = setup();
    target.reinforcedHp = 40;
    world.resetTankForRound(target);
    world.damage(target, 30, shooter.index, { x: target.x, y: target.y });

    world.respawnTank(target, 900);

    expect(target.reinforcedHp).toBe(10);
    expect(target.maxHp).toBe(target.cls.hp + 10);
    expect(target.hp).toBe(target.maxHp);
  });

  it('emits kill, credits the shooter and stops counting the tank as alive', () => {
    const { world, shooter, target } = setup();
    const credits0 = shooter.credits;

    world.damage(target, target.hp + 10, shooter.index, { x: target.x, y: target.y });

    expect(target.alive).toBe(false);
    expect(target.hp).toBe(0);
    expect(shooter.kills).toBe(1);
    expect(shooter.credits).toBe(credits0 + world.mode.killReward);
    expect(world.aliveTanks().map((t) => t.index)).toEqual([shooter.index]);

    const events = world.drainEvents();
    expect(eventsOfKind(events, 'kill')).toHaveLength(1);
    expect(eventsOfKind(events, 'kill')[0]).toMatchObject({ target: target.id, by: shooter.index });
  });

  it('gives no kill credit for shooting yourself', () => {
    const { world, shooter } = setup();
    const credits0 = shooter.credits;
    world.damage(shooter, shooter.hp, shooter.index, { x: shooter.x, y: shooter.y });
    expect(shooter.alive).toBe(false);
    expect(shooter.kills).toBe(0);
    expect(shooter.credits).toBe(credits0);
  });
});

describe('blast damage through the world', () => {
  it('hurts the tank under the crater more than its neighbour', () => {
    const world = flatWorld();
    const near = addLineTank(world, 0, 900);
    const far = addLineTank(world, 1, 945);
    world.drainEvents();

    // Drop a plain shell straight down onto the near tank. Owner -1 is a
    // scripted shot with no shooter, so nobody collects a kill.
    const from = { x: near.x, y: near.y - near.halfHeight * 2 - 40 };
    world.fireFrom(from, { x: 0, y: 200 }, weaponById('shell'), -1);
    const steps = settleWorld(world);
    expect(steps).toBeGreaterThan(0);
    expect(world.projectiles).toHaveLength(0);

    const events = world.drainEvents();
    expect(eventsOfKind(events, 'explode')).toHaveLength(1);
    const nearLoss = near.maxHp - near.hp;
    const farLoss = far.maxHp - far.hp;
    expect(nearLoss).toBeGreaterThan(farLoss);
    expect(farLoss).toBeGreaterThan(0);
    // Full damage at the centre is the weapon's own damage figure.
    expect(nearLoss).toBe(weaponById('shell').damage);
  });

  it('leaves a tank well outside the radius untouched', () => {
    const world = flatWorld();
    const target = addLineTank(world, 0, 300);
    const bystander = addLineTank(world, 1, 900);
    world.drainEvents();

    const from = { x: target.x, y: target.y - target.halfHeight * 2 - 40 };
    world.fireFrom(from, { x: 0, y: 200 }, weaponById('shell'), -1);
    settleWorld(world);

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(bystander.hp).toBe(bystander.maxHp);
  });
});
