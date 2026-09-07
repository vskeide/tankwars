/**
 * Campaign structure: a linear route of levels across three biomes, each level a
 * scripted encounter — enemy tanks with fixed classes and difficulty, optional
 * stationary defences, and every fourth level a boss. Real-time rules (the
 * arena layer) so bosses can act continuously.
 */
export type EnemyKind = 'light' | 'medium' | 'heavy' | 'missile' | 'flame';

export interface EnemyDef {
  kind: EnemyKind;
  /** Bot difficulty. */
  difficulty: 'rookie' | 'gunner' | 'veteran' | 'deadeye';
  /** Spawn column as a fraction of the map width. */
  at: number;
}

export interface LevelDef {
  id: string;
  name: string;
  biome: 'dunes' | 'mesas' | 'crags' | 'basin' | 'spires';
  /** Intro line shown before the fight. */
  brief: string;
  enemies: EnemyDef[];
  /** Boss id, if this is a boss level. */
  boss?: string;
  /** Seconds between crate drops (0 = none). */
  crateInterval: number;
  /** Credits awarded on clearing the level. */
  reward: number;
  /** Player starts at this fraction of the map width. */
  playerAt: number;
}

/** Enemy kind → tank class + stat tweaks. Enemies use the red sheet sprites. */
export const ENEMY_CLASS: Record<EnemyKind, { cls: string; hpScale: number; skin: string }> = {
  light: { cls: 'scout', hpScale: 0.8, skin: 'enemy.light' },
  medium: { cls: 'line', hpScale: 1.0, skin: 'enemy.medium' },
  heavy: { cls: 'bulwark', hpScale: 1.1, skin: 'enemy.heavy' },
  missile: { cls: 'battery', hpScale: 0.9, skin: 'enemy.missile' },
  flame: { cls: 'line', hpScale: 0.9, skin: 'enemy.flame' },
};

export const LEVELS: readonly LevelDef[] = [
  { id: 'l01', name: 'First Light', biome: 'dunes', brief: 'A lone picket on the dunes. Learn the wind.', enemies: [{ kind: 'light', difficulty: 'rookie', at: 0.78 }], crateInterval: 14, reward: 1500, playerAt: 0.15 },
  { id: 'l02', name: 'Two Guns', biome: 'dunes', brief: 'They have started to dig in. Hit the medium first.', enemies: [{ kind: 'light', difficulty: 'rookie', at: 0.6 }, { kind: 'medium', difficulty: 'gunner', at: 0.85 }], crateInterval: 12, reward: 2000, playerAt: 0.12 },
  { id: 'l03', name: 'Salt Wind', biome: 'basin', brief: 'Flat ground, hard wind. The railgun ignores it.', enemies: [{ kind: 'medium', difficulty: 'gunner', at: 0.55 }, { kind: 'missile', difficulty: 'gunner', at: 0.88 }], crateInterval: 10, reward: 2600, playerAt: 0.1 },
  { id: 'b01', name: 'Iron Behemoth', biome: 'mesas', brief: 'The Behemoth guards the pass. Kill the cannons, then the eye.', enemies: [], boss: 'behemoth', crateInterval: 8, reward: 6000, playerAt: 0.14 },
  { id: 'l05', name: 'Red Mesas', biome: 'mesas', brief: 'High ground everywhere. Rollers find the valleys.', enemies: [{ kind: 'heavy', difficulty: 'gunner', at: 0.5 }, { kind: 'light', difficulty: 'veteran', at: 0.8 }], crateInterval: 10, reward: 3000, playerAt: 0.1 },
  { id: 'l06', name: 'Burning Ground', biome: 'mesas', brief: 'Flame tanks. Keep your distance and dig.', enemies: [{ kind: 'flame', difficulty: 'veteran', at: 0.45 }, { kind: 'flame', difficulty: 'gunner', at: 0.7 }, { kind: 'missile', difficulty: 'veteran', at: 0.9 }], crateInterval: 9, reward: 3600, playerAt: 0.08 },
  { id: 'l07', name: 'Iron Crags', biome: 'crags', brief: 'Rock does not fall. Tunnel through it.', enemies: [{ kind: 'heavy', difficulty: 'veteran', at: 0.55 }, { kind: 'heavy', difficulty: 'veteran', at: 0.85 }], crateInterval: 9, reward: 4000, playerAt: 0.1 },
  { id: 'b02', name: 'Desert Juggernaut', biome: 'crags', brief: 'Quad guns, rockets, and a drill that punches through ridges.', enemies: [], boss: 'juggernaut', crateInterval: 7, reward: 9000, playerAt: 0.12 },
  { id: 'l09', name: 'Ash Spires', biome: 'spires', brief: 'Spires collapse when hit. Bring them down on their heads.', enemies: [{ kind: 'missile', difficulty: 'veteran', at: 0.5 }, { kind: 'medium', difficulty: 'deadeye', at: 0.7 }, { kind: 'light', difficulty: 'veteran', at: 0.9 }], crateInterval: 8, reward: 4500, playerAt: 0.08 },
  { id: 'l10', name: 'Column', biome: 'spires', brief: 'An armoured column. Crates are your only resupply.', enemies: [{ kind: 'heavy', difficulty: 'deadeye', at: 0.45 }, { kind: 'heavy', difficulty: 'veteran', at: 0.65 }, { kind: 'missile', difficulty: 'deadeye', at: 0.88 }], crateInterval: 7, reward: 5200, playerAt: 0.08 },
  { id: 'l11', name: 'Last Ridge', biome: 'spires', brief: 'Everything they have left.', enemies: [{ kind: 'flame', difficulty: 'deadeye', at: 0.4 }, { kind: 'heavy', difficulty: 'deadeye', at: 0.6 }, { kind: 'missile', difficulty: 'deadeye', at: 0.78 }, { kind: 'light', difficulty: 'deadeye', at: 0.92 }], crateInterval: 7, reward: 6000, playerAt: 0.06 },
  { id: 'b03', name: 'Both of Them', biome: 'spires', brief: 'The Behemoth and the Juggernaut, together. Good luck.', enemies: [], boss: 'behemoth+juggernaut', crateInterval: 6, reward: 15000, playerAt: 0.1 },
];

export function levelById(id: string): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level: ${id}`);
  return l;
}
