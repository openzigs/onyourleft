// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The emergency kit** (#2781, ADR 0080 D-4): one text file holding each
 * secret the instance read from its secrets folder, the `OYL_INSTANCE_ORIGIN`
 * they are bound to, the instance card (public), and a few lines on where to
 * keep it and how to restore with it. It is what makes an off-box backup
 * restorable after the machine is lost: without it, a restore makes new
 * instance keys and every device has to pin again.
 *
 * It never holds a setup code, a claim code, a passkey or any rider's data,
 * and it is served on the loopback listener only (`admin/admin.ts`), never as
 * a QR — a QR on a screen is easier to photograph than a file is to copy.
 */

import type { SecretFromFile } from './secrets.ts';

/** The name the browser saves the kit under. */
export const EMERGENCY_KIT_FILE_NAME = 'onyourleft-emergency-kit.txt';

export interface EmergencyKitView {
  /** `OYL_INSTANCE_ORIGIN`. */
  readonly origin: string;
  /** `oyl-instance:<origin>#<fingerprint>`, or `null` when the keys could not be read. */
  readonly card: string | null;
  readonly secrets: readonly SecretFromFile[];
  readonly madeAt: Date;
}

/** The kit's text, lines ending `\n`. */
export function emergencyKitText(view: EmergencyKitView): string {
  const lines = [
    'On Your Left instance: emergency kit',
    `Made ${view.madeAt.toISOString()} for ${view.origin}`,
    '',
    'KEEP THIS FILE SAFE, AND AWAY FROM YOUR BACKUPS.',
    'Put it in a password manager, or print it and keep the paper somewhere safe.',
    'Never keep it beside the backup folders, on this machine or with your backups:',
    'whoever holds this file and a backup can pretend to be your instance to every',
    'device that trusts it.',
    '',
    'The address the instance keys are bound to. Keep it the same on a new machine:',
    `OYL_INSTANCE_ORIGIN=${view.origin}`,
    '',
    'The secrets, as .env spells them:',
    ...view.secrets.map((each) => `${each.variable}=${each.text}`),
    '',
    'The instance card (public: your devices already hold it):',
    view.card ?? 'not readable when this kit was made',
    '',
    'To restore on a new machine:',
    '1. Copy the deployment folder there and set OYL_INSTANCE_ORIGIN in .env as above.',
    '2. Put each secret in its own file in the secrets folder beside compose.yaml,',
    `   the value alone on one line: ${view.secrets
      .map((each) => `${each.file} for ${each.variable}`)
      .join(', ')}.`,
    '   On Linux, make each file owner-only (chmod 600) and owned by uid 1000.',
    '3. Restore the backup, then start the instance (docs/operating-an-instance.md, "Restore").',
    'Every device that pinned this instance keeps trusting it.',
  ];
  return `${lines.join('\n')}\n`;
}
