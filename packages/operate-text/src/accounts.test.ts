// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  accountStandingLines,
  REGISTRATION_CHANGE_STEPS,
  REGISTRATION_MODE_TEXT,
} from './accounts';

const text = (line: readonly (string | { readonly code: string })[]): string =>
  line.map((part) => (typeof part === 'string' ? part : part.code)).join('');

describe('Accounts’ words (#2646)', () => {
  it('names every mode in the steps, in the table’s order, each as code', () => {
    expect(REGISTRATION_CHANGE_STEPS.map(text)).toEqual([
      'Open the .env file beside compose.yaml.',
      'Set OYL_INSTANCE_REGISTRATION to approval, invite, open or closed.',
      'In that folder, run docker compose up -d instance, which starts the instance again with the new mode. docker compose restart does not read .env again.',
    ]);
    const codes = (REGISTRATION_CHANGE_STEPS[1] ?? []).flatMap((part) =>
      typeof part === 'string' ? [] : [part.code],
    );
    expect(codes).toEqual(['OYL_INSTANCE_REGISTRATION', ...Object.keys(REGISTRATION_MODE_TEXT)]);
  });

  it('says each standing’s count, awaiting approval first', () => {
    expect(accountStandingLines({ active: 3, pending: 1, suspended: 0 })).toEqual([
      '1 awaiting approval',
      '3 approved and active',
      '0 suspended',
    ]);
  });
});
