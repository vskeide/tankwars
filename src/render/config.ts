/**
 * Render-side constants. The core is resolution-agnostic; only this file and
 * the sprite generator know how big a pixel is.
 *
 * NATIVE_W × NATIVE_H is the game's own pixel grid. Phaser scales it to the
 * window with nearest-neighbour filtering, so on a 4K screen a 1080p native
 * grid shows as clean 2×2 blocks.
 */
export const NATIVE_W = 640;
export const NATIVE_H = 360;

/**
 * Integer zoom to the target display. 3 → 1920×1080, 6 → 4K. The asset sheets'
 * pixel blocks are ~2.3 image px on a 1448-wide export, which lands tanks at
 * ~57 native px = 171 screen px at 1080p — the same grain as the reference art.
 */
export const ZOOM = 3;

/** Height of the top HUD strip in native pixels. Terrain starts below it. */
export const HUD_H = 24;

/** Terrain bitmap covers the full width and everything under the HUD. */
export const TERRAIN_W = NATIVE_W;
export const TERRAIN_H = NATIVE_H - HUD_H;

/** Physics tuning is in native pixels; the core knows nothing about ZOOM. */
export const SPRITE_DETAIL = 1;
