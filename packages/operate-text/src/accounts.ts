// SPDX-License-Identifier: Apache-2.0

/**
 * **Accounts**' words (#2605, moved by #2644, ADR 0069 D-7): the registration
 * mode in words, read by Status's short line and by the Accounts section's
 * sentence, in the app and on the instance's admin pages alike.
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
