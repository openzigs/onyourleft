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
 *    carries no picture part, no data URL and no array longer than the
 *    input's own largest ({@link pictureBodyFaults}); each rule has a red
 *    fixture, and the own-computer transport's real picture body is one.
 *
 * ## The entries, and the ones still to come
 *
 * The four hosted modules; and **every** non-test module under
 * `ride-analysis/`, derived rather than listed, so #809's input builder is
 * walked today and #810's prompt builders and #811's runner are walked the day
 * they land there. ⚠️ A step-request type or body builder added to
 * `analysis-transport.ts` itself (#802) CANNOT be walked: that module carries
 * pictures by design, for `side-pose` and `connection-check`. #802 has to put
 * the ride-analysis request and its builder in a module of their own and add
 * it to {@link ENTRIES}, and #802 and #803 hold their bodies to
 * {@link pictureBodyFaults}.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';
import type { RideAnalysisInput } from '../ride-analysis/input';

import { analysisRequestBody } from './analysis-transport';
import { capturedFrame } from './frame';
import { HOSTED_PROMPTS, type HostedQuestion } from './hosted-port';
import { hostedRequestBody } from './hosted-transport';
import {
  importWalk,
  readFromDisk,
  SOURCE_ROOT,
  type ImportClosure,
  type ReadSource,
} from './import-walk-testing';
import { largestArrayIn, PICTURE_NAME, pictureBodyFaults } from './no-picture-testing';
import { cleanFrameBytes } from './testing';

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

/** Every module a model request is built from. */
const ENTRIES = [...HOSTED_ENTRIES, ...modulesUnder('ride-analysis')] as const;

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
  ...derivedPictureModules(modulesUnder('camera'), readFromDisk),
]);

describe('the module graph (#799)', () => {
  const walk = importWalk();

  it('walks the entries it names, so it is not a walk over nothing', () => {
    expect(ENTRIES).toContain('ride-analysis/input.ts');
    const walked = walk.closure(ENTRIES);
    for (const entry of ENTRIES) {
      expect(walked.modules, entry).toContain(entry);
    }
    // And past them: the input builder reaches the side camera's summary.
    expect(walked.modules).toContain('camera/side-session-summary.ts');
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

  it('refuses to walk an entry that is not there, rather than passing over it', () => {
    expect(() => importWalk().closure(['ride-analysis/not-there.ts'])).toThrow(/not there/);
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

  it.each(Object.keys(HOSTED_PROMPTS) as HostedQuestion[])(
    'passes the hosted %s body the transport really sends',
    (question) => {
      expect(pictureBodyFaults(hostedRequestBody('m', { question }), largest)).toStrictEqual([]);
    },
  );

  it.each([
    ['hosted', hostedShapedStep],
    ['own-computer', ownComputerShapedStep],
  ] as const)('passes a %s-shaped step carrying the input as text', (_path, step) => {
    expect(pictureBodyFaults(step(JSON.stringify(INPUT)), largest)).toStrictEqual([]);
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

  it('reads English with a colon in it as English', () => {
    expect(
      pictureBodyFaults(hostedShapedStep('Your ride data: 62 minutes, 31 km.'), largest),
    ).toStrictEqual([]);
  });
});
