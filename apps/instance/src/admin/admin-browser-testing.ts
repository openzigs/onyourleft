// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A real instance for the admin passkeys' browser gate** (#2642):
 * `apps/web/browser/admin-passkeys.browser.spec.ts` starts it in the spec's
 * own Node process — the production `startInstance`, its Node listener, a
 * SQLite file, `OYL_INSTANCE_ADMIN_PAGES=on` — at `http://localhost:<port>`,
 * which is a secure context, so Chromium runs a WebAuthn ceremony against it
 * with its virtual authenticator. `restart` stops it and starts a new one on
 * the SAME file and the SAME port: the same origin, so the same RP ID and
 * the same passkeys.
 *
 * Test support, never shipped: nothing under `src/` imports it, and the spec
 * imports it by a computed path (`docs/agents/browser-gate.md`).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { adminCode, adminPasskeysConfirm } from '../operator/commands.ts';
import { readServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';

/** The owner's account, as a sign-in from the app would have made it. */
const OWNER = 'admin-browser-owner';

export interface AdminBrowserInstance {
  /** `http://localhost:<port>`: the origin, and where the browser opens the pages. */
  readonly origin: string;
  /** `operator admin-code`, as the CLI runs it, on this instance's file. */
  mint(): Promise<string>;
  /** `operator admin-passkeys confirm`, as the CLI runs it. */
  confirm(id: string): Promise<void>;
  /** The passkeys the file holds, read on a store of its own. */
  passkeys(): Promise<readonly { readonly id: string; readonly algorithm: string }[]>;
  /** How many admin sessions the file holds, read on a store of its own. */
  sessions(): Promise<number>;
  /** Whether the analysis settings row lets other riders use the local model (#2648), read on a store of its own. */
  othersLocal(): Promise<boolean | null | undefined>;
  /** Stop, and start a new instance over the same file at the same origin. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function startAdminInstance(): Promise<AdminBrowserInstance> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-admin-browser-'));
  const path = join(directory, 'instance.sqlite');
  const paths = { database: path, blobs: join(directory, 'blobs') };
  await migrateForDeploy(path);
  const store = await openSqlStore(path);
  await store.registerAthlete(registrationFixture(OWNER));
  await store.close();
  const port = await freeLoopbackPort();
  const origin = `http://localhost:${String(port)}`;
  const read = readServerConfig({ database: path, origin, roomWorkers: '1', adminPages: 'on' }, 1);
  if (!read.ok) throw new Error(read.problems.join(' '));
  const server = { ...read.config, blobsPath: paths.blobs, secretKey: secretBytes(7) };

  const start = (): Promise<StartedInstance> =>
    startInstance({
      config: testConfig({
        port,
        moderators: { owner: registrationFixture(OWNER).key.publicKey },
      }),
      server,
      version: '9.8.7',
      notices: 'notices',
      log: () => undefined,
      migrationPollMs: 50,
    });
  let running = await start();
  await running.opened;

  const reading = async <T>(
    read: (opened: Awaited<ReturnType<typeof openSqlStore>>) => Promise<T>,
  ) => {
    const fresh = await openSqlStore(path);
    try {
      return await read(fresh);
    } finally {
      await fresh.close();
    }
  };

  return {
    origin,
    mint: async () => (await adminCode(paths)).code,
    confirm: async (id) => {
      await adminPasskeysConfirm(paths, id);
    },
    passkeys: () =>
      reading(async (opened) =>
        (await opened.listAdminPasskeys()).map(({ id, algorithm }) => ({ id, algorithm })),
      ),
    othersLocal: () => reading(async (opened) => (await opened.getAnalysisSetting())?.othersLocal),
    sessions: () => {
      const database = openDatabase(path);
      try {
        const counted = database.prepare('select count(*) as n from admin_session').get();
        return Promise.resolve((counted as { n: number }).n);
      } finally {
        database.close();
      }
    },
    restart: async () => {
      await running.stop();
      running = await start();
      await running.opened;
    },
    close: async () => {
      await running.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
