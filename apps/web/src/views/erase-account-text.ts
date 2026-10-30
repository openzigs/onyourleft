// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The words of deleting an account on an instance (#906), in a module of
 * their own so that `apps/mobile`'s Data Safety test can hold its answer to
 * the button's label without compiling a React view.
 *
 * ⚠️ Rider-facing wording, quoted in the pull request for the owner's approval.
 */

/**
 * The Instance screen's words for a signed-in rider (#906). The button's label
 * is the suspended rider's (#1528, owner-approved), so the app names one press
 * wherever it is, and the privacy policy and the web page for requesting
 * deletion name that label.
 */
export const ERASE_ACCOUNT_TEXT = {
  heading: 'Delete your account on this instance',
  intro:
    'You can delete your account on this instance, and everything it holds about you, from ' +
    'here. Nothing on this device is deleted.',
  erase: 'Delete my account on this instance',
  confirm:
    'This deletes your account and everything this instance holds about you, and cannot be ' +
    'undone. It cannot reach a copy anyone already saved, or another instance. The moderation ' +
    'log is kept. Nothing on this device is deleted: your rides stay here, and this device ' +
    'stops being signed in to the instance.',
  confirmErase: 'Delete it',
  keep: 'Keep my account',
  erased:
    'Your account on this instance was deleted, and this device is no longer signed in to it. ' +
    'Your rides are still on this device.',
} as const;
