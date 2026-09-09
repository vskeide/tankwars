/**
 * Shared fixtures for the core tests. Everything here builds a *flat* map by
 * hand rather than going through Terrain.generate: midpoint displacement is
 * deterministic but its silhouette is not something an assertion should depend
 * on, and a level playing field makes ballistics and solver results readable.
 */
import { Terrain, MAT_DIRT, TERRAIN_STYLES } from '../src/core/terrain';
import { World } from '../src/core/world';
import { gameMode } from '../src/core/modes';
import { tankClassById } from '../src/core/tanks';
import type { GameModeId, TerrainStyle } from '../src/core/types';

export const MAP_W = 1920;
export const MAP_H = 1036;
/** Topmost solid row of the flat fixtures. */
export const GROUND_Y = 700;

export function styleById(id: string): TerrainStyle {
  const s = TERRAIN_STYLES.find((t) => t.id === id);
  if (!s) throw new Error(`No such terrain style: ${id}`);
  return s;
}

/** Solid dirt from `surfaceTop` down, air above. Dirty bounds start cleared. */
export function flatTerrain(
  surfaceTop = GROUND_Y,
  style: TerrainStyle = styleById('dunes'),
  width = MAP_W,
  height = MAP_H,
): Terrain {
  const t = new Terrain(width, height, style);
  t.mat.fill(MAT_DIRT, surfaceTop * width);
  t.clearDirty();
  return t;
}

export function flatWorld(seed = 1, mode: GameModeId = 'classic', style = styleById('dunes')): World {
  const w = new World({ width: MAP_W, height: MAP_H, mode: gameMode(mode), seed });
  w.setTerrain(flatTerrain(GROUND_Y, style));
  w.wind = 0;
  return w;
}

/** A placed Line Tank at column x. Index doubles as the free-for-all team. */
export function addLineTank(world: World, index: number, x: number, name = `T${index}`) {
  const t = world.addTank({
    index,
    name,
    colour: index,
    isBot: false,
    difficulty: 'deadeye',
    cls: tankClassById('line'),
    credits: 0,
  });
  world.placeTankAt(t, x);
  return t;
}

/** Run the world until every projectile has resolved, or the cap trips. */
export function settleWorld(world: World, maxSteps = 4000): number {
  let steps = 0;
  while (world.busy && steps < maxSteps) {
    world.step();
    steps++;
  }
  return steps;
}
