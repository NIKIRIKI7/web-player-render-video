import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/player.ts',
    'src/export/browser-export.ts',
    'src/export/client-ffmpeg-export.ts',
    'src/plugins/tailwind-plugin.ts',
    'src/core/hmr.ts',
    'src/ffmpeg.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  platform: 'neutral',
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'sucrase',
    'fflate',
    '@remotion/player',
    'remotion',
    'tailwindcss',
    'postcss',
    'playwright',
  ],
});
