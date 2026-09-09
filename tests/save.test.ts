/**
 * Save games: a mid-match snapshot has to come back as the match that was
 * saved, not as a fresh round from the same seed. The terrain is the part most
 * likely to go wrong, since it is run-length encoded.
 */
import { describe, expect, it } from 'vitest';
import { restoreMatch, serialiseMatch, SAVE_VERSION } from '../src/core/save';
import { TurnBasedMatch, type TurnBasedConfig } from '../src/core/rules/turnBased';
import { MAP_H, MAP_W } from './helpers';

function config(overrides: Partial<TurnBasedConfig> = {}): TurnBasedConfig {
  return {
    mode: 'classic',
    players: [
      { name: 'One', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
      { name: 'Two', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'line' },
    ],
    rounds: 3,
    seed: 4242,
    width: MAP_W,
    height: MAP_H,
    terrainStyle: 'dunes',
    // Random placement, so the constructor finishes the round setup by itself.
    placement: 'random',
    ...overrides,
  };
}

/** A match with some history on it: a crater, damage, spent credits, a kill count. */
function playedMatch(): TurnBasedMatch {
  const m = new TurnBasedMatch(config());
  const [a, b] = m.world.tanks;
  m.world.terrain.carveCircle(a.x + 200, m.world.terrain.surfaceY(a.x + 200), 40);
  m.world.damage(b, 25, a.index, { x: b.x, y: b.y });
  a.credits = 1234;
  a.kills = 1;
  a.roundsWon = 2;
  a.angle = 47.5;
  a.power = 81;
  a.ammo.set('heavy', 3);
  a.selectedWeapon = 'heavy';
  m.round = 2;
  m.turn = 5;
  m.current = a.index;
  return m;
}

describe('serialiseMatch', () => {
  it('refuses to save while a shot is in the air', () => {
    const m = new TurnBasedMatch(config());
    m.currentTank.ammo.set('shell', -1);
    expect(m.world.fire(m.currentTank)).toBe(true);
    // Firing straight at the World leaves the match phase alone, so it is the
    // live-projectile check that has to refuse the save: nothing in flight is
    // serialised, and a save taken now would lose the shot.
    expect(m.world.projectiles.length).toBeGreaterThan(0);
    expect(serialiseMatch(m)).toBeNull();
  });

  it('refuses to save outside the aim phase', () => {
    const m = new TurnBasedMatch(config());
    m.phase = 'resolving';
    expect(serialiseMatch(m)).toBeNull();
  });

  it('saves during the aim phase', () => {
    const m = new TurnBasedMatch(config());
    expect(m.phase).toBe('aim');
    const s = serialiseMatch(m);
    expect(s).not.toBeNull();
    expect(s!.version).toBe(SAVE_VERSION);
  });
});

describe('restoreMatch', () => {
  it('round-trips the match state through JSON', () => {
    const m = playedMatch();
    const saved = JSON.parse(JSON.stringify(serialiseMatch(m)!));
    const r = restoreMatch(saved);

    expect(r.round).toBe(m.round);
    expect(r.turn).toBe(m.turn);
    expect(r.current).toBe(m.current);
    expect(r.phase).toBe('aim');
    expect(r.order).toEqual(m.order);
    expect(r.world.wind).toBe(m.world.wind);
  });

  it('round-trips every tank, ammo map included', () => {
    const m = playedMatch();
    const r = restoreMatch(JSON.parse(JSON.stringify(serialiseMatch(m)!)));

    m.world.tanks.forEach((orig, i) => {
      const back = r.world.tanks[i];
      expect(back.name).toBe(orig.name);
      expect(back.x).toBe(orig.x);
      expect(back.y).toBe(orig.y);
      expect(back.hp).toBe(orig.hp);
      expect(back.maxHp).toBe(orig.maxHp);
      expect(back.reinforcedHp).toBe(orig.reinforcedHp);
      expect(back.angle).toBeCloseTo(orig.angle, 5);
      expect(back.power).toBeCloseTo(orig.power, 5);
      expect(back.credits).toBe(orig.credits);
      expect(back.kills).toBe(orig.kills);
      expect(back.roundsWon).toBe(orig.roundsWon);
      expect(back.selectedWeapon).toBe(orig.selectedWeapon);
      expect([...back.ammo.entries()]).toEqual([...orig.ammo.entries()]);
    });
  });

  it('restores the damaged terrain, not a fresh one from the seed', () => {
    const m = playedMatch();
    const r = restoreMatch(JSON.parse(JSON.stringify(serialiseMatch(m)!)));

    expect(r.world.terrain.width).toBe(m.world.terrain.width);
    expect(r.world.terrain.height).toBe(m.world.terrain.height);
    expect(r.world.terrain.style.id).toBe(m.world.terrain.style.id);
    // Byte-for-byte: the crater carved above has to be in the restored map.
    expect(Array.from(r.world.terrain.mat)).toEqual(Array.from(m.world.terrain.mat));
  });

  it('resumes the same random stream, so the next wind roll matches', () => {
    const m = playedMatch();
    const r = restoreMatch(JSON.parse(JSON.stringify(serialiseMatch(m)!)));
    m.world.rollWind();
    r.world.rollWind();
    // The world's own rng is seeded from the match rng, which is restored, so
    // the two matches stay in step rather than diverging after a load.
    expect(r.rng.next()).toBe(m.rng.next());
  });

  it('keeps the match stats', () => {
    const m = playedMatch();
    const s = m.stats.get(0)!;
    s.shotsFired = 7;
    s.hits = 4;
    s.damageDealt = 210;
    s.damageTaken = 60;
    const r = restoreMatch(JSON.parse(JSON.stringify(serialiseMatch(m)!)));
    expect(r.stats.get(0)).toEqual({ shotsFired: 7, hits: 4, damageDealt: 210, damageTaken: 60 });
  });

  it('rejects a save from an incompatible version', () => {
    const m = new TurnBasedMatch(config());
    const saved = serialiseMatch(m)!;
    expect(() => restoreMatch({ ...saved, version: SAVE_VERSION + 99 })).toThrow();
  });
});
