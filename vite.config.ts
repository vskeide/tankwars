import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path — it is served from
  // /games/tankwars/ on skeide.me.
  base: './',
  server: { port: 5180, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
