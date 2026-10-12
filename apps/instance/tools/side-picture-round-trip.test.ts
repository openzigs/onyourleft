// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side-camera picture measurement's own code (#1106), run against an
 * instance on this machine — the REAL composition (`startInstance`), with its
 * keys and its default limits — whose picture model is scripted. What is held
 * here is the instrument: that it counts what it says it counts. It is also
 * the one test in which a picture goes through the instance as
 * `src/instance.ts` puts it together, rather than as a test's world does.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { Device } from './replan-round-trip-run.ts';
import { startLoopbackInstance, type LoopbackInstance } from './side-picture-loopback.ts';
import {
  FRAMING_CHECK_PICTURES,
  measurePictures,
  measurePicturesWith,
  syntheticPicture,
  type PictureMeasureOptions,
} from './side-picture-round-trip-run.ts';

let instance: LoopbackInstance | undefined;
afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

const options = (
  url: string,
  overrides: Partial<PictureMeasureOptions> = {},
): PictureMeasureOptions => ({
  url,
  pictures: 3,
  intervalMs: 1,
  pictureBytes: 2_048,
  source: 'instance-local',
  ...overrides,
});

/** A device whose every call takes `callMs` of a clock moved by hand. */
function scriptedDevice(clock: { ms: number }, callMs: number, statuses: readonly number[] = []) {
  const bodies: unknown[] = [];
  let calls = 0;
  const device: Device = {
    call: async (_method, _path, body) => {
      bodies.push(body);
      const status = statuses[calls] ?? 200;
      calls += 1;
      // The answer arrives `callMs` later, by the same clock the measurement reads.
      await waitUntil(clock, clock.ms + callMs);
      return status === 200
        ? { status, body: { answer: '{"rider":false}' } }
        : { status, body: { error: { code: 'picture_model_failed' } } };
    },
    stream: () => Promise.resolve(),
    takeCrypto: () => ({ sealMs: 2, openMs: 1 }),
    takeBytes: () => ({ sent: 1_000, received: 400 }),
  };
  return { device, bodies };
}

/** Sleepers of the hand-moved clock: each resolves when the clock reaches its time. */
const sleepers: { at: number; wake: () => void }[] = [];
function waitUntil(clock: { ms: number }, at: number): Promise<void> {
  if (clock.ms >= at) return Promise.resolve();
  return new Promise((wake) => sleepers.push({ at, wake }));
}
/** Move the clock on to each sleeper's time in order, until none is left. */
async function runClock(clock: { ms: number }, done: Promise<unknown>): Promise<void> {
  let finished = false;
  void done.finally(() => {
    finished = true;
  });
  for (let guard = 0; guard < 10_000 && !finished; guard += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    sleepers.sort((a, b) => a.at - b.at);
    const next = sleepers.shift();
    if (next === undefined) continue;
    clock.ms = Math.max(clock.ms, next.at);
    next.wake();
  }
}

describe('the picture measurement’s arithmetic — #1106', () => {
  it('makes a picture of the size asked for that opens and ends as a JPEG, different each time', () => {
    const picture = syntheticPicture(4_096, 1);
    expect(picture).toHaveLength(4_096);
    expect([...picture.slice(0, 4)]).toStrictEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect([...picture.slice(-2)]).toStrictEqual([0xff, 0xd9]);
    // No stray marker in the filler.
    expect(picture.slice(20, -2).includes(0xff)).toBe(false);
    expect(syntheticPicture(4_096, 2)).not.toStrictEqual(picture);
  });

  it('sends one at a time, and drops unsent every picture that falls due meanwhile', async () => {
    const clock = { ms: 0 };
    // Offered every 200 ms; each takes 500 ms. Sent at 0, 600, 1200, 1800; the rest fall due while one is out.
    const { device, bodies } = scriptedDevice(clock, 500);
    const measuring = measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 10, intervalMs: 200 }),
      now: () => clock.ms,
      wait: (milliseconds) => waitUntil(clock, clock.ms + milliseconds),
    });
    await runClock(clock, measuring);
    const report = await measuring;
    expect(report.offered).toBe(10);
    expect(report.sent).toBe(4);
    expect(report.skipped).toBe(6);
    expect(report.answered).toBe(4);
    expect(bodies).toHaveLength(4);
    expect(report.summary.roundTripMs).toMatchObject({ n: 4, p50: 500, max: 500 });
    // The last answer came at 1800 + 500.
    expect(report.elapsedMs).toBe(2_300);
    expect(report.answeredPerSecond).toBe(1.74);
    expect(report.bytesPerSecond).toStrictEqual({ up: 1_739, down: 696 });
    expect(report.summary.bytesUp).toMatchObject({ n: 4, p50: 1_000 });
    expect(report.framingCheckMs).toBeNull();
  });

  it('times the framing check as the tenth answer, and counts a refusal by its code and not as an answer', async () => {
    const clock = { ms: 0 };
    // The third picture is refused: the tenth ANSWER is the eleventh picture sent.
    const { device } = scriptedDevice(clock, 100, [200, 200, 502]);
    const measuring = measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 12, intervalMs: 200 }),
      now: () => clock.ms,
      wait: (milliseconds) => waitUntil(clock, clock.ms + milliseconds),
    });
    await runClock(clock, measuring);
    const report = await measuring;
    expect(report.sent).toBe(12);
    expect(report.skipped).toBe(0);
    expect(report.answered).toBe(11);
    expect(report.refused).toStrictEqual({ picture_model_failed: 1 });
    expect(FRAMING_CHECK_PICTURES).toBe(10);
    // Eleventh picture: offered at 2000, answered at 2100.
    expect(report.framingCheckMs).toBe(2_100);
  });

  it('carries the consent’s endpoint only when it is given one', async () => {
    const clock = { ms: 0 };
    const { device, bodies } = scriptedDevice(clock, 0);
    await measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 1 }),
      now: () => clock.ms,
      wait: () => Promise.resolve(),
    });
    await measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', {
        pictures: 1,
        source: 'instance-hosted',
        endpoint: 'https://models.example',
      }),
      now: () => clock.ms,
      wait: () => Promise.resolve(),
    });
    expect(Object.keys(bodies[0] as object).sort()).toStrictEqual(['picture', 'source']);
    expect(bodies[1]).toMatchObject({
      source: 'instance-hosted',
      endpoint: 'https://models.example',
    });
  });
});

describe('a picture through the instance as it really starts — #1106', () => {
  it('is sealed in, answered by the model the operator named, and written to no log line', async () => {
    instance = await startLoopbackInstance({ modelMs: 0, pictures: 3 });
    const report = await measurePictures({
      ...options(instance.url, { origin: instance.origin, intervalMs: 50 }),
    });
    // One at a time: on a busy machine a picture can fall due while the last is out, and is
    // then skipped, so every one offered is answered or skipped and the first always goes.
    expect(report.answered + report.skipped).toBe(3);
    expect(report.answered).toBeGreaterThanOrEqual(1);
    expect(report.refused).toStrictEqual({});
    // The model was asked once for each answer, each with a picture of the size sent.
    expect(instance.model.requests).toHaveLength(report.answered);
    const first = JSON.stringify(instance.model.requests[0]);
    expect(first).toContain('data:image/jpeg;base64,/9j/4AAQSkZJRgAB');
    expect(instance.model.requests[0]?.model).toBe('scripted');
    // A 2 KiB picture, base64 in JSON, in a padded envelope: more up than the picture, little down.
    expect(report.summary.bytesUp?.min).toBeGreaterThan(2_048);
    expect(report.summary.bytesDown?.max).toBeLessThan(2_048);
    // The instance said the picture model is on, by state alone, and logged no picture route or byte.
    const logged = instance.lines.join('\n');
    expect(logged).toContain('"event":"picture-model","state":"on"');
    expect(logged).not.toContain('scripted');
    expect(logged).not.toContain('/9j/4AAQ');
    expect(logged).not.toContain('camera');
  });

  it('takes the largest picture the side camera sends, inside the limits an instance starts with', async () => {
    instance = await startLoopbackInstance({ modelMs: 0, pictures: 1 });
    const report = await measurePictures(
      options(instance.url, { origin: instance.origin, pictures: 1, pictureBytes: 65_536 }),
    );
    expect(report.refused).toStrictEqual({});
    expect(report.answered).toBe(1);
    // 64 KiB, base64 in JSON, padded to the next 64 KiB and base64url again: between two and three times.
    expect(report.summary.bytesUp?.min).toBeGreaterThan(2 * 65_536);
    expect(report.summary.bytesUp?.max).toBeLessThan(3 * 65_536);
  });

  it('reports pictures_off from an instance whose operator named no picture model', async () => {
    instance = await startLoopbackInstance({ modelMs: 0, pictures: 1, pictureModel: false });
    const report = await measurePictures(
      options(instance.url, { origin: instance.origin, pictures: 1 }),
    );
    expect(report.answered).toBe(0);
    expect(report.refused).toStrictEqual({ pictures_off: 1 });
    expect(instance.model.requests).toHaveLength(0);
    expect(instance.lines.join('\n')).toContain(
      '"event":"picture-model","state":"off","code":"not-set"',
    );
  });
});

describe('the command — #1106', () => {
  const tool = join(dirname(fileURLToPath(import.meta.url)), 'side-picture-round-trip.ts');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 60_000 });

  it('runs on loopback against an instance it starts and stops, and prints one JSON report', () => {
    const ran = run('--loopback', '--model-ms', '20', '--pictures', '4', '--interval-ms', '10');
    expect(ran.status, ran.stderr).toBe(0);
    const report = JSON.parse(ran.stdout) as Record<string, unknown>;
    expect(report).toMatchObject({
      offered: 4,
      source: 'instance-local',
      loopback: { modelMs: 20 },
    });
    expect((report.answered as number) + (report.skipped as number)).toBe(4);
    expect(report.answered as number).toBeGreaterThan(0);
  });

  it.each([
    [['--url', 'http://127.0.0.1:1', '--loopback'], 'give --loopback or --url, and not both'],
    [[], 'give --loopback or --url, and not both'],
    [['--loopback', '--source', 'instance-hosted'], 'instance-hosted is not measured'],
    [['--loopback', '--hosted-key', 'sk-secret'], '--hosted-key is not an option'],
    [['--loopback', '--picture-bytes', '70000'], '--picture-bytes must be a whole number'],
  ])('refuses %j', (args, said) => {
    const ran = run(...args);
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain(said);
    expect(ran.stderr).not.toContain('sk-secret');
    expect(ran.stdout).toBe('');
  });
});
