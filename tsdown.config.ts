/**
 * dsh-live2d build: Node half (host side) + client half (browser bundle).
 *
 * Follows the community bundle-plugin build pattern (see the plugin-console
 * reference) and the official DSH client bundle contract:
 * - Node half: ESM, `@deepseek-ai/*` left external — the profile pnpm closure
 *   injects the official packages at mount time.
 * - Client half: CJS with a `window.__ModuleLoader__.load({ id, factory })`
 *   wrapper; `l2d` is inlined (it is NOT a loader-table module), while the
 *   shell's module-table modules (react, the primitives) stay external so no
 *   duplicate runtime instances exist. The module/exports shims live in
 *   banner/intro/footer so the factory can `return module.exports`.
 */
import { defineConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-live2d'

/** Modules resolved from the shell's module table at runtime (platform seeds). */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig([
  {
    name: PACKAGE_ID,
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
    // Official packages (@deepseek-ai/*) are injected by the profile's pnpm
    // closure at mount — never bundled, never resolvable from public npm.
    deps: {
      neverBundle: [/@deepseek-ai\//],
    },
    outputOptions: {
      entryFileNames: 'index.mjs',
    },
  },
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    deps: {
      // Module-table modules stay external (require() answers them); anything
      // else (l2d, shared config) is inlined — a require() the table cannot
      // answer is a guaranteed runtime throw.
      neverBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? true : undefined),
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
