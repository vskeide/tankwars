import type { GameModeId } from './types';

/**
 * A tank class. In `classic` every player drives the same hull (`line`), so the
 * only asymmetry is aim and wind — exactly like the original. `modern` and
 * `advanced` open the roster up.
 */
export interface TankClass {
  id: string;
  name: string;
  blurb: string;
  /** Starting and maximum hull integrity. */
  hp: number;
  /** Incoming damage multiplier. Below 1 is tougher. */
  armour: number;
  /** Shots per turn. */
  shots: number;
  /** Horizontal movement allowance per turn, in pixels. Ignored in classic. */
  fuel: number;
  /** Maximum slope the hull can climb, in degrees. */
  climb: number;
  /** Half-width and half-height of the collision box, in pixels. */
  halfWidth: number;
  halfHeight: number;
  /** Barrel length in pixels — cosmetic, but also the muzzle offset. */
  barrel: number;
  /** Credits earned multiplier at end of round. */
  salvage: number;
  /** Which modes offer this class. */
  modes: readonly GameModeId[];
  /** Silhouette used by the sprite generator. */
  silhouette: 'line' | 'light' | 'heavy' | 'artillery' | 'hover' | 'walker';
  /** Passive that the match logic applies. */
  perk: TankPerk;
}

export type TankPerk =
  | { kind: 'none' }
  /** Reduces blast damage taken while it has not moved this turn. */
  | { kind: 'dugIn'; reduction: number }
  /** Absorbs a flat amount of damage per round, regenerating each turn. */
  | { kind: 'shield'; capacity: number; regen: number }
  /** Extra credits at end of round. */
  | { kind: 'scavenger'; bonus: number }
  /** Wind affects this tank's shots less — stabilised barrel. */
  | { kind: 'stabilised'; windReduction: number }
  /** Takes no fall damage and may move over any slope. */
  | { kind: 'hover' };

export const TANK_CLASSES: readonly TankClass[] = [
  {
    id: 'line',
    name: 'Line Tank',
    blurb: 'The original. No tricks, no excuses.',
    hp: 100,
    armour: 1,
    shots: 1,
    fuel: 0,
    climb: 45,
    halfWidth: 11,
    halfHeight: 7,
    barrel: 15,
    salvage: 1,
    modes: ['classic', 'modern', 'advanced'],
    silhouette: 'line',
    perk: { kind: 'none' },
  },
  {
    id: 'scout',
    name: 'Scout',
    blurb: 'Fragile and fast. Two shots a turn and plenty of fuel.',
    hp: 74,
    armour: 1.2,
    shots: 2,
    fuel: 150,
    climb: 55,
    halfWidth: 9,
    halfHeight: 6,
    barrel: 12,
    salvage: 1.15,
    modes: ['modern', 'advanced'],
    silhouette: 'light',
    perk: { kind: 'scavenger', bonus: 350 },
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    blurb: 'Slab-sided and stubborn. Dig in and it barely notices a shell.',
    hp: 130,
    armour: 0.85,
    shots: 1,
    fuel: 55,
    climb: 32,
    halfWidth: 14,
    halfHeight: 9,
    barrel: 14,
    salvage: 0.9,
    modes: ['modern', 'advanced'],
    silhouette: 'heavy',
    perk: { kind: 'dugIn', reduction: 0.25 },
  },
  {
    id: 'battery',
    name: 'Battery',
    blurb: "Long stabilised barrel. The wind is somebody else's problem.",
    hp: 92,
    armour: 1.05,
    shots: 1,
    fuel: 70,
    climb: 38,
    halfWidth: 12,
    halfHeight: 7,
    barrel: 22,
    salvage: 1,
    modes: ['modern', 'advanced'],
    silhouette: 'artillery',
    perk: { kind: 'stabilised', windReduction: 0.55 },
  },
  {
    id: 'aegis',
    name: 'Aegis',
    blurb: 'Energy shield soaks the first hit each turn, then recharges.',
    hp: 86,
    armour: 1.1,
    shots: 1,
    fuel: 90,
    climb: 42,
    halfWidth: 11,
    halfHeight: 8,
    barrel: 16,
    salvage: 0.95,
    modes: ['advanced'],
    silhouette: 'hover',
    perk: { kind: 'shield', capacity: 45, regen: 18 },
  },
  {
    id: 'strider',
    name: 'Strider',
    blurb: 'Legged hull. Climbs anything, ignores the drop.',
    hp: 96,
    armour: 1,
    shots: 1,
    fuel: 130,
    climb: 90,
    halfWidth: 10,
    halfHeight: 11,
    barrel: 17,
    salvage: 1,
    modes: ['advanced'],
    silhouette: 'walker',
    perk: { kind: 'hover' },
  },
];

const BY_ID = new Map(TANK_CLASSES.map((t) => [t.id, t]));

export function tankClassById(id: string): TankClass {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown tank class: ${id}`);
  return t;
}

export function tankClassesForMode(mode: GameModeId): readonly TankClass[] {
  return TANK_CLASSES.filter((t) => t.modes.includes(mode));
}
