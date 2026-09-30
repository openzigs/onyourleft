// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../../node-imports.ts';

/**
 * A room worker's entry point (#780): what the router forks, one per core.
 * The resolve hook goes first, for the reason `main.ts` gives, and the worker
 * itself (`worker.ts`, which reaches the room core and so the packages) is
 * imported after it.
 */

registerHooks({ resolve: resolveExtensionless });

await import('./worker.ts');
