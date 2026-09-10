/**
 * Characters outside the campaign: the hull they bring, the fuel they add, the
 * shield capacity the HUD scales against, and driving on after the shot is away.
 */
import { describe, expect, it } from 'vitest';
import { TurnBasedMatch, type TurnBasedConfig } from '../src/core/rules/turnBased';
import { shieldCapacity, SHIELD_CRATE_AMOUNT } from '../src/core/world';
import { tankClassById } from '../src/core/tanks';
import { commanderById } from '../src/core/campaign/commanders';
import { addLineTank, flatWorld, MAP_H, MAP_W } from './helpers';

function config(overrides: Partial<TurnBasedConfig> = {}): TurnBasedConfig {
  return {
    mode: 'advanced',
    players: [
      { name: 'One', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'aegis', commanderId: 'kilo' },
      { name: 'Two', colour: 1, isBot: false, difficulty: 'gunner', tankClass: 'bulwark', commanderId: 'grimm' },
    ],
    rounds: 3,
    seed: 20260909,
    width: MAP_W,
    height: MAP_H,
    terrainStyle: 'basin',
    placement: 'random',
    countdown: 0,
    ...overrides,
  };
}

describe('shieldCapacity', () => {
  it('is the hull capacity for a shield hull', () => {
    const w = flatWorld(1, 'advanced');
    const t = addLineTank(w, 0, 500);
    t.cls = tankClassById('aegis');
    expect(shieldCapacity(t)).toBe(45);
  });

  it('falls back to the crate amount for a hull with no shield of its own', () => {
    const w = flatWorld(1, 'advanced');
    const t = addLineTank(w, 0, 500);
    expect(t.cls.perk.kind).not.toBe('shield');
    expect(shieldCapacity(t)).toBe(SHIELD_CRATE_AMOUNT);
  });

  it('never reads below what the tank is carrying, so a bar cannot overflow', () => {
    const w = flatWorld(1, 'advanced');
    const t = addLineTank(w, 0, 500);
    t.shield = 200;
    expect(shieldCapacity(t)).toBe(200);
    expect(t.shield / shieldCapacity(t)).toBe(1);
  });

  it('an Aegis starts a round at full charge, which now reads as a full bar', () => {
    const m = new TurnBasedMatch(config());
    const aegis = m.world.tanks[0];
    expect(aegis.cls.id).toBe('aegis');
    expect(aegis.shield).toBe(45);
    expect(aegis.shield / shieldCapacity(aegis)).toBe(1);
  });
});

describe('character fuel', () => {
  it('adds the character bonus on top of the hull', () => {
    const m = new TurnBasedMatch(config());
    const [kilo, grimm] = m.world.tanks;
    expect(kilo.cls.fuel).toBe(tankClassById('aegis').fuel + commanderById('kilo').perk.fuelBonus);
    expect(grimm.cls.fuel).toBe(tankClassById('bulwark').fuel + commanderById('grimm').perk.fuelBonus);
    // Grimm adds nothing, Kilo adds plenty: the characters differ in range.
    expect(kilo.cls.fuel).toBeGreaterThan(grimm.cls.fuel);
  });

  it('leaves a slot with no character on the plain hull', () => {
    const m = new TurnBasedMatch(
      config({ players: [{ name: 'A', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'aegis' }, { name: 'B', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line' }] }),
    );
    expect(m.world.tanks[0].cls.fuel).toBe(tankClassById('aegis').fuel);
  });

  it('does not hand out the rest of the commander perk outside the campaign', () => {
    const m = new TurnBasedMatch(config());
    const kilo = m.world.tanks[0];
    const hull = tankClassById('aegis');
    // Fuel is the only thing a character changes here: HP and armour stay stock.
    expect(kilo.maxHp).toBe(hull.hp);
    expect(kilo.cls.armour).toBe(hull.armour);
  });
});

describe('driving while the shot resolves', () => {
  /** Fire the current tank, then hold a drive input for `steps` frames. */
  function fireThenDrive(m: TurnBasedMatch, moveX: number, steps: number) {
    const t = m.currentTank;
    m.world.aim(t, 70);
    m.world.setPower(t, 85);
    m.update({ aimDelta: 0, powerDelta: 0, moveX: 0, fire: true, fireHeld: false, cycleWeapon: 0, jump: false }, 1 / 60);
    const start = { x: t.x, fuel: t.fuel, phase: m.phase };
    for (let i = 0; i < steps; i++) {
      m.update({ aimDelta: 0, powerDelta: 0, moveX, fire: false, fireHeld: false, cycleWeapon: 0, jump: false }, 1 / 60);
    }
    return { start, x: t.x, fuel: t.fuel, phase: m.phase, tank: t };
  }

  it('spends fuel and moves the shooter while the shell is in the air', () => {
    const m = new TurnBasedMatch(config());
    const r = fireThenDrive(m, 1, 60);
    expect(r.start.phase).toBe('resolving');
    expect(r.phase).toBe('resolving');
    expect(r.x).toBeGreaterThan(r.start.x);
    expect(r.fuel).toBeLessThan(r.start.fuel);
  });

  it('stops when the fuel runs out, like driving in the aim phase', () => {
    const m = new TurnBasedMatch(config());
    m.currentTank.fuel = 5;
    const r = fireThenDrive(m, 1, 120);
    expect(r.fuel).toBe(0);
    // Five pixels of fuel buys five pixels of travel, no more.
    expect(r.x - r.start.x).toBeLessThanOrEqual(5);
  });

  it('does not drive in a mode without movement', () => {
    const m = new TurnBasedMatch(
      config({
        mode: 'classic',
        players: [
          { name: 'One', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
          { name: 'Two', colour: 1, isBot: false, difficulty: 'gunner', tankClass: 'line' },
        ],
      }),
    );
    expect(m.mode.movement).toBe(false);
    const r = fireThenDrive(m, 1, 60);
    expect(r.x).toBe(r.start.x);
  });
});
