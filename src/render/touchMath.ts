/**
 * Pure geometry for the touch controls: which gesture a touch starts, where the
 * barrel should point, and how a held finger turns into shot power. No Phaser
 * in here so the rules can be unit-tested; touchControls.ts does the drawing.
 */
export interface Pt {
  x: number;
  y: number;
}

export interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A hold on the FIRE pad shorter than this is a tap and is ignored — it never fires. */
export const FIRE_MIN_HOLD_MS = 180;

/** Same ramp as hold-to-charge on the keyboard: from 20, up 60 a second. */
export const CHARGE_START = 20;
export const CHARGE_RATE = 60;

export type Gesture = { kind: 'button'; id: string } | { kind: 'aim' };

export function hitButton(p: Pt, buttons: readonly HitRect[]): HitRect | null {
  for (const b of buttons) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
  }
  return null;
}

/**
 * Decide what a touch is when it lands: a pad, or otherwise an aim. Firing is
 * the FIRE pad's job alone — the first version also fired on a hold anywhere in
 * the open, and that was the accident people kept having. The decision is made
 * once, at touch-down, and holds until the finger lifts.
 */
export function classifyTouch(p: Pt, buttons: readonly HitRect[]): Gesture {
  const b = hitButton(p, buttons);
  if (b) return { kind: 'button', id: b.id };
  return { kind: 'aim' };
}

/**
 * Barrel angle in the core's convention (degrees, 0 = right, 90 = up, 180 =
 * left) for a finger at `finger` relative to the barrel pivot. Screen y grows
 * downwards, hence the sign flip. A finger below the pivot clamps to whichever
 * horizon it is nearer, so dragging low never snaps the barrel across.
 */
export function aimAngleFrom(pivot: Pt, finger: Pt): number {
  const dx = finger.x - pivot.x;
  const dy = pivot.y - finger.y;
  if (dx === 0 && dy === 0) return 90;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) return dx >= 0 ? 0 : 180;
  return Math.max(0, Math.min(180, deg));
}

/** Power a hold has reached after `heldMs`, on the shared charge ramp. */
export function chargeAfter(heldMs: number): number {
  return Math.max(CHARGE_START, Math.min(100, CHARGE_START + (CHARGE_RATE * Math.max(0, heldMs)) / 1000));
}

/** Whether lifting the finger after `heldMs` fires, or was just a tap. */
export function firesOnRelease(heldMs: number): boolean {
  return heldMs >= FIRE_MIN_HOLD_MS;
}
