// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The runner's deadlines against the Android shell's native read timeout —
 * the one case of `@onyourleft/analysis`'s `runner.test.ts` that reads
 * `@onyourleft/mobile`, which a package may not import, so it stayed in the
 * app when #1094 moved the runner. Unchanged in assertion.
 */

import { ANALYSIS_TEMPLATES, RUN_BUDGET_MILLISECONDS } from '@onyourleft/analysis';
import { ANALYSIS_READ_TIMEOUT_MILLISECONDS } from '@onyourleft/mobile';
import { describe, expect, it } from 'vitest';

describe('the deadlines', () => {
  it('sets every step’s deadline within the native transport’s read timeout, and the run’s beyond any one step', () => {
    for (const template of ANALYSIS_TEMPLATES) {
      for (const step of template.steps) {
        expect(step.bounds.deadlineMilliseconds).toBeGreaterThan(0);
        // ⚠️ Equal, for the summary and the rewrite (#810 set 120 s against
        // this very timeout). Either one ending first is a failed step.
        expect(step.bounds.deadlineMilliseconds).toBeLessThanOrEqual(
          ANALYSIS_READ_TIMEOUT_MILLISECONDS,
        );
        expect(step.bounds.deadlineMilliseconds).toBeLessThan(RUN_BUDGET_MILLISECONDS);
      }
    }
  });
});
