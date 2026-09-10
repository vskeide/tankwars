/**
 * The hold before the first shot. A round used to open with a bot firing the
 * instant the tanks were down, or a human firing by accident with a finger
 * still resting from the drop. Aiming is allowed during the hold; nothing else.
 */
import { describe, expect, it } from 'vitest';
import { TurnBasedMatch, type TurnBasedConfig } from '../src/core/rules/turnBased';
import { CampaignLevel } from '../src/core/rules/campaign';
import type { Intent } from '../src/core/input';
import { MAP_H, MAP_W } from './helpers';

const idle: Intent = { aimDelta: 0, powerDelta: 0, moveX: 0, fire: false, fireHeld: false, cycleWeapon: 0, jump: false };

function config(overrides: Partial<TurnBasedConfig> = {}): TurnBasedConfig {
  return {
    mode: 'advanced',
    players: [
      { name: 'A', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
      { name: 'B', colour: 1, isBot: false, difficulty: 'gunner', tankClass: 'line' },
    ],
    rounds: 3,
    seed: 99,
    width: MAP_W,
    height: MAP_H,
    terrainStyle: 'basin',
    placement: 'random',
    ...overrides,
  };
}

function run(m: TurnBasedMatch, seconds: number, intent: Intent = idle): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) m.update({ ...intent }, 1 / 60);
}

describe('turn-based countdown', () => {
  it('holds for three seconds by default once the tanks are down', () => {
    const m = new TurnBasedMatch(config());
    expect(m.phase).toBe('countdown');
    expect(m.countdown).toBe(3);
    run(m, 2.5);
    expect(m.phase).toBe('countdown');
    run(m, 0.6);
    expect(m.phase).toBe('aim');
  });

  it('ignores fire and drive during the hold', () => {
    const m = new TurnBasedMatch(config());
    const t = m.currentTank;
    const x0 = t.x;
    const fuel0 = t.fuel;
    run(m, 0.5, { ...idle, fire: true, moveX: 1 });
    expect(m.world.projectiles).toHaveLength(0);
    expect(m.phase).toBe('countdown');
    expect(t.x).toBe(x0);
    expect(t.fuel).toBe(fuel0);
  });

  it('lets the player aim and set power while waiting', () => {
    const m = new TurnBasedMatch(config());
    const t = m.currentTank;
    const a0 = t.angle;
    const p0 = t.power;
    run(m, 0.5, { ...idle, aimDelta: 1, powerDelta: 1 });
    expect(t.angle).not.toBe(a0);
    expect(t.power).not.toBe(p0);
  });

  it('follows drop placement too: the hold starts after the last tank lands', () => {
    const m = new TurnBasedMatch(config({ placement: 'drop' }));
    expect(m.phase).toBe('placing');
    while (m.phase === 'placing') m.placeAt(200 + m.order.indexOf(m.placingIndex) * 600);
    expect(m.phase).toBe('countdown');
  });

  it('can be switched off', () => {
    const m = new TurnBasedMatch(config({ countdown: 0 }));
    expect(m.phase).toBe('aim');
  });
});

describe('campaign countdown', () => {
  function level(countdown?: number): CampaignLevel {
    return new CampaignLevel({
      levelId: 'l01',
      players: [{ name: 'P1', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' }],
      seed: 5,
      width: MAP_W,
      height: MAP_H,
      commanderId: 'rook',
      difficultyId: 'soldier',
      ...(countdown === undefined ? {} : { countdown }),
    });
  }

  it('closing the briefing starts a hold, not the fight', () => {
    const c = level();
    c.beginFight();
    expect(c.phase).toBe('countdown');
    for (let i = 0; i < 60 * 2.5; i++) c.update([], 1 / 60);
    expect(c.phase).toBe('countdown');
    for (let i = 0; i < 60 * 0.6; i++) c.update([], 1 / 60);
    expect(c.phase).toBe('live');
  });

  it('can be switched off', () => {
    const c = level(0);
    c.beginFight();
    expect(c.phase).toBe('live');
  });
});
