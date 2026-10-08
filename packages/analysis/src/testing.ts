// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/analysis/testing` — test support, never shipped: imported only
 * by tests, here and in `apps/web` (the store's `@onyourleft/store/testing`
 * precedent).
 *
 * ⚠️ `sealStep` is here and not in `index.ts`: only `runner.ts` may seal a
 * step in shipped code (#803), and the tests that hand a transport a sealed
 * step need one. `sealed-step.test.ts` and `apps/web`'s
 * `ride-analysis/sealed-step-app.test.ts` hold that no shipped module but the
 * runner names it.
 */

export * from './personal-details-testing';
export { sealStep } from './sealed-step';
export { everyPrompt, textOf } from './template/template-fixtures-testing';
