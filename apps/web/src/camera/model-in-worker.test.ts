// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The pose model stays in its worker** — #1061, ADR 0044 D-1 (*"nothing in
 * the live view may move inference to the main thread"*), from spike 0010:
 * on the page's main thread the model cost the game 50–115 ms frames.
 *
 * A source scan over every non-test module under `src/`: only
 * `camera/pose-worker.ts` may import MediaPipe's vision package or call the
 * model (`detect`, `detectForVideo`). And that worker runs it for ONE person
 * (`numPoses: 1`, D-7), so a second person in frame is never outlined.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE = join(import.meta.dirname, '..');
const WORKER = 'camera/pose-worker.ts';

function modules(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return modules(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-testing\.tsx?$/.test(name)
      ? [relative(SOURCE, path)]
      : [];
  });
}

/** Whether `code` imports the vision package or calls the model. */
function runsTheModel(code: string): boolean {
  const bare = stripComments(code);
  return (
    /from\s+['"]@mediapipe\/tasks-vision/.test(bare) ||
    /import\s*\(\s*['"]@mediapipe\/tasks-vision/.test(bare) ||
    /\.detect(ForVideo)?\s*\(/.test(bare)
  );
}

describe('the pose model stays in the worker — #1061, ADR 0044 D-1', () => {
  it('finds the worker it is checking, and the worker does run the model', () => {
    const all = modules(SOURCE);
    expect(all).toContain(WORKER);
    expect(runsTheModel(readFileSync(join(SOURCE, WORKER), 'utf8'))).toBe(true);
  });

  it('is named in no main-thread module', () => {
    const offenders = modules(SOURCE)
      .filter((path) => path !== WORKER)
      .filter((path) => runsTheModel(readFileSync(join(SOURCE, path), 'utf8')));
    expect(offenders).toStrictEqual([]);
  });

  it('catches a view that calls the estimator itself', () => {
    expect(runsTheModel('const found = landmarker.detect(bitmap);')).toBe(true);
    expect(runsTheModel('landmarker.detectForVideo(frame, now);')).toBe(true);
    expect(runsTheModel("import { PoseLandmarker } from '@mediapipe/tasks-vision';")).toBe(true);
    expect(runsTheModel('// landmarker.detect(bitmap) is the worker’s')).toBe(false);
  });

  it('runs the model for one person only (D-7)', () => {
    const worker = stripComments(readFileSync(join(SOURCE, WORKER), 'utf8'));
    expect(worker).toMatch(/numPoses:\s*1\b/);
  });
});
