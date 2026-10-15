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

import {
  startFakeModelServer,
  type FakeModelServer,
} from '../src/analysis/fake-model-server-testing.ts';
import { pictureFrom } from '../src/camera/picture.ts';
import { DRAWN_PICTURE_HEIGHT, DRAWN_PICTURE_WIDTH, drawnPicture } from './drawn-picture.ts';
import type { Device } from './replan-round-trip-run.ts';
import { startLoopbackInstance, type LoopbackInstance } from './side-picture-loopback.ts';
import {
  FRAMING_CHECK_PICTURES,
  measurePictures,
  ANSWER_SHOWN,
  measurePicturesWith,
  syntheticPicture,
  type PictureMeasureOptions,
} from './side-picture-round-trip-run.ts';

let instance: LoopbackInstance | undefined;
let realModel: FakeModelServer | undefined;
afterEach(async () => {
  await instance?.close();
  instance = undefined;
  await realModel?.close();
  realModel = undefined;
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
function scriptedDevice(
  clock: { ms: number },
  callMs: number,
  statuses: readonly number[] = [],
  answers: readonly string[] = [],
) {
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
        ? { status, body: { answer: answers[calls - 1] ?? '{"rider":false}' } }
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

describe('the drawn picture, which a real model can open — #1106', () => {
  /** Every segment's marker, in order, up to the scan. */
  function markers(picture: Uint8Array): number[] {
    const found: number[] = [];
    let at = 2;
    while (at + 3 < picture.length && picture[at] === 0xff) {
      const marker = picture[at + 1] ?? 0;
      found.push(marker);
      if (marker === 0xda) break;
      at += 2 + (((picture[at + 2] ?? 0) << 8) | (picture[at + 3] ?? 0));
    }
    return found;
  }

  it('is a JPEG of its stated size whose only segments are the ones a picture needs: no metadata', () => {
    const picture = drawnPicture(0);
    expect([...picture.slice(0, 2)]).toStrictEqual([0xff, 0xd8]);
    expect([...picture.slice(-2)]).toStrictEqual([0xff, 0xd9]);
    // APP0/JFIF, the quantisation table, the frame, two Huffman tables and the scan. No APP1
    // (Exif, XMP), no APP13 (IPTC) and no comment.
    expect(markers(picture)).toStrictEqual([0xe0, 0xdb, 0xc0, 0xc4, 0xc4, 0xda]);
    expect(Buffer.from(picture.slice(6, 11)).toString('latin1')).toBe('JFIF\0');
    // The frame header says the size: after APP0 (18 bytes) and DQT (69), at SOF0's fifth byte.
    const frame = picture.indexOf(0xc0, 20) - 1;
    expect([...picture.slice(frame, frame + 2)]).toStrictEqual([0xff, 0xc0]);
    const height = ((picture[frame + 5] ?? 0) << 8) | (picture[frame + 6] ?? 0);
    const width = ((picture[frame + 7] ?? 0) << 8) | (picture[frame + 8] ?? 0);
    expect([width, height]).toStrictEqual([DRAWN_PICTURE_WIDTH, DRAWN_PICTURE_HEIGHT]);
  });

  it('is taken by the instance’s own check, is the same for the same variant and differs between two', () => {
    const picture = drawnPicture(3);
    const taken = pictureFrom(Buffer.from(picture).toString('base64'));
    expect(taken).toMatchObject({ ok: true });
    expect(picture.length).toBeLessThan(16 * 1024);
    expect(drawnPicture(3)).toStrictEqual(picture);
    expect(drawnPicture(4)).not.toStrictEqual(picture);
  });

  it('stuffs a zero after every 0xff in the scan, so no byte of it reads as a marker', () => {
    const picture = drawnPicture(0);
    const scan = picture.lastIndexOf(0xda);
    for (let at = scan + 12; at < picture.length - 2; at += 1) {
      if (picture[at] === 0xff) expect(picture[at + 1]).toBe(0x00);
    }
  });

  it('is what is sent when asked for, and its own size is the one reported', async () => {
    const clock = { ms: 0 };
    const { device, bodies } = scriptedDevice(clock, 100);
    const measuring = measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 2, intervalMs: 200, picture: 'drawn' }),
      now: () => clock.ms,
      wait: (milliseconds) => waitUntil(clock, clock.ms + milliseconds),
    });
    await runClock(clock, measuring);
    const report = await measuring;
    const sent = bodies.map((body) => (body as { picture: string }).picture);
    expect(sent).toHaveLength(2);
    expect(sent[0] === Buffer.from(drawnPicture(0)).toString('base64')).toBe(true);
    expect(sent[1] === Buffer.from(drawnPicture(1)).toString('base64')).toBe(true);
    expect(report.picture).toBe('drawn');
    expect(report.pictureBytes).toBe(drawnPicture(0).length);
    // Under 300 ms on every green `main` run read, and 3 723 ms under coverage
    // (nightly 38537249148, EPYC 7763), 74 % of Vitest's 5 s default: drawing
    // the picture is a hot loop coverage instruments. About three times the
    // slowest CI figure (docs/agents/ci.md §4c, #1262); nothing it does is changed.
  }, 12_000);

  it('sends filler unless asked, and reports the size asked for', async () => {
    const clock = { ms: 0 };
    const { device, bodies } = scriptedDevice(clock, 0);
    const report = await measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 1 }),
      now: () => clock.ms,
      wait: () => Promise.resolve(),
    });
    expect((bodies[0] as { picture: string }).picture).toBe(
      Buffer.from(syntheticPicture(2_048, 0)).toString('base64'),
    );
    expect(report).toMatchObject({ picture: 'filler', pictureBytes: 2_048 });
  });

  it('counts what the model said, each distinct answer once, cut to what is shown', async () => {
    const clock = { ms: 0 };
    const long = 'x'.repeat(ANSWER_SHOWN + 50);
    const { device } = scriptedDevice(
      clock,
      100,
      [200, 200, 502, 200],
      ['{"rider":false}', '{"rider":false}', 'never read', long],
    );
    const measuring = measurePicturesWith(device, {
      ...options('http://127.0.0.1:1', { pictures: 4, intervalMs: 200 }),
      now: () => clock.ms,
      wait: (milliseconds) => waitUntil(clock, clock.ms + milliseconds),
    });
    await runClock(clock, measuring);
    const report = await measuring;
    expect(report.answers).toStrictEqual({
      '{"rider":false}': 2,
      ['x'.repeat(ANSWER_SHOWN)]: 1,
    });
    expect(report.refused).toStrictEqual({ picture_model_failed: 1 });
  });
});

describe('a real model on this machine in place of the scripted one — #1106', () => {
  it('asks the server and the model it was given, with the drawn picture', async () => {
    realModel = await startFakeModelServer([{ kind: 'text', text: '{"rider":false}' }]);
    instance = await startLoopbackInstance({
      modelMs: 0,
      pictures: 0,
      realModel: { url: `http://localhost:${realModel.baseUrl.port}/v1`, model: 'named:4b' },
    });
    const report = await measurePictures(
      options(instance.url, { origin: instance.origin, pictures: 1, picture: 'drawn' }),
    );
    expect(report.answers).toStrictEqual({ '{"rider":false}': 1 });
    expect(realModel.requests).toHaveLength(1);
    expect(realModel.requests[0]?.model).toBe('named:4b');
    expect(JSON.stringify(realModel.requests[0])).toContain(
      `data:image/jpeg;base64,${Buffer.from(drawnPicture(0)).toString('base64')}`,
    );
    // The scripted server was started and never asked.
    expect(instance.model.requests).toHaveLength(0);
    // 959 ms on green `main` (38490502814, EPYC 7763) and 2 591 ms under
    // coverage (nightly 38282093800, EPYC 7763), 52 % of Vitest's 5 s default.
    // About three times the slowest CI figure (docs/agents/ci.md §4c, #1262).
  }, 8_000);

  it.each([
    'https://localhost:11434/v1',
    'http://models.example/v1',
    'http://10.0.0.5:11434/v1',
    // Names that only begin like this machine's, or carry it where a user name goes.
    'http://127.0.0.1.models.example/v1',
    'http://127.0.0.1x/v1',
    'http://localhost.models.example/v1',
    'http://localhost@models.example/v1',
    'http://127.0.0.1@models.example/v1',
    'x',
  ])('refuses %s: a picture is sent to a model on this machine or to none', async (url) => {
    await expect(
      startLoopbackInstance({ modelMs: 0, pictures: 0, realModel: { url, model: 'm' } }),
    ).rejects.toThrow(/on this machine only/);
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

  it('sends the drawn picture when asked, and prints what the model said of it', () => {
    const ran = run('--loopback', '--model-ms', '0', '--pictures', '1', '--picture', 'drawn');
    expect(ran.status, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout)).toMatchObject({
      picture: 'drawn',
      pictureBytes: drawnPicture(0).length,
      answers: { '{"rider":false}': 1 },
    });
    // A child process: 2 302 ms on green `main` (38337365635, EPYC 7763) and
    // 2 662 ms under coverage (nightly 38492183044, EPYC 7763), 53 % of
    // Vitest's 5 s default. About three times the slowest CI figure
    // (docs/agents/ci.md §4c, #1262); nothing it does is changed.
  }, 8_000);

  it.each([
    [['--url', 'http://127.0.0.1:1', '--loopback'], 'give --loopback or --url, and not both'],
    [[], 'give --loopback or --url, and not both'],
    [['--loopback', '--source', 'instance-hosted'], 'instance-hosted is not measured'],
    [['--loopback', '--hosted-key', 'sk-secret'], '--hosted-key is not an option'],
    [['--loopback', '--picture-bytes', '70000'], '--picture-bytes must be a whole number'],
    [['--loopback', '--picture', 'photo'], '--picture must be filler or drawn'],
    [['--loopback', '--model-url', 'http://localhost:1/v1'], 'go together'],
    [['--loopback', '--picture-model', 'm'], 'go together'],
    [
      [
        '--url',
        'http://127.0.0.1:1',
        '--model-url',
        'http://localhost:1/v1',
        '--picture-model',
        'm',
      ],
      'are for --loopback',
    ],
    [
      [
        '--loopback',
        '--model-ms',
        '5',
        '--model-url',
        'http://localhost:1/v1',
        '--picture-model',
        'm',
      ],
      'a real model takes the time it takes',
    ],
  ])('refuses %j', (args, said) => {
    const ran = run(...args);
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain(said);
    expect(ran.stderr).not.toContain('sk-secret');
    expect(ran.stdout).toBe('');
  });
});
