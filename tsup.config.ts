import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  target: 'es2020',
  format: ['cjs'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  minify: false,
  external: [
    'pg-native',
    'canvas',
    'jsdom',
    'sharp'
  ],
  noExternal: [
    '@supabase/supabase-js',
    '@supabase/gotrue-js',
    '@supabase/postgrest-js',
    '@supabase/realtime-js',
    '@supabase/storage-js'
  ]
});