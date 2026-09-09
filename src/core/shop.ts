/**
 * Armoury rules, shared by the between-round shop in turn-based matches and the
 * between-mission shop in the campaign. Pure functions over a Tank so both
 * callers spend the same credits on the same terms.
 */
import type { Tank } from './world';
import { weaponById } from './weapons';
import type { GameModeId } from './types';

/** Reinforced Hull: bonus HP bought in steps, capped over the class base. */
export const HULL_UPGRADE_STEP = 10;
export const HULL_UPGRADE_COST = 100;
export const HULL_UPGRADE_CAP = 100;

/** Buy one batch of a weapon's ammo. Returns false if it is unavailable or unaffordable. */
export function buyWeapon(t: Tank, modeId: GameModeId, weaponId: string): boolean {
  const w = weaponById(weaponId);
  if (!w.modes.includes(modeId) || w.cost === 0 || t.credits < w.cost) return false;
  t.credits -= w.cost;
  const have = t.ammo.get(w.id) ?? 0;
  t.ammo.set(w.id, have < 0 ? -1 : have + w.ammoPerBuy);
  return true;
}

/** Cost of the next +10 bonus HP, or -1 when the hull is already maxed. */
export function hullUpgradeCost(t: Tank): number {
  return t.reinforcedHp >= HULL_UPGRADE_CAP ? -1 : HULL_UPGRADE_COST;
}

/**
 * Spend credits on Reinforced Hull. Not a permanent max-HP raise: the class base
 * heals fully every round, but the bonus only carries over at whatever damage
 * left it at, and is gone once the tank dies.
 */
export function upgradeHull(t: Tank): boolean {
  const cost = hullUpgradeCost(t);
  if (cost < 0 || t.credits < cost) return false;
  t.credits -= cost;
  t.reinforcedHp += HULL_UPGRADE_STEP;
  t.maxHp += HULL_UPGRADE_STEP;
  t.hp += HULL_UPGRADE_STEP;
  return true;
}
