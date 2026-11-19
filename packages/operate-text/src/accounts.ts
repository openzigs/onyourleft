// SPDX-License-Identifier: Apache-2.0

import type { OperateLine } from './analysis';

/**
 * **Accounts**' words (#2605, moved by #2644, ADR 0069 D-7): the registration
 * mode in words, read by Status's short line and by the Accounts section's
 * sentence, in the app and on the instance's admin pages alike — and since
 * #2646 the steps to change it on the host and the standings' counts, which
 * the app's `OperateAccountsPanel` and the admin Accounts page both draw.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/**
 * How the instance takes new riders, by its own names for it
 * (`apps/instance/src/config.ts` §`REGISTRATION_MODES`, which
 * `apps/web/src/views/OperateAccountsPanel.test.tsx` holds the table below to).
 */
export type OperateRegistrationMode = 'approval' | 'invite' | 'open' | 'closed';

/**
 * Every registration mode, in words: the ONE table both Status's short line
 * and the Accounts section's sentence are read from. Keyed by the mode type,
 * so a mode added there and not here is a type error, and its key order is the
 * order the steps to change the mode name them in.
 */
export const REGISTRATION_MODE_TEXT: Readonly<
  Record<OperateRegistrationMode, { readonly short: string; readonly meaning: string }>
> = {
  approval: {
    short: 'approval: a moderator approves each account',
    meaning:
      'A new rider’s account waits until a moderator approves it; until then other riders cannot see it.',
  },
  invite: {
    short: 'invite: only with an invite code',
    meaning:
      'A new rider joins only with a single-use invitation from a moderator, good for seven days.',
  },
  open: {
    short: 'open: anybody may join',
    meaning: 'Anybody who reaches the instance gets an active account at once.',
  },
  closed: {
    short: 'closed: nobody new may join',
    meaning: 'Nobody new can join.',
  },
};

/** What every mode has in common, behind the mode heading's ⓘ. */
export const MODERATORS_ALWAYS_JOIN =
  'In every mode, the keys named as owner and deputy sign in with an active account.';

/** Said in place of the counts when the owner's read of the status did not come (moved by #2646). */
export const ACCOUNTS_UNREADABLE_TEXT =
  'The account counts could not be read from the instance, so they are not shown here.';

/** The heading over the steps to change the mode. */
export const REGISTRATION_CHANGE_HEADING = 'Changing the mode';

/**
 * The steps to change the mode on the host (#2605; moved by #2646, ADR 0069
 * D-7): the mode is shown, never changed at runtime here (#2601's decision 2;
 * since ADR 0080 D-6 the setup wizard and `operator registration` may set it).
 * Each step one line, its file names, variable, modes and commands as code.
 */
export const REGISTRATION_CHANGE_STEPS: readonly OperateLine[] = [
  ['Open the ', { code: '.env' }, ' file beside ', { code: 'compose.yaml' }, '.'],
  [
    'Set ',
    { code: 'OYL_INSTANCE_REGISTRATION' },
    ' to ',
    ...(Object.keys(REGISTRATION_MODE_TEXT) as OperateRegistrationMode[]).flatMap(
      (mode, index, modes): OperateLine => [
        { code: mode },
        index === modes.length - 1 ? '.' : index === modes.length - 2 ? ' or ' : ', ',
      ],
    ),
  ],
  [
    'In that folder, run ',
    { code: 'docker compose up -d instance' },
    ', which starts the instance again with the new mode. ',
    { code: 'docker compose restart' },
    ' does not read ',
    { code: '.env' },
    ' again.',
  ],
  // #2784 (ADR 0080 D-6): a mode the setup page or the command chose wins over `.env`.
  [
    'If the setup page or ',
    { code: 'operator registration set' },
    ' chose the mode, the instance holds it over ',
    { code: '.env' },
    ': run ',
    { code: 'operator registration clear' },
    ' too, or set the new mode with ',
    { code: 'operator registration set' },
    ' instead.',
  ],
];

/** How many accounts are in each standing, as `GET /v1/operate/status` counts them. */
export interface OperateAccountCounts {
  readonly active: number;
  readonly pending: number;
  readonly suspended: number;
}

/** The standings in words, awaiting approval first: what the owner acts on. */
export function accountStandingLines(counts: OperateAccountCounts): readonly string[] {
  return [
    `${String(counts.pending)} awaiting approval`,
    `${String(counts.active)} approved and active`,
    `${String(counts.suspended)} suspended`,
  ];
}
