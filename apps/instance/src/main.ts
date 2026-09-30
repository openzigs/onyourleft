// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerHooks } from 'node:module';

import { resolveExtensionless } from './node-imports.ts';

/**
 * The instance's entry point: `node src/main.ts` (#767).
 *
 * It does one thing before anything else is loaded: registers the resolve
 * hook that lets Node load this repository's packages, whose relative imports
 * name no extension (`node-imports.ts`, #780). Everything that reaches a
 * package is therefore imported AFTER it, with `import()`, from `serve.ts` —
 * a static import here would be resolved before this line runs.
 *
 * Node 24 strips the types itself, so there is no build step and the image
 * runs these files as they are committed. `scripts/check-wiring.mjs` reads this
 * path out of `package.json`'s `main`, and follows the literal `import()`.
 */

registerHooks({ resolve: resolveExtensionless });

await import('./serve.ts');
