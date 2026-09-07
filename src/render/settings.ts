/**
 * Player-facing settings persisted in localStorage. Render-side only; the core
 * receives the consequences (hitbox sizes) through the World, never the setting.
 */
export interface Settings {
  /** Display scale of tank sprites; hitboxes follow. 1 = as drawn. */
  tankScale: number;
  /** Turn-based firing: set a power number, or hold fire to charge like Arena. */
  chargeFire: boolean;
}

export const TANK_SIZES: { label: string; scale: number }[] = [
  { label: 'TINY (original)', scale: 0.5 },
  { label: 'SMALL', scale: 0.7 },
  { label: 'NORMAL', scale: 1 },
  { label: 'LARGE', scale: 1.35 },
];

const KEY = 'tankwars.settings';
let current: Settings = { tankScale: 1, chargeFire: false };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) current = { ...current, ...(JSON.parse(raw) as Partial<Settings>) };
} catch { /* private mode / bad JSON */ }

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* private mode */ }
}
