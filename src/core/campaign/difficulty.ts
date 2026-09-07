/** Campaign difficulty tiers. Everything the rules layer scales by lives here. */
export type CampaignDifficultyId = 'recruit' | 'soldier' | 'veteran' | 'ironman';

export interface CampaignDifficulty {
  id: CampaignDifficultyId;
  name: string;
  blurb: string;
  /** Shift applied to each enemy's bot difficulty tier (-1 … +1). */
  enemyShift: number;
  enemyHpMult: number;
  bossHpMult: number;
  /** Multiplier on boss attack intervals (below 1 = faster). */
  bossTempo: number;
  /** Multiplier on crate interval (above 1 = fewer crates). */
  crateMult: number;
  /** Final score multiplier. */
  scoreMult: number;
  /** No retries: a death ends the run. */
  ironman: boolean;
}

export const DIFFICULTIES: readonly CampaignDifficulty[] = [
  { id: 'recruit', name: 'Recruit', blurb: 'Forgiving. Enemies miss, bosses are slow, crates are plentiful.', enemyShift: -1, enemyHpMult: 0.8, bossHpMult: 0.7, bossTempo: 1.3, crateMult: 0.7, scoreMult: 0.8, ironman: false },
  { id: 'soldier', name: 'Soldier', blurb: 'The intended experience.', enemyShift: 0, enemyHpMult: 1, bossHpMult: 1, bossTempo: 1, crateMult: 1, scoreMult: 1, ironman: false },
  { id: 'veteran', name: 'Veteran', blurb: 'Sharper enemies, tougher bosses, fewer crates.', enemyShift: 1, enemyHpMult: 1.2, bossHpMult: 1.3, bossTempo: 0.85, crateMult: 1.3, scoreMult: 1.3, ironman: false },
  { id: 'ironman', name: 'Ironman', blurb: 'Veteran rules and one life. Die and the run is over.', enemyShift: 1, enemyHpMult: 1.25, bossHpMult: 1.5, bossTempo: 0.7, crateMult: 1.5, scoreMult: 1.8, ironman: true },
];

export function difficultyById(id: string | undefined): CampaignDifficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

const TIERS = ['rookie', 'gunner', 'veteran', 'deadeye'] as const;
export function shiftTier(tier: (typeof TIERS)[number], shift: number): (typeof TIERS)[number] {
  const i = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + shift));
  return TIERS[i];
}
