// SPDX-License-Identifier: Apache-2.0

/**
 * **The first-run setup wizard's words** (#2784, ADR 0080 D-1, D-2, D-4, D-6,
 * D-7): what the instance's `/setup` pages on the server machine say, step by
 * step, to an owner who has never edited a `.env` file. Kept here beside the
 * Operate sections' words (ADR 0069 D-7), so the app can say the same thing
 * one day without a second copy.
 *
 * Nothing here is a code, a key, a secret or an address of anybody's: a page
 * puts those in, escaped, where it must.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** The wizard's steps, in order: `apps/instance`'s `SETUP_STEPS`, which its tests hold this to. */
export type OperateSetupStep =
  'claim' | 'passkey' | 'secrets' | 'backups' | 'registration' | 'invite' | 'finish';

/** Each step's name, in the steps list and as its page's heading. */
export const SETUP_STEP_NAMES: Readonly<Record<OperateSetupStep, string>> = {
  claim: 'Claim it with your tablet',
  passkey: 'A passkey for the admin pages',
  secrets: 'The emergency kit',
  backups: 'Backups',
  registration: 'Who may join',
  invite: 'Invite a rider',
  finish: 'Finish',
};

/** The title every setup page carries. */
export const SETUP_TITLE = 'Set up this instance';

/** The locked page: what the code is and where it is. */
export const SETUP_LOCKED_LEAD =
  'This page sets up the instance, on this machine only. To begin, type the setup code. It is in the file setup-code, in the secrets folder beside compose.yaml. A code works once, for 10 minutes.';

/** How to get a new code, without a button the tunnel could press (ADR 0080 D-2). */
export const SETUP_NEW_CODE_TEXT =
  'Each start of the instance makes a new code. If yours has run out, restart the instance (docker compose restart instance) and open the file again, or run the setup-code command on this machine.';

/** The code's label. */
export const SETUP_CODE_LABEL = 'Setup code';

/** The one sentence for a code that was not accepted, whatever the reason (ADR 0080 D-2). */
export const SETUP_CODE_REFUSED_TEXT =
  'That code was not accepted. A code works once, for 10 minutes: open the file again after a restart for a new one.';

/** Too many attempts, from this machine or all together (ADR 0069 D-4's limits). */
export const SETUP_TOO_MANY_TEXT = 'Too many attempts. Wait a minute, then try again.';

/** The page for any address but `localhost:<port>` (ADR 0080 D-1). */
export const SETUP_WRONG_ADDRESS_TEXT =
  'The setup page is served at one address only, on this machine:';

/** A form that did not come from the setup page's own origin. */
export const SETUP_FORM_REFUSED_TEXT =
  'That form did not come from this setup page, so nothing was changed. Go back to the setup page and try again.';

/** The line under every step's page: how long the session lasts. */
export const SETUP_SESSION_TEXT =
  'This setup session ends after 15 minutes without use, and 2 hours after you typed the code. Leave whenever you like: the setup starts again at this step.';

/** The button that moves on. */
export const SETUP_NEXT_BUTTON = 'Next step';

/** The steps list's name. */
export const SETUP_STEPS_LABEL = 'Setup steps';

// --- claim (ADR 0080 D-3, D-5)

export const CLAIM_LEAD =
  'Your tablet becomes this instance’s owner: the one account that runs it. Show a claim code here, scan it with the On Your Left app on the tablet, then compare one number on both screens.';
export const CLAIM_SHOW_BUTTON = 'Show the claim code';
export const CLAIM_AFTER_SCAN_TEXT =
  'When the tablet has scanned the code, it shows a six-digit number. Then come back to this step to compare it:';
export const CLAIM_COMPARE_LINK = 'Compare the number';
export const CLAIM_PENDING_LEAD =
  'A tablet has asked to become this instance’s owner. Does the tablet show this number?';
export const CLAIM_PENDING_LABEL = 'The number this instance shows';
export const CLAIM_YES_BUTTON = 'Yes, it shows the same number';
export const CLAIM_NO_BUTTON = 'No, it shows another number or none';
export const CLAIM_NO_TEXT =
  'If the numbers differ, somebody else may have scanned the code: say No, and show a new code.';
export const CLAIMED_TEXT =
  'This instance has an owner: the tablet that claimed it. If that is wrong, run owner-claim reset on this machine and claim it again.';
export const CLAIM_NOT_CONFIRMED_TEXT =
  'That claim could not be confirmed: it ran out, or a new code replaced it. Show a new claim code and scan it again.';
export const CLAIM_NO_CARD_TEXT =
  'The instance’s own keys could not be read, so there is no card to claim it with. The instance makes them when it starts with its secret key: restart it, then come back.';

// --- passkey (ADR 0080 D-7, Q-6)

export const PASSKEY_STEP_LEAD =
  'A passkey lets you sign in to the instance’s admin pages without a code. It is optional, and you can add one at any time.';
/** How to add one, after the setup: `adminAddress` is the admin pages' address on this machine. */
export function passkeyStepHow(adminAddress: string): readonly string[] {
  return [
    'Turn the admin pages on: set OYL_INSTANCE_ADMIN_PAGES=on in .env, then run docker compose up -d instance.',
    `Run the admin-code command on this machine and sign in at ${adminAddress} with the code it prints.`,
    'On the Passkeys page, add a passkey. It reads every page, and changes nothing until you confirm it with the admin-passkeys confirm command on this machine.',
  ];
}
export const PASSKEY_STEP_SKIP = 'You can skip this step now and add a passkey later.';

// --- the emergency kit (ADR 0080 D-4)

export const KIT_STEP_LEAD =
  'The instance made its own secret key when it first started, in the secrets folder. The emergency kit is one text file holding it, with what you need to restore a backup on a new machine.';
export const KIT_KEEP_TEXT =
  'Keep the kit in a password manager, or print it. Never keep it beside the backups: whoever holds the kit and a backup can pretend to be your instance.';
export const KIT_DOWNLOAD_BUTTON = 'Download the emergency kit';
export const KIT_ONCE_TEXT =
  'This setup session offers the kit once. After setup, the admin pages on this machine offer it again behind a passkey check.';
export const KIT_TAKEN_TEXT =
  'The kit was downloaded in this session. Keep it safe, away from the backups.';
export const KIT_NONE_TEXT =
  'There is no emergency kit to download: every secret this instance uses is set in .env, which is your copy of it.';

// --- backups (ADR 0080 D-6)

export const BACKUPS_STEP_LEAD =
  'The backup service takes a snapshot every six hours into the backup folder on this machine, and copies it to the off-box folder.';
export const BACKUPS_FOLDERS_TEXT =
  'The two folders are set in .env, as OYL_BACKUP_DIR and OYL_OFFBOX_DIR, because the backup service is started with them: this page cannot choose them. To change one, edit its line in .env and run the deploy again.';
export const OFFBOX_RULE_TEXT =
  'OYL_OFFBOX_DIR must be a drive or a network share that is not this machine’s own disk, so a backup survives the machine. On Windows a USB stick does not work as that folder: Docker cannot reach it, and every copy fails.';
export const BACKUPS_NONE_YET_TEXT =
  'No backup has run yet. Back up now to check that both folders work.';
export const BACKUPS_LAST_COPIED_TEXT =
  'The last backup was copied to the off-box folder: both folders work.';
export const BACKUPS_LAST_COPY_FAILED_TEXT =
  'The last backup was taken, but it could not be copied to the off-box folder. Check OYL_OFFBOX_DIR in .env, then back up now again.';
export const BACKUPS_LAST_NOT_CONFIGURED_TEXT =
  'The last backup was taken, with no off-box folder to copy it to. Set OYL_OFFBOX_DIR in .env.';
export const BACKUPS_LAST_FAILED_TEXT =
  'The last backup failed. Check OYL_BACKUP_DIR in .env, and that the backup service is running (docker compose ps backup).';
export const BACKUPS_LAST_AT_TEXT = 'The last backup ran at';
export const BACKUPS_WAITING_TEXT =
  'Waiting for the backup service. It takes the snapshot within 30 seconds: read this page again then.';
export const BACKUPS_TOO_SOON_TEXT =
  'A backup ran in the last 15 minutes, or one is already waiting, so no new one was asked for.';
export const BACK_UP_NOW_STEP_BUTTON = 'Back up now';
export const BACKUPS_READ_AGAIN_LINK = 'Read this page again';

// --- registration (ADR 0080 D-6, Q-3)

export const REGISTRATION_STEP_LEAD =
  'Choose how new riders join this instance. You can change it later with the registration command on this machine.';
export const REGISTRATION_STEP_LEGEND = 'How new riders join';
export const REGISTRATION_SAVE_BUTTON = 'Save';
export const REGISTRATION_SAVED_TEXT = 'Saved. A new rider meets this mode from now on.';
export const REGISTRATION_FROM_SETUP_TEXT = 'Chosen here.';
export const REGISTRATION_FROM_ENV_TEXT = 'From .env, as OYL_INSTANCE_REGISTRATION.';
export const REGISTRATION_NOW_TEXT = 'Now:';

// --- invite (ADR 0080 D-7)

export const INVITE_STEP_LEAD =
  'Make one invite for a rider: a code they scan with the On Your Left app, holding this instance’s card and an invitation that works once, for seven days.';
export const INVITE_MAKE_BUTTON = 'Make an invite';
export const INVITE_TAKEN_TEXT =
  'This setup has made its one invite. Moderators make more from the app.';
export const INVITE_NO_OWNER_TEXT =
  'An invite is made by the owner’s account. Open the app on the tablet that claimed this instance and sign in once, then come back.';
export const INVITE_NOT_INVITE_MODE_TEXT =
  'Riders may join without an invite in the mode you chose; the code still carries the instance’s card, so their app trusts it at once.';

// --- finish (ADR 0080 D-7)

export const FINISH_LEAD =
  'Finishing closes this setup page for good: it will not open again, even after a restart. What this setup changed:';
export const FINISH_NOTHING_TEXT = 'This setup has changed nothing yet.';
export const FINISH_BUTTON = 'Finish setup';
export const FINISHED_HEADING = 'Setup is finished';
export const FINISHED_TEXT =
  'The setup page is closed, and the setup code file is gone. Run the instance from the app’s Operate area, or from the admin pages on this machine.';
