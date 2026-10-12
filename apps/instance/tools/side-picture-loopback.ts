// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An instance on THIS machine for the side-camera picture measurement (#1106):
 * a new database in a temporary directory, keys of its own, registration
 * open, and a picture model that is the fake OpenAI-compatible server
 * (`src/analysis/fake-model-server-testing.ts`) answering every picture after
 * `modelMs`. Loopback only, a port the operating system chooses, and nothing
 * of any other instance is read or changed.
 *
 * Used by `side-picture-round-trip.ts --loopback` and by the tool's own test.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from '../src/analysis/fake-model-server-testing.ts';
import { TEST_ORIGIN } from '../src/auth/identity-testing.ts';
import { DEFAULT_BODY_LIMIT_BYTES, readPictureModelSettings } from '../src/config.ts';
import { startInstance } from '../src/instance.ts';
import { testConfig } from '../src/instance-testing.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';

/** What the scripted model says of every picture: nobody is in it. */
const NOBODY: ScriptedReply = { kind: 'text', text: '{"rider":false}' };

export interface LoopbackInstance {
  readonly url: string;
  /** The origin the instance states, which a device signs for. */
  readonly origin: string;
  readonly model: FakeModelServer;
  /** Every line the instance logged. */
  readonly lines: string[];
  close(): Promise<void>;
}

export async function startLoopbackInstance(options: {
  /** How long the model takes over each picture. */
  readonly modelMs: number;
  /** How many pictures the model will answer. */
  readonly pictures: number;
  /** `false` for an instance with no picture model named. */
  readonly pictureModel?: boolean;
}): Promise<LoopbackInstance> {
  const reply: ScriptedReply =
    options.modelMs > 0 ? { kind: 'slow', milliseconds: options.modelMs, then: NOBODY } : NOBODY;
  const model = await startFakeModelServer(Array.from({ length: options.pictures }, () => reply));
  const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-pictures-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  const lines: string[] = [];
  const running = await startInstance({
    config: testConfig({
      registration: 'open',
      // The limit an instance really starts with, which a 64 KiB picture must fit inside.
      bodyLimitBytes: DEFAULT_BODY_LIMIT_BYTES,
      pictures: readPictureModelSettings({
        analysisModelUrl: `http://ollama:${model.baseUrl.port}/v1`,
        ...(options.pictureModel === false ? {} : { pictureModel: 'scripted' }),
      }),
    }),
    resolve: () => Promise.resolve(['127.0.0.1']),
    server: {
      ...server.config,
      blobsPath: join(directory, 'blobs'),
      secretKey: new Uint8Array(32).fill(7),
    },
    version: '0',
    notices: '',
    log: (line) => lines.push(line),
  });
  await running.opened;
  await running.keysMaintained;
  return {
    url: running.url,
    origin: TEST_ORIGIN,
    model,
    lines,
    close: async () => {
      await running.stop();
      await model.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
