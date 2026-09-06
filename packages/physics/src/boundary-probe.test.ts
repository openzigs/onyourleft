// SPDX-License-Identifier: Apache-2.0

/**
 * #163: a relative import that crosses a directory boundary into a file named
 * after a Node builtin has to be allowed from a platform-isolated package.
 *
 * The specifier below — `./boundary-probe/constants` — is the case the
 * slashless negations missed. This file is a lint fixture first and a unit test
 * second: `pnpm run lint` is what actually checks the guarantee, and the
 * assertion exists so the fixture is a module something imports rather than
 * dead code sitting in the coverage denominator.
 */

import { describe, expect, it } from 'vitest';

import { BOUNDARY_PROBE } from './boundary-probe/constants';

describe('the node-builtin import negation reaches below the package root', () => {
  it('can import a nested module named after a builtin', () => {
    expect(BOUNDARY_PROBE).toBe(163);
  });
});
