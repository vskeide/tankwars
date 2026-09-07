/**
 * Campaign commanders: a portrait, a hull and a passive. Chosen once per run.
 * Bonuses are applied by the campaign rules layer when the player tank is built.
 */
export interface Commander {
  id: string;
  name: string;
  /** Atlas id of the portrait. */
  portrait: string;
  /** Hull class id. */
  cls: string;
  title: string;
  blurb: string;
  perk: {
    /** Added to max HP. */
    hpBonus: number;
    /** Added to fuel. */
    fuelBonus: number;
    /** Multiplier on incoming damage (below 1 = tougher). */
    armourMult: number;
    /** Multiplier on weapon cooldowns (below 1 = faster). */
    reloadMult: number;
    /** Extra starting ammo: weapon id → shots. */
    startWeapons: [string, number][];
    /** Multiplier on crate drop interval (below 1 = more crates). */
    crateMult: number;
  };
}

export const COMMANDERS: readonly Commander[] = [
  {
    id: 'rook', name: 'Rook', portrait: 'portrait.p1', cls: 'line', title: 'Line officer',
    blurb: 'Balanced hull, an extra crate of heavy shells, nothing fancy. The safe pick.',
    perk: { hpBonus: 10, fuelBonus: 20, armourMult: 1, reloadMult: 1, startWeapons: [['heavy', 4]], crateMult: 1 },
  },
  {
    id: 'vex', name: 'Vex', portrait: 'portrait.p2', cls: 'scout', title: 'Scout',
    blurb: 'Fast and fragile. Two shots a turn, quick reload, and crates seem to find her.',
    perk: { hpBonus: 0, fuelBonus: 80, armourMult: 1.1, reloadMult: 0.75, startWeapons: [['sabot', 6]], crateMult: 0.75 },
  },
  {
    id: 'grimm', name: 'Grimm', portrait: 'portrait.p3', cls: 'bulwark', title: 'Siege engineer',
    blurb: 'A rolling bunker. Slow, tough, and he brings the diggers.',
    perk: { hpBonus: 30, fuelBonus: 0, armourMult: 0.8, reloadMult: 1.2, startWeapons: [['digger', 4], ['roller', 2]], crateMult: 1.1 },
  },
  {
    id: 'sable', name: 'Sable', portrait: 'portrait.p4', cls: 'battery', title: 'Gunnery officer',
    blurb: 'Long stabilised barrel; the wind is not her problem. Starts with a railgun.',
    perk: { hpBonus: 0, fuelBonus: 20, armourMult: 1, reloadMult: 1, startWeapons: [['railgun', 3], ['heavy', 2]], crateMult: 1 },
  },
  {
    id: 'kilo', name: 'Kilo', portrait: 'portrait.p5', cls: 'aegis', title: 'Shield tech',
    blurb: 'Hover hull with a regenerating shield. Takes no fall damage.',
    perk: { hpBonus: 0, fuelBonus: 40, armourMult: 1.05, reloadMult: 1, startWeapons: [['airburst', 3]], crateMult: 1 },
  },
  {
    id: 'tarn', name: 'Tarn', portrait: 'portrait.p6', cls: 'strider', title: 'Walker pilot',
    blurb: 'Legged hull climbs anything. Cluster bombs and a MIRV in the racks.',
    perk: { hpBonus: 10, fuelBonus: 60, armourMult: 1, reloadMult: 0.9, startWeapons: [['cluster', 4], ['mirv', 1]], crateMult: 1 },
  },
];

export function commanderById(id: string | undefined): Commander {
  return COMMANDERS.find((c) => c.id === id) ?? COMMANDERS[0];
}
