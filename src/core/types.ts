/**
 * Shared value types for the pure game core.
 * NOTHING in src/core may import Phaser or touch the DOM — see AGENTS.md.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type GameModeId = 'classic' | 'modern' | 'advanced';

export type Difficulty = 'rookie' | 'gunner' | 'veteran' | 'deadeye';

/** How a projectile behaves once it leaves the barrel and once it lands. */
export type WeaponBehaviour =
  | 'shell' // plain explosive
  | 'cluster' // splits into fragments at apex
  | 'mirv' // splits into independently targeted warheads at apex
  | 'roller' // rolls downhill on impact, then detonates
  | 'digger' // tunnels into terrain before detonating
  | 'napalm' // spills burning fluid that flows and burns over time
  | 'railgun' // near-flat, wind-immune, terrain-piercing
  | 'nuke'; // very large radius

export interface TerrainStyle {
  id: string;
  name: string;
  /** 0..1 — how jagged the surface is. */
  roughness: number;
  /** 0..1 — average surface height as a fraction of the map height. */
  baseline: number;
  /** Whether loose dirt settles downwards after an explosion. */
  crumbles: boolean;
}
