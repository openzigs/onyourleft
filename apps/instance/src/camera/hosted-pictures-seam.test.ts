// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Two seams for a picture** (#1106), read off the source of every shipped
 * module of the instance, so a new module is held to them whichever directory
 * it is in (`analysis/hosted-seam.test.ts`'s shape):
 *
 * 1. A picture's hosted connection (`analysis/model.ts`
 *    §`createHostedPictureModel`) is built by `camera/hosted-pictures.ts` and
 *    by no other shipped module, with the one fixed question.
 * 2. The modules a picture passes through — everything under `camera/` —
 *    import nothing that keeps: no store, no blob store, no log, no `node:`
 *    module. *"Never stored on the instance: not in the job table, not in a
 *    log"* is then a property of what those modules can reach.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..');

/** Every shipped module under `directory`, at any depth. */
function shippedUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shippedUnder(path);
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('-testing.ts')
      ? [path]
      : [];
  });
}

/** The modules, relative to `src/`, whose source names the hosted picture connection's constructor. */
function naming(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files)
    .filter(([, source]) => /\bcreateHostedPictureModel\b/.test(source))
    .map(([path]) => path)
    .sort();
}

/** Whether every build of the connection in `source` is handed the one fixed question. */
function buildsWithTheFixedQuestion(source: string): boolean {
  const calls = [...source.matchAll(/\bcreateHostedPictureModel\s*\(\s*\{([^}]*)\}/g)];
  return (
    calls.length > 0 &&
    calls.every((call) => /\bquestion: SIDE_POSE_PICTURE_QUESTION\b/.test(call[1] ?? ''))
  );
}

/** What a module imports, as written: every `from '…'` and bare `import '…'`. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1] ?? '');
}

/** An import through which something could be kept: a store, a blob, a log, the file system. */
const KEEPS = /(^node:)|(\/store\/)|(\/blob\/)|(\/log\.ts$)|(\/sync\/)|(\/history\/)|(jobs\.ts$)/;

function keeping(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith('camera/'))
    .flatMap(([path, source]) =>
      importsOf(source)
        .filter((imported) => KEEPS.test(imported))
        .map((imported) => `${path} imports ${imported}`),
    )
    .sort();
}

describe('a picture’s hosted connection is built in one place, and a picture’s modules keep nothing (#1106)', () => {
  const files = Object.fromEntries(
    shippedUnder(SOURCE).map((path) => [relative(SOURCE, path), readFileSync(path, 'utf8')]),
  );

  it('walks every shipped module, and only model.ts (its definition) and camera/hosted-pictures.ts name the constructor', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(naming(files)).toStrictEqual(['analysis/model.ts', 'camera/hosted-pictures.ts']);
  });

  it('camera/hosted-pictures.ts builds it only with the one fixed question', () => {
    expect(buildsWithTheFixedQuestion(files['camera/hosted-pictures.ts'] ?? '')).toBe(true);
  });

  it('no module under camera/ imports a store, a blob store, a log or a node: module', () => {
    const camera = Object.keys(files).filter((path) => path.startsWith('camera/'));
    expect(camera.sort()).toStrictEqual([
      'camera/hosted-pictures.ts',
      'camera/picture-model.ts',
      'camera/picture.ts',
      'camera/routes.ts',
      'camera/side-pose.ts',
    ]);
    expect(keeping(files)).toStrictEqual([]);
  });

  it('finds a second builder, a builder with a question of its own, and a module that could keep — the controls', () => {
    expect(
      naming({
        'analysis/model.ts': 'export function createHostedPictureModel() {}',
        'camera/hosted-pictures.ts':
          'createHostedPictureModel({ question: SIDE_POSE_PICTURE_QUESTION })',
        'analysis/jobs.ts': "import { createHostedPictureModel } from './model.ts';",
      }),
    ).toStrictEqual(['analysis/jobs.ts', 'analysis/model.ts', 'camera/hosted-pictures.ts']);
    expect(
      buildsWithTheFixedQuestion('createHostedPictureModel({ baseUrl, question: asked })'),
    ).toBe(false);
    expect(buildsWithTheFixedQuestion('createHostedPictureModel({ baseUrl })')).toBe(false);
    expect(
      buildsWithTheFixedQuestion(
        'createHostedPictureModel({\n    baseUrl,\n    question: SIDE_POSE_PICTURE_QUESTION,\n  })',
      ),
    ).toBe(true);
    expect(
      keeping({
        'camera/side-pose.ts':
          "import { logEvent } from '../log.ts';\nimport type { SqlStore } from '../store/sql-store.ts';\nimport { writeFile } from 'node:fs/promises';",
        'analysis/jobs.ts': "import { logEvent } from '../log.ts';",
      }),
    ).toStrictEqual([
      'camera/side-pose.ts imports ../log.ts',
      'camera/side-pose.ts imports ../store/sql-store.ts',
      'camera/side-pose.ts imports node:fs/promises',
    ]);
  });
});
