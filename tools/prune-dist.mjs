// Drop the unpacked per-sprite atlas from the build: the game loads
// public/packed at runtime and public/atlas is only a development fallback.
import { rm, stat } from 'node:fs/promises';

const target = new URL('../dist/atlas/', import.meta.url);
try {
  await stat(target);
  await rm(target, { recursive: true, force: true });
  console.log('pruned dist/atlas (dev-only fallback)');
} catch {
  // Nothing to prune.
}
