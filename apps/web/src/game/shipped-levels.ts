// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The built-in Delivery level files the app ships**, as loaders — #2361,
 * ADR 0065 D-2.5. Vite turns each file under `delivery/levels/data/` into a
 * chunk of its own, loaded only when the game asks for the levels;
 * `import.meta.glob` is resolved at build time, so nothing here is a request.
 *
 * ⚠️ **Here and not in `delivery/levels/levels.ts`**, because
 * `delivery/delivery-cannot-reach-trainer.test.ts` refuses any
 * `import.meta.glob` in a module it walks, rather than pass over what it may
 * load. What this loads is JSON, which runs nothing; `levels.ts` §`loadBuiltInLevels`
 * is handed these loaders. Nothing under `delivery/` may import this module.
 *
 * @unwired #2361 ships no level file, so this loads nothing yet; the tests
 * read it, and #2362 hands it to the game beside `GamePort.listCircuits`.
 */

import type { LevelLoaders } from './delivery/levels/levels';

export const SHIPPED_LEVEL_FILES: LevelLoaders = import.meta.glob('./delivery/levels/data/*.json', {
  import: 'default',
});
