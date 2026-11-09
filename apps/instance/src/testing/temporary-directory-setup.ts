// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `instance` project's setup file (`vitest.config.ts`'s `setupFiles`):
 * before each test file, a temporary directory in memory when there is one;
 * after it, that directory gone (#2398). `temporary-directory.ts` says why.
 */

import { afterAll } from 'vitest';
import { ramTemporaryRoot, useTemporaryDirectoryIn } from './temporary-directory.ts';

afterAll(useTemporaryDirectoryIn(ramTemporaryRoot()));
