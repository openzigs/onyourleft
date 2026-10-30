// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The words of changing your name on an instance (#906 item 2), in a module
 * of their own so that the privacy policy's test can hold the policy to the
 * button's label without compiling a React view, as `erase-account-text.ts`.
 *
 * ⚠️ Rider-facing wording, quoted in the pull request for the owner's approval.
 */

/**
 * The Instance screen's words for a signed-in rider. `earlierNames` is the
 * disclosure the owner asked for (2026-09-30: "earlier names are kept and
 * disclosed"), said above the press.
 */
export const CHANGE_NAME_TEXT = {
  heading: 'Change your name there',
  label: 'The new name other riders will see',
  earlierNames:
    'The instance keeps each name you had before, and when you changed it, with your account, ' +
    'for moderation. They are deleted when your account there is deleted.',
  change: 'Change my name',
  changed: 'Your name there is changed.',
} as const;
