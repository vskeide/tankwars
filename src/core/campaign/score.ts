import { difficultyById } from './difficulty';

/** Everything a campaign run accumulates. Pure data; persisted by the renderer. */
export interface RunStats {
  commander: string;
  difficulty: string;
  /** Simulated seconds spent in live play across all levels. */
  timeSec: number;
  shotsFired: number;
  hits: number;
  damageTaken: number;
  crates: number;
  retries: number;
  levelsCleared: number;
  /** Wall-clock start, ms. */
  startedAt: number;
}

export function emptyRun(commander: string, difficulty: string): RunStats {
  return { commander, difficulty, timeSec: 0, shotsFired: 0, hits: 0, damageTaken: 0, crates: 0, retries: 0, levelsCleared: 0, startedAt: Date.now() };
}

export interface ScoreBreakdown {
  levels: number;
  time: number;
  accuracy: number;
  damage: number;
  crates: number;
  retries: number;
  subtotal: number;
  multiplier: number;
  total: number;
}

/**
 * Score a run. Each cleared level is worth 10 000; a fast run earns up to 6 000
 * extra; accuracy up to 3 000; crates 150 each; damage and retries cost points.
 * The difficulty multiplier is applied last.
 */
export function scoreRun(r: RunStats, totalLevels: number): ScoreBreakdown {
  const levels = r.levelsCleared * 10000;
  const par = totalLevels * 90; // 90 s per level is a brisk clear
  const time = Math.round(Math.max(0, Math.min(6000, (par * 2 - r.timeSec) * (6000 / (par * 2)))));
  const acc = r.shotsFired > 0 ? r.hits / r.shotsFired : 0;
  const accuracy = Math.round(acc * 3000);
  const damage = -Math.round(r.damageTaken * 4);
  const crates = r.crates * 150;
  const retries = -r.retries * 1500;
  const subtotal = Math.max(0, levels + time + accuracy + damage + crates + retries);
  const multiplier = difficultyById(r.difficulty).scoreMult;
  return { levels, time, accuracy, damage, crates, retries, subtotal, multiplier, total: Math.round(subtotal * multiplier) };
}

export interface HighScore {
  total: number;
  commander: string;
  difficulty: string;
  timeSec: number;
  accuracy: number;
  damageTaken: number;
  retries: number;
  date: string;
}

export function toHighScore(r: RunStats, b: ScoreBreakdown): HighScore {
  return {
    total: b.total,
    commander: r.commander,
    difficulty: r.difficulty,
    timeSec: Math.round(r.timeSec),
    accuracy: r.shotsFired ? Math.round((100 * r.hits) / r.shotsFired) : 0,
    damageTaken: Math.round(r.damageTaken),
    retries: r.retries,
    date: new Date().toISOString().slice(0, 10),
  };
}
