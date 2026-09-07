/**
 * Render-side constants. The core is resolution-agnostic; only this file and
 * the sprite generator know how big a pixel is.
 *
 * NATIVE_W × NATIVE_H is the game's own pixel grid. Phaser scales it to the
 * window with nearest-neighbour filtering, so on a 4K screen a 1080p native
 * grid shows as clean 2×2 blocks.
 */
export const NATIVE_W = 1920;
export const NATIVE_H = 1080;

/**
 * Integer zoom to the target display. 1 → 1080p, 2 → 4K. The world, terrain,
 * particles and text live on the full 1080p grid; sprites from the sheets are
 * ~57 px and are drawn at SPRITE_SCALE so a tank is ~114 px = 6% of the map.
 */
export const ZOOM = 1;
export const SPRITE_SCALE = 2;

/** Height of the top HUD strip in native pixels. Terrain starts below it. */
export const HUD_H = 44;

/** Terrain bitmap covers the full width and everything under the HUD. */
export const TERRAIN_W = NATIVE_W;
export const TERRAIN_H = NATIVE_H - HUD_H;


