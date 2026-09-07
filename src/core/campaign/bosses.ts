/**
 * Boss definitions. A boss is a large sprite anchored at a world position with
 * several hardpoints (each a Damageable in the World) and a scripted set of
 * attacks. Destroying every `core` hardpoint kills the boss.
 *
 * Offsets are in native pixels relative to the boss anchor (bottom-centre of
 * the sprite standing on the ground). Tuned against the extracted sheet
 * sprites: behemoth.r is ~150×120, juggernaut.r ~150×110.
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
  | { kind: 'drop'; interval: number };

export interface BossPhase {
  /** Phase begins when boss total HP fraction drops to or below this. */
  belowHp: number;
  /** Multiplier on all attack intervals (lower = faster). */
  tempo: number;
  /** Banner text when the phase starts. */
  banner: string;
  /** Hardpoint ids that become active in this phase. */
  activate: string[];
}

export interface BossDef {
  id: string;
  name: string;
  /** Sprite id in the atlas. */
  skin: string;
  /** Overall width used for spawn spacing. */
  width: number;
  hardpoints: HardpointDef[];
  phases: BossPhase[];
  /** Credits and campaign score for the kill. */
  bounty: number;
}

export const BOSSES: readonly BossDef[] = [
  {
    id: 'behemoth',
    name: 'Iron Behemoth',
    skin: 'boss.behemoth',
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
      { belowHp: 1.0, tempo: 1.0, banner: 'IRON BEHEMOTH', activate: ['gunL', 'gunR'] },
      { belowHp: 0.6, tempo: 0.8, banner: 'THE SPINE OPENS', activate: ['mortar'] },
      { belowHp: 0.3, tempo: 0.55, banner: 'REACTOR CRITICAL', activate: [] },
    ],
  },
  {
    id: 'juggernaut',
    name: 'Desert Juggernaut',
    skin: 'boss.juggernaut',
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
      { belowHp: 1.0, tempo: 1.0, banner: 'DESERT JUGGERNAUT', activate: ['quad'] },
      { belowHp: 0.7, tempo: 0.85, banner: 'ROCKETS ARMED', activate: ['rockets'] },
      { belowHp: 0.4, tempo: 0.6, banner: 'THE DRILL SPINS UP', activate: ['drill'] },
    ],
  },
];

export function bossById(id: string): BossDef {
  const b = BOSSES.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown boss: ${id}`);
  return b;
}
