// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/sensors`.
 *
 * **Deliberately imports nothing**, for the reason `packages/domain`'s copy of
 * this file records: `import { defineConfig } from 'vitest/config'` pulls Vite's
 * type declarations into this package's TypeScript program, and those declare
 * `/// <reference types="node" />`. That reference reaches @types/node from the
 * workspace root and defeats the `types: []` narrowing in `tsconfig.json` —
 * which is the thing that makes `process`, `Buffer`, `fetch` and `navigator`
 * compile errors here. A config file is part of the same program as `src/`, so
 * a type that leaks in here leaks in everywhere.
 *
 * That is not a hypothetical: it is exactly how the guard was silently broken in
 * `packages/domain` until #23's review (CLAUDE.md §4d). Vitest accepts a plain
 * object, and `defineConfig` is only an identity function for editor typing.
 */
export default {
  test: {
    name: 'sensors',
    // `node` rather than a DOM environment, deliberately. This package must hold
    // in an environment with neither a DOM nor a filesystem — it is the half of
    // the sensor stack that has to compile for CoreBluetooth and Android BLE as
    // well as for Web Bluetooth. A run under jsdom would hide an accidental
    // `navigator` reference behind a global that happened to exist.
    environment: 'node',
    // `web-bluetooth/` is here too, and under the same `node` environment
    // rather than a DOM one. That is deliberate twice over. The adapter is
    // handed its `BluetoothPort`, so a DOM environment would add nothing it
    // uses — and running it where `navigator` exists with no `bluetooth` on it
    // is the Safari, Firefox and plain-HTTP path, asserted for real rather
    // than simulated by deleting a global.
    include: ['src/**/*.test.ts', 'web-bluetooth/**/*.test.ts'],
  },
};
