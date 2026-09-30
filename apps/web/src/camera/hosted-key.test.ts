// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the rider's hosted-model key can be, and where it cannot** — #518's
 * third criterion: *"a test asserts it never reaches a log, an error message,
 * an export, or `packages/store` in plaintext"*.
 *
 * The error half is `hosted-transport.test.ts` and `hosted-model.test.ts`
 * (every failure and refusal sentence, and a rejection that quotes the key);
 * the export half runs the real account export in
 * `transfer/export-everything.test.ts` §"#518". This file is the rest: which
 * modules can reach the stored row at all, that `packages/store` cannot, that
 * no log line carries it through a whole press, and that the two filed
 * statements — the privacy policy and the Play Data Safety answers — say what
 * the path does.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripComments } from '../units/no-inline-units';

import { hostedModelDecision, HOSTED_MODEL_STORAGE_KEY } from './hosted-model';
import { hostedModelPort, type HostedSend } from './hosted-transport';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';
import { hostedStepPort } from '../ride-analysis/hosted-step';
import type { RideAnalysisInput } from '../ride-analysis/input';
import { STILL_CLOCK } from '../ride-analysis/model-server-testing';
import { askFailureText } from '../ride-analysis/ride-analysis';
import { runAnalysis } from '../ride-analysis/runner';
import { patternsOnlyGuard } from '../ride-analysis/personal-details-testing';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'fixture-hosted-key-DO-NOT-LEAK-0123456789';

/** Every non-test TypeScript source under `root`, relative to the repository. */
function sourcesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(relative(REPOSITORY_ROOT, path));
      }
    }
  };
  walk(join(REPOSITORY_ROOT, root));
  return found;
}

function code(path: string): string {
  return stripComments(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'));
}

describe('what can reach the stored key', () => {
  const everywhere = [
    ...sourcesUnder(join('apps', 'web', 'src')),
    ...sourcesUnder(join('apps', 'mobile', 'src')),
    ...sourcesUnder('packages'),
  ];

  it('has source to scan', () => {
    expect(everywhere.length).toBeGreaterThan(300);
  });

  it('names the storage key in one module only', () => {
    const naming = everywhere.filter((path) => code(path).includes(HOSTED_MODEL_STORAGE_KEY));
    expect(naming).toStrictEqual([join('apps', 'web', 'src', 'camera', 'hosted-model.ts')]);
  });

  it('is read by the camera screen, the controller’s port and the erase — and by no export', () => {
    // Every module that imports the row's reader or writer, by name.
    const readers = everywhere.filter((path) =>
      /\b(readHostedModel|writeHostedModel)\b/.test(code(path)),
    );
    expect([...readers].sort()).toStrictEqual(
      [
        join('apps', 'web', 'src', 'camera', 'hosted-model.ts'),
        join('apps', 'web', 'src', 'main.tsx'),
        join('apps', 'web', 'src', 'views', 'CameraView.tsx'),
      ].sort(),
    );
  });

  it('cannot be reached from packages/store', () => {
    for (const path of sourcesUnder(join('packages', 'store'))) {
      expect(code(path), path).not.toMatch(/hosted-model|HostedModel|oyl\.hosted/);
    }
  });
});

describe('no log line carries it', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('through a press that fails with the key in the platform’s own error', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const send: HostedSend = () => Promise.reject(new Error(`Authorization: Bearer ${KEY}`));
    const model = hostedModelDecision({
      address: 'https://models.example.invalid',
      model: 'm',
      key: KEY,
    }).model;
    const controller = new CameraController({
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
      hosted: () => hostedModelPort(model, { guard: patternsOnlyGuard, send }),
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    controller.agreeToHosted(true);
    const outcome = await controller.askHostedModel('connection-check').outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'unreachable' });
    // An `Error` stringifies to `{}` through JSON, so each argument is read as
    // the text a console would print — message and stack included.
    const printed = (argument: unknown): string =>
      argument instanceof Error
        ? `${argument.message} ${argument.stack ?? ''}`
        : typeof argument === 'string'
          ? argument
          : JSON.stringify(argument);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.map(printed).join(' ')).not.toContain(KEY);
      }
    }
  });
});

describe('no log line, failure or sentence carries it through a ride analysis (#803)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ride: RideAnalysisInput = {
    templateVersion: 'ride-analysis/1',
    ride: { movingMinutes: 62, distanceKilometres: 31.4 },
    rider: { massKilograms: 72, thresholdPower: 250 },
    whole: { power: { coverage: 1, mean: 190, max: 410 } },
    sections: [1, 2].map((index) => ({
      index,
      kind: 'flat' as const,
      minutes: 30,
      metrics: { power: { coverage: 1, mean: 190, max: 300 } },
    })),
  };

  it.each([
    [
      'a rejection that quotes the key',
      (): Promise<Response> => Promise.reject(new Error(`Authorization: Bearer ${KEY}`)),
    ],
    [
      'a refusal whose body quotes the key',
      (): Promise<Response> =>
        Promise.resolve(new Response(`{"error":"invalid key ${KEY}"}`, { status: 401 })),
    ],
    [
      'an error from the service that quotes the key',
      (): Promise<Response> =>
        Promise.resolve(new Response(`{"error":"quota for ${KEY}"}`, { status: 429 })),
    ],
  ] as const)('through %s, on every step', async (_name, answer) => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const send = vi.fn<HostedSend>(answer);
    const model = hostedModelDecision({
      address: 'https://models.example.invalid',
      model: 'm',
      key: KEY,
    }).model;
    const controller = new CameraController({
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
      hosted: () => hostedModelPort(model, { guard: patternsOnlyGuard, send }),
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    controller.agreeToHosted(true);
    const port = hostedStepPort(controller, () => true);
    const outcome = await runAnalysis(ride, {
      port: port as NonNullable<typeof port>,
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
    });
    // Both section steps were sent and both failed — so the key was on the
    // wire each time and came back each time — and with no section left the
    // run ends before the summary.
    expect(send).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe('failed');
    expect(JSON.stringify(outcome)).not.toContain(KEY);
    if (outcome.kind === 'failed') {
      expect(askFailureText(outcome.why, 'hosted')).not.toContain(KEY);
    }
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(call.map(String).join(' ')).not.toContain(KEY);
      }
    }
  });
});

describe('what the filed statements say', () => {
  const policy = readFileSync(join(REPOSITORY_ROOT, 'docs', 'privacy-policy.md'), 'utf8');

  it('the privacy policy names the hosted exception, as numbers and never a picture', () => {
    expect(policy).toContain('## Questions sent to a service you chose, on your own key');
    expect(policy).toContain('never a picture');
    // Four since #777 (an instance sign-in); the hosted question is still one of them.
    expect(policy).toContain('exactly **four** network calls');
  });

  it('Play’s Photos and videos row stays shared: false and says why', () => {
    const safety = readFileSync(
      join(REPOSITORY_ROOT, 'apps', 'mobile', 'src', 'android', 'data-safety.ts'),
      'utf8',
    );
    const row = safety.slice(safety.indexOf("dataType: 'Photos and videos'"));
    expect(row).toMatch(/^dataType: 'Photos and videos',\s+collected: true,\s+shared: false,/);
    expect(row.slice(0, row.indexOf('},'))).toContain('never sent a picture');
  });
});
