/**
 * Player-facing settings persisted in localStorage. Render-side only; the core
 * receives the consequences (hitbox sizes) through the World, never the setting.
 */
export type TouchSetting = 'auto' | 'on' | 'off';

export interface Settings {
  /** Display scale of tank sprites; hitboxes follow. 1 = as drawn. */
  tankScale: number;
  /** Turn-based firing: set a power number, or hold fire to charge like Arena. */
  chargeFire: boolean;
  /**
   * On-screen touch controls. 'auto' follows the device; 'on' forces them so
   * the layout can be tested with a mouse; 'off' hides them on a touch device
   * that also has a keyboard.
   */
  touch: TouchSetting;
}

export const TANK_SIZES: { label: string; scale: number }[] = [
  { label: 'TINY (original)', scale: 0.5 },
  { label: 'SMALL', scale: 0.7 },
  { label: 'NORMAL', scale: 1 },
  { label: 'LARGE', scale: 1.35 },
];

export const TOUCH_OPTIONS: TouchSetting[] = ['auto', 'on', 'off'];

const KEY = 'tankwars.settings';
let current: Settings = { tankScale: 1, chargeFire: false, touch: 'auto' };
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

/** Does this device look like it is driven by fingers? Coarse pointer plus touch points. */
export function deviceIsTouch(): boolean {
  try {
    const points = (navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return points > 0 && coarse;
  } catch {
    return false;
  }
}

/** Whether the touch layout is in force right now, after the override. */
export function touchActive(): boolean {
  const t = current.touch;
  if (t === 'on') return true;
  if (t === 'off') return false;
  return deviceIsTouch();
}
