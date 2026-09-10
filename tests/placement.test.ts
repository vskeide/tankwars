/**
 * Drop placement: who chooses, in what order, and where they may land.
 * The renderer half (a stuck key confirming the drop by itself) lives in
 * BattleScene and cannot be reached from here, but the rules half can.
 */
import { describe, expect, it } from 'vitest';
import { TurnBasedMatch, type TurnBasedConfig } from '../src/core/rules/turnBased';
import { MAP_H, MAP_W } from './helpers';

function config(overrides: Partial<TurnBasedConfig> = {}): TurnBasedConfig {
  return {
    mode: 'advanced',
    players: [
      { name: 'Human', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
      { name: 'Bot', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line' },
    ],
    rounds: 3,
    seed: 4711,
    width: MAP_W,
    height: MAP_H,
    terrainStyle: 'basin',
    placement: 'drop',
    countdown: 0,
    ...overrides,
  };
}

describe('drop placement', () => {
  it('asks the human and auto-places the bot', () => {
    const m = new TurnBasedMatch(config());
    expect(m.phase).toBe('placing');
    // Whoever is being asked is the human; the bot is already down.
    expect(m.placingTank!.isBot).toBe(false);
    expect(m.world.tanks.filter((t) => t.isBot).every((t) => t.placed)).toBe(true);
  });

  it('drop order is turn order', () => {
    const m = new TurnBasedMatch(config());
    const first = m.order[0];
    while (m.phase === 'placing') expect(m.placeAt(200 + m.order.indexOf(m.placingIndex) * 600)).toBe(true);
    expect(m.phase).toBe('aim');
    expect(m.current).toBe(first);
  });

  it('refuses a spot too close to a tank already down, and off the edges', () => {
    const m = new TurnBasedMatch(config());
    const down = m.world.tanks.find((t) => t.placed)!;
    expect(m.canPlaceAt(down.x)).toBe(false);
    expect(m.canPlaceAt(down.x + 40)).toBe(false);
    expect(m.canPlaceAt(down.x + 400)).toBe(true);
    const { min, max } = m.placeBounds();
    expect(m.canPlaceAt(min - 1)).toBe(false);
    expect(m.canPlaceAt(max + 1)).toBe(false);
    // A refused drop leaves the queue where it was.
    expect(m.placeAt(down.x)).toBe(false);
    expect(m.phase).toBe('placing');
  });

  it('asks again after the armoury, rather than placing for you', () => {
    const m = new TurnBasedMatch(config());
    while (m.phase === 'placing') m.placeAt(200 + m.order.indexOf(m.placingIndex) * 600);

    // End the round and walk the phases the way the scene does.
    const loser = m.world.tanks[1];
    m.world.damage(loser, loser.hp + loser.shield, 0, { x: loser.x, y: loser.y });
    m.phase = 'resolving';
    for (let i = 0; i < 120 && m.phase === 'resolving'; i++) {
      m.update({ aimDelta: 0, powerDelta: 0, moveX: 0, fire: false, fireHeld: false, cycleWeapon: 0, jump: false }, 1 / 60);
    }
    expect(m.phase).toBe('roundOver');
    m.proceedFromRoundOver();
    expect(m.phase).toBe('shop');

    m.finishShop();
    expect(m.phase).toBe('placing');
    expect(m.placingTank!.isBot).toBe(false);
    expect(m.placingTank!.placed).toBe(false);
  });

  it('random placement skips the phase entirely', () => {
    const m = new TurnBasedMatch(config({ placement: 'random' }));
    expect(m.phase).toBe('aim');
    expect(m.world.tanks.every((t) => t.placed)).toBe(true);
  });

  it('an all-bot match places itself even with drop placement on', () => {
    const m = new TurnBasedMatch(
      config({
        players: [
          { name: 'A', colour: 0, isBot: true, difficulty: 'gunner', tankClass: 'line' },
          { name: 'B', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line' },
        ],
      }),
    );
    expect(m.phase).toBe('aim');
  });
});
