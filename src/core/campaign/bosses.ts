/**
 * Boss definitions. A boss is a large sprite anchored at a world position with
 * several hardpoints (each a Damageable in the World) and a scripted set of
 * attacks. Destroying every `core` hardpoint kills the boss.
 *
 * Offsets are in design units (×UNIT in world pixels) relative to the boss
 * anchor — bottom-centre of the sprite on the ground. Tuned against the
 * tanks-v2 sheet: behemoth ~246×153 px drawn at 1×, juggernaut ~242×146.
 */
export interface HardpointDef {
  id: string;
  name: string;
  dx: number;
  dy: number;
  halfWidth: number;
  halfHeight: number;
  hp: number;
  /** Destroying all core hardpoints ends the boss. */
  core: boolean;
  /** Which attack this hardpoint performs, if any. */
  attack?: BossAttack;
}

export type BossAttack =
  /** Lobs `count` shells of `weapon` at the nearest player, one per `interval` seconds. */
  | { kind: 'barrage'; weapon: string; count: number; interval: number; spread: number }
  /** Launches a MIRV-style salvo straight up that splits over the players. */
  | { kind: 'mortar'; weapon: string; interval: number }
  /** Direct fire: flat fast shot at the nearest player, needs line of sight. */
  | { kind: 'direct'; weapon: string; interval: number }
  /** Drops a mine or crate-shaped hazard between the players. */
  | { kind: 'drop'; interval: number }
  /** Launches `count` drones that fly at the nearest player and detonate on contact. */
  | { kind: 'drone'; count: number; interval: number; hp: number };

export interface BossPhase {
  /** Phase begins when boss total HP fraction drops to or below this. */
  belowHp: number;
  /** Multiplier on all attack intervals (lower = faster). */
  tempo: number;
  /** Banner text when the phase starts. */
  banner: string;
  /** Hardpoint ids that become active in this phase. */
  activate: string[];
  /** Line the boss says when this phase opens, shown on its portrait card. */
  taunt?: string;
}

export interface BossDef {
  id: string;
  name: string;
  /** Sprite id in the atlas. */
  skin: string;
  /** Portrait id for the taunt card, if the sheet has one. */
  portrait?: string;
  /** Overall width used for spawn spacing. */
  width: number;
  hardpoints: HardpointDef[];
  phases: BossPhase[];
  /** Credits and campaign score for the kill. */
  bounty: number;
  /**
   * Emplacements (stationary defences) reuse the whole boss machinery for
   * hardpoint damage, attack scheduling and HP bars, but must not announce
   * themselves with a boss card.
   */
  quiet?: boolean;
}

export const BOSSES: readonly BossDef[] = [
  {
    id: 'behemoth',
    name: 'Iron Behemoth',
    skin: 'boss.behemoth',
    portrait: 'portrait.boss1',
    width: 150,
    bounty: 12000,
    hardpoints: [
      { id: 'core', name: 'Reactor Eye', dx: 0, dy: -62, halfWidth: 12, halfHeight: 10, hp: 260, core: true },
      { id: 'gunL', name: 'Port Cannon', dx: -52, dy: -84, halfWidth: 16, halfHeight: 8, hp: 110, core: false, attack: { kind: 'barrage', weapon: 'shell', count: 2, interval: 6.5, spread: 18 } },
      { id: 'gunR', name: 'Starboard Cannon', dx: 52, dy: -84, halfWidth: 16, halfHeight: 8, hp: 110, core: false, attack: { kind: 'barrage', weapon: 'shell', count: 2, interval: 6.5, spread: 18 } },
      { id: 'mortar', name: 'Spine Mortar', dx: 0, dy: -104, halfWidth: 14, halfHeight: 10, hp: 130, core: false, attack: { kind: 'mortar', weapon: 'cluster', interval: 10 } },
      { id: 'tracks', name: 'Drive Train', dx: 0, dy: -18, halfWidth: 70, halfHeight: 14, hp: 200, core: false },
    ],
    phases: [
      { belowHp: 1.0, tempo: 1.0, banner: 'IRON BEHEMOTH', activate: ['gunL', 'gunR'], taunt: 'You brought one tank. I am the pass.' },
      { belowHp: 0.6, tempo: 0.8, banner: 'THE SPINE OPENS', activate: ['mortar'], taunt: 'Then take the ridge from above.' },
      { belowHp: 0.3, tempo: 0.55, banner: 'REACTOR CRITICAL', activate: [], taunt: 'The eye still works. Come closer.' },
    ],
  },
  {
    id: 'juggernaut',
    name: 'Desert Juggernaut',
    skin: 'boss.juggernaut',
    portrait: 'portrait.boss2',
    width: 150,
    bounty: 16000,
    hardpoints: [
      { id: 'core', name: 'Command Eye', dx: 6, dy: -70, halfWidth: 11, halfHeight: 9, hp: 320, core: true },
      { id: 'quad', name: 'Quad Battery', dx: 48, dy: -92, halfWidth: 22, halfHeight: 12, hp: 170, core: false, attack: { kind: 'barrage', weapon: 'sabot', count: 3, interval: 7.5, spread: 10 } },
      { id: 'rockets', name: 'Rocket Rack', dx: -50, dy: -80, halfWidth: 16, halfHeight: 12, hp: 130, core: false, attack: { kind: 'mortar', weapon: 'mirv', interval: 13 } },
      { id: 'drill', name: 'Drill Prow', dx: 62, dy: -34, halfWidth: 18, halfHeight: 16, hp: 160, core: false, attack: { kind: 'direct', weapon: 'railgun', interval: 10 } },
      { id: 'tracks', name: 'Drive Train', dx: 0, dy: -18, halfWidth: 72, halfHeight: 14, hp: 220, core: false },
    ],
    phases: [
      { belowHp: 1.0, tempo: 1.0, banner: 'DESERT JUGGERNAUT', activate: ['quad'], taunt: 'Four barrels. One of them is enough.' },
      { belowHp: 0.7, tempo: 0.85, banner: 'ROCKETS ARMED', activate: ['rockets'], taunt: 'Racks open. There is no cover on this ridge.' },
      { belowHp: 0.4, tempo: 0.6, banner: 'THE DRILL SPINS UP', activate: ['drill'], taunt: 'I will come through the rock to reach you.' },
    ],
  },
  {
    id: 'hive',
    name: 'Hive Crawler',
    skin: 'boss.hive',
    portrait: 'portrait.boss3',
    width: 170,
    bounty: 20000,
    hardpoints: [
      { id: 'core', name: 'Brood Core', dx: 0, dy: -74, halfWidth: 12, halfHeight: 10, hp: 340, core: true },
      { id: 'trigun', name: 'Tri-Gun', dx: -46, dy: -86, halfWidth: 18, halfHeight: 10, hp: 150, core: false, attack: { kind: 'barrage', weapon: 'sabot', count: 3, interval: 6.5, spread: 14 } },
      { id: 'bay', name: 'Drone Bay', dx: 14, dy: -102, halfWidth: 18, halfHeight: 12, hp: 170, core: false, attack: { kind: 'drone', count: 2, interval: 9, hp: 26 } },
      { id: 'rockets', name: 'Spine Rockets', dx: 82, dy: -84, halfWidth: 16, halfHeight: 12, hp: 150, core: false, attack: { kind: 'mortar', weapon: 'mirv', interval: 12 } },
      { id: 'legs', name: 'Walking Gear', dx: 0, dy: -20, halfWidth: 76, halfHeight: 16, hp: 240, core: false },
    ],
    phases: [
      { belowHp: 1.0, tempo: 1.0, banner: 'HIVE CRAWLER', activate: ['trigun'], taunt: 'It walks. It does not need the pass.' },
      { belowHp: 0.65, tempo: 0.85, banner: 'THE BAY OPENS', activate: ['bay'], taunt: 'The bay is open. Count them if you like.' },
      { belowHp: 0.35, tempo: 0.6, banner: 'BROOD CORE EXPOSED', activate: ['rockets'], taunt: 'Every gun at once, then. Hold still.' },
    ],
  },
];

/**
 * Stationary defences: one core hardpoint each, quiet so they do not announce
 * themselves, sized to the sprites on the misc sheet. They have to be destroyed
 * to clear the level, like any other enemy.
 */
export const DEFENCES: readonly BossDef[] = [
  {
    id: 'turret',
    name: 'Gun Emplacement',
    skin: 'defense.turret',
    width: 34,
    bounty: 900,
    quiet: true,
    hardpoints: [
      {
        id: 'core',
        name: 'Gun Emplacement',
        dx: 0,
        dy: -14,
        halfWidth: 13,
        halfHeight: 12,
        hp: 90,
        core: true,
        attack: { kind: 'barrage', weapon: 'shell', count: 1, interval: 5.5, spread: 12 },
      },
    ],
    phases: [{ belowHp: 1.0, tempo: 1.0, banner: '', activate: ['core'] }],
  },
  {
    id: 'launcher',
    name: 'Missile Emplacement',
    skin: 'defense.launcher',
    width: 36,
    bounty: 1200,
    quiet: true,
    hardpoints: [
      {
        id: 'core',
        name: 'Missile Emplacement',
        dx: 0,
        dy: -14,
        halfWidth: 14,
        halfHeight: 13,
        hp: 110,
        core: true,
        attack: { kind: 'mortar', weapon: 'cluster', interval: 9 },
      },
    ],
    phases: [{ belowHp: 1.0, tempo: 1.0, banner: '', activate: ['core'] }],
  },
];

export function defenceById(id: string): BossDef {
  const d = DEFENCES.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown defence: ${id}`);
  return d;
}

export function bossById(id: string): BossDef {
  const b = BOSSES.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown boss: ${id}`);
  return b;
}
