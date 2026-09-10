/**
 * The touch gesture rules. These are the parts of the touch layer that carry a
 * decision — what a touch means, where the barrel points, when a hold becomes a
 * shot — so they live in a Phaser-free module and get pinned here.
 */
import { describe, expect, it } from 'vitest';
import { aimAngleFrom, chargeAfter, classifyTouch, FIRE_MIN_HOLD_MS, firesOnRelease, type HitRect } from '../src/render/touchMath';

const buttons: HitRect[] = [
  { id: 'left', x: 80, y: 850, w: 150, h: 150 },
  { id: 'fire', x: 1620, y: 800, w: 220, h: 220 },
];

describe('classifyTouch', () => {
  it('a touch on a pad is that pad', () => {
    expect(classifyTouch({ x: 100, y: 900 }, buttons)).toEqual({ kind: 'button', id: 'left' });
    expect(classifyTouch({ x: 1700, y: 900 }, buttons)).toEqual({ kind: 'button', id: 'fire' });
  });

  it('anything else is an aim, wherever the tank is — nothing in the open fires', () => {
    expect(classifyTouch({ x: 900, y: 700 }, buttons)).toEqual({ kind: 'aim' });
    expect(classifyTouch({ x: 300, y: 300 }, buttons)).toEqual({ kind: 'aim' });
    expect(classifyTouch({ x: 1500, y: 1000 }, buttons)).toEqual({ kind: 'aim' });
  });

  it('with no pads at all, every touch is an aim', () => {
    expect(classifyTouch({ x: 1700, y: 900 }, [])).toEqual({ kind: 'aim' });
  });
});

describe('aimAngleFrom', () => {
  const pivot = { x: 500, y: 500 };
  it('maps the compass to the core’s convention', () => {
    expect(aimAngleFrom(pivot, { x: 600, y: 500 })).toBeCloseTo(0, 6);
    expect(aimAngleFrom(pivot, { x: 500, y: 400 })).toBeCloseTo(90, 6);
    expect(aimAngleFrom(pivot, { x: 400, y: 500 })).toBeCloseTo(180, 6);
    expect(aimAngleFrom(pivot, { x: 600, y: 400 })).toBeCloseTo(45, 6);
  });

  it('a finger below the pivot clamps to the nearer horizon rather than flipping', () => {
    expect(aimAngleFrom(pivot, { x: 600, y: 600 })).toBe(0);
    expect(aimAngleFrom(pivot, { x: 400, y: 600 })).toBe(180);
  });

  it('a finger on the pivot points straight up rather than NaN', () => {
    expect(aimAngleFrom(pivot, pivot)).toBe(90);
  });

  it('is independent of how far the finger is: a longer lever arm, same angle', () => {
    const near = aimAngleFrom(pivot, { x: 530, y: 460 });
    const far = aimAngleFrom(pivot, { x: 800, y: 100 });
    expect(near).toBeCloseTo(far, 6);
  });
});

describe('hold to fire (FIRE pad)', () => {
  it('a tap does not fire, a hold does', () => {
    expect(firesOnRelease(FIRE_MIN_HOLD_MS - 1)).toBe(false);
    expect(firesOnRelease(FIRE_MIN_HOLD_MS)).toBe(true);
  });

  it('charge ramps from the keyboard’s starting power and caps at 100', () => {
    expect(chargeAfter(0)).toBe(20);
    expect(chargeAfter(500)).toBeCloseTo(50, 6);
    expect(chargeAfter(10_000)).toBe(100);
  });
});
