import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC para soportar los decoradores + emitDecoratorMetadata que necesita Nest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/unit/**/*.spec.ts'],
    environment: 'node',
  },
});
