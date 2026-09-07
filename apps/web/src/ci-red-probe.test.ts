// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

/** Throwaway. Proves CI's test step can go red. Never merged. */
describe('the CI test step', () => {
  it('can go red', () => {
    expect(1).toBe(2);
  });
});
