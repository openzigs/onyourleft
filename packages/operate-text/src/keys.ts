// SPDX-License-Identifier: Apache-2.0

/**
 * **Keys**' words (#2613, ADR 0069 D-7): the sentences the Keys section says
 * over what `GET /v1/operate/keys` returns, and what rotating the encryption
 * key does. The instance's admin Keys page (#2650) says the same, and shows
 * the card on the loopback listener only (ADR 0069 D-2).
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** What the card is, above it. */
export const KEYS_CARD_TEXT =
  'The instance’s card. A rider’s app checks every key the instance offers against it. Give it ' +
  'to riders yourself, by a way the internet in between cannot change.';

/** What the fingerprint is, above it. */
export const KEYS_FINGERPRINT_TEXT =
  'The identity key’s fingerprint, which the card carries. Read it to a rider to check theirs.';

/** The QR code's accessible name. */
export const KEYS_CARD_PICTURE_LABEL = 'The instance’s card, for a rider’s device';

/** Said in place of the section when the owner's read of it did not come. */
export const KEYS_UNREADABLE_TEXT =
  'The instance’s keys could not be read from the instance, so they are not shown here.';

/** What rotating does, said in its confirmation and beside its button. */
export const ROTATE_KEY_TEXT =
  'Rotating makes a new encryption key now. The old one keeps working for 7 days. Devices pick ' +
  'the new key up by themselves, and nobody needs to pin the card again.';

/** The word the owner types to rotate. */
export const ROTATE_CONFIRM_WORD = 'rotate';

/** How the owner confirms. */
export const ROTATE_TYPE_TEXT = `To rotate it, type ${ROTATE_CONFIRM_WORD}.`;

/** Said when a rotation was refused because the instance's own key maintenance was running. */
export const ROTATE_BUSY_TEXT =
  'The instance was looking after its keys just then, so nothing was rotated. Try again in a minute.';

/** Said when a rotation did not happen for any other reason. */
export const ROTATE_NOT_DONE_TEXT =
  'The instance did not rotate the key, so it is as it was. Read the keys again and try once more.';

/** What stays on the command line, and why: one short line. */
export const KEYS_CLI_TEXT =
  'These stay on the host’s command line: each makes every device pin again, or answers a leak.';

/** The three commands that stay on the CLI, as the home deployment runs them. */
export const KEYS_CLI_COMMANDS: readonly { readonly what: string; readonly command: string }[] = [
  {
    what: 'Rotate and drop every old encryption key at once, after a leak',
    command:
      'docker compose run --rm --no-deps -T instance node src/operator/cli.ts instance-key rotate --drop-old',
  },
  {
    what: 'Make a new identity key: every device pins the new card',
    command:
      'docker compose run --rm --no-deps -T instance node src/operator/cli.ts instance-key rotate-identity',
  },
  {
    what: 'Throw every key away and make new ones: every device pins the new card',
    command:
      'docker compose run --rm --no-deps -T instance node src/operator/cli.ts instance-key reset',
  },
];

/** The current encryption key, as a fact's value: "1790000000, made 2026-11-14 08:00 UTC". */
export function currentKeyText(serial: number, made: string): string {
  return `${String(serial)}, made ${made}`;
}

/** How many older keys are still held, as a fact's value. */
export function olderHeldText(count: number): string {
  if (count === 0) return 'none';
  return `${String(count)}, each kept 7 days after the next was made`;
}
