/**
 * The shell has to leave the end of the barrel that is on screen.
 *
 * The renderer draws the barrel from a pivot that leans with the hull; muzzle()
 * has to spawn from the same point, or the shot appears above the barrel on a
 * slope. These tests reproduce the renderer's own geometry and check the two
 * agree — that is the invariant that broke.
 */
import { describe, expect, it } from 'vitest';
import { hullRotation, MAX_HULL_TILT } from '../src/core/world';
import { addLineTank, flatWorld } from './helpers';

/** What BattleScene puts the barrel pivot at, in world coordinates. */
function drawnPivot(t: { x: number; y: number; tilt: number; facing: 1 | -1; pivotDX: number; pivotDY: number }) {
  const rot = hullRotation(t as never);
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const lx = t.pivotDX * t.facing;
  const ly = t.pivotDY;
  return { x: t.x + lx * ca - ly * sa, y: t.y + lx * sa + ly * ca };
}

/** Perpendicular distance from `p` to the barrel's centreline. */
function offBarrel(pivot: { x: number; y: number }, angleDeg: number, p: { x: number; y: number }): number {
  const a = (angleDeg * Math.PI) / 180;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  // Barrel direction in world space: y grows downwards, hence -sin.
  return Math.abs(dx * -Math.sin(a) - dy * Math.cos(a));
}

function tankWithBarrel(tilt: number, facing: 1 | -1 = 1, angle = 55) {
  const w = flatWorld(1, 'advanced');
  const t = addLineTank(w, 0, 900);
  // Geometry the renderer publishes for a parts hull.
  t.pivotDX = 14;
  t.pivotDY = -38;
  t.barrelLen = 40;
  t.tilt = tilt;
  t.facing = facing;
  t.angle = angle;
  return { w, t };
}

describe('muzzle alignment', () => {
  it('sits on the barrel centreline on flat ground', () => {
    const { w, t } = tankWithBarrel(0);
    expect(offBarrel(drawnPivot(t), t.angle, w.muzzle(t))).toBeLessThan(0.001);
  });

  it('stays on the centreline across every slope and both facings', () => {
    for (const tilt of [-0.6, -0.4, -0.2, -0.05, 0.05, 0.2, 0.4, 0.6]) {
      for (const facing of [1, -1] as const) {
        for (const angle of [20, 55, 90, 125, 160]) {
          const { w, t } = tankWithBarrel(tilt, facing, angle);
          const off = offBarrel(drawnPivot(t), t.angle, w.muzzle(t));
          expect(off, `tilt ${tilt} facing ${facing} angle ${angle}`).toBeLessThan(0.001);
        }
      }
    }
  });

  it('is a barrel length from the pivot, not somewhere else along it', () => {
    const { w, t } = tankWithBarrel(0.3);
    const pivot = drawnPivot(t);
    const m = w.muzzle(t);
    expect(Math.hypot(m.x - pivot.x, m.y - pivot.y)).toBeCloseTo(t.barrelLen, 6);
  });

  it('was off the barrel before the fix, by enough to see', () => {
    // The old muzzle ignored the lean: this is what it computed.
    const { t } = tankWithBarrel(0.35);
    const a = (t.angle * Math.PI) / 180;
    const oldPivot = { x: t.x + t.pivotDX * t.facing, y: t.y + t.pivotDY };
    const old = { x: oldPivot.x + Math.cos(a) * t.barrelLen, y: oldPivot.y - Math.sin(a) * t.barrelLen };
    expect(offBarrel(drawnPivot(t), t.angle, old)).toBeGreaterThan(3);
  });
});

describe('hullRotation', () => {
  it('clamps the lean symmetrically', () => {
    expect(hullRotation({ tilt: 2 } as never)).toBe(MAX_HULL_TILT);
    expect(hullRotation({ tilt: -2 } as never)).toBe(-MAX_HULL_TILT);
    expect(hullRotation({ tilt: 0.1 } as never)).toBe(0.1);
  });
});
