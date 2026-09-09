/**
 * Characters outside the campaign.
 *
 * The select screen picks one of the six commanders for every slot. In the
 * campaign that pick brings the whole perk with it (see rules/campaign.ts); in
 * a normal battle only the hull and the fuel bonus apply, so the characters
 * differ in chassis and in how far they can drive, but nobody gets free HP,
 * armour or reload out of a hotseat match.
 */
import { commanderById } from './campaign/commanders';
import type { TankClass } from './tanks';
import type { PlayerSetup } from './rules/turnBased';
import { weaponById } from './weapons';
import type { GameModeId } from './types';

/** Fuel a character adds on top of its hull, or 0 for a slot with no character. */
export function fuelBonusFor(commanderId: string | undefined): number {
  return commanderId ? commanderById(commanderId).perk.fuelBonus : 0;
}

/**
 * The rounds a character brings to the fight. Their blurbs have always promised
 * these ("an extra crate of heavy shells", "starts with a railgun") but only the
 * campaign was handing them out. Filtered to what the mode's armoury stocks, so
 * Classic cannot be handed a railgun.
 */
export function startingAmmoFor(commanderId: string | undefined, modeId: GameModeId): [string, number][] {
  if (!commanderId) return [];
  return commanderById(commanderId).perk.startWeapons.filter(([id]) => weaponById(id).modes.includes(modeId));
}

/** The hull a player actually drives: their class plus the character's fuel. */
export function hullForPlayer(base: TankClass, p: PlayerSetup): TankClass {
  const bonus = fuelBonusFor(p.commanderId);
  return bonus === 0 ? base : { ...base, fuel: base.fuel + bonus };
}
