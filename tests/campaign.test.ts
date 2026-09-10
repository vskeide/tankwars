/**
 * Campaign level scripting: stationary defences, scattered hazards, and the
 * Hive Crawler's drones (spawn from the bay, home in on a player, detonate).
 */
import { describe, expect, it } from 'vitest';
import { CampaignLevel } from '../src/core/rules/campaign';
import { LEVELS, levelById } from '../src/core/campaign/levels';
import { MAP_H, MAP_W } from './helpers';

function level(levelId: string): CampaignLevel {
  return new CampaignLevel({
    levelId,
    players: [{ name: 'P1', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' }],
    seed: 9182,
    width: MAP_W,
    height: MAP_H,
    commanderId: 'rook',
    difficultyId: 'soldier',
    countdown: 0,
  });
}

/** Run the level for `seconds` of simulated time with no player input. */
function run(c: CampaignLevel, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) c.update([], dt);
}

/**
 * Step until `done` holds, up to a cap. Drones only exist between launch and
 * detonation, so a test that wants to look at one has to stop while it is up.
 */
function runUntil(c: CampaignLevel, done: () => boolean, maxSeconds = 30): boolean {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(maxSeconds / dt); i++) {
    if (done()) return true;
    c.update([], dt);
  }
  return done();
}

/** Drop a boss to the given HP fraction so the later phases open. */
function softenBoss(c: CampaignLevel, fraction: number): void {
  for (const h of c.bosses[0].hardpoints.values()) h.hp = Math.round(h.maxHp * fraction);
}

describe('level furniture', () => {
  it('spawns the emplacements and hazards the level asks for', () => {
    const def = levelById('l07');
    const c = level('l07');
    expect(def.defences?.length).toBeGreaterThan(0);
    expect(c.defences).toHaveLength(def.defences!.length);
    const wantedHazards = (def.hazards ?? []).reduce((n, h) => n + (h.count ?? 1), 0);
    expect(c.world.hazards).toHaveLength(wantedHazards);
  });

  it('lists them in the intro roster', () => {
    const labels = level('l07').roster().map((r) => r.label);
    expect(labels).toContain('missile emplacement');
    expect(labels).toContain('mines');
    expect(labels).toContain('heavy armour');
  });

  it('an emplacement counts as an enemy: the level is not clear while it stands', () => {
    const c = level('l07');
    // Wipe the mobile enemies but leave the emplacement alone.
    for (const i of c.enemyIndices) c.world.tanks[i].alive = false;
    c.beginFight();
    run(c, 0.5);
    expect(c.phase).toBe('live');

    for (const d of c.defences) for (const h of d.hardpoints.values()) h.alive = false;
    run(c, 0.5);
    expect(c.phase).toBe('won');
  });

  it('emplacements are quiet: no boss card, no boss music', () => {
    const c = level('l07');
    expect(c.defences.every((d) => d.def.quiet)).toBe(true);
    expect(c.bosses.some((b) => !b.def.quiet)).toBe(false);
  });
});

describe('hive crawler drones', () => {
  const hiveLevel = LEVELS.find((l) => l.boss === 'hive')!;

  it('is in the campaign', () => {
    expect(hiveLevel).toBeDefined();
  });

  it('launches drones once the bay phase opens, and not before', () => {
    const c = level(hiveLevel.id);
    c.beginFight();
    const hive = c.bosses[0];
    run(c, 12);
    // Phase 0 has only the tri-gun; the bay is still shut.
    expect(hive.active.has('bay')).toBe(false);
    expect(c.drones).toHaveLength(0);

    // Chew it down into the drone phase.
    softenBoss(c, 0.5);
    expect(runUntil(c, () => c.drones.length > 0, 15)).toBe(true);
    expect(hive.active.has('bay')).toBe(true);
  });

  it('drones close on the player', () => {
    const c = level(hiveLevel.id);
    c.beginFight();
    softenBoss(c, 0.5);
    expect(runUntil(c, () => c.drones.length > 0, 15)).toBe(true);
    const drone = c.drones[0];

    const player = c.world.tanks[c.playerIndices[0]];
    const before = Math.abs(drone.hp.x - player.x);
    run(c, 1.5);
    const after = Math.abs(drone.hp.x - player.x);
    expect(after).toBeLessThan(before);
  });

  it('a drone detonates instead of loitering forever', () => {
    const c = level(hiveLevel.id);
    c.beginFight();
    softenBoss(c, 0.5);
    expect(runUntil(c, () => c.drones.length > 0, 15)).toBe(true);
    const drone = c.drones[0];
    // Long enough to cross the map and reach the player or the ground.
    run(c, 30);
    expect(drone.hp.alive).toBe(false);
  });

  it('the bay survives launching them: a boss does not blast its own mounts', () => {
    const c = level(hiveLevel.id);
    c.beginFight();
    softenBoss(c, 0.5);
    const bay = c.bosses[0].hardpoints.get('bay')!;
    const hp = bay.hp;
    expect(runUntil(c, () => c.drones.length > 0, 15)).toBe(true);
    run(c, 10);
    expect(bay.alive).toBe(true);
    expect(bay.hp).toBe(hp);
  });

  it('drones do not count towards the boss HP fraction', () => {
    const c = level(hiveLevel.id);
    c.beginFight();
    const hive = c.bosses[0];
    softenBoss(c, 0.5);
    expect(runUntil(c, () => c.drones.length > 0, 15)).toBe(true);
    // The drones live in their own list, not in the boss's hardpoint map.
    const ids = new Set([...hive.hardpoints.values()].map((h) => h.id));
    expect(c.drones.some((d) => ids.has(d.hp.id))).toBe(false);
  });
});
