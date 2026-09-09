/**
 * Mines and explosive barrels: the level furniture the campaign scatters.
 * Mines trip on proximity, barrels blow when shot, and a barrel's blast sets
 * off its neighbours so a row of them chains.
 */
import { describe, expect, it } from 'vitest';
import { addLineTank, flatWorld, GROUND_Y, settleWorld } from './helpers';
import { UNIT } from '../src/core/physics';
import { weaponById } from '../src/core/weapons';

describe('mines', () => {
  it('trips when a tank drives onto it and hurts the tank', () => {
    const w = flatWorld();
    const t = addLineTank(w, 0, 500);
    const mine = w.spawnHazard(700, 'mine');
    const fullHp = t.hp;

    // Well clear: nothing happens however long it sits there.
    for (let i = 0; i < 30; i++) w.step();
    expect(mine.alive).toBe(true);
    expect(t.hp).toBe(fullHp);

    // On top of it: the next step trips it.
    t.x = mine.x;
    w.step();
    expect(mine.alive).toBe(false);
    expect(mine.spent).toBe(true);
    expect(t.hp).toBeLessThan(fullHp);
    expect(w.hazards).toHaveLength(0);
  });

  it('reports being armed and being blown', () => {
    const w = flatWorld();
    const t = addLineTank(w, 0, 500);
    const mine = w.spawnHazard(700, 'mine');
    expect(w.drainEvents().some((e) => e.kind === 'hazardArmed')).toBe(true);

    t.x = mine.x;
    w.step();
    const blown = w.drainEvents().filter((e) => e.kind === 'hazardBlown');
    expect(blown).toHaveLength(1);
    expect(blown[0]).toMatchObject({ hazard: mine.id, hazardKind: 'mine' });
  });

  it('leaves a crater in the terrain where it went off', () => {
    const w = flatWorld();
    const t = addLineTank(w, 0, 500);
    const mine = w.spawnHazard(900, 'mine');
    const before = w.terrain.surfaceY(mine.x);
    t.x = mine.x;
    w.step();
    settleWorld(w);
    expect(w.terrain.surfaceY(mine.x)).toBeGreaterThan(before);
  });
});

describe('explosive barrels', () => {
  it('detonates when shot out rather than simply dying', () => {
    const w = flatWorld();
    const barrel = w.spawnHazard(800, 'barrel');
    const before = w.terrain.surfaceY(barrel.x);

    w.damage(barrel, barrel.maxHp, -1, { x: barrel.x, y: barrel.y });
    w.step();

    expect(barrel.spent).toBe(true);
    // A plain death would not move the ground; a detonation does.
    expect(w.terrain.surfaceY(barrel.x)).toBeGreaterThan(before);
  });

  it('chains along a row: one barrel takes the whole line with it', () => {
    const w = flatWorld();
    // Spaced inside the shell blast radius so each one reaches the next.
    const gap = Math.round(weaponById('shell').radius * UNIT * 0.7);
    const barrels = [0, 1, 2, 3].map((i) => w.spawnHazard(700 + i * gap, 'barrel'));

    w.damage(barrels[0], barrels[0].maxHp, -1, { x: barrels[0].x, y: barrels[0].y });
    w.step();

    expect(barrels.every((b) => b.spent)).toBe(true);
    expect(w.hazards).toHaveLength(0);
  });

  it('does not chain to a barrel parked well outside the blast', () => {
    const w = flatWorld();
    const near = w.spawnHazard(700, 'barrel');
    const far = w.spawnHazard(700 + 40 * weaponById('shell').radius, 'barrel');

    w.damage(near, near.maxHp, -1, { x: near.x, y: near.y });
    w.step();

    expect(near.spent).toBe(true);
    expect(far.spent).toBe(false);
    expect(far.alive).toBe(true);
  });

  it('a tank standing next to a barrel takes the blast', () => {
    const w = flatWorld();
    const t = addLineTank(w, 0, 800);
    const barrel = w.spawnHazard(t.x + 12 * UNIT, 'barrel');
    const fullHp = t.hp;

    w.damage(barrel, barrel.maxHp, -1, { x: barrel.x, y: barrel.y });
    w.step();

    expect(t.hp).toBeLessThan(fullHp);
  });

  it('sits on the surface it was spawned over', () => {
    const w = flatWorld();
    const barrel = w.spawnHazard(640, 'barrel');
    expect(barrel.y).toBe(GROUND_Y);
    expect(barrel.landed).toBe(true);
  });
});
