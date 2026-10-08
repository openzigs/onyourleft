// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No hosted request skips the masking** — the gate for
 * [#839](https://github.com/openzigs/onyourleft/issues/839), in the shape of
 * `camera/no-picture-reachable.test.ts` (#799, #822).
 *
 * Four halves, and each fails for a different reason:
 *
 * 1. **The source.** `camera/hosted-transport.ts` is the one module with the
 *    hosted `fetch`. Its request body must be `hostedRequestBody(…)` and every
 *    message `content` in that function must be `maskForHosted(…)`. A planted
 *    copy of the file with one message unmasked goes red — the control.
 * 2. **A real run with planted details.** Free text of every kind #839 names
 *    (goals, notes, a document, a retrieved write-up — none of which the input
 *    carries yet; #835 brings the history) is put into a template's prompt,
 *    the model's own notes carry details too, and the run goes through the
 *    real controller and transport with the rider's guard read from a real
 *    store. No body carries any planted detail, however it was hidden. The
 *    same prompts built into a body WITHOUT the mask carry every one — the
 *    control that shows the finder can find.
 * 3. **The negative.** A real run of the shipped template over a real ride,
 *    with a rider who has no words and no zones, sends every step's text
 *    exactly as the runner built it: ride numbers are not masked.
 * 4. **The preview is what is sent.** The ride page's preview and the bodies a
 *    run then sends are the same text, character for character, with a
 *    listed word that appears in the instructions so that the masking is
 *    visibly applied on both sides.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unixSeconds } from '@onyourleft/domain';
import { privacyZoneId, type ActivityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  seedRide,
  streamSetFor,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hostedModelDecision } from '../camera/hosted-model';
import { hostedModelPort } from '../camera/hosted-transport';
import { SOURCE_ROOT } from '../camera/import-walk-testing';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import { stripComments } from '../units/no-inline-units';
import { readMaskingGuard } from '@onyourleft/analysis';
import { hostedStepPort } from './hosted-step';
import type { RideAnalysisInput } from '@onyourleft/analysis';
import { modelServer, STILL_CLOCK } from './model-server-testing';
import type { ModelStepPort, StepRequest } from '@onyourleft/analysis';
import {
  personalDetailFaults,
  PLANTED_DETAILS,
  PLANTED_GUARD,
  plantedFreeText,
  plantedVariants,
} from '@onyourleft/analysis/testing';
import { createRideAnalysis, PREVIEW_FAILURE_TEXT } from './ride-analysis';
import { runAnalysis } from '@onyourleft/analysis';
import { CURRENT_ANALYSIS_TEMPLATE, type AnalysisTemplate } from '@onyourleft/analysis';
import { browserSecureWindow } from '../camera/secure-window-testing';

type Body = Readonly<Record<string, unknown>>;

/** The two message texts of a body. */
function contents(body: Body): string[] {
  const messages = body.messages as readonly { readonly content: string }[];
  return messages.map((message) => message.content);
}

let harness: StoreHarness;
let writer: PersistentStore;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = indexedDbStoreFactory.open(harness.databaseName);
});

afterEach(async () => {
  writer.close();
  await harness.destroy();
});

/** Store the planted guard's words and zones as the rider's own. */
async function storePlantedGuard(): Promise<void> {
  await writer.setAthleteMaskedWords(ATHLETE_A, PLANTED_GUARD.words);
  for (const [index, zone] of PLANTED_GUARD.zones.entries()) {
    await writer.putPrivacyZone({
      id: privacyZoneId(`zone-${String(index)}`),
      athleteId: ATHLETE_A,
      centre: zone.centre,
      radius: zone.radius as never,
      label: zone.label,
      createdAt: unixSeconds(1_700_000_000),
    });
  }
}

/**
 * The hosted step port, through the real controller and the real transport,
 * with the rider's guard read from the store for every request — as `main.tsx`
 * builds it. Every body is kept.
 */
function hostedOver(send: (url: string, init: RequestInit) => Promise<Response>): {
  readonly port: ModelStepPort;
  readonly bodies: Body[];
} {
  const bodies: Body[] = [];
  const service = hostedModelDecision({
    address: 'https://models.example.invalid',
    model: 'm',
    key: 'fixture-hosted-key',
  }).model;
  const camera = new CameraController({
    secureWindow: browserSecureWindow(),
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
    hosted: () =>
      hostedModelPort(service, {
        guard: async () => readMaskingGuard(writer, ATHLETE_A),
        send: async (url, init) => {
          bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Body);
          return send(url, init);
        },
      }),
  });
  camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  camera.agreeToHosted(true);
  const port = hostedStepPort(camera, () => true);
  if (port === undefined) {
    throw new Error('no hosted port');
  }
  return { port, bodies };
}

/** A port that remembers every step it was handed, then hands it on unchanged. */
function recording(inner: ModelStepPort): { port: ModelStepPort; steps: StepRequest[] } {
  const steps: StepRequest[] = [];
  return {
    steps,
    port: {
      runModelStep: async (step, signal) => {
        steps.push(step);
        return inner.runModelStep(step, signal);
      },
    },
  };
}

describe('the hosted body is built through the mask, and nowhere else (#839)', () => {
  const TRANSPORT = 'camera/hosted-transport.ts';

  /** What is wrong with `source` as the hosted transport, or nothing. */
  function unmaskedBodyFaults(source: string): string[] {
    const code = stripComments(source);
    const faults: string[] = [];
    // A `body:` that is a value, not a parameter's type annotation.
    const bodies = [...code.matchAll(/\bbody:[ \t]*(?![ \t]|string\b)([^\n]+)/g)].map(
      (match) => match[1] ?? '',
    );
    if (bodies.length === 0) {
      faults.push('no request body at all');
    }
    for (const body of bodies) {
      if (!body.startsWith('JSON.stringify(hostedRequestBody(')) {
        faults.push(`a body built some other way: ${body}`);
      }
    }
    const start = code.indexOf('export function hostedRequestBody(');
    const end = code.indexOf('\nexport function', start + 1);
    const builder = code.slice(start, end === -1 ? undefined : end);
    const contents = [...builder.matchAll(/\bcontent:\s*([^\n}]+)/g)].map(
      (match) => match[1] ?? '',
    );
    if (start === -1 || contents.length === 0) {
      faults.push('no message content in hostedRequestBody');
    }
    for (const content of contents) {
      if (!content.trimStart().startsWith('maskForHosted(')) {
        faults.push(`a message not masked: ${content.trim()}`);
      }
    }
    return faults;
  }

  const source = readFileSync(join(SOURCE_ROOT, TRANSPORT), 'utf8');

  it('holds for the transport as it stands', () => {
    expect(unmaskedBodyFaults(source)).toStrictEqual([]);
  });

  it('goes red on a planted builder that skips the mask for one message', () => {
    const planted = source.replace(
      "{ role: 'user', content: maskForHosted(step.user, guard) }",
      "{ role: 'user', content: step.user }",
    );
    expect(planted).not.toBe(source);
    expect(unmaskedBodyFaults(planted)).toStrictEqual(['a message not masked: step.user']);
  });

  it('goes red on a request body built without the builder', () => {
    const planted = source.replace(
      'body: JSON.stringify(hostedRequestBody(model.model, request, guard)),',
      'body: JSON.stringify({ model: model.model, request }),',
    );
    expect(planted).not.toBe(source);
    expect(unmaskedBodyFaults(planted)).toHaveLength(1);
  });
});

describe('a real hosted run carries no planted detail (#839)', () => {
  const INPUT: RideAnalysisInput = {
    templateVersion: CURRENT_ANALYSIS_TEMPLATE.version,
    ride: { movingMinutes: 62, distanceKilometres: 31.4 },
    rider: { massKilograms: 72, thresholdPower: 250 },
    whole: { power: { coverage: 1, mean: 190, max: 410 } },
    sections: [1, 2, 3].map((index) => ({
      index,
      kind: 'flat',
      minutes: 20,
      metrics: { power: { coverage: 1, mean: 185 + index, max: 300 } },
    })),
    pose: { source: 'tablet', posed: 300, noRider: 2, unreadable: 1, differences: { knee: -2 } },
  };

  /** The shipped template with free text of every kind in every section prompt. */
  const WITH_FREE_TEXT: AnalysisTemplate = (() => {
    const [section, ...rest] = CURRENT_ANALYSIS_TEMPLATE.steps;
    return {
      ...CURRENT_ANALYSIS_TEMPLATE,
      steps: [
        {
          ...section,
          bounds: { ...section.bounds, maximumInputCharacters: 50_000 },
          prompt: (input: RideAnalysisInput, index: number) => {
            const prompt = section.prompt(input, index);
            return { ...prompt, user: `${plantedFreeText()}\n${prompt.user}` };
          },
        },
        ...rest,
      ] as unknown as AnalysisTemplate['steps'],
    };
  })();

  /** A model whose notes carry details of their own, which the summary step sends back. */
  function chattyModel(): (url: string, init: RequestInit) => Promise<Response> {
    const server = modelServer();
    return async (url, init) => {
      const reply = await server.send(url, init);
      const parsed = (await reply.json()) as {
        choices: { message: { content: string } }[];
      };
      const [choice] = parsed.choices;
      if (choice !== undefined && choice.message.content.startsWith('{')) {
        const note = JSON.parse(choice.message.content) as Record<string, unknown>;
        note.notes =
          'Rode past 12 Acacia Avenue by Kestrel Farm; mail priya.rider+club@example.com.';
        choice.message.content = JSON.stringify(note);
      }
      return new Response(JSON.stringify(parsed), { status: 200 });
    };
  }

  it('masks every planted detail, in the prompts and in the model’s own notes', async () => {
    await storePlantedGuard();
    const { port, bodies } = hostedOver(chattyModel());
    const outcome = await runAnalysis(INPUT, {
      port,
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
      template: WITH_FREE_TEXT,
    });
    // Three sections, the position step and the summary: a whole run.
    expect(outcome.kind).toBe('written');
    expect(bodies).toHaveLength(5);
    for (const body of bodies) {
      expect(personalDetailFaults(body, plantedVariants())).toStrictEqual([]);
    }
    // The summary step really did carry the model's notes — masked.
    const summary = contents(bodies[4] as Body).join('\n');
    expect(summary).toContain('Rode past [address] by [masked]; mail [email].');
  });

  it('would find every one of them in a body that skipped the mask — the control', () => {
    const [section] = WITH_FREE_TEXT.steps;
    const prompt = section.prompt(INPUT, 1);
    const unmasked = {
      model: 'm',
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };
    expect(personalDetailFaults(unmasked, plantedVariants())).toHaveLength(
      plantedVariants().length,
    );
    expect(personalDetailFaults(unmasked)).toHaveLength(PLANTED_DETAILS.length);
  });

  it('sends nothing when the rider’s guard cannot be read', async () => {
    const { port, bodies } = hostedOver(modelServer().send);
    writer.close();
    await harness.destroy();
    const outcome = await runAnalysis(INPUT, {
      port,
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe('failed');
    expect(bodies).toStrictEqual([]);
    // Re-open so `afterEach` has something to close.
    harness = createStoreHarness();
    writer = indexedDbStoreFactory.open(harness.databaseName);
  });
});

describe('a real ride’s numbers are not masked (#839)', () => {
  it('sends every step exactly as the runner built it, for a rider with no words or zones', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
    );
    const hosted = hostedOver(modelServer().send);
    const recorded = recording(hosted.port);
    const outcome = await createRideAnalysis({
      store: writer,
      athleteId: ATHLETE_A,
      computer: () => undefined,
      hosted: () => recorded.port,
      nativeShell: false,
      cameraConsented: () => true,
      clock: STILL_CLOCK,
      now: () => unixSeconds(1_800_000_000),
    }).askForRideWriteUp(ride.id, 'hosted', new AbortController().signal);
    expect(outcome.kind).toBe('written');
    expect(hosted.bodies.length).toBeGreaterThan(2);
    expect(hosted.bodies.map(contents)).toStrictEqual(
      recorded.steps.map((step) => [step.system, step.user]),
    );
  });
});

describe('the preview is exactly what is sent (#839)', () => {
  async function rideWithStreams(): Promise<ActivityId> {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
    );
    return ride.id;
  }

  it('shows the same text, character for character, as the run then sends', async () => {
    const ride = await rideWithStreams();
    // A word the instructions use, so masking visibly happens on both sides.
    await writer.setAthleteMaskedWords(ATHLETE_A, ['cyclist']);
    const hosted = hostedOver(modelServer().send);
    const analysis = createRideAnalysis({
      store: writer,
      athleteId: ATHLETE_A,
      computer: () => undefined,
      hosted: () => hosted.port,
      hostedGuard: async () => readMaskingGuard(writer, ATHLETE_A),
      nativeShell: false,
      cameraConsented: () => true,
      clock: STILL_CLOCK,
      now: () => unixSeconds(1_800_000_000),
    });

    expect(analysis.hostedPreviewSeen()).toBe(false);
    const preview = await analysis.previewHostedRequest(ride);
    expect(hosted.bodies).toStrictEqual([]);
    expect(analysis.hostedPreviewSeen()).toBe(true);
    if (preview.kind !== 'shown') {
      throw new Error(preview.text);
    }
    expect(preview.steps.length).toBeGreaterThan(0);
    expect(preview.steps.some((step) => step.system.includes('[masked]'))).toBe(true);

    const outcome = await analysis.askForRideWriteUp(ride, 'hosted', new AbortController().signal);
    expect(outcome.kind).toBe('written');
    expect(hosted.bodies).toHaveLength(preview.total);
    expect(hosted.bodies.slice(0, preview.steps.length).map(contents)).toStrictEqual(
      preview.steps.map((step) => [step.system, step.user]),
    );
  });

  it('shows nothing, and sends nothing, when the guard cannot be read or the ride is not there', async () => {
    const ride = await rideWithStreams();
    const hosted = hostedOver(modelServer().send);
    const options = {
      store: writer,
      athleteId: ATHLETE_A,
      computer: () => undefined,
      hosted: () => hosted.port,
      nativeShell: false,
      cameraConsented: () => true,
      clock: STILL_CLOCK,
      now: () => unixSeconds(1_800_000_000),
    };
    const blocked = createRideAnalysis({
      ...options,
      hostedGuard: async () => Promise.reject(new Error('blocked')),
    });
    expect((await blocked.previewHostedRequest(ride)).kind).toBe('failed');
    expect(blocked.hostedPreviewSeen()).toBe(false);
    const missing = createRideAnalysis({
      ...options,
      hostedGuard: async () => readMaskingGuard(writer, ATHLETE_A),
    });
    expect((await missing.previewHostedRequest('not-a-ride' as ActivityId)).kind).toBe('failed');
    // A controller built with no guard reader has nothing to mask with.
    expect(await createRideAnalysis(options).previewHostedRequest(ride)).toStrictEqual({
      kind: 'failed',
      text: PREVIEW_FAILURE_TEXT['not-masked'],
    });
    expect(hosted.bodies).toStrictEqual([]);
  });
});
