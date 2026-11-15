// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The built-in Delivery level files the app ships**, as loaders — #2361,
 * ADR 0065 D-2.5. Vite turns each file under `delivery/levels/data/` into a
 * chunk of its own, loaded only when that level is chosen;
 * `import.meta.glob` is resolved at build time, so nothing here is a request.
 *
 * ⚠️ **Here and not in `delivery/levels/levels.ts`**, because
 * `delivery/delivery-cannot-reach-trainer.test.ts` refuses any
 * `import.meta.glob` in a module it walks, rather than pass over what it may
 * load. What this loads is JSON, which runs nothing; `levels.ts` §`levelLibrary`
 * is handed these loaders. Nothing under `delivery/` may import this module.
 *
 * #2362: `main.tsx` hands {@link SHIPPED_LEVELS} to the game as
 * `GamePort.listDeliveryLevels` and `GamePort.loadDeliveryLevel`, beside
 * `GamePort.listCircuits`: the listing is the catalogue's, and a file is read
 * only for the level the rider chose.
 */

import { LEVEL_CATALOGUE } from './delivery/levels/catalogue';
import { levelLibrary, type LevelLoaders } from './delivery/levels/levels';

export const SHIPPED_LEVEL_FILES: LevelLoaders = import.meta.glob('./delivery/levels/data/*.json', {
  import: 'default',
});

/** The shipped levels: listed from the catalogue, each file loaded only when chosen. */
export const SHIPPED_LEVELS = levelLibrary(SHIPPED_LEVEL_FILES, LEVEL_CATALOGUE);
