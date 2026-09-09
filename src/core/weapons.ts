import type { GameModeId, WeaponBehaviour } from './types';

export interface Weapon {
  id: string;
  name: string;
  /** Short line shown in the shop and the weapon selector. */
  blurb: string;
  behaviour: WeaponBehaviour;
  /** Peak damage at the centre of the blast. */
  damage: number;
  /** Blast radius in pixels. */
  radius: number;
  /** Shots bought per purchase. -1 means unlimited. */
  ammoPerBuy: number;
  /** Cost per purchase in credits. 0 means it is free and unlimited. */
  cost: number;
  /** Fragments for cluster/mirv/napalm behaviours. */
  submunitions: number;
  /** 0 = ignores wind, 1 = full wind. */
  windFactor: number;
  gravityFactor: number;
  /** Launch speed multiplier — railguns fly flat and fast. */
  speedScale: number;
  /** Which modes this weapon exists in. */
  modes: readonly GameModeId[];
  /** Trail colour key hint for the renderer. */
  trail: 'spark' | 'smoke' | 'plasma' | 'fire' | 'none';
}

/**
 * The armoury. `classic` keeps close to the DOS original's shot list; `modern`
 * adds the guided and area weapons; `advanced` adds the utility and terrain
 * weapons that only make sense once tanks can move and shield themselves.
 */
export const WEAPONS: readonly Weapon[] = [
  {
    id: 'shell',
    name: 'Standard Shell',
    blurb: 'Free, unlimited, always in the rack.',
    behaviour: 'shell',
    damage: 32,
    radius: 26,
    ammoPerBuy: -1,
    cost: 0,
    submunitions: 0,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'spark',
  },
  {
    id: 'heavy',
    name: 'Heavy Shell',
    blurb: 'Twice the punch, falls harder, fights the wind less.',
    behaviour: 'shell',
    damage: 58,
    radius: 38,
    ammoPerBuy: 5,
    cost: 900,
    submunitions: 0,
    windFactor: 0.7,
    gravityFactor: 1.25,
    speedScale: 2.85,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'spark',
  },
  {
    id: 'cluster',
    name: 'Cluster Bomb',
    blurb: 'Splits at apex into five bomblets. Wide, shallow, cruel.',
    behaviour: 'cluster',
    // Nerfed on feedback that it was too strong: full-spread max damage was
    // 100 (5 x 20) for 1200cr/4 shots — cheaper and more forgiving than a
    // direct hit with anything else in the rack. Down to a 70-damage ceiling,
    // tighter radius, and a higher price.
    damage: 14,
    radius: 18,
    ammoPerBuy: 3,
    cost: 1600,
    submunitions: 5,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'smoke',
  },
  {
    id: 'roller',
    name: 'Hill Roller',
    blurb: 'Lands, rolls downhill, detonates in the valley.',
    behaviour: 'roller',
    damage: 40,
    radius: 30,
    ammoPerBuy: 5,
    cost: 1000,
    submunitions: 0,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'smoke',
  },
  {
    id: 'digger',
    name: 'Digger',
    blurb: 'Tunnels into the ground before it blows. Cracks dug-in tanks.',
    behaviour: 'digger',
    damage: 46,
    radius: 30,
    ammoPerBuy: 4,
    cost: 1100,
    submunitions: 0,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'spark',
  },
  {
    id: 'nuke',
    name: 'Tactical Nuke',
    blurb: 'Reshapes the map. Mind the fallout radius on your own hull.',
    behaviour: 'nuke',
    damage: 110,
    radius: 92,
    ammoPerBuy: 1,
    cost: 4200,
    submunitions: 0,
    windFactor: 0.85,
    gravityFactor: 1.1,
    speedScale: 3.0,
    modes: ['classic', 'modern', 'advanced'],
    trail: 'fire',
  },

  // ---- modern and advanced only ----
  {
    id: 'mirv',
    name: 'MIRV',
    blurb: 'Three warheads fan out at apex and come down in a line.',
    behaviour: 'mirv',
    damage: 34,
    radius: 28,
    ammoPerBuy: 2,
    cost: 2400,
    submunitions: 3,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['modern', 'advanced'],
    trail: 'plasma',
  },
  {
    id: 'napalm',
    name: 'Napalm Pod',
    blurb: 'Bursts into burning fluid that runs downhill and keeps burning.',
    behaviour: 'napalm',
    damage: 14,
    radius: 18,
    ammoPerBuy: 3,
    cost: 1600,
    submunitions: 9,
    windFactor: 1,
    gravityFactor: 0.95,
    speedScale: 3.05,
    modes: ['modern', 'advanced'],
    trail: 'fire',
  },
  {
    id: 'railgun',
    name: 'Railgun Slug',
    blurb: 'Flat, fast, wind-immune. Punches straight through a ridge.',
    behaviour: 'railgun',
    damage: 44,
    radius: 18,
    ammoPerBuy: 3,
    cost: 2000,
    submunitions: 0,
    windFactor: 0.05,
    gravityFactor: 0.25,
    speedScale: 5.4,
    modes: ['modern', 'advanced'],
    trail: 'plasma',
  },
  {
    id: 'sabot',
    name: 'Sabot Dart',
    blurb: 'Cheap, tight blast, barely notices the wind. The sniper round.',
    behaviour: 'shell',
    damage: 38,
    radius: 14,
    ammoPerBuy: 6,
    cost: 700,
    submunitions: 0,
    windFactor: 0.35,
    gravityFactor: 1.05,
    speedScale: 3.6,
    modes: ['modern', 'advanced'],
    trail: 'spark',
  },
  {
    id: 'airburst',
    name: 'Airburst Frag',
    blurb: 'Detonates above the ground. Terrible at digging, brutal on hulls.',
    behaviour: 'shell',
    damage: 52,
    radius: 44,
    ammoPerBuy: 4,
    cost: 1500,
    submunitions: 0,
    windFactor: 1.15,
    gravityFactor: 0.9,
    speedScale: 3.1,
    modes: ['modern', 'advanced'],
    trail: 'smoke',
  },
  {
    id: 'earthmover',
    name: 'Earthmover',
    blurb: 'Dumps a hill of dirt instead of removing one. Bury a rival.',
    behaviour: 'shell',
    damage: 6,
    radius: 46,
    ammoPerBuy: 3,
    cost: 800,
    submunitions: 0,
    windFactor: 1,
    gravityFactor: 1.1,
    speedScale: 3.0,
    modes: ['advanced'],
    trail: 'smoke',
  },
  {
    id: 'thermobaric',
    name: 'Thermobaric',
    blurb: 'Small crater, enormous overpressure. Ignores cover.',
    behaviour: 'nuke',
    damage: 74,
    radius: 62,
    ammoPerBuy: 2,
    cost: 3000,
    submunitions: 0,
    windFactor: 0.9,
    gravityFactor: 1,
    speedScale: 3.05,
    modes: ['advanced'],
    trail: 'fire',
  },
  {
    id: 'clusternuke',
    name: 'Funky Cluster',
    blurb: 'Nine bomblets from a nuclear casing. Ruinous and imprecise.',
    behaviour: 'cluster',
    damage: 44,
    radius: 40,
    ammoPerBuy: 1,
    cost: 5200,
    submunitions: 9,
    windFactor: 1,
    gravityFactor: 1,
    speedScale: 3.1,
    modes: ['advanced'],
    trail: 'fire',
  },
];

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export function weaponById(id: string): Weapon {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

export function weaponsForMode(mode: GameModeId): readonly Weapon[] {
  return WEAPONS.filter((w) => w.modes.includes(mode));
}

/** Weapons that are free and infinite — always present in every inventory. */
export function defaultWeaponId(): string {
  return 'shell';
}
