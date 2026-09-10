/**
 * What ShopScene needs from whoever opened it. The between-round shop in a
 * turn-based match and the between-mission shop in the campaign spend credits
 * on the same terms (core/shop.ts) but belong to different rules layers and go
 * back to different scenes afterwards, so the scene talks to this instead.
 */
import type Phaser from 'phaser';
import type { Tank, World } from '../core/world';
import type { GameModeId } from '../core/types';
import { buyWeapon, hullUpgradeCost, upgradeHull } from '../core/shop';
import { gameMode } from '../core/modes';
import { World as WorldImpl } from '../core/world';
import { tankClassById } from '../core/tanks';
import { commanderById } from '../core/campaign/commanders';
import { loadLoadout, saveLoadout } from './campaignRun';
import type { TurnBasedMatch } from '../core/rules/turnBased';

export interface ShopHost {
  /** Which armoury list to show. */
  modeId: GameModeId;
  /** Everyone who shops, in order. Bots included: the scene shops them instantly. */
  shoppers: Tank[];
  /** Title shown at the top of the panel. */
  title: string;
  buy(t: Tank, weaponId: string): boolean;
  hullUpgradeCost(t: Tank): number;
  upgradeHull(t: Tank): boolean;
  /** Persist whatever was bought and hand control back to the calling scene. */
  finish(scene: Phaser.Scene): void;
}

/** The between-round shop of a turn-based match. */
export function turnBasedHost(match: TurnBasedMatch): ShopHost {
  return {
    modeId: match.mode.id,
    shoppers: match.world.tanks,
    title: 'A R M O U R Y',
    buy: (t, id) => match.buy(t, id),
    hullUpgradeCost: (t) => match.hullUpgradeCost(t),
    upgradeHull: (t) => match.upgradeHull(t),
    finish: (scene) => {
      match.finishShop();
      scene.scene.stop();
      scene.scene.wake('battle');
    },
  };
}

/**
 * The campaign armoury, opened from the map between missions. There is no live
 * World here, so the loadout is loaded onto a scratch tank, the shop mutates
 * that, and it is written back on the way out. The scratch World never gets
 * terrain — nothing in the shop path touches it.
 *
 * Takes the *commander* id the campaign setup carries and resolves the hull
 * itself: the first version took a class id, every caller passed a commander,
 * and the armoury threw on open.
 */
export function campaignHost(commanderId: string): ShopHost {
  const world: World = new WorldImpl({ width: 1, height: 1, mode: gameMode('advanced'), seed: 1 });
  const cls = tankClassById(commanderById(commanderId).cls);
  const loadout = loadLoadout();
  const tank = world.addTank({
    index: 0,
    name: 'Loadout',
    colour: 0,
    isBot: false,
    difficulty: 'gunner',
    cls,
    credits: loadout.credits,
  });
  tank.reinforcedHp = loadout.reinforcedHp;
  tank.maxHp = cls.hp + loadout.reinforcedHp;
  tank.hp = tank.maxHp;
  tank.ammo.clear();
  for (const [id, n] of Object.entries(loadout.ammo)) tank.ammo.set(id, n);

  return {
    modeId: 'advanced',
    shoppers: [tank],
    title: 'C A M P A I G N   A R M O U R Y',
    buy: (t, id) => buyWeapon(t, 'advanced', id),
    hullUpgradeCost,
    upgradeHull,
    finish: (scene) => {
      const ammo: Record<string, number> = {};
      for (const [id, n] of tank.ammo) if (n !== 0) ammo[id] = n;
      saveLoadout({ credits: tank.credits, ammo, reinforcedHp: tank.reinforcedHp });
      scene.scene.stop();
      scene.scene.wake('campaignMap');
    },
  };
}
