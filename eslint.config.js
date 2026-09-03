// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ESLint flat configuration for the workspace.
 *
 * Three of the blocks below are not style. They are the enforcement half of
 * decisions that are otherwise only documented, and ADR 0005 decision H picked
 * ESLint over Biome specifically because these two plugins exist:
 *
 *   1. `headers/header-format` — the SPDX identifier CONTRIBUTING.md says "is
 *      linted in CI, so a missing or mismatched header fails the build rather
 *      than being caught in review". It complements rather than replaces
 *      `scripts/check-repo-rules.sh` (LIC001/LIC002), which checks the same
 *      thing with no toolchain at all and covers file types ESLint never parses.
 *   2. `boundaries/dependencies` — "dependencies point one way: apps/ →
 *      packages/, never the reverse" (docs/architecture.md). Under the licence
 *      boundary a `packages/` → `apps/` import is a licence violation as well as
 *      a layering one, because AGPL code cannot be combined into an Apache-2.0
 *      work.
 *   3. `no-restricted-imports` / `no-restricted-globals` in `packages/domain` —
 *      "no platform API at all". `packages/domain/tsconfig.json` already makes
 *      `document` and `process` type errors by narrowing `lib` and `types`;
 *      this catches the module specifiers a `lib` narrowing cannot see.
 */

import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import headers from 'eslint-plugin-headers';
import tseslint from 'typescript-eslint';

const SPDX_APACHE = 'SPDX-License-Identifier: Apache-2.0';
const SPDX_AGPL = 'SPDX-License-Identifier: AGPL-3.0-or-later';

/** The header rule, in the one style this repository uses: a single line comment. */
const spdxHeader = (content) => ({
  plugins: { headers },
  rules: {
    'headers/header-format': ['error', { source: 'string', style: 'line', content }],
  },
});

/**
 * Module specifiers `packages/domain` may not name. The DOM and Node globals are
 * already unreachable there through `tsconfig.json`; what remains reachable is an
 * `import`, because a module specifier is resolved before `lib` has anything to
 * say about it.
 */
const PLATFORM_IMPORT_PATTERNS = [
  {
    group: ['node:*'],
    message:
      'packages/domain depends on no platform API at all — the same code signs a record on a device and verifies it on an instance (docs/architecture.md).',
  },
  {
    group: [
      'fs',
      'fs/*',
      'path',
      'os',
      'crypto',
      'http',
      'https',
      'net',
      'stream',
      'child_process',
    ],
    message:
      'packages/domain depends on no platform API at all. A Node builtin here means this package can no longer run in a browser.',
  },
  {
    group: ['react', 'react-dom', 'react-dom/*', 'vite', 'dexie'],
    message:
      'packages/domain is rendering-, storage- and framework-free. Rendering belongs in apps/web; persistence belongs in packages/store.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // Not source: a checked-in template of variable names.
      '.env.example',
    ],
  },

  // --- Base ------------------------------------------------------------------
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  // --- Type-aware TypeScript -------------------------------------------------
  // Type-aware, not merely syntactic: ADR 0005 decision H keeps TypeScript on
  // 6.0.3 precisely so this works, and `no-floating-promises` alone earns it in
  // a codebase that will be full of BLE and IndexedDB promises.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // --- SPDX headers, by path -------------------------------------------------
  // The same path rule scripts/check-repo-rules.sh enforces, so a contributor
  // hears it from whichever gate they run first.
  { files: ['packages/**/*.{ts,tsx}'], ...spdxHeader(SPDX_APACHE) },
  { files: ['apps/**/*.{ts,tsx}'], ...spdxHeader(SPDX_AGPL) },
  { files: ['*.{js,ts}'], ...spdxHeader(SPDX_AGPL) },

  // --- Package boundaries ----------------------------------------------------
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*', capture: ['app'] },
        { type: 'package', pattern: 'packages/*', capture: ['package'] },
      ],
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // Every package's tsconfig, so a cross-package import resolves to the
          // file it actually names rather than being written off as external —
          // which is what makes the boundary rule below reach an import written
          // as `@onyourleft/web` and not only one written as a relative path.
          project: ['tsconfig.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // The application composes the leaf packages. This direction is the
            // only one the licence permits.
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { types: { anyOf: ['app', 'package'] } } } },
            },
            // A leaf package may build on another leaf package, and on nothing
            // above it. This is the rule that makes "an import from
            // packages/domain into a client-only or server-only module fails
            // lint" true rather than conventional.
            {
              from: { element: { type: 'package' } },
              allow: { to: { element: { type: 'package' } } },
            },
            // Third-party modules are governed by the licence rules in
            // CONTRIBUTING.md and by the per-package allowlist #24 adds, not by
            // this rule.
            { allow: { to: { module: { origin: 'external' } } } },
          ],
        },
      ],
    },
  },

  // --- packages/domain depends on no platform API at all ---------------------
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: PLATFORM_IMPORT_PATTERNS }],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'process',
          'Buffer',
          '__dirname',
        ].map((name) => ({
          name,
          message:
            'packages/domain depends on no platform API at all (ADR 0005 decision D, docs/architecture.md).',
        })),
      ],
    },
  },

  // --- Tests -----------------------------------------------------------------
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      // An expectation on a promise that is never awaited passes silently.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
