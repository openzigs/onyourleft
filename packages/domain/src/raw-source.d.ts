// SPDX-License-Identifier: Apache-2.0

/**
 * Vite's `?raw` suffix: a module's text as a string, as
 * `packages/physics/src/raw-source.d.ts` declares it. It is declared here rather
 * than through `vite/client`'s types, whose declarations would pull
 * `@types/node` and the DOM into a package that forbids both (`tsconfig.json`).
 * Only a test uses it: `lap-race/bots.test.ts` reads the lap race's sources for
 * an import of a recorded ride (#1900). Only Vitest resolves it, and nothing
 * shipped imports a `?raw` module.
 */
declare module '*?raw' {
  const text: string;
  export default text;
}
