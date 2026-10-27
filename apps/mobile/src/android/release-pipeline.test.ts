// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The release pipeline's own drift, which nothing else here can see
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * ⚠️ **`release.yml` is not a required check and cannot block a merge**, which
 * is right for a tag-triggered job and is exactly why it rots: docs/agents/ci.md §4c
 * records that its action pins had already drifted behind `rules.yml`'s with
 * nothing noticing. A workflow that only runs on a tag gets reviewed once and
 * then read by nobody until the day somebody needs a release.
 *
 * So the two things about it that are *statements of fact from outside the
 * workflow* are asserted from inside the test suite, which does run on every
 * pull request:
 *
 * 1. **The target API floor is one number in three languages** — Gradle, bash
 *    and YAML — and #95's second criterion is that the app targets it and that
 *    a regression fails. Three copies with no assertion between them is three
 *    chances to fix one and ship the other two.
 * 2. **Every action is pinned to a commit**, CLAUDE.md §8. A tag is mutable, so
 *    a tag pin in the one workflow that holds `contents: write` and decrypts a
 *    signing key is the highest-value supply-chain foothold in this repository.
 * 3. **Which inputs are read from `secrets` and which from `vars`**
 *    ([#338](https://github.com/openzigs/onyourleft/issues/338)). Actions
 *    redacts every occurrence of a secret's *value* from the log, so a
 *    non-secret stored as a secret blanks its own value out of every line that
 *    contains it — the key alias is the word "upload", which blanked the step
 *    name *"Decode the upload key"* and the pinned `actions/upload-artifact`
 *    out of the first run there ever was. Nothing but an assertion keeps a
 *    later hand from moving it back, because the pipeline goes green either
 *    way.
 *
 * ⚠️ **The signing step is EXECUTED here, not read.** Its two refusals — a tag
 * with no keystore, and a keystore with no alias — both have to fail a build
 * that the unsigned fallback would otherwise carry to a green finish, and a
 * test that only greps the YAML for an `exit 1` cannot tell a guard that fires
 * from one that is unreachable. The script is lifted out of the workflow and
 * run under the shell GitHub runs it under.
 *
 * ⚠️ **What this file deliberately does NOT claim.** It reads the workflow as
 * text. It says nothing about whether the pipeline works — that is settled by
 * running it, and `apps/mobile/RELEASE.md` §1 is where the result of doing so
 * is recorded rather than here.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The repository root, resolved from this file rather than from `cwd`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const WORKFLOW = read('.github', 'workflows', 'release.yml');
const REPO_RULES = read('scripts', 'check-repo-rules.sh');
const VARIABLES = read('apps', 'mobile', 'android', 'variables.gradle');

/**
 * The one number, read out of each file the way that file states it.
 *
 * Each reader is deliberately narrow: a permissive pattern that fell back to
 * "any number nearby" would keep agreeing after the declaration it is supposed
 * to be reading had been deleted.
 */
function gradleTarget(): number {
  const match = /targetSdkVersion\s*=\s*(\d+)/.exec(VARIABLES);
  expect(match, 'variables.gradle declares no targetSdkVersion').not.toBeNull();
  return Number(match?.[1]);
}

function repoRuleFloor(): number {
  const match = /^MINIMUM_TARGET_SDK=(\d+)$/m.exec(REPO_RULES);
  expect(match, 'check-repo-rules.sh declares no MINIMUM_TARGET_SDK').not.toBeNull();
  return Number(match?.[1]);
}

/**
 * Every copy in the workflow: one per verification step, the APK's and the
 * App Bundle's (#958). Reading only the first would let the second drift.
 */
function workflowFloors(): number[] {
  const floors = [...WORKFLOW.matchAll(/MINIMUM_TARGET_SDK:\s*'(\d+)'/g)].map((match) =>
    Number(match[1]),
  );
  expect(floors.length, 'release.yml should state the floor for the APK and the bundle').toBe(2);
  return floors;
}

describe('the target API floor', () => {
  it('is the same number in the Gradle build, the repository rule and the release workflow', () => {
    const gradle = gradleTarget();
    expect(repoRuleFloor(), 'scripts/check-repo-rules.sh disagrees with variables.gradle').toBe(
      gradle,
    );
    for (const floor of workflowFloors()) {
      expect(floor, '.github/workflows/release.yml disagrees with variables.gradle').toBe(gradle);
    }
  });

  it('is at least the level Google Play requires of a new app or an update', () => {
    // Android 16. Enforced for new apps and updates from 2026-08-31; #95's
    // note that "sources disagree on the exact date" was resolved on
    // 2026-09-16 and the date is recorded in apps/mobile/RELEASE.md §7.
    expect(gradleTarget()).toBeGreaterThanOrEqual(36);
  });
});

describe('the release workflow', () => {
  it('pins every action to a full commit SHA rather than a tag', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    // A workflow whose `uses:` lines stopped being found would pass a loop over
    // an empty list, which is the shape this repository keeps finding.
    expect(uses.length, 'no `uses:` found in release.yml at all').toBeGreaterThan(0);
    for (const reference of uses) {
      expect(reference, `${reference} is not pinned to a commit`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('asks for no permission beyond writing the release it publishes', () => {
    // Every other workflow here is read-only. This one needs `contents: write`
    // to create a Release and must not quietly acquire anything else — it is
    // the job that holds the signing key.
    // `[ \t]` rather than `\s`, which matches a newline and would run the
    // block past the blank line into the next top-level key.
    const block = /^permissions:\n((?:[ \t]+\S+:[^\n]*\n)+)/m.exec(WORKFLOW);
    expect(block, 'release.yml declares no permissions block').not.toBeNull();
    const granted = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(granted).toEqual(['contents: write']);
  });
});

/**
 * The `run:` block of a named step, lifted out of the workflow.
 *
 * Deliberately narrow, and it fails rather than returning something empty: an
 * extractor that quietly found nothing would hand every case below a script
 * that exits 0 and asserts about the shell rather than about this pipeline.
 */
function stepScript(stepName: string): string {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  expect(start, `release.yml has no step named ${stepName}`).toBeGreaterThanOrEqual(0);

  const after = lines.findIndex(
    (line, index) => index > start && /^\s*-\s+(name|uses):/.test(line),
  );
  const step = lines.slice(start, after === -1 ? lines.length : after);

  const runAt = step.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  expect(runAt, `the ${stepName} step has no literal \`run: |\` block`).toBeGreaterThanOrEqual(0);
  const runLine = step[runAt] ?? '';
  const indent = runLine.length - runLine.trimStart().length;

  const body: string[] = [];
  for (const line of step.slice(runAt + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  const script = body.join('\n');
  expect(script.trim(), `extracted nothing from the ${stepName} step`).not.toBe('');
  return script;
}

const SIGNING_STEP = 'Decode the upload key, if this repository has one';

interface StepRun {
  /** The exit status the runner would see. */
  readonly status: number;
  /** stdout and stderr together, which is what a log line is. */
  readonly log: string;
  /** What the step appended to `$GITHUB_OUTPUT`. */
  readonly output: string;
  /** The decoded keystore, or `null` where the step wrote none. */
  readonly keystore: string | null;
}

/**
 * Run the signing step the way the runner does.
 *
 * `bash --noprofile --norc -eo pipefail` is GitHub's documented default shell
 * for a `run:` step on Linux. Running it under a bare `bash -c` would drop
 * `-e`, which is the difference between a failed decode aborting the step and
 * the step carrying on to report `signed=true`.
 */
function runSigningStep(environment: {
  readonly keystore?: string;
  readonly alias?: string;
  readonly ref: string;
}): StepRun {
  const directory = mkdtempSync(join(tmpdir(), 'oyl-release-'));
  try {
    const script = join(directory, 'step.sh');
    writeFileSync(script, stepScript(SIGNING_STEP));
    const outputFile = join(directory, 'github-output');
    writeFileSync(outputFile, '');

    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      encoding: 'utf8',
      env: {
        // Inherited rather than built from nothing, so `base64` is on the PATH.
        // Every variable the step reads is set below it, so nothing a
        // developer happens to export can change what this measures.
        ...process.env,
        KEYSTORE_BASE64: environment.keystore ?? '',
        KEY_ALIAS: environment.alias ?? '',
        REF: environment.ref,
        RUNNER_TEMP: directory,
        GITHUB_OUTPUT: outputFile,
      },
    });

    const keystore = join(directory, 'upload.jks');
    return {
      status: result.status ?? -1,
      log: `${result.stdout}${result.stderr}`,
      output: readFileSync(outputFile, 'utf8'),
      keystore: existsSync(keystore) ? readFileSync(keystore, 'utf8') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Nothing key-shaped: the step decodes whatever it is given. */
const NOT_A_KEYSTORE = 'this is not a keystore';
const NOT_A_KEYSTORE_BASE64 = Buffer.from(NOT_A_KEYSTORE, 'utf8').toString('base64');

describe('the signing inputs', () => {
  /** Every `${{ secrets.X }}` the workflow reads. */
  function referenced(context: 'secrets' | 'vars'): string[] {
    const pattern = new RegExp(`\\$\\{\\{\\s*${context}\\.([A-Z0-9_]+)\\s*\\}\\}`, 'g');
    return [...new Set([...WORKFLOW.matchAll(pattern)].map((match) => match[1] ?? ''))].sort();
  }

  it('reads three secrets, and the key alias is not one of them', () => {
    const secrets = referenced('secrets');
    // A pattern that had stopped matching would pass an equality against the
    // list it also produced, so the count is asserted first.
    expect(secrets.length, 'no `${{ secrets.X }}` reference found in release.yml at all').toBe(3);
    expect(secrets).toEqual([
      'ANDROID_KEYSTORE_BASE64',
      'ANDROID_KEYSTORE_PASSWORD',
      'ANDROID_KEY_PASSWORD',
    ]);
  });

  it('reads the key alias from a repository variable, which Actions does not redact', () => {
    expect(referenced('vars')).toEqual(['ANDROID_KEY_ALIAS']);
    // Read in two places — the guard below and the Gradle invocation — and it
    // is the second that actually signs.
    expect(
      WORKFLOW.includes('ANDROID_KEY_ALIAS: ${{ vars.ANDROID_KEY_ALIAS }}'),
      'the Assemble step no longer passes the alias variable to Gradle',
    ).toBe(true);
  });
});

describe('the signing step, run under the shell the runner uses', () => {
  it('builds unsigned off a tag when the repository holds no keystore', () => {
    const run = runSigningStep({ ref: 'refs/heads/main' });
    expect(run.status, run.log).toBe(0);
    expect(run.output).toContain('signed=false');
    expect(run.keystore).toBeNull();
  });

  it('refuses a tag that has no keystore rather than publishing a debug build', () => {
    const run = runSigningStep({ ref: 'refs/tags/v0.1.0' });
    expect(run.status).toBe(1);
    expect(run.log).toContain('::error::');
    expect(run.output).not.toContain('signed=true');
  });

  it('refuses a keystore with no alias rather than falling through to unsigned', () => {
    const run = runSigningStep({ keystore: NOT_A_KEYSTORE_BASE64, ref: 'refs/heads/main' });
    expect(run.status, 'a keystore with no alias to open it built something anyway').toBe(1);
    expect(run.log).toContain('ANDROID_KEY_ALIAS');
    // The failure that would look like success: `signed=false` is a green
    // build and an unsigned APK.
    expect(run.output).toBe('');
  });

  it('decodes the keystore and reports signed when both are present', () => {
    const run = runSigningStep({
      keystore: NOT_A_KEYSTORE_BASE64,
      alias: 'oyl-upload',
      ref: 'refs/heads/main',
    });
    expect(run.status, run.log).toBe(0);
    expect(run.output).toContain('signed=true');
    expect(run.keystore, 'the step reported signed=true and wrote no keystore').toBe(
      NOT_A_KEYSTORE,
    );
  });
});

/**
 * Run a step's script from `cwd`, with `bin` ahead of the inherited PATH so a
 * stub stands in for each Android or JDK tool the step calls.
 */
function runStep(
  stepName: string,
  cwd: string,
  bin: string,
  environment: Readonly<Record<string, string>>,
): { readonly status: number; readonly log: string } {
  const script = join(cwd, 'step.sh');
  writeFileSync(script, stepScript(stepName));
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd,
    encoding: 'utf8',
    // A fixed system PATH behind the stubs rather than the developer's own, so
    // a real `jarsigner` or `java` installed locally can never answer instead.
    env: { ...process.env, ...environment, PATH: `${bin}:/usr/bin:/bin` },
  });
  return { status: result.status ?? -1, log: `${result.stdout}${result.stderr}` };
}

function stub(bin: string, name: string, body: string): void {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

describe('the Assemble step builds the App Bundle beside the APK (#958)', () => {
  /** One `./gradlew` invocation: its arguments, and the channel its web assets were built for. */
  interface Invocation {
    readonly args: readonly string[];
    readonly channel: string;
  }

  /**
   * Every `./gradlew` invocation the step made, in order. The synced web
   * assets carry a `channel` file, the direct build's in place and the Play
   * build's set aside where the web build steps leave it (#1745), so each
   * invocation records which one Gradle would have packaged.
   */
  function gradleInvocations(signed: boolean): Invocation[] {
    const directory = mkdtempSync(join(tmpdir(), 'oyl-assemble-'));
    try {
      const recorded = join(directory, 'gradle-args');
      const assets = join(directory, 'app/src/main/assets/public');
      mkdirSync(assets, { recursive: true });
      writeFileSync(join(assets, 'channel'), 'direct\n');
      mkdirSync(join(directory, 'public-play'));
      writeFileSync(join(directory, 'public-play', 'channel'), 'play\n');
      stub(
        directory,
        'gradlew',
        `{ printf 'channel=%s\\n' "$(cat app/src/main/assets/public/channel)"; printf '%s\\n' "$@"; printf -- '--\\n'; } >> '${recorded}'`,
      );
      const run = runStep('Assemble', directory, directory, {
        SIGNED: signed ? 'true' : 'false',
        RUNNER_TEMP: directory,
        ANDROID_KEYSTORE_PASSWORD: 'store-password',
        ANDROID_KEY_ALIAS: 'oyl-upload',
        ANDROID_KEY_PASSWORD: 'key-password',
      });
      expect(run.status, run.log).toBe(0);
      return readFileSync(recorded, 'utf8')
        .split('--\n')
        .filter((block) => block.trim() !== '')
        .map((block) => {
          const [first = '', ...args] = block.trim().split('\n');
          return { channel: first.replace(/^channel=/, ''), args };
        });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const SIGNING_PROPERTIES = [
    'android.injected.signing.store.file=',
    'android.injected.signing.store.password=store-password',
    'android.injected.signing.key.alias=oyl-upload',
    'android.injected.signing.key.password=key-password',
  ];

  it('signs the bundle with the same injected upload key as the APK', () => {
    const invocations = gradleInvocations(true);
    expect(invocations.map(({ args }) => args[0])).toEqual(['assembleRelease', 'bundleRelease']);
    // Two invocations since #1745, so each must carry the injected
    // properties: a `./gradlew bundleRelease` without them builds an unsigned
    // bundle with a green exit.
    for (const { args } of invocations) {
      for (const property of SIGNING_PROPERTIES) {
        expect(
          args.some((arg) => arg.startsWith(`-P${property}`)),
          `${property} missing from ./gradlew ${args[0] ?? ''}`,
        ).toBe(true);
      }
    }
  });

  it('packages the direct build into the APK and the Play build into the bundle (#1745)', () => {
    for (const signed of [true, false]) {
      expect(
        gradleInvocations(signed).map(({ args, channel }) => `${args[0] ?? ''} ${channel}`),
      ).toEqual(
        signed
          ? ['assembleRelease direct', 'bundleRelease play']
          : ['assembleDebug direct', 'bundleDebug play'],
      );
    }
  });

  it('builds a debug bundle after the debug APK when there is no key', () => {
    expect(gradleInvocations(false).map(({ args }) => args)).toEqual([
      ['assembleDebug'],
      ['bundleDebug'],
    ]);
  });
});

describe('the web client is built once per channel (#1745)', () => {
  /** The channel a step's `env:` block sets, read from the step's own lines. */
  function stepChannel(stepName: string): string | undefined {
    const lines = WORKFLOW.split('\n');
    const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
    expect(start, `release.yml has no step named ${stepName}`).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((line, index) => index > start && /^\s*run: \|/.test(line));
    const match = lines
      .slice(start, end)
      .join('\n')
      .match(/VITE_OYL_RELEASE_CHANNEL:\s*(.+)/);
    return match?.[1];
  }

  it('builds for Google Play first and sets its synced assets aside', () => {
    expect(stepChannel('Build the web client for Google Play')).toBe(
      "${{ secrets.ANDROID_KEYSTORE_BASE64 != '' && 'play' || '' }}",
    );
    const script = stepScript('Build the web client for Google Play');
    expect(script).toContain('pnpm --filter @onyourleft/web run build');
    expect(script).toContain('cap sync android');
    expect(script).toContain(
      'cp -R apps/mobile/android/app/src/main/assets/public "${RUNNER_TEMP}/public-play"',
    );
  });

  it('leaves the direct build in place for the APK', () => {
    expect(stepChannel('Build the web client for the direct download')).toBe(
      "${{ secrets.ANDROID_KEYSTORE_BASE64 != '' && 'direct' || '' }}",
    );
    const script = stepScript('Build the web client for the direct download');
    expect(script).toContain('pnpm --filter @onyourleft/web run build');
    expect(script).toContain('cap sync android');
  });

  it('finishes both builds before the key is decoded', () => {
    const at = (name: string): number => WORKFLOW.indexOf(`- name: ${name}`);
    expect(at('Build the web client for Google Play')).toBeLessThan(
      at('Build the web client for the direct download'),
    );
    expect(at('Build the web client for the direct download')).toBeLessThan(at(SIGNING_STEP));
  });
});

/**
 * #1745: every place a rider meets the app says which channel it is and that
 * the two do not mix, because switching is an uninstall and an uninstall
 * deletes the rides on the device. Read as prose, with markdown emphasis and
 * line breaks taken out.
 */
describe('riders are told the two channels do not mix (#1745)', () => {
  const prose = (text: string): string =>
    text
      .replace(/^\s*>\s?/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ');

  const PLACES = {
    'the README': prose(read('README.md')),
    'the GitHub release notes': prose(read('apps', 'mobile', 'release-notes.md')),
    "the Play listing's full description": prose(
      /The full description carries this paragraph[\s\S]*?(?=\n- \[ \])/.exec(
        read('apps', 'mobile', 'RELEASE.md'),
      )?.[0] ?? '',
    ),
  };

  for (const [place, text] of Object.entries(PLACES)) {
    it(`in ${place}`, () => {
      expect(text, `${place} does not name Google Play`).toContain('Google Play');
      expect(text, `${place} does not name the direct download`).toContain('direct download');
      expect(text).toMatch(/cannot update each other/);
      expect(text).toContain('uninstalling deletes the rides on the device');
      expect(text).toMatch(/sync them with an instance, before you switch/);
    });
  }

  it('publishes the release notes with every GitHub Release', () => {
    const match = /^\s+body_path:\s*(\S+)\s*$/m.exec(WORKFLOW);
    expect(match?.[1]).toBe('apps/mobile/release-notes.md');
    expect(existsSync(join(ROOT, match?.[1] ?? 'missing'))).toBe(true);
  });
});

const BUNDLE_STEP = 'Verify the bundle is signed and targets the required API level';

interface BundleTools {
  /** What `jarsigner -verify` prints. It exits 0 either way, as the real one does. */
  readonly verify?: string;
  /** What `keytool -printcert -jarfile` prints. */
  readonly certificate?: string;
  /** What bundletool prints for the targetSdkVersion XPath. */
  readonly target?: string;
  /** Whether Assemble left an `.aab` at all. */
  readonly bundle?: boolean;
  readonly signed?: boolean;
}

const UPLOAD_CERTIFICATE =
  'Owner: CN=On Your Left, O=openzigs\nIssuer: CN=On Your Left, O=openzigs';
const DEBUG_CERTIFICATE =
  'Owner: C=US, O=Android, CN=Android Debug\nIssuer: C=US, O=Android, CN=Android Debug';

function verifyBundle(tools: BundleTools): { readonly status: number; readonly log: string } {
  const directory = mkdtempSync(join(tmpdir(), 'oyl-bundle-'));
  try {
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    stub(bin, 'jarsigner', `printf '%s\\n' '${tools.verify ?? 'jar verified.'}'`);
    stub(bin, 'keytool', `printf '%s\\n' '${tools.certificate ?? UPLOAD_CERTIFICATE}'`);
    // bundletool runs as `java -jar`; the stub answers the one XPath asked of it.
    stub(
      bin,
      'java',
      `case "$*" in *'--xpath=/manifest/uses-sdk/@android:targetSdkVersion'*) printf '%s\\n' '${tools.target ?? '36'}' ;; *) exit 64 ;; esac`,
    );
    if (tools.bundle ?? true) {
      const release = join(directory, 'apps/mobile/android/app/build/outputs/bundle/release');
      mkdirSync(release, { recursive: true });
      writeFileSync(join(release, 'app-release.aab'), 'not a bundle');
    }
    return runStep(BUNDLE_STEP, directory, bin, {
      SIGNED: (tools.signed ?? true) ? 'true' : 'false',
      MINIMUM_TARGET_SDK: String(gradleTarget()),
      RUNNER_TEMP: directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('the bundle verification step, run against stub tools (#958)', () => {
  it('passes a bundle signed with the upload key at the required target', () => {
    const run = verifyBundle({});
    expect(run.status, run.log).toBe(0);
    expect(run.log).toContain('targeting API 36');
  });

  it('refuses an unsigned bundle even though jarsigner exits 0 for one', () => {
    const run = verifyBundle({ verify: 'jar is unsigned.' });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('does not verify as signed');
  });

  // #1745. Both outputs are what JDK 21's `jarsigner -verify` printed on
  // 2026-10-27 for a jar signed with a fresh self-signed key, before and after
  // `jar uf` added an entry to it. It exits 0 for both.
  const SELF_SIGNED_WARNINGS = [
    'This jar contains entries whose signer certificate is self-signed.',
    'This jar contains signatures that do not include a timestamp.',
  ];

  it('passes the self-signed and no-timestamp warnings the upload key always raises', () => {
    const run = verifyBundle({
      verify: ['', 'jar verified.', '', 'Warning: ', ...SELF_SIGNED_WARNINGS].join('\n'),
    });
    expect(run.status, run.log).toBe(0);
  });

  it('refuses a partly signed bundle, which jarsigner still calls verified', () => {
    const run = verifyBundle({
      verify: [
        '',
        'jar verified.',
        '',
        'Warning: ',
        'This jar contains unsigned entries which have not been integrity-checked. ',
        ...SELF_SIGNED_WARNINGS,
      ].join('\n'),
    });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('has entries that are not signed');
  });

  it('refuses a bundle signed with the Android debug certificate', () => {
    const run = verifyBundle({ certificate: DEBUG_CERTIFICATE });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('debug certificate');
  });

  it('refuses a bundle below the target API floor', () => {
    const run = verifyBundle({ target: '35' });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('below the required 36');
  });

  it('refuses a bundle whose manifest declares no target', () => {
    const run = verifyBundle({ target: '' });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('no numeric targetSdkVersion');
  });

  it('refuses a build that produced no bundle at all', () => {
    const run = verifyBundle({ bundle: false });
    expect(run.status, run.log).toBe(1);
    expect(run.log).toContain('produced no App Bundle');
  });

  it('checks only the target on an unsigned fork run, as the APK step does', () => {
    const run = verifyBundle({ signed: false, certificate: DEBUG_CERTIFICATE });
    expect(run.status, run.log).toBe(0);
    expect(verifyBundle({ signed: false, target: '35' }).status).toBe(1);
  });
});

describe('where the App Bundle goes (#958)', () => {
  it('is uploaded as a workflow artefact', () => {
    expect(WORKFLOW).toMatch(
      /name: android-aab\n\s+path: apps\/mobile\/android\/app\/build\/outputs\/bundle\/\*\*\/\*\.aab\n\s+if-no-files-found: error/,
    );
  });

  it('is not a GitHub Release asset, which stays the APK alone', () => {
    const files = [...WORKFLOW.matchAll(/^\s+files:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    expect(files).toEqual(['apps/mobile/android/app/build/outputs/apk/**/*.apk']);
  });

  it('fetches bundletool pinned to a SHA-256 and checks it', () => {
    expect(WORKFLOW).toMatch(/BUNDLETOOL_SHA256: '[0-9a-f]{64}'/);
    expect(stepScript('Fetch bundletool')).toContain('sha256sum -c -');
  });
});
