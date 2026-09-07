/**
 * One frame of intent from one player. Every controller — keyboard set,
 * gamepad, bot brain, replay — produces this and nothing else, so the rules
 * layers never know where an input came from.
 */
export interface Intent {
  /** -1..1 horizontal drive. */
  moveX: number;
  /** Degrees per second of barrel rotation requested (+ = counter-clockwise / up-left). */
  aimDelta: number;
  /** Power units per second requested. */
  powerDelta: number;
  /** Fire edge — true on the frame the button went down. */
  fire: boolean;
  /** Fire held — for weapons or modes that charge. */
  fireHeld: boolean;
  /** Cycle weapon: -1, 0 or 1 (edge). */
  cycleWeapon: -1 | 0 | 1;
  /** Jump / hop for hulls that can (arena mode). Edge. */
  jump: boolean;
}

export const EMPTY_INTENT: Readonly<Intent> = Object.freeze({
  moveX: 0,
  aimDelta: 0,
  powerDelta: 0,
  fire: false,
  fireHeld: false,
  cycleWeapon: 0,
  jump: false,
});

export function emptyIntent(): Intent {
  return { ...EMPTY_INTENT };
}

/** A named keyboard layout for one hotseat slot. Key names are KeyboardEvent.code. */
export interface KeySet {
  name: string;
  left: string;
  right: string;
  up: string;
  down: string;
  fire: string;
  cycle: string;
  jump: string;
}

export const KEY_SETS: readonly KeySet[] = [
  { name: 'WASD', left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', fire: 'Space', cycle: 'KeyQ', jump: 'KeyE' },
  { name: 'Arrows', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', fire: 'Enter', cycle: 'ShiftRight', jump: 'ControlRight' },
  { name: 'IJKL', left: 'KeyJ', right: 'KeyL', up: 'KeyI', down: 'KeyK', fire: 'KeyO', cycle: 'KeyU', jump: 'KeyP' },
  { name: 'Numpad', left: 'Numpad4', right: 'Numpad6', up: 'Numpad8', down: 'Numpad5', fire: 'Numpad0', cycle: 'NumpadAdd', jump: 'NumpadEnter' },
];
