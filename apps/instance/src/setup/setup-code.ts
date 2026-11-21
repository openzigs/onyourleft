// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The setup code** (#2784, ADR 0080 D-2): what opens the first-run setup on
 * the loopback listener.
 *
 * - **Shape and life are ADR 0069 D-1's code** (`admin/code.ts`):
 *   `readableCode(16)`, 79 bits, ten minutes, single use, stored only as the
 *   SHA-256 of its normalised form; minting one voids every unused one.
 * - **Minted only while the setup is open**, at every start of the instance
 *   and by `operator setup-code` on the host. Nothing else mints one: a "new
 *   code" button on the locked page would let the tunnel, which can reach that
 *   page on Docker Desktop, void the owner's code at will.
 * - **Kept in the file {@link SETUP_CODE_FILE} in the secrets folder**,
 *   written whole (a `0600` temporary file renamed into place, as the
 *   secrets are), holding the code, when it ends, and which address to type it
 *   into. Only `instance` mounts that folder, no route serves it, and it is
 *   not in the data volume, so no backup carries it off the box. The file is
 *   removed when the code is used and when the setup is done.
 * - **Never in a log line, a page or an operator-log entry.** The instance's
 *   start logs where the code IS ({@link SETUP_LOG_EVENT}), never the code:
 *   a container's standard output is kept by Docker, shipped by log drivers
 *   and pasted into help requests.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ADMIN_CODE_LIFETIME_SECONDS, newAdminCode } from '../admin/code.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { writeWhole } from './secrets.ts';

/** The file in the secrets folder the code is kept in. */
export const SETUP_CODE_FILE = 'setup-code';

/** How long a setup code may be redeemed for, in seconds: ADR 0069 D-1's ten minutes. */
export const SETUP_CODE_LIFETIME_SECONDS = ADMIN_CODE_LIFETIME_SECONDS;

/** The log event that says where the code is (`log.ts` §`EVENT_KEYS`). */
export const SETUP_LOG_EVENT = 'first-run-setup';

/**
 * The log event for an instance whose address is still the settings
 * template's example (#2855), with where the page that says what to set is,
 * when the setup's listener serves it. Written in place of
 * {@link SETUP_LOG_EVENT}: no code is made. Never the address itself.
 */
export const EXAMPLE_ADDRESS_LOG_EVENT = 'example-address';

/** The setup page's address on the loopback listener (ADR 0080 D-1: `localhost`, never `127.0.0.1`). */
export const setupAddress = (port: number): string => `http://localhost:${String(port)}/setup`;

export type SetupCodeMinted =
  | {
      readonly outcome: 'minted';
      readonly code: string;
      /** Unix seconds. */
      readonly expiresAt: number;
      /** Whether the file was written: `false` with no secrets folder. */
      readonly written: boolean;
    }
  /** The setup is done: nothing minted, and the file removed. */
  | { readonly outcome: 'done' };

/**
 * A moment as this machine's clock reads it, with its zone named (#2858):
 * `2026-11-19 05:30 EST`. The machine's own zone unless `timeZone` names one;
 * in a container with no `TZ` that is UTC, and it says so.
 */
export function localTimeText(seconds: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(seconds * 1000));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

/** The file's text: the code, when it ends, and where to type it. Lines end `\n`. */
export function setupCodeFileText(
  code: string,
  expiresAt: number,
  port: number,
  timeZone?: string,
): string {
  return [
    code,
    `Type this code at ${setupAddress(port)} on this machine.`,
    // #2858: this machine's time with its zone first, and UTC after it for a log to match.
    `It works once, until ${localTimeText(expiresAt, timeZone)} (${new Date(expiresAt * 1000).toISOString()}).`,
    'A restart of the instance makes a new one.',
  ].join('\n');
}

/**
 * Mint a setup code (ADR 0080 D-2) and write it to the secrets folder: the
 * code and its `setup_code_minted` entry in ONE transaction, from `source`,
 * then the file. With `directory` unset nothing is written and the caller
 * says where else the code is (`operator setup-code` prints it).
 */
export async function mintSetupCode(
  store: SqlStore,
  options: {
    readonly mintedBy: 'start' | 'cli';
    /** Unix milliseconds. */
    readonly now: () => number;
    /** `OYL_INSTANCE_SECRETS_DIR`, or `undefined`. */
    readonly directory: string | undefined;
    /** `OYL_INSTANCE_ADMIN_LOOPBACK_PORT`, for the address the file names. */
    readonly port: number;
  },
): Promise<SetupCodeMinted> {
  // A start after Finish asks for no code, so it writes no "refused" entry on every restart
  // (owner, 2026-11-19). `operator setup-code` still asks, and its refusal is logged: the
  // operator ran it. The transaction below still refuses a setup done in between.
  if (options.mintedBy === 'start' && ((await store.setupState())?.doneAt ?? null) !== null) {
    await removeSetupCodeFile(options.directory);
    return { outcome: 'done' };
  }
  const { code, sha256 } = await newAdminCode();
  const mintedAt = Math.floor(options.now() / 1000);
  const expiresAt = mintedAt + SETUP_CODE_LIFETIME_SECONDS;
  const { value } = await store.recordOperatorAction(
    {
      actor: options.mintedBy === 'cli' ? { source: 'cli' } : { source: 'start' },
      action: 'setup_code_minted',
      at: mintedAt,
    },
    async (inside) => {
      const minted = await inside.mintSetupCode({
        codeSha256: sha256,
        mintedAt,
        expiresAt,
        mintedBy: options.mintedBy,
      });
      return minted.outcome === 'done'
        ? { outcome: 'refused', value: 'done' as const }
        : {
            outcome: 'done',
            detail: minted.voided > 0 ? 'voided_unused' : null,
            value: 'minted' as const,
          };
    },
  );
  if (value === 'done') {
    await removeSetupCodeFile(options.directory);
    return { outcome: 'done' };
  }
  if (options.directory === undefined || options.directory.trim() === '') {
    return { outcome: 'minted', code, expiresAt, written: false };
  }
  const directory = options.directory.trim();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeWhole(
    join(directory, SETUP_CODE_FILE),
    setupCodeFileText(code, expiresAt, options.port),
    (bytes) => new Uint8Array(randomBytes(bytes)),
  );
  return { outcome: 'minted', code, expiresAt, written: true };
}

/** Remove the code's file, if there is one: once the code is used, and once the setup is done. */
export async function removeSetupCodeFile(directory: string | undefined): Promise<void> {
  if (directory === undefined || directory.trim() === '') return;
  await unlink(join(directory.trim(), SETUP_CODE_FILE)).catch(() => undefined);
}
