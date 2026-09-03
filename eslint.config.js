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
 *      "no platform API at all". `packages/domain/tsconfig.json` narrows `lib`
 *      to ES2024 and empties `types`, which is a closure no denylist can match:
 *      every name and every module outside the ES library becomes a compile
 *      error. But that closure is conditional — one `.d.ts` with a
 *      `/// <reference types="node" />` anywhere in the package's program
 *      reopens it, and until #23's review `vitest.config.ts` did exactly that,
 *      so `fetch` and `process` typechecked cleanly inside the package that
 *      forbids them. These rules are the half that does not depend on that
 *      condition holding. Keep both; check both with a probe file.
 */

import { builtinModules } from 'node:module';

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
 * Every Node builtin, in its bare spelling and every subpath — `events`,
 * `stream/promises`, `util` and the ~40 others — derived from the running
 * Node's own `builtinModules` rather than typed out.
 *
 * Derived, not enumerated, deliberately. A hand-written sample of the list is
 * indistinguishable from the complete list until someone imports the one that
 * was left off, and a partial guard behind a doc that says "no Node globals"
 * is worse than no guard: it reads as a solved problem. Names that already
 * carry the `node:` prefix in that array (`node:test`, `node:sqlite`) are
 * dropped here because the `node:*` group below covers every prefixed
 * spelling, including builtins added by a future Node.
 *
 * ⚠️ **The trailing negation is not optional.** `group` patterns are matched
 * with gitignore semantics, where a pattern containing no slash matches *any
 * path segment* — so the bare builtin `domain` matches the specifier
 * `@onyourleft/domain`, and every workspace package that imports the units
 * package is reported as importing a Node builtin. `packages/domain` never hit
 * it because it does not import itself; `packages/sensors` (#39) hit it on the
 * first import, and `packages/fit` (#29) and `packages/store` (#26) would each
 * have hit it too. The same collision is waiting for `@onyourleft/test`,
 * `@onyourleft/http` and any other scope member whose last segment is a
 * builtin's name, which is why the exemption is written for the scope rather
 * than for `domain` alone. It exempts nothing that is not already governed by
 * `boundaries/dependencies`, which is what decides which workspace package may
 * import which.
 */
const NODE_BUILTIN_SPECIFIERS = [
  ...new Set(
    builtinModules
      .filter((name) => !name.startsWith('node:'))
      .flatMap((name) => [name, `${name}/*`]),
  ),
  '!@onyourleft/*',
];

/**
 * Module specifiers a platform-isolated package may not name. The DOM, Node and
 * network globals are unreachable there through its `tsconfig.json`; what
 * remains reachable is an `import`, because a module specifier is resolved
 * before `lib` has anything to say about it — and because an explicit
 * `import … from 'events'` resolves through the workspace root's @types/node
 * whatever `types: []` says.
 *
 * The messages do not name a package, because two packages now share this list
 * — `packages/domain` (#25) and `packages/sensors` (#39). They are isolated for
 * the same reason in different words: domain's code signs a record on a device
 * and verifies it on an instance, and sensors' interfaces have to be satisfied
 * unchanged by Web Bluetooth, CoreBluetooth and the Android BLE APIs.
 */
const PLATFORM_IMPORT_PATTERNS = [
  {
    group: ['node:*'],
    message:
      'This package depends on no platform API at all — the same code has to run in a browser, in a native shell and on an instance (docs/architecture.md).',
  },
  {
    group: NODE_BUILTIN_SPECIFIERS,
    message:
      'This package depends on no platform API at all. A Node builtin here means it can no longer run in a browser.',
  },
  {
    group: ['react', 'react-dom', 'react-dom/*', 'vite', 'dexie'],
    message:
      'This package is rendering-, storage- and framework-free. Rendering belongs in apps/web; persistence belongs in packages/store.',
  },
];

/**
 * What `packages/sensors` may not name on top of the shared list.
 *
 * A BLE *library* is not a platform global, so neither the `lib` narrowing nor
 * `PLATFORM_GLOBALS` can see it — and importing one is the single most likely
 * way for #39's abstraction to acquire a transport. The point of #39 is that the
 * same interfaces are implemented by Web Bluetooth (#40), by the Capacitor
 * plugin over CoreBluetooth and Android BLE (#15) and by the simulator (#44);
 * a package that imports any one of them has chosen it for all three.
 */
const BLE_LIBRARY_IMPORT_PATTERNS = [
  {
    group: ['@capacitor-community/bluetooth-le', '@capacitor/*', 'webbluetooth', 'noble', 'bleno'],
    message:
      'packages/sensors defines the transport-agnostic abstraction and implements no transport. A BLE library belongs in the adapter that owns it — #40 for Web Bluetooth, #15 for the native stacks.',
  },
];

/**
 * Globals a platform-isolated package may not name.
 *
 * The package's own `tsconfig.json` is the closure here — `lib: ["ES2024"]` with
 * `types: []` makes *any* name outside the ES library a compile error, which is
 * a guarantee no denylist can offer. This list is the fast duplicate: it fires
 * in the editor on keystroke and in `pnpm run lint` seconds before a typecheck
 * finishes, with a message that says why rather than "Cannot find name".
 * Grouped by what each name would drag in.
 */
const PLATFORM_GLOBALS = [
  // DOM and browser storage.
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  // Node.
  'process',
  'Buffer',
  '__dirname',
  '__filename',
  'global',
  'require',
  // Network I/O. `fetch` is the one that matters most: it is a global in both
  // Node 24 and every browser, so it is the shortest path from "pure leaf
  // package" to an outbound request.
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Request',
  'Response',
  'Headers',
];

/**
 * The rules that make "this package depends on no platform API at all" a lint
 * error as well as a compile error.
 *
 * A function rather than a copied block, because two packages now use it and a
 * copy is the version that gets extended in one place only. `extraPatterns` is
 * for restrictions that belong to one package — the BLE libraries, for
 * `packages/sensors`.
 */
const platformIsolation = (extraPatterns = []) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    { patterns: [...PLATFORM_IMPORT_PATTERNS, ...extraPatterns] },
  ],
  'no-restricted-globals': [
    'error',
    ...PLATFORM_GLOBALS.map((name) => ({
      name,
      message:
        'This package depends on no platform API at all (ADR 0005 decision D, docs/architecture.md).',
    })),
  ],
});

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
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
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
  // `.tsx` is included even though a package that renders is already a design
  // error: the header block above already covers `packages/**/*.{ts,tsx}`, and
  // two rules that disagree about which files they cover is exactly the kind of
  // gap nobody notices at the moment it starts to matter.
  {
    files: ['packages/domain/**/*.{ts,tsx}'],
    rules: platformIsolation(),
  },

  // --- packages/sensors depends on no platform API either --------------------
  // #39 defines the shape every BLE transport implements, and its second
  // acceptance criterion is that Web Bluetooth *and* a native stack satisfy it
  // unchanged. An interface that can name `navigator.bluetooth` — or a
  // `BluetoothRemoteGATTCharacteristic`, or a `DataView` full of GATT payload —
  // has already chosen one of the three, and #15 becomes a rewrite of the
  // protocol layer rather than an adapter. `packages/sensors/tsconfig.json`
  // narrows `lib` and empties `types` for the same reason; these rules are the
  // half that does not depend on that narrowing surviving a stray
  // `/// <reference types="node" />`.
  //
  // ⚠️ **#40's Web Bluetooth adapter needs the DOM and does not belong under
  // this block.** docs/architecture.md puts the transport in this package with
  // the constraint that "Web Bluetooth types must not escape above the transport
  // boundary" — so the adapter arrives in its own directory with its own
  // tsconfig (DOM in `lib`) and its own entry here, and `packages/sensors/src`
  // stays platform-free. Narrow this block's `files` when that lands; do not
  // widen the tsconfig.
  {
    files: ['packages/sensors/**/*.{ts,tsx}'],
    rules: platformIsolation(BLE_LIBRARY_IMPORT_PATTERNS),
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
