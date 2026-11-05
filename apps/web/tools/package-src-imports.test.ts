// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2147: a non-test file under `apps/` may not reach a package's `src/` by a
 * relative path, and a test may. The package's `exports` map is what keeps
 * `packages/physics/src/pacer.ts` §`advancePlannedBot` out of `apps/` (ADR
 * 0007 D4, #1960), and a relative path goes round it with `tsc` and
 * `boundaries/dependencies` both passing.
 *
 * Read through the configuration `pnpm run lint` itself computes for each file
 * (`calculateConfigForFile` over the repository's `eslint.config.js`), so a
 * later block that resets `no-restricted-imports` for a path — flat config
 * keeps the last setting of a rule — turns this red. Only that rule is then
 * run, by ESLint's own `Linter`, over a one-line import: the type-aware rules
 * the full configuration carries need a TypeScript program and say nothing
 * about an import's specifier.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Files of each kind the rule distinguishes, all of them real. */
const FILES = {
  webSource: 'apps/web/src/game/scene.ts',
  webTest: 'apps/web/src/game/scene.test.ts',
  webTestSupport: 'apps/web/src/routes/testing.ts',
  instanceSource: 'apps/instance/src/auth/crypto.ts',
  instanceTest: 'apps/instance/src/auth/hpke.test.ts',
  modelModule: 'apps/instance/src/analysis/model.ts',
} as const;

type FileKind = keyof typeof FILES;

const ruleFor = new Map<FileKind, Linter.RuleEntry | undefined>();

beforeAll(async () => {
  const eslint = new ESLint({ cwd: ROOT });
  for (const [kind, file] of Object.entries(FILES) as [FileKind, string][]) {
    const config = (await eslint.calculateConfigForFile(join(ROOT, file))) as Linter.Config;
    ruleFor.set(kind, config.rules?.['no-restricted-imports']);
  }
}, 30_000);

/** The `no-restricted-imports` messages for `import … from specifier` in a file of `kind`. */
function refusals(kind: FileKind, specifier: string): string[] {
  const rule = ruleFor.get(kind);
  if (rule === undefined) return [];
  const messages = new Linter().verify(`import { advancePlannedBot } from '${specifier}';\n`, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-restricted-imports': rule },
  });
  return messages.map((message) => message.message);
}

const PACER = '../../../packages/physics/src/pacer';

describe('a relative import of a package’s src/ from apps/ — #2147', () => {
  it('is refused in a non-test file under apps/web and apps/instance', () => {
    for (const kind of ['webSource', 'instanceSource', 'modelModule'] as const) {
      expect(refusals(kind, PACER), kind).toEqual([expect.stringContaining('#2147')]);
      expect(refusals(kind, `${PACER}.ts`), kind).toHaveLength(1);
      expect(refusals(kind, '../../../packages/physics/src'), kind).toHaveLength(1);
      // One directory deeper, and a package nested one level (`sensors/protocol`).
      expect(
        refusals(kind, '../../../../packages/sensors/protocol/src/fitness-machine-control'),
        kind,
      ).toHaveLength(1);
    }
  });

  it('is allowed in a test and in test support', () => {
    for (const kind of ['webTest', 'webTestSupport', 'instanceTest'] as const) {
      expect(refusals(kind, PACER), kind).toEqual([]);
    }
  });

  it('leaves the package name, an own relative path and a package’s non-source files alone', () => {
    for (const specifier of [
      '@onyourleft/physics',
      './pacer',
      '../game/pacer',
      // An app's own directory named `packages`: not the repository's.
      './packages/physics/src/pacer',
      '../../../packages/fit/fixtures/corpus/planned-loop-route.gpx',
    ]) {
      expect(refusals('webSource', specifier), specifier).toEqual([]);
    }
  });

  it('keeps the AI SDK refused outside model.ts, which the same rule carries', () => {
    expect(refusals('webSource', 'ai')).toHaveLength(1);
    expect(refusals('instanceSource', '@ai-sdk/openai-compatible')).toHaveLength(1);
    expect(refusals('webTest', 'ai')).toHaveLength(1);
    expect(refusals('modelModule', 'ai')).toEqual([]);
  });
});
