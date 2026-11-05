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

/**
 * Vite's `import.meta.glob`, as eagerly as `?raw` above and for the same
 * reason declared here: `pacer.test.ts` reads every source file in this
 * package to find the callers of `advancePlannedBot` (#1960). Only Vitest
 * transforms it.
 */
interface ImportMeta {
  glob<T>(
    patterns: string | readonly string[],
    options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true },
  ): Record<string, T>;
}
