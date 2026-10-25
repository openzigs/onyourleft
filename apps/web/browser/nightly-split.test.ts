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
 * Since #1285 the required check is one job over several shards (four since
 * #1362, which split the browser gate in two), and the same
 * thing must not happen there by another road: a shard the aggregating job
 * does not wait for, that job renamed, or its verdict weakened. Those are the
 * last describe in this file.
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
 * The jobs of a workflow, as `id → its lines`, with every comment line removed.
 * Text, not YAML (see the file header): a job is a key at two spaces under
 * `jobs:`, which is how both workflows are written.
 */
function jobsOf(workflow: string): Map<string, string> {
  const code = workflow.replace(/^\s*#.*\n/gm, '');
  const body = code.slice(code.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const starts = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):\n/gm)];
  const jobs = new Map<string, string>();
  starts.forEach((match, index) => {
    jobs.set(String(match[1]), body.slice(match.index, starts[index + 1]?.index));
  });
  return jobs;
}

/** A job-level scalar: `name`, `if`, `needs`, `runs-on`, `timeout-minutes`. */
const jobField = (job: string, key: string): string | undefined =>
  new RegExp(`^ {4}${key}: (.+)$`, 'm').exec(job)?.[1]?.trim();

/** The name `main` requires a status check under. */
const REQUIRED_CHECK = 'Repository rules';

/**
 * The shards as they were last measured — #1285 (the one job, until then:
 * #1280).
 *
 * ⚠️ **A measurement cannot be derived, and this is why the bounds below
 * still rest on recorded figures.** How long a job takes on GitHub's slower
 * runner is known only from the Actions API after a run; a Vitest case has no
 * network (and must not grow one), so nothing here can ask. What CAN be
 * derived is everything else: the stops come from the workflow and
 * `playwright.config.ts`, and the figures come from the ONE place they are
 * recorded — the table in `docs/agents/ci.md` between the two
 * `shard-measurements` markers — rather than from a second copy typed here.
 * Until #1280 this file held its own copies (835 s and 1 522 s), and #1279's
 * review found the record and the copy already apart. Now a row added to that
 * table moves every bound, and a cell that is not a number fails here rather
 * than being skipped.
 *
 * ⚠️ **It still cannot notice a shard that got slower since the last row.**
 * The one job grew about 21 s a day in the week to 2026-10-12; the table's
 * newest row is how old these bounds are.
 */
function measuredShards(): (column: string) => number[] {
  const doc = read(ROOT, 'docs', 'agents', 'ci.md');
  const block =
    /<!-- shard-measurements:start -->\n([\s\S]*?)<!-- shard-measurements:end -->/.exec(doc)?.[1] ??
    '';
  const cells = (line: string): string[] =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const [header = '', , ...rows] = block.trim().split('\n');
  return (name) => {
    const column = cells(header).indexOf(name);
    expect(column, `the table has a "${name}" column`).toBeGreaterThanOrEqual(0);
    // At least three runs, which is what #1285 asked to be measured.
    expect(rows.length, 'rows in the table').toBeGreaterThanOrEqual(3);
    return rows.map((row) => {
      const cell = cells(row)[column] ?? '';
      // Refused rather than skipped: a row this cannot read is a measurement
      // the bounds would silently leave out.
      expect(cell, `"${name}" in the row: ${row}`).toMatch(/^\d+$/);
      return Number(cell);
    });
  };
}

/**
 * What runs after the `Browser gate` step, in seconds. It was the two coverage
 * steps and the post steps until #1280 (4 s, #1128's review), then the Docker
 * logout and the post steps; since #1285 the gate's shard has only the post
 * steps after it. Kept at the larger, older figure: it is an allowance, and
 * #1280's margin criterion is written with it.
 */
const AFTER_GATE_S = 4;

/** The web package's scripts. */
const webScripts = (): Record<string, string> =>
  (JSON.parse(read(BROWSER, '..', 'package.json')) as { scripts: Record<string, string> }).scripts;

/** Every Playwright run a script makes, in order, as its arguments. */
const playwrightRuns = (script: string | undefined): string[] =>
  [...(script ?? '').matchAll(/playwright test ([^;&]+)/g)].map((match) => String(match[1]).trim());

/**
 * The scripts CI runs the required gate as, one per browser shard — #1362.
 * `test:browser:shard-1`, `test:browser:shard-2`, …, in their order.
 */
function shardScripts(): [name: string, script: string][] {
  return Object.entries(webScripts())
    .filter(([name]) => /^test:browser:shard-\d+$/.test(name))
    .sort(([a], [b]) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
}

/**
 * The scripts CI runs the nightly browser checks as, one per nightly job —
 * #1675. `test:browser:nightly:shard-1`, `…-2`, …, in their order.
 */
function nightlyShardScripts(): [name: string, script: string][] {
  return Object.entries(webScripts())
    .filter(([name]) => /^test:browser:nightly:shard-\d+$/.test(name))
    .sort(([a], [b]) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
}

/** The command a browser shard's `Browser gate` step runs, wrapper and all. */
const gateCommand = (script: string): string =>
  `timeout --verbose --kill-after=10s ${String(GATE_STEP_MS / 1000)}s pnpm run ${script}`;

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
    for (const [name] of nightlyShardScripts()) {
      expect(projectsOf(scripts[name]), name).toEqual(['nightly']);
    }
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

  it('bounds each browser shard’s gate step from outside, inside what its shard has left — #1128’s review, #1285, #1362', () => {
    const rules = read(ROOT, '.github', 'workflows', 'rules.yml');
    const seconds = GATE_STEP_MS / 1000;
    const latestStart = Math.max(...measuredShards()('Gate starts'));
    const scripts = shardScripts();
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const [name] of scripts) {
      // The job is the shard that runs this script, found by its command
      // rather than by its name, and exactly one does.
      const shard = [...jobsOf(rules).values()].filter((job) => job.includes(`pnpm run ${name}\n`));
      expect(shard, name).toHaveLength(1);
      const jobText = shard[0] ?? '';
      const step = /^ +- name: Browser gate\n((?: {8}.+\n)+)/m.exec(jobText)?.[1] ?? '';
      expect(step, name).toContain(`run: ${gateCommand(name)}\n`);
      const minutes = Number(/^ +timeout-minutes: (\d+)$/m.exec(step)?.[1]);
      // The step's own stop is behind the wrapper and its kill, never in front.
      expect(minutes * 60, name).toBeGreaterThanOrEqual(seconds + 10);
      // ...and the step's stop ends at least THREE MINUTES inside its job's
      // (#1280's criterion; it was 115 s when #1279 merged), from the latest
      // start measured — read from docs/agents/ci.md, @see measuredShards —
      // with what runs after the gate.
      const job = Number(jobField(jobText, 'timeout-minutes'));
      expect(job * 60 - (latestStart + minutes * 60 + AFTER_GATE_S), name).toBeGreaterThanOrEqual(
        180,
      );
      // And with nothing measured at all: the browser install before it has a
      // stop of its own, so even an install that uses the whole of it leaves
      // the gate's stop inside the job's. 20 s is what the shard spends before
      // the install (the checkout, Node, pnpm and the frozen install; 11 s
      // measured).
      const install =
        /^ +- name: Install the pinned Chromium\n((?: {8}.+\n)+)/m.exec(jobText)?.[1] ?? '';
      const installStop = Number(/^ +timeout-minutes: (\d+)$/m.exec(install)?.[1]) * 60;
      expect(installStop, name).toBeGreaterThan(0);
      expect(20 + installStop + minutes * 60 + AFTER_GATE_S, name).toBeLessThanOrEqual(job * 60);
    }
    // The whole gate as one command is the LOCAL form (§4a); CI runs it only
    // as its shards, so a job running it as well would run every case twice.
    expect(rules).not.toContain('pnpm run test:browser\n');
  });

  it('divides the chromium run between the shard scripts, every case in exactly one, and the game run in one — #1362', () => {
    const scripts = shardScripts();
    const total = scripts.length;
    expect(total).toBeGreaterThanOrEqual(2);
    const [chromium = '', game = ''] = playwrightRuns(webScripts()['test:browser']);
    const BUILD =
      /^vite build && vite build --config vite\.browser\.config\.ts \|\| exit 1; playwright test /;
    const shardsWithGame: string[] = [];
    scripts.forEach(([name, script], index) => {
      const runs = playwrightRuns(script);
      // The whole gate's chromium run, with this shard's slice of it: the same
      // project, workers and stop, so a shard is never run under a looser one.
      expect(runs[0], name).toBe(
        chromium.replace(
          '--project chromium ',
          `--project chromium --shard ${String(index + 1)}/${String(total)} `,
        ),
      );
      // A failed build ends the step before any run starts.
      expect(script, name).toMatch(BUILD);
      if (runs.length === 2) {
        // The game run exactly as in the whole gate, after the chromium run
        // whatever its result, and the step fails when EITHER did.
        expect(runs[1], name).toBe(game);
        expect(script, name).toContain('; chromium=$?; playwright test --project game');
        expect(script, name).toMatch(/\[ \$chromium -eq 0 \] && \[ \$game -eq 0 \]$/);
        shardsWithGame.push(name);
      } else {
        // One run, and the script's status is that run's.
        expect(runs, name).toHaveLength(1);
        expect(script.endsWith(`playwright test ${String(runs[0])}`), name).toBe(true);
      }
    });
    // The game run is in one shard: in none it leaves the gate, in two it
    // runs twice.
    expect(shardsWithGame).toHaveLength(1);
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
});

describe('the nightly workflow runs what left the required job, and cannot pass for it — #866', () => {
  const rules = read(ROOT, '.github', 'workflows', 'rules.yml');
  const nightly = read(ROOT, '.github', 'workflows', 'nightly.yml');
  const runCommands = (workflow: string): string[] =>
    [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => String(match[1]).trim());

  it('runs the uninstrumented Vitest files, and each half of the nightly browser checks in a job of its own — #1675', () => {
    const commands = runCommands(nightly);
    expect(commands).toContain('pnpm run test:uninstrumented');
    // The whole set in one command is the LOCAL form: on one worker it reached
    // its 840 s stop with tests not run (#1675), and beside its halves it
    // would run every case twice.
    expect(commands).not.toContain('pnpm run test:browser:nightly');
    const shards = nightlyShardScripts();
    expect(shards.length).toBeGreaterThanOrEqual(2);
    const jobs = [...jobsOf(nightly)];
    const homes = shards.map(([name]) => {
      const where = jobs.filter(([, job]) => job.includes(`run: pnpm run ${name}\n`));
      expect(
        where.map(([id]) => id),
        name,
      ).toHaveLength(1);
      expect(
        commands.filter((command) => command === `pnpm run ${name}`),
        name,
      ).toHaveLength(1);
      return where[0]?.[0];
    });
    // A runner each: two halves on one runner would share its CPU, which is
    // the cost one worker exists to avoid (#651).
    expect(new Set(homes).size).toBe(shards.length);
  });

  it('divides the nightly checks between its halves by file, every nightly spec in exactly one — #1675', () => {
    const [whole = ''] = playwrightRuns(webScripts()['test:browser:nightly']);
    expect(whole).toBe('--project nightly --workers 1');
    const tagged = [...new Set(NIGHTLY_CHECKS.map((check) => check.spec))];
    const filtersOf = new Map(
      nightlyShardScripts().map(([name, script]) => {
        const runs = playwrightRuns(script);
        expect(runs, name).toHaveLength(1);
        const run = String(runs[0]);
        // The whole run's project and worker, with this half's files after it.
        expect(run.startsWith(`${whole} `), name).toBe(true);
        expect(script, name).toMatch(
          /^vite build && vite build --config vite\.browser\.config\.ts && playwright test /,
        );
        const filters = run.slice(whole.length).trim().split(/\s+/);
        // Playwright reads a positional argument as a pattern over the path.
        for (const filter of filters) {
          expect(
            tagged.filter((spec) => new RegExp(filter).test(spec)),
            `${name}: ${filter} names no nightly spec`,
          ).not.toEqual([]);
        }
        return [name, filters] as const;
      }),
    );
    for (const spec of tagged) {
      const halves = [...filtersOf]
        .filter(([, filters]) => filters.some((filter) => new RegExp(filter).test(spec)))
        .map(([name]) => name);
      // In none, a new nightly spec runs nowhere; in two, it runs twice.
      expect(halves, spec).toHaveLength(1);
    }
  });

  it('runs every nightly job on the standard runner, on actions pinned to a commit — CLAUDE.md §8', () => {
    for (const [id, job] of jobsOf(nightly)) {
      expect(jobField(job, 'runs-on'), id).toBe('ubuntu-latest');
    }
    const uses = [...nightly.matchAll(/^ +uses: (\S+)/gm)].map((match) => String(match[1]));
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });

  it('reports a red run of any job, the second browser half included — #1675', () => {
    const jobs = jobsOf(nightly);
    const report = jobs.get('report') ?? '';
    const needs = (jobField(report, 'needs') ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((id) => id.trim());
    expect(needs.sort()).toEqual([...jobs.keys()].filter((id) => id !== 'report').sort());
    // Over every job it needs, not one named job's result.
    expect(report).toContain(
      "(contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))",
    );
  });

  it('leaves the required shards running the gate and the suite, with no coverage — #1280', () => {
    const commands = runCommands(rules);
    expect(commands).toEqual(
      expect.arrayContaining([
        'pnpm run test:required',
        'timeout --verbose --kill-after=10s 825s pnpm run test:browser:shard-1',
        'timeout --verbose --kill-after=10s 825s pnpm run test:browser:shard-2',
      ]),
    );
    expect(commands).not.toContain('pnpm run test:browser:nightly');
    // The owner's ruling of 2026-10-12: the instrumented run is nightly. Back
    // in the required job it is 106 to 133 s of the slower runner's margin,
    // spent twice over the same files.
    expect(commands.filter((command) => /test:coverage|--coverage/.test(command))).toEqual([]);
  });

  it('instruments nothing by default, so `test:required` cannot take coverage through the config — #1286’s review', () => {
    // The pin above is on the command. `coverage.enabled: true` in the root
    // config would instrument `vitest run` with no flag at all, and put back
    // the 106 to 133 s with nothing red; `test:coverage` passes `--coverage`.
    expect(read(ROOT, 'vitest.config.ts')).not.toMatch(/\benabled\b/);
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

  it('still takes and publishes the report when an earlier nightly step went red — #1286’s review', () => {
    // A step runs only if every step before it succeeded, unless it says
    // otherwise. Without this condition one red nightly browser check costs
    // that night's coverage table too.
    for (const name of [
      'Tests under coverage',
      'Publish the coverage summary',
      'Upload the coverage report',
    ]) {
      const step =
        new RegExp(`^ +- name: ${name}\\n((?: {8}.+\\n)+)`, 'm').exec(nightly)?.[1] ?? '';
      expect(step, name).toMatch(/^ {8}if: \$\{\{ !cancelled\(\) \}\}$/m);
    }
  });

  it('names the step that failed in the issue a red nightly run opens — #1286’s review', () => {
    // One issue for every nightly failure, so its body has to say which step:
    // since #1280 a case that fails only under coverage arrives here too.
    const report = jobsOf(nightly).get('report') ?? '';
    expect(report).toContain(
      'gh api "repos/${GH_REPO}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}/jobs"',
    );
    expect(report).toContain(
      `--jq '.jobs[] | .name as $job | .steps[] | select(.conclusion == "failure" or .conclusion == "cancelled") | "- \\($job): \\(.name) (\\(.conclusion))"'`,
    );
    // What it read is in the body it files, and a read that failed says so
    // rather than filing an issue that names nothing.
    expect(report).toContain('${steps:-(the steps could not be read; open the run)}');
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

describe('the required check is one job over every shard — #1285', () => {
  const workflow = read(ROOT, '.github', 'workflows', 'rules.yml');
  const jobs = jobsOf(workflow);
  const named = [...jobs].filter(([, job]) => jobField(job, 'name') === REQUIRED_CHECK);
  const aggregate = named[0]?.[1] ?? '';
  const shards = new Map([...jobs].filter(([, job]) => jobField(job, 'name') !== REQUIRED_CHECK));

  /** What a job runs: every `run:` line, with a concurrent step's commands unfolded. */
  const commandsOf = (job: string): string[] => {
    const lines = [...job.matchAll(/^ +run: (.+)$/gm)].map((match) => String(match[1]).trim());
    const folded =
      /^ +bash scripts\/run-concurrently\.sh\n((?: +'.+' '.+'\n)+)/m.exec(job)?.[1] ?? '';
    const concurrent = [...folded.matchAll(/^ +'[^']+' '(.+)'$/gm)].map((match) =>
      String(match[1]),
    );
    const block = [...job.matchAll(/^ +run: \|\n((?: {10}.+\n)+)/gm)].flatMap((match) =>
      String(match[1])
        .split('\n')
        .map((line) => line.trim()),
    );
    return [...lines, ...concurrent, ...block];
  };

  it('reports under the required name from exactly one job, and from the workflow', () => {
    // `main` requires a status check whose context is this string. Renamed,
    // the required check never reports and no pull request can merge; given
    // to a second job, a green shard could report it.
    expect(workflow).toMatch(new RegExp(`^name: ${REQUIRED_CHECK}$`, 'm'));
    expect(named).toHaveLength(1);
    expect(shards.size).toBeGreaterThanOrEqual(3);
  });

  it('triggers on every pull request: no path filter, and the event is present', () => {
    // A filter, or a missing event, makes the required check never report.
    const on = /^on:\n((?: {2}.+\n|\n)+)/m.exec(workflow)?.[1] ?? '';
    expect(on).toMatch(/^ {2}pull_request:\s*$/m);
    expect(on).not.toMatch(/paths(-ignore)?:|branches-ignore:/);
  });

  it('waits for every shard: a job it does not need cannot block a merge', () => {
    const needs = (jobField(aggregate, 'needs') ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    expect(needs.sort()).toEqual([...shards.keys()].sort());
  });

  it('runs whatever the shards did, and passes only if every one succeeded', () => {
    // Skipped when a shard fails, without this — and GitHub counts a skipped
    // required check as passing.
    expect(jobField(aggregate, 'if')).toBe('always()');
    // The verdict is the checker over ALL of `needs`, so a shard added to
    // `needs:` is judged without a second edit; its suite holds that failure,
    // cancelled and skipped each fail, and so does no shard at all.
    expect(commandsOf(aggregate)).toEqual(['bash scripts/check-shard-results.sh']);
    expect(aggregate).toMatch(/^ {10}NEEDS: \$\{\{ toJSON\(needs\) \}\}$/m);
    expect([...shards.values()].flatMap(commandsOf)).toContain(
      'bash scripts/check-shard-results.test.sh',
    );
    // On a job, this reports a failure to `needs` as success; on a step, it
    // turns a red step green. Neither belongs in a gate.
    expect(workflow.replace(/^\s*#.*\n/gm, '')).not.toContain('continue-on-error');
    // The verdict step must run on every event and its exit must reach the
    // job. A step-level `if:` or a `shell:` override (`... || true`) switches
    // it off with every shard red, and the check would pass.
    const uncommented = (text: string): string => text.replace(/^\s*#.*\n/gm, '');
    const steps = uncommented(aggregate)
      .split(/^ {6}- /m)
      .slice(1);
    const verdict = steps.find((step) => step.includes('check-shard-results.sh')) ?? '';
    expect(verdict).not.toMatch(/^ +(if|shell|continue-on-error):/m);
    expect(uncommented(aggregate).match(/^ +(if|shell):/gm)).toHaveLength(1);
    // Across the file: the job-level `if:` above is the only condition (the
    // Docker logout's `always()` left with the Docker Hub login, #1231). Any
    // step-level `if:` can skip a gate command in a shard and the shard still
    // succeeds.
    expect(
      uncommented(workflow)
        .match(/^ +if: .+$/gm)
        ?.map((line) => line.trim()),
    ).toEqual(['if: always()']);
    expect(uncommented(workflow)).not.toMatch(/^ +shell:/m);
    // A stop of its own, so it cannot be what hangs the required check.
    expect(Number(jobField(aggregate, 'timeout-minutes'))).toBeLessThanOrEqual(5);
  });

  it('runs every command the one job ran, each in exactly one shard — nothing left the required check', () => {
    // The whole of what `Repository rules` ran as one job at #1285's base
    // (af67cf98), less the two steps that gate nothing (the CPU line and the
    // Docker logout). A command that leaves this workflow, or lands in the
    // aggregating job where nothing waits for it, is a red case here; so is
    // one that runs in two shards.
    const required = [
      'bash scripts/run-concurrently.test.sh',
      'pnpm install --frozen-lockfile',
      'bash scripts/check-repo-rules.sh',
      'bash scripts/check-repo-rules.test.sh',
      'bash scripts/check-licence-hashes.sh',
      'bash scripts/check-licence-hashes.test.sh',
      'bash scripts/check-env-example.sh',
      'bash scripts/check-env-example.test.sh',
      'bash scripts/check-doc-links.sh',
      'bash scripts/check-doc-links.test.sh',
      'shellcheck --version && shellcheck scripts/*.sh',
      'pnpm run format:check',
      'pnpm run lint',
      'pnpm run typecheck',
      'bash scripts/check-a11y-suite.test.sh',
      'pnpm run check:test-split',
      'bash scripts/check-test-split.test.sh',
      'pnpm run check:wiring',
      'bash scripts/check-wiring.test.sh',
      'pnpm run check:cost-model',
      'bash scripts/check-cost-model.test.sh',
      'bash scripts/coverage-summary.test.sh',
      'bash scripts/check-dependency-licences.test.sh',
      'pnpm run check:licences',
      'pnpm run build',
      'bash scripts/check-instance-image.sh',
      'bash scripts/check-instance-image.test.sh',
      'pnpm run check:a11y-suite',
      'pnpm run test:a11y',
      'pnpm run check:capacitor',
      'bash scripts/check-capacitor-generated.test.sh',
      'bash scripts/check-third-party-notices.test.sh',
      'pnpm run check:notices',
      'pnpm run test:required',
      'pnpm --filter @onyourleft/web exec playwright install --with-deps chromium',
      // #1362: the one gate command is a command per browser shard.
      ...shardScripts().map(([name]) => gateCommand(name)),
    ];
    const ran = new Map([...shards].map(([id, job]) => [id, commandsOf(job)]));
    for (const command of required) {
      const where = [...ran].filter(([, commands]) => commands.includes(command)).map(([id]) => id);
      // The install is each shard's own, and the browser install each browser
      // shard's (#1362); everything else runs once.
      const expected =
        command === 'pnpm install --frozen-lockfile'
          ? shards.size
          : command.includes('playwright install')
            ? shardScripts().length
            : 1;
      expect(where, command).toHaveLength(expected);
    }
    // The Vitest halves `check:test-split` reasons about share a runner with
    // nothing that would slow a case past its timeout: the same shard, and no
    // concurrent step in it.
    const vitest = [...ran].filter(([, commands]) => commands.includes('pnpm run test:required'));
    expect(vitest[0]?.[1]).toContain('pnpm run test:a11y');
    expect(vitest[0]?.[1].join('\n')).not.toContain('run-concurrently');
  });

  it('runs every job on the standard runner, on actions pinned to a commit — CLAUDE.md §8', () => {
    for (const [id, job] of jobs) {
      expect(jobField(job, 'runs-on'), id).toBe('ubuntu-latest');
    }
    const uses = [...workflow.matchAll(/^ +uses: (\S+)/gm)].map((match) => String(match[1]));
    expect(uses.length).toBeGreaterThan(jobs.size);
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });

  it('keeps every shard’s stop at least five minutes clear of its slowest measured run — #651, #1280', () => {
    // A stop has to be clear of what it stops. The figures are the table in
    // docs/agents/ci.md §4c §"Shards — #1285", one column per shard and named
    // for it — @see measuredShards — so a shard added without being measured
    // is a red case, and so is a new row that leaves a stop too close. When a
    // row turns this red the answer is that section's "what is next", not a
    // smaller number here.
    const measured = measuredShards();
    for (const [id, job] of shards) {
      const stop = Number(jobField(job, 'timeout-minutes')) * 60;
      const slowest = Math.max(...measured(id));
      // A figure under a minute is a typo, not a shard that installs.
      expect(slowest, id).toBeGreaterThan(60);
      expect(stop - slowest, id).toBeGreaterThanOrEqual(300);
    }
  });

  it('reports inside fifteen minutes of the push on every run measured — #1285', () => {
    // The point of the shards: `Wall` is the run being created to the
    // required check completing, queueing included.
    expect(Math.max(...measuredShards()('Wall'))).toBeLessThan(900);
  });
});
