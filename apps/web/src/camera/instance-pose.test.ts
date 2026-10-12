// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's pictures, looked at by a model on the rider's instance —
 * #1106: two switches off by default, one builder of the body, sealed or not
 * sent, stripped or not sent, one a second, and a stop that says why.
 *
 * The channel here is a plain function: what crosses the wire sealed is
 * `instance/sealed-call.test.ts`'s, and what the instance does with it is
 * `apps/instance/src/camera/side-pose.test.ts`'s.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EndpointStorage } from './analysis-endpoint';
import { ANALYSIS_PROMPTS } from './analysis-port';
import {
  hostedServiceHost,
  INSTANCE_POSE_DEADLINE_MILLISECONDS,
  INSTANCE_POSE_INTERVAL_MILLISECONDS,
  instancePoseEstimator,
  MAXIMUM_CONSECUTIVE_INSTANCE_FAILURES,
  readSideInstanceChoice,
  SIDE_INSTANCE_CONSENT,
  SIDE_INSTANCE_HOSTED_STORAGE_KEY,
  SIDE_INSTANCE_STORAGE_KEY,
  SIDE_INSTANCE_WHAT_IS_SENT,
  SIDE_POSE_PATH,
  sideInstanceHostedConsent,
  sidePoseRequest,
  writeSideInstanceHostedConsent,
  writeSideInstanceSwitch,
  type InstancePictureChoice,
  type SidePictureChannel,
  type SidePictureSession,
} from './instance-pose';
import { instanceEraser } from '../instance/instance-port';
import { SIDE_ANALYSER_STORAGE_KEY } from './side-analyser';
import { sizedFrameBytes } from './testing';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTANCE = (path: string): string => resolve(HERE, '../../../instance/src', path);

function memoryStorage(): EndpointStorage & { readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

const ORIGIN = 'https://models.example';
/** The instance this device is signed in to, in these tests. */
const INSTANCE_AT = 'https://rides.example';
const OTHER_INSTANCE = 'https://project.example';
const LOCAL: InstancePictureChoice = { source: 'instance-local' };
const HOSTED: InstancePictureChoice = { source: 'instance-hosted', endpoint: ORIGIN };
const PICTURE = sizedFrameBytes(256, 192);
const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));
/** A JPEG carrying an Exif segment before its frame header, as a camera's own file does. */
const WITH_EXIF = sizedFrameBytes(256, 192, [
  0xff,
  0xe1,
  0x00,
  0x10,
  ...ascii('Exif\0\0'),
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
]);

/** A rider who could be one (`computer-pose.test.ts` §`ALL_SEEN`). */
const RIDER = JSON.stringify({
  rider: true,
  nearSide: 'left',
  landmarks: {
    ear: [0.1, 0.2],
    shoulder: [0.62, 0.29],
    elbow: [0.67, 0.39],
    wrist: [0.73, 0.47],
    hip: [0.41, 0.44],
    knee: [0.53, 0.57],
    ankle: [0.5, 0.78],
    heel: [0.48, 0.79],
    toe: [0.55, 0.79],
  },
});
const NOBODY = '{"rider":false}';

type Call = Parameters<SidePictureChannel['call']>;
type Answer = { status: number; body: unknown } | Error;

/** A channel that answers from a script and writes down every call; a clock moved by `wait`. */
function world(
  script: Answer[] = [],
  choose: () => InstancePictureChoice | undefined = () => LOCAL,
) {
  const calls: { path: string; options: Call[2]; at: number }[] = [];
  const clock = { ms: 0 };
  const waits: number[] = [];
  let opened = 0;
  let session: SidePictureSession | 'throws' = {
    kind: 'open',
    token: 'session-token',
    channel: {
      call: (_method, path, options) => {
        calls.push({ path, options, at: clock.ms });
        const next = script.shift() ?? { status: 200, body: { answer: NOBODY } };
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    },
  };
  const estimator = instancePoseEstimator(
    {
      choice: () => choose(),
      session: () => {
        opened += 1;
        return session === 'throws'
          ? Promise.reject(new Error('no keys'))
          : Promise.resolve(session);
      },
    },
    {
      now: () => clock.ms,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        clock.ms += milliseconds;
        return Promise.resolve();
      },
    },
  );
  return {
    estimator,
    calls,
    clock,
    waits,
    opened: () => opened,
    closeSession: (to: SidePictureSession | 'throws') => {
      session = to;
    },
  };
}

const refusal = (status: number, code: string): Answer => ({ status, body: { error: { code } } });

describe('the two switches are off by default, and the second sits under the first (#1106)', () => {
  it('reads off on an empty device, one with no storage, one that throws, and a row that is not this instance’s address', () => {
    expect(readSideInstanceChoice(INSTANCE_AT, memoryStorage())).toBeUndefined();
    expect(readSideInstanceChoice(INSTANCE_AT, undefined)).toBeUndefined();
    const storage = memoryStorage();
    // What an earlier design might have stored is not agreement to anything.
    for (const stale of ['on', 'true', '']) {
      storage.rows.set(SIDE_INSTANCE_STORAGE_KEY, stale);
      expect(readSideInstanceChoice(INSTANCE_AT, storage), stale).toBeUndefined();
    }
    // And an empty address is no instance, even against an empty row.
    expect(readSideInstanceChoice('', storage)).toBeUndefined();
    const throwing: EndpointStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readSideInstanceChoice(INSTANCE_AT, throwing)).toBeUndefined();
    expect(writeSideInstanceSwitch(INSTANCE_AT, throwing)).toBe(false);
    expect(writeSideInstanceSwitch(INSTANCE_AT, undefined)).toBe(false);
    expect(writeSideInstanceSwitch('', memoryStorage())).toBe(false);
    expect(writeSideInstanceHostedConsent(ORIGIN, throwing)).toBe(false);
    expect(writeSideInstanceHostedConsent(ORIGIN, undefined)).toBe(false);
  });

  it('is its own stored answer: the computer’s switch does not turn it on, nor it the computer’s', () => {
    const storage = memoryStorage();
    storage.rows.set(SIDE_ANALYSER_STORAGE_KEY, 'on');
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toBeUndefined();
    expect(writeSideInstanceSwitch(INSTANCE_AT, storage)).toBe(true);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(LOCAL);
    expect(storage.rows.get(SIDE_ANALYSER_STORAGE_KEY)).toBe('on');
  });

  it('is agreement for ONE instance: signed in to another, or to none, it reads off', () => {
    const storage = memoryStorage();
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    writeSideInstanceHostedConsent(ORIGIN, storage);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(HOSTED);
    expect(readSideInstanceChoice(OTHER_INSTANCE, storage)).toBeUndefined();
    expect(readSideInstanceChoice(undefined, storage)).toBeUndefined();
    // Back on the instance it was given for, it still stands.
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(HOSTED);
  });

  it('agreeing for another instance drops the hosted consent given under the first', () => {
    const storage = memoryStorage();
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    writeSideInstanceHostedConsent(ORIGIN, storage);
    expect(writeSideInstanceSwitch(OTHER_INSTANCE, storage)).toBe(true);
    expect(readSideInstanceChoice(OTHER_INSTANCE, storage)).toStrictEqual(LOCAL);
    expect(storage.rows.get(SIDE_INSTANCE_HOSTED_STORAGE_KEY)).toBeUndefined();
    // Ticking it again for the same instance keeps what was agreed under it.
    writeSideInstanceHostedConsent(ORIGIN, storage);
    writeSideInstanceSwitch(OTHER_INSTANCE, storage);
    expect(readSideInstanceChoice(OTHER_INSTANCE, storage)).toStrictEqual(HOSTED);
  });

  it('keeps a hosted consent only as an https: origin, only under the first switch, and reads it back as the endpoint', () => {
    const storage = memoryStorage();
    // Not while the first switch is off.
    expect(writeSideInstanceHostedConsent(ORIGIN, storage)).toBe(false);
    expect(storage.rows.size).toBe(0);
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    for (const bad of ['http://models.example', `${ORIGIN}/v1`, 'models.example', '']) {
      expect(writeSideInstanceHostedConsent(bad, storage), bad).toBe(false);
    }
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(LOCAL);
    expect(writeSideInstanceHostedConsent(ORIGIN, storage)).toBe(true);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(HOSTED);
    // Withdrawn on its own, the first switch stays on.
    expect(writeSideInstanceHostedConsent(undefined, storage)).toBe(true);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(LOCAL);
  });

  it('switching the first off removes both rows, so the hosted consent does not outlive it', () => {
    const storage = memoryStorage();
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    writeSideInstanceHostedConsent(ORIGIN, storage);
    expect(writeSideInstanceSwitch(undefined, storage)).toBe(true);
    expect(storage.rows.size).toBe(0);
    // Switched on again, it is the instance's own model: nothing is sent on.
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(LOCAL);
  });

  it('reads a stored consent that is not an https: origin as no hosted consent', () => {
    const storage = memoryStorage();
    storage.rows.set(SIDE_INSTANCE_STORAGE_KEY, INSTANCE_AT);
    storage.rows.set(SIDE_INSTANCE_HOSTED_STORAGE_KEY, 'http://models.example');
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toStrictEqual(LOCAL);
  });

  it('is forgotten with the sign-in when the device is erased', () => {
    const storage = memoryStorage();
    writeSideInstanceSwitch(INSTANCE_AT, storage);
    writeSideInstanceHostedConsent(ORIGIN, storage);
    storage.rows.set(SIDE_ANALYSER_STORAGE_KEY, 'on');
    instanceEraser(storage).forget();
    expect(storage.rows.has(SIDE_INSTANCE_STORAGE_KEY)).toBe(false);
    expect(storage.rows.has(SIDE_INSTANCE_HOSTED_STORAGE_KEY)).toBe(false);
    expect(readSideInstanceChoice(INSTANCE_AT, storage)).toBeUndefined();
    // The control: it removes what is the instance's, and not a key that is not.
    expect(storage.rows.get(SIDE_ANALYSER_STORAGE_KEY)).toBe('on');
  });
});

describe('the words a rider agrees to (#1106) — approved by the owner on 2026-10-12', () => {
  it('says the pictures leave the room, are sealed, and are not kept, and what the tunnel can still see', () => {
    expect(SIDE_INSTANCE_WHAT_IS_SENT).toContain(
      'If the sealed connection is not available, no picture is sent.',
    );
    expect(SIDE_INSTANCE_WHAT_IS_SENT).toContain('not kept there');
    expect(SIDE_INSTANCE_CONSENT).toContain('pictures of you leave this room');
    expect(SIDE_INSTANCE_CONSENT).toContain('how often and roughly how large');
    expect(SIDE_INSTANCE_CONSENT).toContain('whoever runs your instance controls that machine');
  });

  it('names the service in the hosted consent, says it is a company under its own terms, and promises nothing about it', () => {
    const words = sideInstanceHostedConsent('models.example').join(' ');
    expect(sideInstanceHostedConsent('models.example')[0]).toBe(
      'This sends pictures of you to models.example.',
    );
    expect(words).toContain('under its terms and not ours');
    expect(words).toContain('we cannot delete them for you afterwards');
    expect(words).toContain('“Not kept” is a promise about your instance only.');
    expect(words).toContain('You do not need this.');
    // The app names no vendor of its own: every name in it is the one it was handed.
    expect(sideInstanceHostedConsent('x.test').join(' ')).not.toContain('models.example');
  });

  it('names a service by the host of an https: origin and by nothing else', () => {
    expect(hostedServiceHost('https://models.example')).toBe('models.example');
    expect(hostedServiceHost('https://models.example:8443')).toBe('models.example:8443');
    for (const bad of [
      'http://models.example',
      'https://models.example/v1',
      'https://u:p@models.example',
      'nope',
    ]) {
      expect(hostedServiceHost(bad), bad).toBeUndefined();
    }
  });
});

describe('the one builder of a picture request (#1106)', () => {
  it('carries the picture, which model, and for a hosted one the origin consented to — and no other key', () => {
    const local = sidePoseRequest(PICTURE, LOCAL);
    expect(Object.keys(local).sort()).toStrictEqual(['picture', 'source']);
    expect(local.source).toBe('instance-local');
    // The bytes that were handed over, and exactly those.
    expect(Uint8Array.from(atob(local.picture), (c) => c.charCodeAt(0))).toStrictEqual(PICTURE);
    const hosted = sidePoseRequest(PICTURE, HOSTED);
    expect(Object.keys(hosted).sort()).toStrictEqual(['endpoint', 'picture', 'source']);
    expect(hosted).toMatchObject({ source: 'instance-hosted', endpoint: ORIGIN });
  });

  it('encodes a picture of the largest size the link carries', () => {
    const large = new Uint8Array(64 * 1024).map((_, index) => index % 251);
    const request = sidePoseRequest(large, LOCAL);
    expect(Uint8Array.from(atob(request.picture), (c) => c.charCodeAt(0))).toStrictEqual(large);
  });

  it('asks the instance the question its own source holds, word for word', async () => {
    // The instance asks the question; the app reads the answer. One sentence, two files.
    const instance = (await import(/* @vite-ignore */ INSTANCE('camera/hosted-pictures.ts'))) as {
      SIDE_POSE_QUESTION: string;
    };
    expect(instance.SIDE_POSE_QUESTION).toBe(ANALYSIS_PROMPTS['side-pose']);
    const routes = (await import(/* @vite-ignore */ INSTANCE('camera/routes.ts'))) as {
      SIDE_POSE_PATH: string;
    };
    expect(routes.SIDE_POSE_PATH).toBe(SIDE_POSE_PATH);
  });
});

describe('a picture, sent to the instance and read (#1106)', () => {
  it('goes through the sealed channel to the one route, with the session’s token and the time it may take', async () => {
    const { estimator, calls } = world([{ status: 200, body: { answer: RIDER } }]);
    const outcome = await estimator.estimateSidePose(PICTURE);
    expect(outcome.kind).toBe('pose');
    expect(outcome.kind === 'pose' && outcome.pose.nearSide).toBe('left');
    expect(outcome.kind === 'pose' && outcome.pose.aspect).toBeCloseTo(256 / 192);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(SIDE_POSE_PATH);
    expect(calls[0]!.options).toStrictEqual({
      body: sidePoseRequest(PICTURE, LOCAL),
      token: 'session-token',
      timeoutMilliseconds: INSTANCE_POSE_DEADLINE_MILLISECONDS,
    });
  });

  it('reads the answer as numbers or nothing: nobody, prose, and a pose no rider could have', async () => {
    const { estimator } = world([
      { status: 200, body: { answer: NOBODY } },
      { status: 200, body: { answer: 'There is a rider at the left of the picture.' } },
      { status: 200, body: { answer: RIDER.replace('[0.53,0.57]', '[0.53,5]') } },
    ]);
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'no-rider',
      cause: 'said-nobody',
    });
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({ kind: 'unreadable' });
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({ kind: 'unreadable' });
  });

  it('never sends a picture that carries metadata, or is not a JPEG', async () => {
    const { estimator, calls, opened } = world();
    expect(await estimator.estimateSidePose(WITH_EXIF)).toStrictEqual({ kind: 'unreadable' });
    expect(await estimator.estimateSidePose(Uint8Array.from([1, 2, 3, 4]))).toStrictEqual({
      kind: 'unreadable',
    });
    expect(calls).toHaveLength(0);
    // Not even the session was opened for it.
    expect(opened()).toBe(0);
    // The control: the same picture without the segment IS sent.
    await estimator.estimateSidePose(PICTURE);
    expect(calls).toHaveLength(1);
  });

  it('sends the hosted choice with the origin the consent names', async () => {
    const { estimator, calls } = world([], () => HOSTED);
    await estimator.estimateSidePose(PICTURE);
    expect(calls[0]!.options.body).toMatchObject({ source: 'instance-hosted', endpoint: ORIGIN });
  });
});

describe('sealed, or not sent (#1106, ruling 1)', () => {
  const CLOSED: SidePictureSession = { kind: 'closed' };
  it.each([
    ['there is no sealed session', CLOSED],
    ['opening the session throws', 'throws' as const],
  ])('sends nothing when %s, and says why', async (_name, session) => {
    const built = world();
    built.closeSession(session);
    expect(await built.estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'unavailable',
      why: 'not-sealed',
    });
    expect(await built.estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'unavailable',
      why: 'not-sealed',
    });
    expect(built.calls).toHaveLength(0);
  });

  it('opens the session once for a whole pairing’s pictures', async () => {
    const { estimator, opened, calls } = world();
    for (let picture = 0; picture < 4; picture += 1) await estimator.estimateSidePose(PICTURE);
    expect(calls).toHaveLength(4);
    expect(opened()).toBe(1);
  });
});

describe('the switch is read for every picture (#1106)', () => {
  it('stops the very next picture when it is switched off, and does not start again this session', async () => {
    let choice: InstancePictureChoice | undefined = LOCAL;
    const { estimator, calls } = world([], () => choice);
    await estimator.estimateSidePose(PICTURE);
    choice = undefined;
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'unavailable',
      why: 'switched-off',
    });
    // Switched on again mid-session: a pairing does not quietly start sending again.
    choice = LOCAL;
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'unavailable',
      why: 'switched-off',
    });
    expect(calls).toHaveLength(1);
  });

  it('follows a change of model at the next picture', async () => {
    let choice: InstancePictureChoice = LOCAL;
    const { estimator, calls } = world([], () => choice);
    await estimator.estimateSidePose(PICTURE);
    choice = HOSTED;
    await estimator.estimateSidePose(PICTURE);
    expect(calls.map((call) => call.options.body.source)).toStrictEqual([
      'instance-local',
      'instance-hosted',
    ]);
  });

  it('sends nothing after it is closed, and drops the answer of a picture already sent', async () => {
    let release: (answer: { status: number; body: unknown }) => void = () => undefined;
    const sent: unknown[] = [];
    const estimator = instancePoseEstimator({
      choice: () => LOCAL,
      session: () =>
        Promise.resolve({
          kind: 'open',
          token: 't',
          channel: {
            call: (_method, _path, options) => {
              sent.push(options);
              return new Promise((resolve) => {
                release = resolve;
              });
            },
          },
        }),
    });
    const looking = estimator.estimateSidePose(PICTURE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    estimator.closeSidePoseModel();
    release({ status: 200, body: { answer: RIDER } });
    expect(await looking).toStrictEqual({ kind: 'unavailable', why: 'switched-off' });
    expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({
      kind: 'unavailable',
      why: 'switched-off',
    });
    expect(sent).toHaveLength(1);
  });
});

describe('no faster than one a second (#1106, spike 0025)', () => {
  it('waits out the rest of the second before the next picture, and not at all once a second has passed', async () => {
    const { estimator, calls, clock, waits } = world();
    await estimator.estimateSidePose(PICTURE);
    // The answer took 300 ms; the next picture is ready at once.
    clock.ms = 300;
    await estimator.estimateSidePose(PICTURE);
    expect(waits).toStrictEqual([INSTANCE_POSE_INTERVAL_MILLISECONDS - 300]);
    expect(calls.map((call) => call.at)).toStrictEqual([0, 1_000]);
    // A slow answer: more than a second since the last send already.
    clock.ms = 2_500;
    await estimator.estimateSidePose(PICTURE);
    expect(waits).toHaveLength(1);
    expect(calls.map((call) => call.at)).toStrictEqual([0, 1_000, 2_500]);
    expect(INSTANCE_POSE_INTERVAL_MILLISECONDS).toBe(1_000);
  });
});

describe('a stop that says why (#1106, ruling 3)', () => {
  it.each([
    [503, 'pictures_off', 'pictures-off'],
    [409, 'picture_source_unavailable', 'no-hosted-service'],
    [422, 'model_without_pictures', 'model-without-pictures'],
    [403, 'sealed_required', 'not-sealed'],
    [401, 'unauthenticated', 'not-sealed'],
    [404, 'not_found', 'instance-without-pictures'],
  ] as const)(
    'stops for good on %i %s, as %s, and sends nothing more',
    async (status, code, why) => {
      const { estimator, calls } = world([refusal(status, code)]);
      expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({ kind: 'unavailable', why });
      expect(await estimator.estimateSidePose(PICTURE)).toStrictEqual({ kind: 'unavailable', why });
      expect(calls).toHaveLength(1);
    },
  );

  it('tries the next picture after one that failed, and stops after three in a row', async () => {
    expect(MAXIMUM_CONSECUTIVE_INSTANCE_FAILURES).toBe(3);
    const { estimator, calls } = world([
      refusal(502, 'picture_model_failed'),
      new Error('no answer'),
      { status: 200, body: { answer: NOBODY } },
      refusal(429, 'rate_limited'),
      { status: 200, body: { notAnAnswer: true } },
      refusal(502, 'picture_model_failed'),
    ]);
    const kinds: string[] = [];
    for (let picture = 0; picture < 7; picture += 1) {
      const outcome = await estimator.estimateSidePose(PICTURE);
      kinds.push(
        outcome.kind === 'unavailable' ? `unavailable:${String(outcome.why)}` : outcome.kind,
      );
    }
    expect(kinds).toStrictEqual([
      'unreadable',
      'unreadable',
      // An answer about a picture: the count starts again.
      'no-rider',
      'unreadable',
      'unreadable',
      'unavailable:not-answering',
      'unavailable:not-answering',
    ]);
    expect(calls).toHaveLength(6);
  });
});
