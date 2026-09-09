import { describe, it, expect } from 'vitest';
import { MAT_AIR, MAT_DIRT, MAT_SCORCH, TERRAIN_STYLES, type Terrain } from '../src/core/terrain';
import { flatTerrain, styleById, GROUND_Y, MAP_H, MAP_W } from './helpers';

const CRUMBLES = styleById('dunes');
const HARD = styleById('mesas');

function solidCount(t: Terrain): number {
  let n = 0;
  for (let i = 0; i < t.mat.length; i++) if (t.mat[i] !== MAT_AIR) n++;
  return n;
}

function columnSolid(t: Terrain, x: number): number {
  let n = 0;
  for (let y = 0; y < t.height; y++) if (t.mat[y * t.width + x] !== MAT_AIR) n++;
  return n;
}

describe('the style table', () => {
  it('agrees on which maps crumble', () => {
    const crumbling = TERRAIN_STYLES.filter((s) => s.crumbles).map((s) => s.id);
    expect(crumbling).toEqual(['dunes', 'basin', 'spires']);
    // Every style must be reachable by id, or the match setup can pick a ghost.
    for (const s of TERRAIN_STYLES) expect(styleById(s.id)).toBe(s);
  });
});

describe('carveCircle', () => {
  it('removes material and reports the damaged band as dirty', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    expect(t.hasDirty()).toBe(false);
    const before = solidCount(t);

    t.carveCircle(500, GROUND_Y + 40, 30);

    expect(solidCount(t)).toBeLessThan(before);
    // A circle of radius 30 fully inside the ground: pi*r^2 pixels, give or take
    // the pixel grid.
    expect(before - solidCount(t)).toBeCloseTo(Math.PI * 30 * 30, -2);
    expect(t.hasDirty()).toBe(true);
    expect(t.dirtyMinX).toBeLessThanOrEqual(470);
    expect(t.dirtyMaxX).toBeGreaterThanOrEqual(530);
    expect(t.mat[(GROUND_Y + 40) * MAP_W + 500]).toBe(MAT_AIR);
  });

  it('scorches the rim it does not remove', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    t.carveCircle(500, GROUND_Y + 40, 30);
    // Just outside the hole but inside the scorch shoulder. Note the shoulder
    // is nominally radius + 3 wide but the scan box only reaches radius + 1, so
    // the outermost two rings never get scorched (see carveCircle).
    expect(t.mat[(GROUND_Y + 40) * MAP_W + 531]).toBe(MAT_SCORCH);
    expect(t.mat[(GROUND_Y + 40) * MAP_W + 560]).toBe(MAT_DIRT);
  });

  it('raises surfaceY when it takes the top off a column', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    expect(t.surfaceY(500)).toBe(GROUND_Y);
    t.carveCircle(500, GROUND_Y, 40, false);
    expect(t.surfaceY(500)).toBe(GROUND_Y + 41);
    // Well outside the crater the surface is untouched.
    expect(t.surfaceY(700)).toBe(GROUND_Y);
  });

  it('clips at the map edges instead of wrapping', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    t.carveCircle(2, GROUND_Y + 10, 20, false);
    expect(t.surfaceY(0)).toBeGreaterThan(GROUND_Y);
    // The right edge must not have been touched by a wrapped write.
    expect(t.surfaceY(MAP_W - 1)).toBe(GROUND_Y);
  });
});

describe('fillCircle', () => {
  it('adds material and lowers surfaceY', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    const before = solidCount(t);
    t.fillCircle(800, GROUND_Y - 50, 20);
    expect(solidCount(t)).toBeGreaterThan(before);
    expect(t.surfaceY(800)).toBe(GROUND_Y - 70);
    expect(t.hasDirty()).toBe(true);
  });
});

describe('settle', () => {
  /** Blow a cavity out from under the top slab so the roof is unsupported. */
  const undermine = (style = CRUMBLES) => {
    const t = flatTerrain(GROUND_Y, style);
    t.carveCircle(900, GROUND_Y + 60, 40, false);
    t.clearDirty();
    return t;
  };

  it('drops the unsupported roof on a crumbling style', () => {
    const t = undermine(CRUMBLES);
    const solidBefore = columnSolid(t, 900);
    expect(t.surfaceY(900)).toBe(GROUND_Y);

    t.settle(820, 980);

    // Nothing is created or destroyed; the column just compacts to the bottom.
    expect(columnSolid(t, 900)).toBe(solidBefore);
    expect(t.surfaceY(900)).toBe(MAP_H - solidBefore);
    expect(t.surfaceY(900)).toBeGreaterThan(GROUND_Y);
    expect(t.hasDirty()).toBe(true);
  });

  it('leaves the arch standing on a style that does not crumble', () => {
    const t = undermine(HARD);
    const cavityRow = (GROUND_Y + 60) * MAP_W + 900;
    expect(t.mat[cavityRow]).toBe(MAT_AIR);

    t.settle(820, 980);

    expect(t.surfaceY(900)).toBe(GROUND_Y);
    expect(t.mat[cavityRow]).toBe(MAT_AIR);
    expect(t.hasDirty()).toBe(false);
  });

  it('only touches the columns it is given', () => {
    const t = undermine(CRUMBLES);
    t.settle(890, 910);
    expect(t.surfaceY(900)).toBeGreaterThan(GROUND_Y);
    // A column inside the cavity but outside the settle span keeps its roof.
    expect(t.surfaceY(880)).toBe(GROUND_Y);
  });
});

describe('surfaceAngle', () => {
  it('is flat over flat ground and tilts with the slope', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    expect(t.surfaceAngle(500)).toBeCloseTo(0, 6);

    // Pile material on the left so the ground falls away to the right.
    t.fillCircle(494, GROUND_Y - 6, 8);
    expect(t.surfaceAngle(500, 6)).toBeGreaterThan(0);
  });
});

describe('tunnel', () => {
  it('bores a hole along the direction and stops at the map edge', () => {
    const t = flatTerrain(GROUND_Y, CRUMBLES);
    const end = t.tunnel({ x: 600, y: GROUND_Y - 2 }, { x: 0, y: 1 }, 200, 4);
    expect(end.y).toBeCloseTo(GROUND_Y - 2 + 200, 6);
    expect(t.isSolid(600, GROUND_Y + 100)).toBe(false);
    expect(t.isSolid(600, GROUND_Y + 250)).toBe(true);

    const off = t.tunnel({ x: MAP_W - 5, y: GROUND_Y }, { x: 1, y: 0 }, 100, 3);
    expect(off.x).toBeGreaterThanOrEqual(MAP_W);
  });
});
