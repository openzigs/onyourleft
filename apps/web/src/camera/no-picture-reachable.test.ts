// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No picture type is reachable from anything a model request is built
 * from** — #799, for #795's ride analysis and #518's hosted model.
 *
 * #760 held "never a picture" on the hosted path three ways: the
 * `HostedRequest` type, the run-time `isQuestionOnly` refusal, and a text scan
 * over four named files (`hosted-transport.test.ts` §"a picture cannot reach
 * it"). All three still stand. What the scan could not see was the GRAPH: it
 * read each file and never what that file imports, and on the tree #799 was
 * written against `hosted-port.ts` reached `CapturedFrame` in two steps —
 * `hosted-port.ts → analysis-port.ts → camera-port.ts` — for one branded
 * string type. The picture-free half of `analysis-port.ts` is `model-answer.ts`
 * since, and this file is what keeps it that way.
 *
 * Three holds:
 *
 * 1. **The module graph.** Walking every relative import transitively from
 *    each entry reaches no picture module. A picture module is one of a
 *    minimum list the issue names, OR any module under `camera/` whose code
 *    names a picture ({@link PICTURE_NAME}) — so a new one is caught with no
 *    edit here.
 * 2. **A control.** A planted chain `entry → helper → frame.ts` goes red and
 *    names the chain, and a planted picture module nobody listed is found by
 *    the derivation alone.
 * 3. **The body.** A ride-analysis request body, in either transport's shape,
 *    carries no picture part, no data URL, no array longer than the input's
 *    own largest and no long run of base64 ({@link pictureBodyFaults}); each
 *    rule has a red fixture, and the own-computer transport's real picture
 *    body is one. Since #822, JSON wrapped in prose is found, the transport's
 *    own `messages` and `content` lists are not bounded, and a relative import
 *    the walk cannot resolve fails the walk.
 *
 * ## The one path a picture has to an instance — #1106
 *
 * Since #1106 the side camera's pictures may go to the rider's instance, so
 * "no picture reaches an instance" is no longer true and this gate says what
 * IS: **`camera/instance-pose.ts` is the one module that puts a picture in an
 * instance's request, and the picture route is the one route it names.**
 * §"a picture reaches an instance by one path" holds it four ways — every
 * OTHER module that names an instance route is an entry of the graph walk,
 * derived rather than listed; the picture route is named by that one module;
 * that module names no other instance route; and its body is the one body
 * {@link pictureBodyFaults} is REQUIRED to fault. Each has a control.
 *
 * ## The entries, and the ones still to come
 *
 * The four hosted modules; and **every** non-test module under
 * `ride-analysis/`, derived rather than listed, so #809's input builder is
 * walked today and #810's prompt builders and #811's runner are walked the day
 * they land there. ⚠️ A step-request type or body builder added to
 * `analysis-transport.ts` itself CANNOT be walked: that module carries
 * pictures by design, for `side-pose` and `connection-check`. So #802 put the
 * ride-analysis request and its builder in a module of their own,
 * `ride-analysis/own-computer-step.ts`, which the derivation above walks, and
 * moved the send types it needs out of the transport into `http-body.ts`; and
 * §"the body carries no picture" holds every body a real run sends through it
 * to {@link pictureBodyFaults}. #803 did the same for the hosted path: its
 * step port is `ride-analysis/hosted-step.ts`, walked by the same derivation,
 * and §"the body carries no picture" holds every body a real run sends through
 * the hosted transport.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';
import type { RideAnalysisInput } from '@onyourleft/analysis';

import { analysisRequestBody, riderModelStepPort } from './analysis-transport';
import { endpointDecision } from './analysis-endpoint';
import { acceptHistoryAnswer } from '@onyourleft/analysis';
import { runAnalysis } from '@onyourleft/analysis';
import { capturedFrame } from './frame';
import { HOSTED_PROMPTS, type HostedQuestion } from './hosted-port';
import { hostedModelPort, hostedRequestBody } from './hosted-transport';
import { SIDE_POSE_PATH, sidePoseRequest } from './instance-pose';
import { hostedModelDecision } from './hosted-model';
import { CameraController } from './session';
import { cleanFrameBytes, manualSchedule, scriptedCamera } from './testing';
import { hostedStepPort } from '../ride-analysis/hosted-step';
import { analysisJobRequest } from '../ride-analysis/instance-job';
import { modelServer, STILL_CLOCK } from '../ride-analysis/model-server-testing';
import {
  analysisModules,
  ANALYSIS_ROOT,
  importWalk,
  readFromDisk,
  SOURCE_ROOT,
  type ImportClosure,
  type ReadSource,
} from './import-walk-testing';
import { largestArrayIn, PICTURE_NAME, pictureBodyFaults } from './no-picture-testing';
import { patternsOnlyGuard } from '@onyourleft/analysis/testing';
import { PATTERNS_ONLY } from '@onyourleft/analysis';
import { browserSecureWindow } from './secure-window-testing';

/** The modules #799 names as picture modules whatever their code says. */
const MINIMUM_PICTURE_MODULES = [
  'camera/frame.ts',
  'camera/side-link-pictures.ts',
  'camera/browser-camera.ts',
  'camera/shell-camera.ts',
  'camera/pose-runtime.ts',
  'camera/pose-worker.ts',
] as const;

/** The hosted path (#518, #760). */
const HOSTED_ENTRIES = [
  'camera/hosted-port.ts',
  'camera/hosted-transport.ts',
  'camera/hosted-model.ts',
  'camera/useHostedCheck.ts',
] as const;

/** The non-test modules directly under `directory`, as paths under `src`. */
function modulesUnder(directory: string): string[] {
  return readdirSync(join(SOURCE_ROOT, directory))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => `${directory}/${name}`)
    .sort();
}

/**
 * The app's half of the history index (#835, ADR 0040 D-2 item 1): the sync
 * that pushes a ride's summary to the rider's instance. Its retrieval half is
 * `ride-analysis/history.ts`, walked with the rest of that directory; the
 * instance's half is `apps/instance/src/history/no-picture.test.ts`.
 */
const HISTORY_ENTRIES = ['instance/sync.ts'] as const;

/**
 * Every module a model request is built from, or history is indexed from —
 * since #1094 every module of `@onyourleft/analysis` too, where the runner, the
 * templates, the input builder and the history's retrieval moved.
 */
const ENTRIES = [
  ...HOSTED_ENTRIES,
  ...HISTORY_ENTRIES,
  ...modulesUnder('ride-analysis'),
  ...analysisModules(),
] as const;

/** Every module under `camera/` whose code names a picture. */
function derivedPictureModules(paths: readonly string[], read: ReadSource): string[] {
  return paths.filter((path) => PICTURE_NAME.test(stripComments(read(path) ?? '')));
}

/** The picture modules a walk reached, each with the chain of imports that reached it. */
function picturesReached(walked: ImportClosure, forbidden: ReadonlySet<string>): string[] {
  return [...walked.modules]
    .filter((path) => forbidden.has(path))
    .map((path) => (walked.chainTo(path) ?? [path]).join(' → '));
}

const FORBIDDEN = new Set<string>([
  ...MINIMUM_PICTURE_MODULES,
  ...derivedPictureModules([...modulesUnder('camera'), ...analysisModules()], readFromDisk),
]);

describe('the module graph (#799)', () => {
  const walk = importWalk();

  it('walks the entries it names, so it is not a walk over nothing', () => {
    expect(ENTRIES).toContain(`${ANALYSIS_ROOT}/input.ts`);
    // #835: the history's retrieval, its summary builder, and the sync that pushes it.
    expect(ENTRIES).toContain(`${ANALYSIS_ROOT}/history.ts`);
    expect(ENTRIES).toContain('ride-analysis/ride-summary.ts');
    expect(ENTRIES).toContain('instance/sync.ts');
    // #802: the step port to the rider's own computer, and what it imports.
    expect(ENTRIES).toContain('ride-analysis/own-computer-step.ts');
    // #1102: the job request to the rider's instance, and its controller.
    expect(ENTRIES).toContain('ride-analysis/instance-job.ts');
    expect(ENTRIES).toContain('ride-analysis/instance-analysis.ts');
    const walked = walk.closure(ENTRIES);
    for (const entry of ENTRIES) {
      expect(walked.modules, entry).toContain(entry);
    }
    // And past them: the input builder reaches the side camera's summary.
    expect(walked.modules).toContain(`${ANALYSIS_ROOT}/pose-summary.ts`);
  });

  it('has every picture module it names', () => {
    const read = readFromDisk;
    for (const path of MINIMUM_PICTURE_MODULES) {
      expect(read(path), path).toBeDefined();
    }
  });

  it('derives the picture modules from what the code says, and finds the ones it knows', () => {
    const derived = derivedPictureModules(modulesUnder('camera'), readFromDisk);
    // The frame type is declared in one and built in the other.
    expect(derived).toContain('camera/camera-port.ts');
    expect(derived).toContain('camera/frame.ts');
    // The own-computer transport builds a picture into a request by design.
    expect(derived).toContain('camera/analysis-transport.ts');
  });

  it.each(ENTRIES)(
    '%s reaches no picture module, directly or through anything it imports',
    (entry) => {
      expect(picturesReached(walk.closure([entry]), FORBIDDEN)).toStrictEqual([]);
    },
  );
});

describe('the walk can fire (#799’s control)', () => {
  /** A tree with planted modules over the real one. */
  function planted(files: Readonly<Record<string, string>>): ReadSource {
    return (path) => files[path] ?? readFromDisk(path);
  }

  it('goes red on a chain two imports long, and names the chain', () => {
    const walk = importWalk(
      planted({
        'ride-analysis/planted-entry.ts': "import { help } from './planted-helper';\n",
        'ride-analysis/planted-helper.ts':
          "import type { CapturedFrame as F } from '../camera/frame';\nexport const help = 1;\n",
      }),
    );
    expect(picturesReached(walk.closure(['ride-analysis/planted-entry.ts']), FORBIDDEN)).toContain(
      'ride-analysis/planted-entry.ts → ride-analysis/planted-helper.ts → camera/frame.ts',
    );
  });

  it('finds a picture module nobody listed, by what its code says', () => {
    const files = {
      'ride-analysis/planted-entry.ts': "export * from '../camera/planted-picture';\n",
      // Named in a comment only, which is not a picture: ImageBitmap.
      'camera/planted-words.ts': '// An ImageBitmap, a Blob and a CapturedFrame.\nexport {};\n',
      'camera/planted-picture.ts': 'export type Picture = ImageBitmap;\n',
    };
    const read = planted(files);
    const forbidden = new Set([
      ...MINIMUM_PICTURE_MODULES,
      ...derivedPictureModules(['camera/planted-words.ts', 'camera/planted-picture.ts'], read),
    ]);
    expect(forbidden.has('camera/planted-words.ts')).toBe(false);
    expect(
      picturesReached(importWalk(read).closure(['ride-analysis/planted-entry.ts']), forbidden),
    ).toStrictEqual(['ride-analysis/planted-entry.ts → camera/planted-picture.ts']);
  });

  it('follows an import after a regex literal holding `/*` (#864)', () => {
    const walk = importWalk(
      planted({
        'ride-analysis/planted-entry.ts':
          "const q = /[/*]/;\nimport type { CapturedFrame } from '../camera/frame';\n// */\nexport { q };\n",
      }),
    );
    expect(picturesReached(walk.closure(['ride-analysis/planted-entry.ts']), FORBIDDEN)).toContain(
      'ride-analysis/planted-entry.ts → camera/frame.ts',
    );
  });

  it('refuses to walk an entry that is not there, rather than passing over it', () => {
    expect(() => importWalk().closure(['ride-analysis/not-there.ts'])).toThrow(/not there/);
  });

  it('refuses a relative import it cannot resolve, rather than dropping it (#822)', () => {
    const walk = importWalk(
      planted({
        'ride-analysis/planted-entry.ts': "import { help } from './planted-helper';\n",
        'ride-analysis/planted-helper.ts': "export { frame } from '../camera/fram';\n",
      }),
    );
    expect(() => walk.closure(['ride-analysis/planted-entry.ts'])).toThrow(
      'ride-analysis/planted-helper.ts imports ../camera/fram, which the walk cannot resolve',
    );
  });

  it.each([
    ["import W from '../camera/frame.ts?worker';", '../camera/frame.ts?worker'],
    ["import I from './nothere?inline';", './nothere?inline'],
    ["import U from './picture.png?url&worker';", './picture.png?url&worker'],
  ])('refuses a query that is not exactly ?url or ?raw: %s (#823)', (line, specifier) => {
    const walk = importWalk(planted({ 'ride-analysis/planted-entry.ts': `${line}\n` }));
    expect(() => walk.closure(['ride-analysis/planted-entry.ts'])).toThrow(
      `ride-analysis/planted-entry.ts imports ${specifier}, which the walk cannot resolve`,
    );
  });

  it('refuses an existing file of code it does not walk, rather than skipping it (#823)', () => {
    const walk = importWalk(
      planted({
        'ride-analysis/planted-entry.ts': "import { legacy } from './legacy.js';\n",
        'ride-analysis/legacy.js': "export { frame as legacy } from '../camera/frame';\n",
      }),
    );
    expect(() => walk.closure(['ride-analysis/planted-entry.ts'])).toThrow(
      'ride-analysis/planted-entry.ts imports ./legacy.js, which the walk cannot resolve',
    );
  });

  it('passes over an asset handed over as a string, and a stylesheet that is there (#822)', () => {
    const walk = importWalk(
      planted({
        'ride-analysis/planted-entry.ts': [
          "import url from './picture.png?url';",
          "import text from './notes.txt?raw';",
          "import '../design/theme.css';",
          '',
        ].join('\n'),
      }),
    );
    expect([...walk.closure(['ride-analysis/planted-entry.ts']).modules]).toStrictEqual([
      'ride-analysis/planted-entry.ts',
    ]);
  });
});

/** A ride with three sections: the input's largest array is three long. */
const INPUT: RideAnalysisInput = {
  templateVersion: 'ride-analysis/1',
  ride: { movingMinutes: 62, distanceKilometres: 31.4 },
  rider: { massKilograms: 72, thresholdPower: 250 },
  whole: { power: { coverage: 1, mean: 190, max: 410 } },
  sections: [1, 2, 3].map((index) => ({
    index,
    kind: 'flat',
    minutes: 20,
    metrics: { power: { coverage: 1, mean: 185 + index, max: 300 } },
  })),
};

/** A text-only step body in the hosted transport's shape: one string of content. */
function hostedShapedStep(text: string): Record<string, unknown> {
  return { model: 'm', stream: false, messages: [{ role: 'user', content: text }] };
}

/** A text-only step body in the own-computer transport's shape: a list of parts. */
function ownComputerShapedStep(text: string): Record<string, unknown> {
  return {
    model: 'm',
    stream: false,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  };
}

describe('the body carries no picture (#799)', () => {
  const largest = largestArrayIn(INPUT);

  it('measures the input’s own largest array', () => {
    expect(largest).toBe(3);
  });

  it('passes the request a write-up job sends to the rider’s instance (#1102), with a pose summary and without', () => {
    const withPose: RideAnalysisInput = {
      ...INPUT,
      pose: { source: 'tablet', posed: 300, noRider: 2, unreadable: 1, differences: { knee: -2 } },
    };
    for (const input of [INPUT, withPose]) {
      const body = analysisJobRequest(input, '1', 'instance-local');
      expect(pictureBodyFaults(body, largestArrayIn(input))).toStrictEqual([]);
    }
  });

  it('fails a job request that carried a picture (#1102’s control)', () => {
    const body = {
      ...analysisJobRequest(INPUT, '1', 'instance-local'),
      frame: { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    };
    expect(pictureBodyFaults(body, largest)).not.toStrictEqual([]);
  });

  it.each(Object.keys(HOSTED_PROMPTS) as HostedQuestion[])(
    'passes the hosted %s body the transport really sends',
    (question) => {
      expect(
        pictureBodyFaults(hostedRequestBody('m', { question }, PATTERNS_ONLY), largest),
      ).toStrictEqual([]);
    },
  );

  it.each([
    ['hosted', hostedShapedStep],
    ['own-computer', ownComputerShapedStep],
  ] as const)('passes a %s-shaped step carrying the input as text', (_path, step) => {
    expect(pictureBodyFaults(step(JSON.stringify(INPUT)), largest)).toStrictEqual([]);
  });

  it('passes every body a real run sends to the rider’s own computer (#802)', async () => {
    const bodies: unknown[] = [];
    const port = riderModelStepPort(
      endpointDecision({ address: 'http://192.168.1.20:8080', model: 'm', switchedOn: true })
        .endpoint,
      {
        send: async (_url, init) => {
          const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as {
            response_format?: {
              json_schema: { schema: { properties: { section?: { enum: number[] } } } };
            };
          };
          bodies.push(body);
          // A section answers for its own index, the position step its notes,
          // the summary in prose: every step of a real run is reached.
          const section = body.response_format?.json_schema.schema.properties.section?.enum[0];
          const content =
            body.response_format === undefined
              ? 'A steady ride.'
              : JSON.stringify(
                  section === undefined ? { notes: 'Held.' } : { section, notes: 'Steady.' },
                );
          return Promise.resolve(
            new Response(
              JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
            ),
          );
        },
      },
    );
    const withPose: RideAnalysisInput = {
      ...INPUT,
      pose: { source: 'tablet', posed: 300, noRider: 2, unreadable: 1, differences: { knee: -2 } },
    };
    const outcome = await runAnalysis(withPose, {
      port: port as NonNullable<typeof port>,
      clock: {
        now: () => 0,
        delay: () => ({ elapsed: new Promise<void>(() => undefined), cancel: () => undefined }),
      },
      signal: new AbortController().signal,
      // #835: a passage of the rider's history, so the history step is reached too.
      history:
        acceptHistoryAnswer(
          { passages: [{ kind: 'note', label: 'Your note', text: 'Hill repeats felt strong.' }] },
          { limit: 6, characters: 5_400 },
        ) ?? [],
    });
    // Three sections, the position step, the history step and the summary: a whole run.
    expect(outcome.kind).toBe('written');
    expect(outcome.kind === 'written' && outcome.history).toBe('used');
    expect(bodies).toHaveLength(6);
    for (const body of bodies) {
      expect(pictureBodyFaults(body, largestArrayIn(withPose))).toStrictEqual([]);
    }
  });

  it('passes every body a real run sends to the hosted model (#803)', async () => {
    const bodies: unknown[] = [];
    const server = modelServer();
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
          guard: patternsOnlyGuard,
          send: async (url, init) => {
            bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown);
            return server.send(url, init);
          },
        }),
    });
    camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    camera.agreeToHosted(true);
    const port = hostedStepPort(camera, () => true);
    const withPose: RideAnalysisInput = {
      ...INPUT,
      pose: { source: 'tablet', posed: 300, noRider: 2, unreadable: 1, differences: { knee: -2 } },
    };
    const outcome = await runAnalysis(withPose, {
      port: port as NonNullable<typeof port>,
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
      // #835: a passage of the rider's history, which the hosted path refuses to send (ADR 0040 D-9).
      history:
        acceptHistoryAnswer(
          { passages: [{ kind: 'note', label: 'Your note', text: 'Hill repeats felt strong.' }] },
          { limit: 6, characters: 5_400 },
        ) ?? [],
    });
    // Three sections, the position step and the summary: the history step is
    // refused before a byte of it is sent, and the run goes on without it.
    expect(outcome.kind).toBe('written');
    expect(outcome.kind === 'written' && outcome.history).toBe('failed');
    expect(bodies).toHaveLength(5);
    expect(JSON.stringify(bodies)).not.toContain('Hill repeats');
    for (const body of bodies) {
      expect(pictureBodyFaults(body, largestArrayIn(withPose))).toStrictEqual([]);
    }
  });

  it('fails the own-computer transport’s real picture body, on both of the first two rules', () => {
    const frame = capturedFrame({
      bytes: cleanFrameBytes(),
      mediaType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    const faults = pictureBodyFaults(
      analysisRequestBody('m', { question: 'side-pose', frame }),
      largest,
    );
    expect(faults.some((fault) => fault.includes('picture part'))).toBe(true);
    expect(faults.some((fault) => fault.includes('of type image_url'))).toBe(true);
    expect(faults.some((fault) => fault.includes('data URL'))).toBe(true);
  });

  it.each([
    ['hosted', hostedShapedStep],
    ['own-computer', ownComputerShapedStep],
  ] as const)('fails a %s-shaped step with a data URL in its text', (_path, step) => {
    expect(
      pictureBodyFaults(step('Here is the ride: data:image/png;base64,iVBORw0KGgo='), largest),
    ).toStrictEqual([expect.stringContaining('is a data URL')]);
  });

  it.each([
    ['hosted', hostedShapedStep],
    ['own-computer', ownComputerShapedStep],
  ] as const)(
    'fails a %s-shaped step with a flattened pixel buffer in the input',
    (_path, step) => {
      const pixels = Array.from({ length: 64 * 48 }, (_unused, index) => index % 256);
      const faults = pictureBodyFaults(step(JSON.stringify({ ...INPUT, pixels })), largest);
      expect(faults).toStrictEqual([expect.stringContaining(`has ${pixels.length} entries`)]);
    },
  );

  it('fails a picture part of any type a model server reads, and a bare array', () => {
    for (const type of ['image_url', 'input_image', 'image']) {
      expect(
        pictureBodyFaults({ messages: [{ content: [{ type }] }] }, largest),
        type,
      ).toStrictEqual([expect.stringContaining(`of type ${type}`)]);
    }
    expect(pictureBodyFaults({ values: [1, 2, 3, 4] }, largest)).toStrictEqual([
      'body.values has 4 entries, more than 3',
    ]);
  });

  describe('JSON wrapped in prose (#822)', () => {
    const pixels = Array.from({ length: 64 * 48 }, (_unused, index) => index % 256);
    const json = JSON.stringify({ ...INPUT, pixels });

    it.each([
      ['before it', `Here is the ride as JSON: ${json}`],
      ['after it', `${json}\nSay what the rider did.`],
      ['on both sides', `The ride: ${json} — answer in one paragraph.`],
      ['after a bracket that is not JSON', `Read this [carefully]: ${json}`],
    ])('finds a pixel buffer with prose %s', (_where, text) => {
      for (const step of [hostedShapedStep, ownComputerShapedStep]) {
        expect(pictureBodyFaults(step(text), largest)).toStrictEqual([
          expect.stringContaining(`has ${pixels.length} entries`),
        ]);
      }
    });

    it('finds every JSON value in one string, not only the first', () => {
      expect(
        pictureBodyFaults(
          hostedShapedStep(`First ${JSON.stringify(INPUT)}, then ${JSON.stringify({ pixels })}.`),
          largest,
        ),
      ).toStrictEqual([expect.stringContaining('(json 1).pixels has')]);
    });

    it('passes the input wrapped in prose', () => {
      expect(
        pictureBodyFaults(
          ownComputerShapedStep(`The ride: ${JSON.stringify(INPUT)} — say what happened.`),
          largest,
        ),
      ).toStrictEqual([]);
    });
  });

  describe('the transport’s own envelope (#822)', () => {
    const emptyRide: RideAnalysisInput = { ...INPUT, sections: [] };
    const none = largestArrayIn(emptyRide);

    it('measures an empty ride’s largest array as nothing', () => {
      expect(none).toBe(0);
    });

    it.each([
      ['hosted', (text: string) => ({ role: 'user', content: text })],
      [
        'own-computer',
        (text: string) => ({
          role: 'user',
          content: [
            { type: 'text', text: 'The ride:' },
            { type: 'text', text },
          ],
        }),
      ],
    ] as const)('passes a clean two-message %s body for a ride with no sections', (_path, user) => {
      const body = {
        model: 'm',
        stream: false,
        messages: [
          { role: 'system', content: 'You describe rides.' },
          user(JSON.stringify(emptyRide)),
        ],
      };
      expect(pictureBodyFaults(body, none)).toStrictEqual([]);
    });

    it('passes the hosted body the transport really sends, for a ride with no sections', () => {
      expect(
        pictureBodyFaults(
          hostedRequestBody('m', { question: 'connection-check' }, PATTERNS_ONLY),
          none,
        ),
      ).toStrictEqual([]);
    });

    it('still bounds a messages or content list that is not messages or parts', () => {
      expect(pictureBodyFaults({ messages: [1, 2, 3, 4] }, largest)).toStrictEqual([
        'body.messages has 4 entries, more than 3',
      ]);
      expect(
        pictureBodyFaults({ messages: [{ role: 'user', content: [1, 2, 3, 4] }] }, largest),
      ).toStrictEqual(['body.messages[0].content has 4 entries, more than 3']);
    });

    it('still bounds a list called messages inside the input', () => {
      expect(
        pictureBodyFaults(
          hostedShapedStep(JSON.stringify({ messages: [{}, {}, {}, {}] })),
          largest,
        ),
      ).toStrictEqual([expect.stringContaining('(json 0).messages has 4 entries')]);
    });
  });

  describe('bare base64 (#822)', () => {
    const base64 = btoa(String.fromCharCode(...cleanFrameBytes()));

    it.each([
      ['hosted', hostedShapedStep],
      ['own-computer', ownComputerShapedStep],
    ] as const)('fails a %s-shaped step carrying a picture as base64 text', (_path, step) => {
      expect(pictureBodyFaults(step(`The rider: ${base64}`), largest)).toStrictEqual([
        expect.stringContaining('long run of base64'),
      ]);
    });

    it('fails base64 wrapped at 76 characters, and base64 inside the input', () => {
      const wrapped = base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
      expect(pictureBodyFaults(hostedShapedStep(wrapped), largest)).toStrictEqual([
        expect.stringContaining('long run of base64'),
      ]);
      expect(
        pictureBodyFaults(hostedShapedStep(JSON.stringify({ ...INPUT, frame: base64 })), largest),
      ).toStrictEqual([
        expect.stringContaining('body.messages[0].content holds a long run'),
        expect.stringContaining('(json 0).frame holds a long run'),
      ]);
    });

    it('passes a run one short of the bound, and a long sentence', () => {
      expect(pictureBodyFaults(hostedShapedStep('A'.repeat(99)), largest)).toStrictEqual([]);
      expect(pictureBodyFaults(hostedShapedStep('A'.repeat(100)), largest)).toStrictEqual([
        expect.stringContaining('long run of base64'),
      ]);
      expect(pictureBodyFaults(hostedShapedStep('word '.repeat(400)), largest)).toStrictEqual([]);
    });

    it('passes a list of field names one per line, and a rule of dashes (#823)', () => {
      const fields = [
        'power',
        'cadence',
        'heartRate',
        'speed',
        'distance',
        'movingMinutes',
        'thresholdPower',
        'massKilograms',
        'coverage',
        'sections',
        'metrics',
        'kind',
      ].join('\n');
      expect(fields.replace(/\n/g, '').length).toBeGreaterThanOrEqual(100);
      expect(pictureBodyFaults(hostedShapedStep(fields), largest)).toStrictEqual([]);
      expect(
        pictureBodyFaults(hostedShapedStep(`Ride\n${'-'.repeat(120)}\nNotes`), largest),
      ).toStrictEqual([]);
      expect(pictureBodyFaults(hostedShapedStep('_'.repeat(120)), largest)).toStrictEqual([]);
    });
  });

  it('reads English with a colon in it as English', () => {
    expect(
      pictureBodyFaults(hostedShapedStep('Your ride data: 62 minutes, 31 km.'), largest),
    ).toStrictEqual([]);
  });
});

/**
 * **A picture reaches an instance by one path** — #1106.
 *
 * The side camera's pictures may go to the rider's instance, sealed, when the
 * rider switched that on. So the rule is no longer "none does": it is that
 * {@link PICTURE_PATH} is the ONE module that puts a picture in an instance's
 * request, through the one instance module (`privacy/no-network.test.ts`
 * holds that half), and that it fails for any other.
 */
describe('a picture reaches an instance by one path (#1106)', () => {
  /** The one module that may send a picture to an instance. */
  const PICTURE_PATH = 'camera/instance-pose.ts';
  /** The instance's picture routes: everything under this prefix. */
  const PICTURE_ROUTES = '/v1/camera/';

  /** Every shipped module under `src`, as a path under it. */
  function shippedModules(directory = ''): string[] {
    return readdirSync(join(SOURCE_ROOT, directory), { withFileTypes: true })
      .flatMap((entry) => {
        const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === 'testing' ? [] : shippedModules(path);
        return /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name) &&
          !/(?:^|-)testing\.tsx?$/.test(entry.name) &&
          !entry.name.endsWith('.d.ts')
          ? [path]
          : [];
      })
      .sort();
  }

  /**
   * An instance route written in a module's code: a string that opens with
   * `/v1/`. ⚠️ `/v1/chat/completions` is not one — it is the path of an
   * OpenAI-compatible server on the rider's own computer
   * (`analysis-endpoint.ts` §`COMPLETIONS_PATH`), which no instance serves.
   */
  const INSTANCE_ROUTE = /['"`]\/v1\/(?!chat\/completions)/;

  /** The modules among `paths` whose code names an instance route. */
  function instanceCallers(paths: readonly string[], read: ReadSource): string[] {
    return paths.filter((path) => INSTANCE_ROUTE.test(stripComments(read(path) ?? '')));
  }

  /** The modules among `paths` whose code names a picture route of the instance. */
  function namingPictureRoute(paths: readonly string[], read: ReadSource): string[] {
    return paths.filter((path) => stripComments(read(path) ?? '').includes(PICTURE_ROUTES));
  }

  /** Every instance route `source` names, as written up to its first interpolation. */
  function routesNamedIn(source: string): string[] {
    return [...stripComments(source).matchAll(/['"`](\/v1\/[A-Za-z0-9/_-]*)/g)].map(
      (match) => match[1] ?? '',
    );
  }

  const modules = shippedModules();
  const callers = instanceCallers(modules, readFromDisk);
  const others = callers.filter((path) => path !== PICTURE_PATH);
  const walk = importWalk();

  it('derives the modules that call an instance, and finds the ones it knows', () => {
    expect(modules.length).toBeGreaterThan(300);
    for (const known of [
      'instance/instance-port.ts',
      'instance/sign-in.ts',
      'instance/sync.ts',
      'instance/moderation-port.ts',
      'instance/hosted-service.ts',
      'net/rooms-port.ts',
      'ride-analysis/instance-job.ts',
      PICTURE_PATH,
    ]) {
      expect(callers, known).toContain(known);
    }
    // The rider's own computer is not an instance.
    expect(callers).not.toContain('camera/analysis-endpoint.ts');
  });

  it.each(others)('%s names an instance route, and reaches no picture module', (caller) => {
    expect(picturesReached(walk.closure([caller]), FORBIDDEN)).toStrictEqual([]);
  });

  it('names the picture route in one module, and that module names no other instance route', () => {
    expect(SIDE_POSE_PATH.startsWith(PICTURE_ROUTES)).toBe(true);
    expect(namingPictureRoute(modules, readFromDisk)).toStrictEqual([PICTURE_PATH]);
    expect(routesNamedIn(readFromDisk(PICTURE_PATH) ?? '')).toStrictEqual([SIDE_POSE_PATH]);
  });

  it('is the one path that DOES reach a picture module — the exception is real, not vacuous', () => {
    expect(picturesReached(walk.closure([PICTURE_PATH]), FORBIDDEN)).toContain(
      `${PICTURE_PATH} → camera/frame.ts`,
    );
  });

  it('builds the one body that carries a picture, which the body rule faults — and a job’s body still has none', () => {
    const frame = capturedFrame({
      bytes: cleanFrameBytes(2048),
      mediaType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    const body = sidePoseRequest(frame.bytes, { source: 'instance-local' });
    expect(pictureBodyFaults(body, largestArrayIn(INPUT))).toStrictEqual([
      'body.picture holds a long run of base64',
    ]);
    expect(
      pictureBodyFaults(analysisJobRequest(INPUT, '1', 'instance-local'), largestArrayIn(INPUT)),
    ).toStrictEqual([]);
  });

  describe('it fails for any other — the controls', () => {
    /** A tree with planted modules over the real one. */
    const planted =
      (files: Readonly<Record<string, string>>): ReadSource =>
      (path) =>
        files[path] ?? readFromDisk(path);

    it('goes red for a second module that calls an instance and can reach a picture', () => {
      const files = {
        'detail/planted-upload.ts':
          "import { capturedFrame } from '../camera/frame';\nexport const to = '/v1/sync/items/note/1';\nexport { capturedFrame };\n",
      };
      const read = planted(files);
      const found = instanceCallers([...modules, 'detail/planted-upload.ts'], read);
      expect(found).toContain('detail/planted-upload.ts');
      expect(
        picturesReached(importWalk(read).closure(['detail/planted-upload.ts']), FORBIDDEN),
      ).toContain('detail/planted-upload.ts → camera/frame.ts');
    });

    it('finds an instance route however it is quoted, and not one only a comment names', () => {
      const read = planted({
        'a.ts': 'const path = `/v1/analysis/jobs/${id}`;',
        'b.ts': 'call("/v1/auth/devices");',
        'c.ts': "// It used to call '/v1/sync/records'.\nexport {};",
        'd.ts': "const completions = '/v1/chat/completions';",
      });
      expect(instanceCallers(['a.ts', 'b.ts', 'c.ts', 'd.ts'], read)).toStrictEqual([
        'a.ts',
        'b.ts',
      ]);
    });

    it('goes red for a second module naming the picture route, and for the one module naming another route', () => {
      const read = planted({
        'views/planted-sender.tsx': "export const path = '/v1/camera/side-pose';",
      });
      expect(namingPictureRoute([...modules, 'views/planted-sender.tsx'], read)).toStrictEqual([
        PICTURE_PATH,
        'views/planted-sender.tsx',
      ]);
      expect(
        routesNamedIn("const a = '/v1/camera/side-pose';\nconst b = `/v1/sync/items/${kind}`;"),
      ).toStrictEqual(['/v1/camera/side-pose', '/v1/sync/items/']);
    });
  });
});
