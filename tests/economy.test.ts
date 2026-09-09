/**
 * Round payouts, the kit a character brings, and the napalm nerf.
 */
import { describe, expect, it } from 'vitest';
import { TurnBasedMatch, type TurnBasedConfig } from '../src/core/rules/turnBased';
import { gameMode } from '../src/core/modes';
import { commanderById } from '../src/core/campaign/commanders';
import { startingAmmoFor } from '../src/core/characters';
import { weaponById } from '../src/core/weapons';
import { addLineTank, flatWorld, settleWorld, MAP_H, MAP_W } from './helpers';
import { UNIT, launchVelocity } from '../src/core/physics';

function config(overrides: Partial<TurnBasedConfig> = {}): TurnBasedConfig {
  return {
    mode: 'advanced',
    players: [
      { name: 'One', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line', commanderId: 'rook' },
      { name: 'Two', colour: 1, isBot: false, difficulty: 'gunner', tankClass: 'line', commanderId: 'sable' },
    ],
    rounds: 3,
    seed: 777,
    width: MAP_W,
    height: MAP_H,
    terrainStyle: 'basin',
    placement: 'random',
    ...overrides,
  };
}

/**
 * Kill `victim` outright, credited to `killer`, and let the match notice the
 * round is over. The kill reward comes from World.damage(), so the killer has to
 * be the other tank — crediting it to the victim pays nobody.
 */
function endRound(m: TurnBasedMatch, victimIndex: number, killerIndex: number): void {
  const victim = m.world.tanks[victimIndex];
  m.world.damage(victim, victim.hp + victim.shield, killerIndex, { x: victim.x, y: victim.y });
  // afterShot() runs once the world is idle and the settle timer has elapsed.
  m.phase = 'resolving';
  for (let i = 0; i < 120 && m.phase === 'resolving'; i++) {
    m.update({ aimDelta: 0, powerDelta: 0, moveX: 0, fire: false, fireHeld: false, cycleWeapon: 0, jump: false }, 1 / 60);
  }
}

describe('round payouts', () => {
  it('pays the loser a consolation so it can still shop', () => {
    const m = new TurnBasedMatch(config());
    const mode = gameMode('advanced');
    const before = m.world.tanks.map((t) => t.credits);
    endRound(m, 1, 0);

    expect(m.phase).toBe('roundOver');
    expect(m.lastRoundWinner).toBe(0);
    // Winner: the kill plus surviving. Loser: the consolation, nothing else.
    expect(m.world.tanks[0].credits - before[0]).toBe(mode.killReward + mode.survivalReward);
    expect(m.world.tanks[1].credits - before[1]).toBe(mode.lossReward);
  });

  it('the consolation is well short of the winner’s take', () => {
    const mode = gameMode('advanced');
    expect(mode.lossReward).toBeGreaterThan(0);
    expect(mode.lossReward * 3).toBeLessThanOrEqual(mode.killReward + mode.survivalReward);
  });

  it('every mode with a shop pays one', () => {
    for (const id of ['classic', 'modern', 'advanced'] as const) {
      const mode = gameMode(id);
      expect(mode.lossReward).toBeGreaterThan(0);
      expect(mode.lossReward).toBeLessThan(mode.killReward);
    }
  });
});

describe('character starting kit', () => {
  it('hands out the weapons the blurb promises', () => {
    const m = new TurnBasedMatch(config());
    const rook = m.world.tanks[0];
    const sable = m.world.tanks[1];
    // Rook brings heavy shells, Sable a railgun — both were campaign-only before.
    expect(rook.ammo.get('heavy')).toBe(4);
    expect(sable.ammo.get('railgun')).toBe(3);
    expect(sable.ammo.get('heavy')).toBe(2);
  });

  it('matches what the commander definition says', () => {
    const m = new TurnBasedMatch(config());
    for (const [i, id] of [[0, 'rook'], [1, 'sable']] as const) {
      for (const [wid, n] of commanderById(id).perk.startWeapons) {
        expect(m.world.tanks[i].ammo.get(wid)).toBe(n);
      }
    }
  });

  it('never issues a weapon the mode does not stock', () => {
    // Kilo starts with an airburst, which Classic does not sell.
    expect(startingAmmoFor('kilo', 'advanced').map(([id]) => id)).toContain('airburst');
    expect(startingAmmoFor('kilo', 'classic')).toHaveLength(0);
    const m = new TurnBasedMatch(
      config({
        mode: 'classic',
        players: [
          { name: 'A', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line', commanderId: 'kilo' },
          { name: 'B', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line', commanderId: 'vex' },
        ],
      }),
    );
    expect(m.world.tanks[0].ammo.has('airburst')).toBe(false);
  });

  it('gives a slot with no character nothing extra', () => {
    const m = new TurnBasedMatch(
      config({
        players: [
          { name: 'A', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
          { name: 'B', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line' },
        ],
      }),
    );
    expect([...m.world.tanks[0].ammo.keys()]).toEqual(['shell']);
  });
});

describe('napalm', () => {
  /** Fire `weaponId` straight down onto a tank and return the damage it took. */
  function pointBlank(weaponId: string): number {
    const w = flatWorld(5, 'advanced');
    const shooter = addLineTank(w, 0, 400);
    const victim = addLineTank(w, 1, 1200);
    shooter.ammo.set(weaponId, 5);
    shooter.selectedWeapon = weaponId;
    const full = victim.hp;
    // Drop it on the victim's roof rather than trusting a solver.
    const weapon = weaponById(weaponId);
    w.fireFrom({ x: victim.x, y: victim.y - 200 }, launchVelocity(-90, 40, weapon.speedScale), weapon, shooter.index);
    settleWorld(w);
    return full - victim.hp;
  }

  it('a direct hit no longer beats a nuke', () => {
    const napalm = pointBlank('napalm');
    const nuke = pointBlank('nuke');
    expect(napalm).toBeGreaterThan(0);
    expect(napalm).toBeLessThan(nuke);
  });

  it('a direct hit is in the same league as a heavy shell, not above a thermobaric', () => {
    const napalm = pointBlank('napalm');
    expect(napalm).toBeLessThan(pointBlank('thermobaric'));
    // It should still be worth firing.
    expect(napalm).toBeGreaterThan(25);
  });

  it('spreads its streams instead of stacking them on one spot', () => {
    const w = flatWorld(5, 'advanced');
    const shooter = addLineTank(w, 0, 300);
    const weapon = weaponById('napalm');
    w.fireFrom({ x: 1000, y: 300 }, launchVelocity(-90, 40, weapon.speedScale), weapon, shooter.index);
    settleWorld(w);
    const burns = w.drainEvents().filter((e) => e.kind === 'burn');
    expect(burns).toHaveLength(weapon.submunitions);
    const xs = burns.map((e) => (e as { at: { x: number } }).at.x);
    // The outermost streams are further apart than one blast diameter, so no
    // single hull can be inside all of them.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(weapon.radius * UNIT * 2);
  });
});
