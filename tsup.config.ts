import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/native-plugin.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  outDir: 'dist',
  target: 'node22',
  // Don't bundle dependencies — they resolve from node_modules at runtime.
  external: ['openclaw', '@edictum/core', '@edictum/server'],
})
