// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `node src/operator/copy-snapshot.ts <from> <to>` — the off-box copy of one
 * snapshot, in a process of its own (#2626). `backup` runs it and watches it
 * (`commands.ts` §`copyOffBox`): a share that stops answering blocks this
 * process inside a file-system call, which Node cannot cancel, and the
 * watchdog kills it. Exit 0 once the whole tree is copied; anything else is a
 * copy that failed. It writes nothing of its own, and `backup` gives it no
 * output to write to: an error here would name a path.
 *
 * It imports nothing but Node, so it needs no resolve hook and starts fast.
 */

import { cp } from 'node:fs/promises';

const [from, to] = process.argv.slice(2);
if (from === undefined || to === undefined) {
  process.exitCode = 2;
} else {
  await cp(from, to, { recursive: true });
}
