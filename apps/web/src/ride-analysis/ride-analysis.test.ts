// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The post-ride ask (#804), against the real store and the real step port to
 * the rider's own computer with a scripted model server behind its `fetch`.
 * Every write is read back through a FRESH connection — the path the ride's
 * page reads — never through the handle that wrote it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unixSeconds } from '@onyourleft/domain';
import {
  activityId,
  type ActivityId,
  type AthleteId,
  type RideWriteUpRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  seedRide,
  streamSetFor,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { endpointDecision, type AnalysisEndpoint } from '../camera/analysis-endpoint';
import { riderModelStepPort } from '../camera/analysis-transport';
import { SOURCE_ROOT } from '../camera/import-walk-testing';
import type { UntrustedText } from '@onyourleft/analysis';
import { screenWriteUp, type ScreenedWriteUp } from '@onyourleft/analysis';
import { stripComments } from '../units/no-inline-units';
import { hostedModelDecision } from '../camera/hosted-model';
import { hostedModelPort } from '../camera/hosted-transport';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import { hostedStepPort } from './hosted-step';
import { modelServer, REPLY_MARKER, STILL_CLOCK, type ModelServer } from './model-server-testing';
import type { ModelStepPort } from '@onyourleft/analysis';
import {
  ASK_FAILURE_TEXT,
  askFailureText,
  CANCELLED_TEXT,
  createRideAnalysis,
  platformRunnerClock,
  type RideAnalysisOptions,
  type RideAnalysisStore,
  type ScreenedRideWriteUp,
} from './ride-analysis';
import type { AskOutcome, AskProgress } from './ride-analysis-port';
import { RUN_FAILURE_TEXT } from '@onyourleft/analysis';
import { CURRENT_ANALYSIS_TEMPLATE } from '@onyourleft/analysis';
import { patternsOnlyGuard } from '@onyourleft/analysis/testing';
import { browserSecureWindow } from '../camera/secure-window-testing';

const ADDRESS = 'http://192.168.1.20:8080';
const MODEL = 'text-7b';

function endpoint(): AnalysisEndpoint {
  const decision = endpointDecision({ address: ADDRESS, model: MODEL, switchedOn: true });
  if (decision.endpoint === undefined) {
    throw new Error('fixture endpoint refused');
  }
  return decision.endpoint;
}

/** A step port that counts, answering nothing — for "is it ever asked". */
function countingPort(): ModelStepPort & { calls: number } {
  const port = {
    calls: 0,
    runModelStep: async () => {
      port.calls += 1;
      return Promise.resolve({ kind: 'failed' as const, failure: 'unreachable' as const });
    },
  };
  return port;
}

const POSE = {
  differences: { torso: -9.5, elbow: 2.25 },
  posed: 2700,
  noRider: 41,
  unreadable: 6,
  source: 'computer' as const,
};

let harness: StoreHarness;
let writer: PersistentStore;
let server: ModelServer;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = indexedDbStoreFactory.open(harness.databaseName);
  server = modelServer();
});

afterEach(async () => {
  writer.close();
  await harness.destroy();
});

async function seededRide(owner: AthleteId = ATHLETE_A): Promise<ActivityId> {
  const ride = await seedRide(harness, owner);
  await harness.write(async (store) =>
    store.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
  );
  return ride.id;
}

function ask(overrides: Partial<RideAnalysisOptions> = {}) {
  return createRideAnalysis({
    store: writer,
    athleteId: ATHLETE_A,
    computer: () => riderModelStepPort(endpoint(), { send: server.send }),
    nativeShell: false,
    cameraConsented: () => true,
    clock: STILL_CLOCK,
    now: () => unixSeconds(1_800_000_000),
    ...overrides,
  });
}

async function savedWriteUp(id: ActivityId): Promise<RideWriteUpRecord | undefined> {
  return harness.read(async (store) => store.getRideWriteUp(ATHLETE_A, id));
}

const live = (): AbortSignal => new AbortController().signal;

describe('which sources are offered, in which order (owner ruling 7)', () => {
  const offered = (computer: boolean, hosted: boolean) =>
    ask({
      computer: () => (computer ? countingPort() : undefined),
      hosted: () => (hosted ? countingPort() : undefined),
    }).availableSources();

  it('offers the rider’s own computer first when both are set up', () => {
    expect(offered(true, true)).toStrictEqual(['computer', 'hosted']);
  });

  it('offers the one that is set up, alone', () => {
    expect(offered(true, false)).toStrictEqual(['computer']);
    expect(offered(false, true)).toStrictEqual(['hosted']);
  });

  it('offers nothing when neither is, and with no hosted source at all', () => {
    expect(offered(false, false)).toStrictEqual([]);
    expect(ask({ computer: () => undefined }).availableSources()).toStrictEqual([]);
  });

  it('refuses a source switched off between the page opening and the press, sending nothing', async () => {
    const id = await seededRide();
    const outcome = await ask({ computer: () => undefined }).askForRideWriteUp(
      id,
      'computer',
      live(),
    );
    expect(outcome).toStrictEqual({ kind: 'failed', text: ASK_FAILURE_TEXT['no-source'] });
    expect(server.requests).toHaveLength(0);
  });

  it('asks the hosted model through the hosted port when that is the one pressed', async () => {
    const id = await seededRide();
    const hosted = countingPort();
    const computer = countingPort();
    await ask({ computer: () => computer, hosted: () => hosted }).askForRideWriteUp(
      id,
      'hosted',
      live(),
    );
    expect(hosted.calls).toBeGreaterThan(0);
    expect(computer.calls).toBe(0);
  });
});

describe('the write is read back through the path the page reads', () => {
  it('saves the screened write-up with the ride, read back on a fresh connection', async () => {
    const id = await seededRide();
    const outcome = await ask().askForRideWriteUp(id, 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    const saved = await savedWriteUp(id);
    expect(saved).toStrictEqual({
      activityId: id,
      athleteId: ATHLETE_A,
      text: server.summary,
      templateId: CURRENT_ANALYSIS_TEMPLATE.id,
      templateVersion: CURRENT_ANALYSIS_TEMPLATE.version,
      source: 'computer',
      includedPose: false,
      missingSections: [],
      writtenAt: 1_800_000_000,
    });
  });

  it('replaces the first write-up with the second, read back the same way', async () => {
    const id = await seededRide();
    await ask().askForRideWriteUp(id, 'computer', live());
    server.summary = 'A second look: the pacing held all the way through.';
    await ask().askForRideWriteUp(id, 'computer', live());
    expect((await savedWriteUp(id))?.text).toBe(server.summary);
  });

  it.each<[string, (server: ModelServer) => void, string]>([
    [
      'a run the screen withholds twice',
      (model) => {
        model.summary = 'Your knee reached 142° at the bottom of the stroke.';
      },
      RUN_FAILURE_TEXT['withheld-by-screen'],
    ],
    [
      'a failed run',
      (model) => {
        model.summary = '';
      },
      RUN_FAILURE_TEXT['no-summary'],
    ],
  ])('leaves the earlier write-up untouched after %s', async (_, spoil, text) => {
    const id = await seededRide();
    await ask().askForRideWriteUp(id, 'computer', live());
    const before = await savedWriteUp(id);
    spoil(server);
    const outcome = await ask().askForRideWriteUp(id, 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'failed', text });
    expect(await savedWriteUp(id)).toStrictEqual(before);
  });

  it('leaves the earlier write-up untouched after a cancel, even one after the last reply', async () => {
    const id = await seededRide();
    await ask().askForRideWriteUp(id, 'computer', live());
    const before = await savedWriteUp(id);
    server.summary = 'A write-up nobody is waiting for.';
    const cancel = new AbortController();
    // Cancel once the summary has been asked for: the run has everything it
    // needs, and must still keep none of it.
    const outcome = await ask({
      computer: () => {
        const port = riderModelStepPort(endpoint(), { send: server.send });
        return port === undefined
          ? undefined
          : {
              runModelStep: async (step, signal) => {
                const reply = await port.runModelStep(step, signal);
                if (step.kind === 'summary') {
                  cancel.abort();
                }
                return reply;
              },
            };
      },
    }).askForRideWriteUp(id, 'computer', cancel.signal);
    expect(outcome).toStrictEqual({ kind: 'failed', text: CANCELLED_TEXT['computer-browser'] });
    expect(await savedWriteUp(id)).toStrictEqual(before);
  });

  it('says so, and keeps the earlier write-up, when the store will not keep the new one', async () => {
    const id = await seededRide();
    const refusing: RideAnalysisStore = {
      getActivity: writer.getActivity.bind(writer),
      getStreamSet: writer.getStreamSet.bind(writer),
      getAthlete: writer.getAthlete.bind(writer),
      listLaps: writer.listLaps.bind(writer),
      getRoute: writer.getRoute.bind(writer),
      getSideCameraReport: writer.getSideCameraReport.bind(writer),
      putRideWriteUp: async () => Promise.reject(new Error(`${ADDRESS} ${MODEL}`)),
    };
    const outcome = await ask({ store: refusing }).askForRideWriteUp(id, 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: ASK_FAILURE_TEXT['not-saved'] });
    expect(await savedWriteUp(id)).toBeUndefined();
  });

  it('keeps the sections a run left out, counted from nought as the store counts them', async () => {
    const id = await seededRide();
    const port = riderModelStepPort(endpoint(), { send: server.send });
    let sectionsAsked = 0;
    const outcome = await ask({
      computer: () => ({
        runModelStep: async (step, signal) => {
          if (step.kind === 'section') {
            sectionsAsked += 1;
            // The first section's step fails; the rest answer.
            if (sectionsAsked === 1) {
              return { kind: 'failed', failure: 'unreachable' };
            }
          }
          return (port as ModelStepPort).runModelStep(step, signal);
        },
      }),
    }).askForRideWriteUp(id, 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    expect(sectionsAsked).toBeGreaterThan(1);
    expect((await savedWriteUp(id))?.missingSections).toStrictEqual([0]);
  });
});

describe('only screened text is saved', () => {
  it('saves no part of a raw reply outside the field the runner reads', async () => {
    const id = await seededRide();
    await ask().askForRideWriteUp(id, 'computer', live());
    const saved = await savedWriteUp(id);
    expect(saved).toBeDefined();
    expect(JSON.stringify(saved)).not.toContain(REPLY_MARKER);
  });

  it('refuses a structured reply carrying a key beside the validated ones, so it reaches nothing (#805)', async () => {
    const id = await seededRide();
    await ask().askForRideWriteUp(id, 'computer', live());
    const earlier = await savedWriteUp(id);
    server = modelServer('A different ride entirely.', { extraKey: true });
    const outcome = await ask().askForRideWriteUp(id, 'computer', live());
    // Every section step is refused at the acceptor, so the run fails and the
    // earlier write-up stands.
    expect(outcome).toStrictEqual({
      kind: 'failed',
      text: RUN_FAILURE_TEXT['too-few-sections'],
    });
    // The server was asked; the outcome above is what its extra key cost.
    expect(server.requests.length).toBeGreaterThan(0);
    const saved = await savedWriteUp(id);
    expect(saved).toStrictEqual(earlier);
    expect(JSON.stringify(saved)).not.toContain(REPLY_MARKER);
  });

  it('takes a screened write-up, and a plain string does not compile', () => {
    const record: Omit<ScreenedRideWriteUp, 'text'> = {
      activityId: activityId('r'),
      athleteId: ATHLETE_A,
      templateId: 't',
      templateVersion: '1',
      source: 'computer',
      includedPose: false,
      missingSections: [],
      writtenAt: unixSeconds(0),
    };
    const screened = screenWriteUp('A steady ride.' as UntrustedText) as ScreenedWriteUp;
    const accepted: ScreenedRideWriteUp = { ...record, text: screened };
    // @ts-expect-error — a string that did not come out of the screen is not a write-up to keep.
    const refused: ScreenedRideWriteUp = { ...record, text: 'A steady ride.' };
    expect([accepted.text, refused.text]).toHaveLength(2);
  });
});

describe('the pose summary goes only with camera consent (owner ruling 5)', () => {
  async function filmedRide(): Promise<ActivityId> {
    const id = await seededRide();
    await harness.write(async (store) =>
      store.putSideCameraReport({
        activityId: id,
        athleteId: ATHLETE_A,
        summary: 'Your position was compared across the session.',
        observations: [],
        pose: POSE,
      }),
    );
    return id;
  }

  const positionAsked = (): boolean =>
    server.requests.some(
      (request) =>
        (request.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema
          ?.name === 'position_notes',
    );

  it('sends the pose summary, and says so on the row, when the camera consent covers it', async () => {
    const id = await filmedRide();
    await ask({ cameraConsented: () => true }).askForRideWriteUp(id, 'computer', live());
    expect(positionAsked()).toBe(true);
    expect(JSON.stringify(server.requests)).toContain('-9.5');
    expect((await savedWriteUp(id))?.includedPose).toBe(true);
  });

  it('leaves it out without the consent, and still writes the ride up', async () => {
    const id = await filmedRide();
    const outcome = await ask({ cameraConsented: () => false }).askForRideWriteUp(
      id,
      'computer',
      live(),
    );
    expect(outcome).toStrictEqual({ kind: 'written' });
    expect(positionAsked()).toBe(false);
    expect(JSON.stringify(server.requests)).not.toContain('-9.5');
    expect((await savedWriteUp(id))?.includedPose).toBe(false);
  });

  /** The hosted model's step port, through the real controller and transport, over `server` (#803). */
  function hostedOver(): () => ModelStepPort | undefined {
    const service = hostedModelDecision({
      address: 'https://models.example.invalid',
      model: 'a-model',
      key: 'fixture-hosted-key-DO-NOT-LEAK',
    }).model;
    const camera = new CameraController({
      secureWindow: browserSecureWindow(),
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
      hosted: () => hostedModelPort(service, { guard: patternsOnlyGuard, send: server.send }),
    });
    camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    camera.agreeToHosted(true);
    return () => hostedStepPort(camera, () => true);
  }

  /** Whether any request carried the pose step's prompt — the hosted path sends no schema name. */
  const poseSent = (): boolean =>
    JSON.stringify(server.requests).includes('The side-camera comparison');

  it('on the hosted model too (#803): sends the pose summary with the camera consent', async () => {
    const id = await filmedRide();
    const outcome = await ask({
      hosted: hostedOver(),
      cameraConsented: () => true,
    }).askForRideWriteUp(id, 'hosted', live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    expect(poseSent()).toBe(true);
    expect((await savedWriteUp(id))?.source).toBe('hosted');
    expect((await savedWriteUp(id))?.includedPose).toBe(true);
  });

  it('on the hosted model too (#803): leaves the pose field out without the camera consent', async () => {
    const id = await filmedRide();
    const outcome = await ask({
      hosted: hostedOver(),
      cameraConsented: () => false,
    }).askForRideWriteUp(id, 'hosted', live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    expect(server.requests.length).toBeGreaterThan(0);
    expect(poseSent()).toBe(false);
    expect(JSON.stringify(server.requests)).not.toContain('-9.5');
    expect(JSON.stringify(server.requests)).not.toContain('"pose"');
    expect((await savedWriteUp(id))?.includedPose).toBe(false);
  });

  it('writes up a ride with no side-camera session at all', async () => {
    const id = await seededRide();
    const outcome = await ask({ cameraConsented: () => true }).askForRideWriteUp(
      id,
      'computer',
      live(),
    );
    expect(outcome).toStrictEqual({ kind: 'written' });
    expect(positionAsked()).toBe(false);
  });
});

describe('nothing is sent without a press', () => {
  it('sends nothing when the ask is built, asked what it offers, or the store is written', async () => {
    const analysis = ask();
    expect(analysis.availableSources()).toStrictEqual(['computer']);
    // Saving a ride, its streams and its side-camera report.
    const id = await seededRide();
    await harness.write(async (store) =>
      store.putSideCameraReport({
        activityId: id,
        athleteId: ATHLETE_A,
        summary: 'Your position was compared across the session.',
        observations: [],
        pose: null,
      }),
    );
    expect(server.requests).toHaveLength(0);
    // And the press is what sends.
    await analysis.askForRideWriteUp(id, 'computer', live());
    expect(server.requests.length).toBeGreaterThan(0);
  });
});

describe('the ride is read as the rider’s own', () => {
  it('will not write up another athlete’s ride, and sends nothing for it', async () => {
    const theirs = await seededRide(ATHLETE_B);
    const outcome = await ask().askForRideWriteUp(theirs, 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: ASK_FAILURE_TEXT['not-read'] });
    expect(server.requests).toHaveLength(0);
    expect(
      await harness.read(async (store) => store.getRideWriteUp(ATHLETE_B, theirs)),
    ).toBeUndefined();
  });

  it('says the ride could not be read when a read fails, and names nothing', async () => {
    const outcome = await ask({
      store: {
        ...writer,
        getActivity: async () => Promise.reject(new Error(ADDRESS)),
      } as unknown as RideAnalysisStore,
    }).askForRideWriteUp(activityId('any'), 'computer', live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: ASK_FAILURE_TEXT['not-read'] });
  });
});

describe('cancelling', () => {
  it.each<[boolean, 'computer' | 'hosted', string]>([
    [false, 'computer', CANCELLED_TEXT['computer-browser']],
    [true, 'computer', CANCELLED_TEXT['computer-shell']],
    [false, 'hosted', CANCELLED_TEXT.hosted],
  ])(
    'in the shell %s, from %s, says the path’s own sentence',
    async (nativeShell, source, text) => {
      const id = await seededRide();
      const cancel = new AbortController();
      cancel.abort();
      const outcome = await ask({ nativeShell, hosted: () => countingPort() }).askForRideWriteUp(
        id,
        source,
        cancel.signal,
      );
      expect(outcome).toStrictEqual({ kind: 'failed', text });
    },
  );

  it('stops a run under way, and sends no step after the cancel', async () => {
    const id = await seededRide();
    const cancel = new AbortController();
    const port = riderModelStepPort(endpoint(), { send: server.send }) as ModelStepPort;
    let asked = 0;
    const outcome = await ask({
      computer: () => ({
        runModelStep: async (step, signal) => {
          asked += 1;
          cancel.abort();
          return port.runModelStep(step, signal);
        },
      }),
    }).askForRideWriteUp(id, 'computer', cancel.signal);
    expect(outcome).toStrictEqual({ kind: 'failed', text: CANCELLED_TEXT['computer-browser'] });
    expect(asked).toBe(1);
  });

  it('has a different sentence for each path, and only the shell says the computer may carry on', () => {
    expect(new Set(Object.values(CANCELLED_TEXT)).size).toBe(3);
    expect(CANCELLED_TEXT['computer-shell']).toMatch(/may carry on/);
    expect(CANCELLED_TEXT['computer-browser']).not.toMatch(/may carry on/);
  });
});

describe('progress', () => {
  it('passes on step n of m, and nothing else', async () => {
    const id = await seededRide();
    const seen: AskProgress[] = [];
    await ask().askForRideWriteUp(id, 'computer', live(), (progress) => {
      seen.push(progress);
    });
    expect(seen.length).toBeGreaterThan(1);
    const last = seen.at(-1);
    expect(last?.step).toBe(last?.total);
    for (const progress of seen) {
      expect(Object.keys(progress).sort()).toStrictEqual(['step', 'total']);
    }
  });
});

describe('what an ask says when it fails (ADR 0029 D-8)', () => {
  it('has a fixed sentence for every failure, naming no key, address, model or model text', () => {
    const sentences = [...Object.values(ASK_FAILURE_TEXT), ...Object.values(CANCELLED_TEXT)];
    for (const sentence of sentences) {
      expect(sentence).toMatch(/nothing was (?:kept|sent)|nothing was kept/);
      expect(sentence).not.toMatch(/https?:|\d+\.\d+\.\d+|:\d{2,5}\b|\bkey\b|\bsk-/i);
      expect(sentence).not.toContain(MODEL);
      expect(sentence).not.toContain(REPLY_MARKER);
    }
    expect(askFailureText('cancelled', 'hosted')).toBe(CANCELLED_TEXT.hosted);
    expect(askFailureText('no-summary', 'hosted')).toBe(RUN_FAILURE_TEXT['no-summary']);
  });

  it('carries none of the model’s words in any outcome', async () => {
    const id = await seededRide();
    server.summary = `${REPLY_MARKER} 142° at the knee`;
    const outcome: AskOutcome = await ask().askForRideWriteUp(id, 'computer', live());
    expect(outcome.kind).toBe('failed');
    expect(JSON.stringify(outcome)).not.toContain(REPLY_MARKER);
  });
});

describe('the platform clock', () => {
  it('waits, and a cancelled wait never elapses', async () => {
    const clock = platformRunnerClock();
    const start = clock.now();
    await clock.delay(5).elapsed;
    expect(clock.now()).toBeGreaterThanOrEqual(start);
    const cancelled = clock.delay(5);
    cancelled.cancel();
    const outcome = await Promise.race([
      cancelled.elapsed.then(() => 'elapsed'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 30)),
    ]);
    expect(outcome).toBe('waiting');
  });
});

describe('main.tsx builds that port and hands it to the shell (ride-analysis-wiring.test.tsx drives it)', () => {
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
  const builder = main.slice(
    main.indexOf('async function buildRideAnalysis('),
    main.indexOf('async function buildCameraController('),
  );

  it('finds the builder, so the checks below are not over nothing', () => {
    expect(builder).toContain('buildRideAnalysis');
    expect(builder.length).toBeGreaterThan(100);
  });

  it('builds the step port through riderModelStepSource, from the saved endpoint and the platform', () => {
    expect(builder).toMatch(
      /riderModelStepSource\(\s*nativeShell,\s*async \(\) => \(await import\('@onyourleft\/mobile'\)\)\.capacitorAnalysisPost\(\),\s*readAnalysisEndpoint,?\s*\)/,
    );
    expect(builder).toMatch(/nativeShell = isNativeShell\(platformCapacitor\(\)\)/);
  });

  it('builds the ask over the local store, the local athlete and the camera’s consent', () => {
    expect(builder).toMatch(/createRideAnalysis\(\{/);
    expect(builder).toMatch(/store: localStore\(\)/);
    expect(builder).toMatch(/athleteId: LOCAL_ATHLETE/);
    expect(builder).toMatch(/computer,/);
    expect(builder).toMatch(
      /cameraConsented: \(\) => camera\?\.state\(\)\.consent\.local \?\? false/,
    );
  });

  it('builds the hosted source over the camera controller and the saved service (#803)', () => {
    expect(builder).toMatch(
      /hosted: \(\) => hostedStepPort\(camera, \(\) => readHostedModel\(\) !== undefined\)/,
    );
  });

  it('passes it to the shell', () => {
    expect(main).toMatch(/const rideAnalysis = await buildRideAnalysis\(camera\);/);
    expect(main).toMatch(/rideAnalysis=\{rideAnalysis\}/);
  });
});
