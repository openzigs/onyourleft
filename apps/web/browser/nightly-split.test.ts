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
  GATE_STEP_MS,
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

/**
 * The required job as it was last measured — #1280.
 *
 * ⚠️ **A measurement cannot be derived, and this is why the two bounds below
 * still rest on recorded figures.** How long the job takes on GitHub's slower
 * runner is known only from the Actions API after a run; a Vitest case has no
 * network (and must not grow one), so nothing here can ask. What CAN be
 * derived is everything else: the stops come from the workflow and
 * `playwright.config.ts`, and the figures come from the ONE place they are
 * recorded — the table in `docs/agents/ci.md` between the two
 * `required-job-measurements` markers — rather than from a second copy typed
 * here. Until #1280 this file held its own copies (835 s and 1 522 s), and
 * #1279's review found the record and the copy already apart (the start was
 * 841 s). Now a row added to that table moves both bounds, and a row that is
 * not a number fails here rather than being skipped.
 *
 * ⚠️ **It still cannot notice a job that got slower since the last row.** The
 * job grew about 21 s a day in the week to 2026-10-12; the table's newest row
 * is how old these bounds are.
 */
function measuredRequiredJob(): { jobs: number[]; gateStarts: number[] } {
  const doc = read(ROOT, 'docs', 'agents', 'ci.md');
  const block =
    /<!-- required-job-measurements:start -->\n([\s\S]*?)<!-- required-job-measurements:end -->/.exec(
      doc,
    )?.[1] ?? '';
  const cells = (line: string): string[] =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const [header = '', , ...rows] = block.trim().split('\n');
  const column = (name: string): number => cells(header).indexOf(name);
  const numbers = (name: string): number[] =>
    rows.map((row) => {
      const cell = cells(row)[column(name)] ?? '';
      // Refused rather than skipped: a row this cannot read is a measurement
      // the bounds would silently leave out.
      expect(cell, `"${name}" in the row: ${row}`).toMatch(/^\d+$/);
      return Number(cell);
    });
  expect(column('Job'), 'the table has a "Job" column').toBeGreaterThanOrEqual(0);
  expect(column('Gate starts'), 'the table has a "Gate starts" column').toBeGreaterThanOrEqual(0);
  return { jobs: numbers('Job'), gateStarts: numbers('Gate starts') };
}

/**
 * What runs after the `Browser gate` step, in seconds. It was the two coverage
 * steps and the post steps until #1280 (4 s, #1128's review); the coverage
 * steps are nightly now and what is left is the Docker logout and the post
 * steps. Kept at the larger, older figure: it is an allowance, and #1280's
 * margin criterion is written with it.
 */
const AFTER_GATE_S = 4;

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

  it('reads no DEFAULT-world game load from a nightly describe, so the game every rider gets stays required — #878’s review', () => {
    // A nightly describe in `game.browser.spec.ts` is about the realistic
    // world (nightly.ts; the default-world entries there, #1076's and
    // #1137's, are other specs and owner's exceptions). One that reads the
    // plain load (`game.html` with no query) is asserting something about the
    // DEFAULT world's game, which then reaches main unchecked: #878's first
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
      `--project game --global-timeout ${String(GAME_PART_MS)} --output browser/dist/test-results/game`,
    ]);
    // The two stops sit inside the config's own backstop (#1128's review: no
    // longer equal to it, because 840 s did not fit inside the job).
    expect(CHROMIUM_PART_MS + GAME_PART_MS).toBeLessThanOrEqual(GATE_BUDGET_MS);
    // A failed build ends the step before either run starts.
    expect(script).toMatch(
      /^vite build && vite build --config vite\.browser\.config\.ts \|\| exit 1; playwright test --project chromium /,
    );
    // The game run is not skipped when the chromium run fails (`;`, not
    // `&&`), and the step fails when EITHER did.
    expect(script).toContain('; chromium=$?; playwright test --project game');
    expect(script).toMatch(/\[ \$chromium -eq 0 \] && \[ \$game -eq 0 \]$/);
  });

  it('bounds the required gate’s step from outside, inside what the job has left — #1128’s review', () => {
    const rules = read(ROOT, '.github', 'workflows', 'rules.yml');
    const step = /^ +- name: Browser gate\n((?: {8}.+\n)+)/m.exec(rules)?.[1] ?? '';
    const seconds = GATE_STEP_MS / 1000;
    expect(step).toContain(
      `run: timeout --verbose --kill-after=10s ${String(seconds)}s pnpm run test:browser\n`,
    );
    const minutes = Number(/^ +timeout-minutes: (\d+)$/m.exec(step)?.[1]);
    // The step's own stop is behind the wrapper and its kill, never in front.
    expect(minutes * 60).toBeGreaterThanOrEqual(seconds + 10);
    // ...and the step's stop ends at least THREE MINUTES inside the job's
    // (#1280's criterion; it was 115 s when #1279 merged), from the latest
    // start measured — read from docs/agents/ci.md, @see measuredRequiredJob —
    // with what runs after the gate.
    const job = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(rules)?.[1]);
    const { gateStarts } = measuredRequiredJob();
    expect(gateStarts.length).toBeGreaterThanOrEqual(2);
    const latestStart = Math.max(...gateStarts);
    expect(job * 60 - (latestStart + minutes * 60 + AFTER_GATE_S)).toBeGreaterThanOrEqual(180);
  });

  it('holds both Playwright stops and the builds inside the step’s wrapper, so each stop names its own run — #651', () => {
    // Until #651 they summed to 815 s against a 765 s wrapper, and a `chromium`
    // run that used its 720 s left the game run 35 s of its 85. What the step
    // spends OUTSIDE the two runs is about 14 s on the runner, not the 10 s
    // first written here (#1279's review, run 38196648879 attempt 3): the two
    // `vite build`s about 5 s, Playwright's two web servers starting before it
    // prints its first line 11 s in, and 3 s between the `chromium` run ending
    // and the `game` run starting. So the wrapper holds both stops with 6 s to
    // spare, not 10.
    const BUILDS_MS = 14_000;
    expect(CHROMIUM_PART_MS + GAME_PART_MS + BUILDS_MS).toBeLessThanOrEqual(GATE_STEP_MS);
  });

  it('keeps the job’s stop at least five minutes clear of the slowest job measured — #651, #1280', () => {
    // A stop has to be clear of what it stops. Three minutes until #1280,
    // against 1 522 s typed here (a job with coverage, cancelled at the
    // 25-minute stop with every test green); five since, against the slowest
    // job in docs/agents/ci.md §4c §"Coverage out of the required job — #1280"
    // — @see measuredRequiredJob. When a new row there turns this red, the
    // answer is that section's "what is next" (shards, #1285), not a smaller
    // number here and not a longer stop.
    const rules = read(ROOT, '.github', 'workflows', 'rules.yml');
    const job = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(rules)?.[1]);
    const { jobs } = measuredRequiredJob();
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    // A figure outside what a 30-minute job can take is a typo, not a run.
    for (const seconds of jobs) expect(seconds).toBeGreaterThan(600);
    expect(job * 60 - Math.max(...jobs)).toBeGreaterThanOrEqual(300);
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

  it('leaves the required job running the gate and the suite, with no coverage — #1280', () => {
    const commands = runCommands(rules);
    expect(commands).toEqual(
      expect.arrayContaining([
        'pnpm run test:required',
        'timeout --verbose --kill-after=10s 825s pnpm run test:browser',
      ]),
    );
    expect(commands).not.toContain('pnpm run test:browser:nightly');
    // The owner's ruling of 2026-10-12: the instrumented run is nightly. Back
    // in the required job it is 106 to 133 s of the slower runner's margin,
    // spent twice over the same files.
    expect(commands.filter((command) => /test:coverage|--coverage/.test(command))).toEqual([]);
  });

  it('takes the coverage report nightly and publishes it, so it moved rather than stopped — #1280', () => {
    // The ruling moved the report; it did not drop it. Each of the three is a
    // way it stops being reported with nothing red: the run, the table in the
    // run's summary, the HTML artefact.
    const commands = runCommands(nightly);
    expect(commands).toContain('pnpm run test:coverage');
    expect(commands).toContain(
      'node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY" || true',
    );
    const upload =
      /^ +- name: Upload the coverage report\n((?: {8}.+\n)+)/m.exec(nightly)?.[1] ?? '';
    expect(upload).toMatch(/^ +uses: actions\/upload-artifact@[0-9a-f]{40} /m);
    expect(upload).toMatch(/^ +path: coverage\/$/m);
    // After the run that writes it, or it publishes yesterday's nothing.
    expect(commands.indexOf('pnpm run test:coverage')).toBeLessThan(
      commands.indexOf('node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY" || true'),
    );
    expect(nightly.indexOf('run: pnpm run test:coverage')).toBeLessThan(
      nightly.indexOf('- name: Upload the coverage report'),
    );
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
