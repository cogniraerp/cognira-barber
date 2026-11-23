import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/e2e/**/*.e2e.spec.ts'],
    environment: 'node',
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/e2e-env.ts'],
    // Las suites comparten una BD: en serie para que no se pisen.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
