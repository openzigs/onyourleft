// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The split between the required job and the nightly one — #866.
 *
 * A nightly check cannot block a merge, so the one thing that must not happen
 * is a check leaving the required job WITHOUT anybody deciding it should:
 * a tag added to a safety gate's describe in passing, a `test:browser` that
 * stopped naming its projects, a nightly workflow that stopped running what
 * was moved to it. Each is a red case here rather than a green job that
 * checks less than it did. `check:test-split` is the Vitest half's own gate;
 * this is the browser half and the workflows.
 *
 * ⚠️ **It reads the workflows as text, not as YAML.** There is no YAML parser
 * in this workspace and adding one for a test is not worth a dependency; the
 * assertions are about which commands a file names, which text answers.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import config, {
  CHROMIUM_PART_MS,
  CHROMIUM_WORKERS,
  GAME_PART_MS,
  GATE_BUDGET_MS,
} from '../playwright.config';

import { NIGHTLY, NIGHTLY_CHECKS } from './nightly';

const BROWSER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(BROWSER, '..', '..', '..');
const read = (...path: string[]): string => readFileSync(join(...path), 'utf8');

const SPECS = readdirSync(BROWSER).filter((name) => name.endsWith('.browser.spec.ts'));

type Project = NonNullable<typeof config.projects>[number];
const PROJECTS: readonly Project[] = config.projects ?? [];

const patternMatches = (pattern: Project['testMatch'], file: string): boolean => {
  if (pattern === undefined) return false;
  const all = Array.isArray(pattern) ? pattern : [pattern];
  return all.some((one) => (one instanceof RegExp ? one.test(file) : file.endsWith(one)));
};

/** Whether a project would run a test with this title in this spec file. */
function runs(project: Project, file: string, title: string): boolean {
  if (project.testMatch !== undefined && !patternMatches(project.testMatch, file)) return false;
  if (patternMatches(project.testIgnore, file)) return false;
  const matches = (grep: Project['grep']): boolean =>
    (Array.isArray(grep) ? grep : [grep]).some((one) => one?.test(title) === true);
  if (project.grep !== undefined && !matches(project.grep)) return false;
  if (project.grepInvert !== undefined && matches(project.grepInvert)) return false;
  return true;
}

/** A spec with its comments removed: only code counts. */
const codeOf = (spec: string): string =>
  read(BROWSER, spec)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

/** Every describe tagged nightly, as `spec › title`, read from the sources. */
function taggedDescribes(): string[] {
  const found: string[] = [];
  for (const spec of SPECS) {
    // Comments may name the tag in prose; only code counts.
    const source = codeOf(spec);
    const tagged = [...source.matchAll(/describe\(\s*'([^']+)',\s*\{\s*tag:\s*NIGHTLY\s*\}/g)];
    // Any other use of the tag — on a single test, spelt as a literal, or in a
    // form this pattern does not read — is refused rather than guessed at.
    const uses = source.split(/\bNIGHTLY\b/).length - 1;
    const imports = /import \{ NIGHTLY \} from '\.\/nightly';/.test(source) ? 1 : 0;
    expect(uses - imports, `${spec} uses NIGHTLY other than as a describe's tag`).toBe(
      tagged.length,
    );
    expect(source.includes(NIGHTLY), `${spec} spells ${NIGHTLY} as a literal`).toBe(false);
    found.push(...tagged.map((match) => `${spec} › ${String(match[1])}`));
  }
  return found.sort();
}

/**
 * The body of every describe tagged nightly, as `spec › title` → its code: from
 * the tag to the next top-level `test.describe(`, or to the end of the file.
 */
function taggedBodies(): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const spec of SPECS) {
    const source = codeOf(spec);
    for (const match of source.matchAll(/describe\(\s*'([^']+)',\s*\{\s*tag:\s*NIGHTLY\s*\}/g)) {
      const start = match.index + match[0].length;
      const next = source.indexOf('\ntest.describe(', start);
      bodies.set(
        `${spec} › ${String(match[1])}`,
        source.slice(start, next === -1 ? undefined : next),
      );
    }
  }
  return bodies;
}

describe('the browser gate is split into a required run and a nightly one — #866', () => {
  const nightly = PROJECTS.filter((project) => project.name === 'nightly');
  const required = PROJECTS.filter((project) => project.name !== 'nightly');

  it('finds the specs and the projects it reasons about', () => {
    expect(SPECS.length).toBeGreaterThan(20);
    expect(SPECS).toContain('game.browser.spec.ts');
    expect(nightly).toHaveLength(1);
    expect(required.map((project) => project.name)).toEqual(['chromium', 'game']);
  });

  it('runs every test in exactly one project: the nightly one if it is tagged, else one required one', () => {
    for (const spec of SPECS) {
      for (const title of ['a check', `a check ${NIGHTLY}`]) {
        const taking = PROJECTS.filter((project) => runs(project, spec, title)).map(
          (project) => project.name,
        );
        const expected = title.includes(NIGHTLY)
          ? ['nightly']
          : taking.filter((n) => n !== 'nightly');
        expect(taking, `${spec}: "${title}"`).toEqual(expected);
        expect(taking, `${spec}: "${title}"`).toHaveLength(1);
      }
    }
  });

  it('moves exactly the reviewed describes, and every reviewed describe is moved', () => {
    const reviewed = NIGHTLY_CHECKS.map((check) => `${check.spec} › ${check.describe}`).sort();
    expect(taggedDescribes()).toEqual(reviewed);
    for (const check of NIGHTLY_CHECKS) {
      expect(check.why.length, check.describe).toBeGreaterThan(20);
      expect(check.seconds, check.describe).not.toBe('');
    }
  });

  it('reads no DEFAULT-world load from a nightly describe, so the world every rider gets stays required — #878’s review', () => {
    // A nightly describe is about the realistic world (nightly.ts). One that
    // reads the plain load (`game.html` with no query) is asserting something
    // about the DEFAULT world, which then reaches main unchecked: #878's first
    // cut did exactly that with #501's shader-compile case and D-7's "the
    // default world fetches none of the realistic set". Those halves belong in
    // a required describe, where the plain load is already paid for.
    const bodies = taggedBodies();
    expect(bodies.size).toBe(NIGHTLY_CHECKS.length);
    for (const [describe, body] of bodies) {
      expect(body.length, describe).toBeGreaterThan(100);
      expect(body, `${describe} reads the plain load`).not.toMatch(/harnessRun\(\s*\)/);
      expect(body, `${describe} pays for the plain load`).not.toMatch(/paysForTheLoad\(\s*''/);
    }
  });

  it('keeps the gate’s own command to the required projects, and the nightly command to the nightly one', () => {
    const scripts = (
      JSON.parse(read(BROWSER, '..', 'package.json')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const projectsOf = (script: string | undefined): string[] =>
      [...(script ?? '').matchAll(/--project (\S+)/g)].map((match) => String(match[1])).sort();
    expect(scripts['test:browser']).toMatch(/playwright test --project/);
    expect(projectsOf(scripts['test:browser'])).toEqual(
      required.map((project) => String(project.name)).sort(),
    );
    expect(projectsOf(scripts['test:browser:nightly'])).toEqual(['nightly']);
  });

  it('runs the chromium project on its workers and stop, then the game project alone on its stop, and fails if either fails — #1128', () => {
    const script = String(
      (JSON.parse(read(BROWSER, '..', 'package.json')) as { scripts: Record<string, string> })
        .scripts['test:browser'],
    );
    const runs = [...script.matchAll(/playwright test ([^;&]+)/g)].map((match) =>
      String(match[1]).trim(),
    );
    expect(runs).toEqual([
      `--project chromium --workers ${String(CHROMIUM_WORKERS)} --global-timeout ${String(CHROMIUM_PART_MS)}`,
      `--project game --global-timeout ${String(GAME_PART_MS)}`,
    ]);
    // The two stops are the one the gate had before the split.
    expect(CHROMIUM_PART_MS + GAME_PART_MS).toBe(GATE_BUDGET_MS);
    // The game run is not skipped when the chromium run fails (`;`, not
    // `&&`), and the step fails when EITHER did.
    expect(script).toContain('; chromium=$?; playwright test --project game');
    expect(script).toMatch(/\[ \$chromium -eq 0 \] && \[ \$game -eq 0 \]$/);
  });
});

describe('the nightly workflow runs what left the required job, and cannot pass for it — #866', () => {
  const rules = read(ROOT, '.github', 'workflows', 'rules.yml');
  const nightly = read(ROOT, '.github', 'workflows', 'nightly.yml');
  const runCommands = (workflow: string): string[] =>
    [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => String(match[1]).trim());

  it('runs the uninstrumented Vitest files and the nightly browser checks', () => {
    expect(runCommands(nightly)).toEqual(
      expect.arrayContaining(['pnpm run test:uninstrumented', 'pnpm run test:browser:nightly']),
    );
  });

  it('leaves the required job running the gate and the covered suite', () => {
    const commands = runCommands(rules);
    expect(commands).toEqual(
      expect.arrayContaining(['pnpm run test:coverage', 'pnpm run test:browser']),
    );
    expect(commands).not.toContain('pnpm run test:browser:nightly');
  });

  it('reports under a name that is not the required check, on a schedule', () => {
    expect(nightly).not.toMatch(/^\s*name: Repository rules\s*$/m);
    expect(nightly).toMatch(/^\s+schedule:\s*$/m);
    expect(nightly).toMatch(/^\s+- cron: '[^']+'/m);
    expect(nightly).toMatch(/^\s+workflow_dispatch:/m);
  });

  it('holds a read-only token, and issues: write only in the job that reports a red run', () => {
    const workflowLevel = /^permissions:\n((?: +.+\n)+)/m.exec(nightly)?.[1];
    expect(workflowLevel).toBe('  contents: read\n');
    const writes = [...nightly.matchAll(/^ +([\w-]+): write *$/gm)].map((m) => String(m[1]));
    expect(writes).toEqual(['issues']);
  });
});
