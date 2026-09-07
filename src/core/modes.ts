import type { GameModeId } from './types';

/**
 * The three modes are one data structure, not three code paths. Everything the
 * rules layer needs to branch on lives here, so adding a fourth mode is a
 * config edit rather than a refactor.
 */
export interface GameMode {
  id: GameModeId;
  name: string;
  tagline: string;
  /** Long-form description shown on the mode select screen. */
  description: string;

  /** Players pick a hull, or everyone drives the Line Tank. */
  tankClasses: boolean;
  /** Tanks may drive left and right on their turn. */
  movement: boolean;
  /** Between-round shop for weapons and repairs. */
  shop: boolean;
  /** Class perks (shields, dug-in, stabilised barrel) are active. */
  perks: boolean;
  /** Wind changes between turns rather than between rounds. */
  windPerTurn: boolean;
  /** Wind strength ceiling in px/s^2. */
  windMax: number;
  /** Tanks take damage when they fall. */
  fallDamage: boolean;
  /** Loose dirt settles after explosions on styles that allow it. */
  terrainCollapse: boolean;
  /** Starting credits. */
  startCredits: number;
  /** Credits per kill. */
  killReward: number;
  /** Credits for surviving a round. */
  survivalReward: number;
  /** Aim is remembered between turns rather than reset. */
  retainAim: boolean;
  /** Show the predicted trajectory before firing (training wheels). */
  aimAssist: 'off' | 'shortArc' | 'full';
}

export const GAME_MODES: readonly GameMode[] = [
  {
    id: 'classic',
    name: 'Classic',
    tagline: 'The 1991 rules, repainted.',
    description:
      'One hull, one shot, one wind reading per round. Angle and power are all you have. ' +
      'Six weapons, a shop between rounds, dirt that falls when you blow the ground out ' +
      'from under it. If you played the original, you already know this game.',
    tankClasses: false,
    movement: false,
    shop: true,
    perks: false,
    windPerTurn: false,
    windMax: 55,
    fallDamage: false,
    terrainCollapse: true,
    startCredits: 2500,
    killReward: 1400,
    survivalReward: 500,
    retainAim: true,
    aimAssist: 'off',
  },
  {
    id: 'modern',
    name: 'Modern',
    tagline: 'Hulls, a real armoury, live wind.',
    description:
      'Pick a hull with its own armour, shot count and passive. Twelve weapons including ' +
      'MIRV, napalm and a wind-immune railgun. Wind rerolls every turn, so the shot that ' +
      'worked last time will not work now. Tanks take fall damage.',
    tankClasses: true,
    movement: false,
    shop: true,
    perks: true,
    windPerTurn: true,
    windMax: 80,
    fallDamage: true,
    terrainCollapse: true,
    startCredits: 3200,
    killReward: 1600,
    survivalReward: 600,
    retainAim: true,
    aimAssist: 'shortArc',
  },
  {
    id: 'advanced',
    name: 'Advanced',
    tagline: 'Move, shield, bury, reshape.',
    description:
      'Everything in Modern plus fuel: drive along the ridge, break line of sight, dig in. ' +
      'Shields, legged hulls, an Earthmover that builds terrain instead of removing it, and ' +
      'the full fifteen-weapon armoury. Positioning matters as much as aim.',
    tankClasses: true,
    movement: true,
    shop: true,
    perks: true,
    windPerTurn: true,
    windMax: 95,
    fallDamage: true,
    terrainCollapse: true,
    startCredits: 4000,
    killReward: 1800,
    survivalReward: 700,
    retainAim: true,
    aimAssist: 'shortArc',
  },
];

const BY_ID = new Map(GAME_MODES.map((m) => [m.id, m]));

export function gameMode(id: GameModeId): GameMode {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown mode: ${id}`);
  return m;
}
