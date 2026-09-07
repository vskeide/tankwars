/**
 * Render-side constants. The core is resolution-agnostic; only this file and
 * the sprite generator know how big a pixel is.
 *
 * NATIVE_W × NATIVE_H is the game's own pixel grid. Phaser scales it to the
 * window with nearest-neighbour filtering, so on a 4K screen a 1080p native
 * grid shows as clean 2×2 blocks.
 */
export const NATIVE_W = 960;
export const NATIVE_H = 540;

/**
 * Integer zoom to the target display. 2 → 1920×1080, 4 → 4K. Sheet sprites are
 * ~57 native px wide, i.e. 6% of the map — small enough that aim matters.
 */
export const ZOOM = 2;

/** Height of the top HUD strip in native pixels. Terrain starts below it. */
export const HUD_H = 30;

/** Terrain bitmap covers the full width and everything under the HUD. */
export const TERRAIN_W = NATIVE_W;
export const TERRAIN_H = NATIVE_H - HUD_H;

/** Physics tuning is in native pixels; the core knows nothing about ZOOM. */
export const SPRITE_DETAIL = 1;
