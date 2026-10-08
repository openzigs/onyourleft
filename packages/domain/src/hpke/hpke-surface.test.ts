// SPDX-License-Identifier: Apache-2.0

/**
 * The package's public surface carries no way to choose an HPKE ephemeral key
 * (#1188, ADR 0047 D-3).
 *
 * The guarantee is compile-time, so it is held the way `CLAUDE.md` §5 says a
 * compile-time guarantee is held: each `@ts-expect-error` below documents a
 * name `src/index.ts` must NOT export, and **exporting it turns the typecheck
 * red with `TS2578: Unused '@ts-expect-error' directive`**. The runtime
 * `undefined` check is the second half, for a run that skips the typecheck.
 *
 * The other half of "no production module can reach it" is
 * `eslint.config.js` §`HPKE_TESTING_IMPORT_PATTERNS`: the only module that
 * carries the injection is `hpke-testing.ts`, and that rule refuses its import
 * outside a test or test support.
 */

import { describe, expect, it } from 'vitest';

import * as domain from '../index';

describe('the HPKE surface of @onyourleft/domain — #1188', () => {
  it('exports no sender that takes an injected ephemeral key pair', () => {
    // @ts-expect-error -- the injected-ephemeral Encap is test support only.
    expect(domain.setupBaseSenderWithEphemeral).toBeUndefined();
    // @ts-expect-error -- the option-taking core is not on the surface either.
    expect(domain.setupSender).toBeUndefined();
    // @ts-expect-error -- nor is the bare Encap, which takes an ephemeral key.
    expect(domain.encap).toBeUndefined();
  });

  it('exports the production sender, which takes no key of the caller’s', () => {
    expect(domain.setupBaseSender).toHaveLength(3);
  });
});
