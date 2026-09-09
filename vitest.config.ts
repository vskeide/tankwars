import { defineConfig } from 'vitest/config';

// The core is pure TypeScript with no DOM dependency, so the node environment
// is enough — no jsdom, and nothing from src/render is under test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
