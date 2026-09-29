// SPDX-License-Identifier: Apache-2.0

/**
 * Vite's `?raw` suffix: a module's text as a string. Declared here rather than
 * through `vite/client`'s types, whose declarations would pull `@types/node`
 * and the DOM into a program that forbids both (`tsconfig.json`). Only a test
 * uses it — `draft.test.ts` reads `draft.ts`'s source for a forbidden name —
 * and only Vitest resolves it; nothing shipped imports a `?raw` module.
 */
declare module '*?raw' {
  const text: string;
  export default text;
}
