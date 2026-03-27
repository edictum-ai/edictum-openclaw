import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/native-plugin.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'node22',
  // Bundle all deps into dist — OpenClaw's plugin installer expects
  // self-contained files with zero node_modules resolution.
  noExternal: [/@edictum\/core/, /@edictum\/server/, /js-yaml/, /argparse/],
})
