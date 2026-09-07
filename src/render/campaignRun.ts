/**
 * Persistence for a campaign run and the high-score table (localStorage).
 * The core computes scores (core/campaign/score.ts); this only stores them.
 */
import { emptyRun, type HighScore, type RunStats } from '../core/campaign/score';

const RUN_KEY = 'tankwars.campaign.run';
const LEVEL_KEY = 'tankwars.campaign.level';
const SCORES_KEY = 'tankwars.campaign.scores';

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode */ }
}

export function loadRun(): RunStats | null {
  return read<RunStats>(RUN_KEY);
}

export function saveRun(r: RunStats): void {
  write(RUN_KEY, r);
}

/** Start a fresh run: stats reset, progress back to the first level. */
export function startRun(commander: string, difficulty: string): RunStats {
  const r = emptyRun(commander, difficulty);
  saveRun(r);
  try {
    localStorage.setItem(LEVEL_KEY, 'l01');
  } catch { /* private mode */ }
  return r;
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY);
    localStorage.setItem(LEVEL_KEY, 'l01');
  } catch { /* private mode */ }
}

export function savedLevelId(): string {
  try {
    return localStorage.getItem(LEVEL_KEY) ?? 'l01';
  } catch {
    return 'l01';
  }
}

export function setSavedLevel(id: string): void {
  try {
    localStorage.setItem(LEVEL_KEY, id);
  } catch { /* private mode */ }
}

export function loadScores(): HighScore[] {
  return read<HighScore[]>(SCORES_KEY) ?? [];
}

/** Insert and keep the top ten. Returns the rank (1-based) of the new entry. */
export function addScore(s: HighScore): number {
  const list = [...loadScores(), s].sort((a, b) => b.total - a.total).slice(0, 10);
  write(SCORES_KEY, list);
  return list.indexOf(s) + 1;
}
