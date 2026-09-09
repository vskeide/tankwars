/**
 * localStorage slot for the in-progress turn-based match (core/save.ts does the
 * actual serialising). One slot: saving overwrites, continuing consumes.
 */
import { restoreMatch, serialiseMatch, SAVE_VERSION, type SavedMatch } from '../core/save';
import type { TurnBasedMatch } from '../core/rules/turnBased';

const KEY = 'tankwars.match.save';

/** Header for the menu line, without decoding the terrain. */
export interface SavedMatchInfo {
  savedAt: number;
  mode: string;
  round: number;
  rounds: number;
  players: string[];
}

export function saveMatch(m: TurnBasedMatch): boolean {
  const snap = serialiseMatch(m);
  if (!snap) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
    return true;
  } catch {
    // Quota or private mode: the match is unaffected, the player just has no save.
    return false;
  }
}

function readSave(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMatch;
    return s.version === SAVE_VERSION ? s : null;
  } catch {
    return null;
  }
}

export function savedMatchInfo(): SavedMatchInfo | null {
  const s = readSave();
  if (!s) return null;
  return {
    savedAt: s.savedAt,
    mode: s.config.mode,
    round: s.round,
    rounds: s.config.rounds,
    players: s.config.players.map((p) => p.name),
  };
}

/** Rebuild the saved match, or null if there is nothing usable stored. */
export function continueMatch(): TurnBasedMatch | null {
  const s = readSave();
  if (!s) return null;
  try {
    return restoreMatch(s);
  } catch {
    clearSavedMatch();
    return null;
  }
}

export function clearSavedMatch(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}
