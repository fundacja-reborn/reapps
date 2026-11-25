import { defineConfig } from 'tsup';

export default defineConfig({
  // `native-client` is its own entry: the pure header contract, importable by
  // client code without pulling the client barrel (whose SessionManager
  // singleton is a module side effect the web bundle would then keep).
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    'native-client': 'src/utils/native-client.ts'
  },
  format: ['esm'],
  dts: {
    resolve: true,
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      'native-client': 'src/utils/native-client.ts'
    },
    compilerOptions: {
      composite: false,
      incremental: false,
      paths: {
        '@reborn/crypto': ['../../crypto/src/index.ts'],
        '@reborn/types': ['../../types/src/index.ts'],
        '@reborn/utils': ['../../utils/src/index.ts']
      }
    }
  },
  sourcemap: false,
  clean: true,
  external: ['@reborn/crypto', '@reborn/types', '@reborn/utils'],
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist'
});
