// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitest configuration for `@onyourleft/instance`.
 *
 * **Imports nothing**, for the reason `packages/domain/vitest.config.ts`
 * records: `vitest/config`'s declarations pull all of `@types/node` into the
 * program this file belongs to. This program has Node's types anyway, but a
 * plain object is the shape every package here uses, so there is one rule.
 */
export default {
  test: {
    name: 'instance',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
};
