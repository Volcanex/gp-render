import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Library build for the scenes.mjs contract consumed by gdesign. Runs as a
// second build alongside the normal SPA build (see package.json's `build`
// script): emptyOutDir is false so it doesn't wipe the SPA output already
// in dist/.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/scenes-lib/index.js'),
      formats: ['es'],
      fileName: () => 'scenes.mjs',
    },
    rollupOptions: {
      external: [],
    },
  },
})
