// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pnpm --filter @onyourleft/instance run test:workerd` — the Durable Object
 * adapter (#781) under a real `workerd`, on this machine, with no Cloudflare
 * account: the conformance suite with the `workerd` adapter switched on, and
 * the alarm and hibernation cases, which wait on the runtime's own clock.
 *
 * **Not in CI**, and not in `pnpm run test`: it spawns a runtime and spends
 * about half a minute waiting for alarms and for an eviction, which the one
 * required job cannot afford (docs/agents/ci.md §4c). `vitest.config.ts` excludes the
 * `*.workerd.test.ts` files for that reason.
 *
 * Imports nothing, for `vitest.config.ts`' reason.
 */
export default {
  test: {
    name: 'instance-workerd',
    environment: 'node',
    include: ['src/room/conformance.test.ts', 'src/**/*.workerd.test.ts'],
    provide: { workerd: true },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};
