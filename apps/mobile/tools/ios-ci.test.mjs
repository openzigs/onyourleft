// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The iOS job's checks (#1756), driven with synthetic input on any machine,
 * and the job itself read from `.github/workflows/rules.yml` as text in the
 * style of `src/android/release-pipeline.test.ts`.
 *
 * ⚠️ What this cannot say: whether the job passes. That is the job's own run on
 * `macos-latest`, which builds the app and executes every check below against
 * the built product. This file holds that each check would go red on the input
 * it exists to refuse, and that the job runs each one, where it must run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import config from '../capacitor.config.ts';

import {
  EXPECTED,
  STILL_RUNNING_AFTER_S,
  XCODE_FLOOR,
  builtAppProblems,
  launchedPid,
  parseXcodeVersion,
  runningPid,
  simulatorFor,
  xcodeProblems,
} from './ios-ci.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (/** @type {string[]} */ ...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('the Xcode floor — the iOS counterpart of REL002', () => {
  it('passes the Xcode the job selects and a newer one', () => {
    expect(xcodeProblems('Xcode 26.6\nBuild version 17F42\n')).toEqual([]);
    expect(xcodeProblems('Xcode 26.0.1\nBuild version 17A400\n')).toEqual([]);
    expect(xcodeProblems('Xcode 27.2\nBuild version 27B52\n')).toEqual([]);
  });

  it('fails an Xcode older than the floor, naming both', () => {
    const problems = xcodeProblems('Xcode 16.4\nBuild version 16F6\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Xcode 16.4');
    expect(problems[0]).toContain(`Xcode ${String(XCODE_FLOOR)}`);
    expect(xcodeProblems('Xcode 25.9\nBuild version 25Z1\n')).toHaveLength(1);
  });

  it('fails output it cannot read rather than passing it', () => {
    expect(xcodeProblems('')).toHaveLength(1);
    expect(xcodeProblems('xcode-select: error: tool `xcodebuild` requires Xcode')).toHaveLength(1);
    // A version on a line that is not the version line is not the version.
    expect(parseXcodeVersion('Build version Xcode 26.6')).toBeNull();
  });

  it('reads the major, minor and patch', () => {
    expect(parseXcodeVersion('Xcode 26.4.1\nBuild version 17E202\n')).toEqual({
      major: 26,
      minor: 4,
      patch: 1,
    });
    expect(parseXcodeVersion('Xcode 26\n')).toEqual({ major: 26, minor: 0, patch: 0 });
  });

  it('is 26, Apple’s floor since 2026-04-28', () => {
    expect(XCODE_FLOOR).toBe(26);
  });
});

/**
 * A built Info.plist as `plutil -convert json` reads it, cut down from the
 * one this tree's own simulator build produced on 2026-11-28.
 */
const BUILT = Object.freeze({
  CFBundleIdentifier: 'dev.openzigs.onyourleft',
  CFBundleExecutable: 'App',
  UIDeviceFamily: [1, 2],
  MinimumOSVersion: '17.0',
  UIBackgroundModes: ['bluetooth-central'],
  NSBluetoothAlwaysUsageDescription:
    'On Your Left connects to your smart trainer and sensors over Bluetooth.',
  NSCameraUsageDescription: 'On Your Left opens the camera only when you turn it on.',
  CFBundleSupportedPlatforms: ['iPhoneSimulator'],
});

/** @param {Record<string, unknown>} change */
const built = (change) => {
  /** @type {Record<string, unknown>} */
  const plist = { ...BUILT, ...change };
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete plist[key];
  return plist;
};

describe('the built Info.plist', () => {
  it('passes the plist this tree builds', () => {
    expect(builtAppProblems(BUILT)).toEqual([]);
  });

  it('holds the bundle ID to capacitor.config.ts’s appId (D-12)', () => {
    expect(EXPECTED.bundleId).toBe(config.appId);
    expect(
      builtAppProblems(built({ CFBundleIdentifier: 'dev.openzigs.onyourleft.spike' })),
    ).toEqual([
      'CFBundleIdentifier is "dev.openzigs.onyourleft.spike", not "dev.openzigs.onyourleft"',
    ]);
  });

  it('fails a missing or empty Bluetooth string — the plugin crashes without it', () => {
    expect(builtAppProblems(built({ NSBluetoothAlwaysUsageDescription: undefined }))).toEqual([
      'NSBluetoothAlwaysUsageDescription is missing',
    ]);
    expect(builtAppProblems(built({ NSBluetoothAlwaysUsageDescription: '  ' }))).toHaveLength(1);
    // A build setting nobody defined reaches the rider as these characters.
    expect(
      builtAppProblems(built({ NSBluetoothAlwaysUsageDescription: '$(BLE_REASON)' })),
    ).toHaveLength(1);
  });

  it('fails a missing camera string', () => {
    expect(builtAppProblems(built({ NSCameraUsageDescription: undefined }))).toEqual([
      'NSCameraUsageDescription is missing',
    ]);
  });

  it('fails anything but iPhone and iPad (D-3)', () => {
    for (const family of [[2], [1], [1, 2, 3], ['1', '2'], undefined]) {
      expect(
        builtAppProblems(built({ UIDeviceFamily: family })),
        JSON.stringify(family),
      ).toHaveLength(1);
    }
    expect(builtAppProblems(built({ UIDeviceFamily: [2, 1] }))).toEqual([]);
  });

  it('fails a deployment target other than D-9’s 17.0', () => {
    for (const target of ['15.0', '18.0', '26.0', 17, undefined]) {
      expect(builtAppProblems(built({ MinimumOSVersion: target })), String(target)).toHaveLength(1);
    }
  });

  it('fails a background mode no shipped feature uses, and a missing one (guideline 2.5.4)', () => {
    for (const modes of [
      ['bluetooth-central', 'location'],
      ['bluetooth-central', 'audio'],
      ['bluetooth-central', 'bluetooth-central'],
      [],
      ['location'],
      undefined,
    ]) {
      expect(
        builtAppProblems(built({ UIBackgroundModes: modes })),
        JSON.stringify(modes),
      ).toHaveLength(1);
    }
  });

  it('names every difference at once, and refuses what is not a dictionary', () => {
    expect(
      builtAppProblems(built({ MinimumOSVersion: '15.0', UIBackgroundModes: undefined })),
    ).toHaveLength(2);
    expect(builtAppProblems(null)).toEqual(['the built Info.plist is not a dictionary']);
    expect(builtAppProblems([])).toEqual(['the built Info.plist is not a dictionary']);
  });
});

describe('the simulator launch', () => {
  const ipad = (/** @type {string} */ name, /** @type {string} */ udid) => ({
    name,
    udid,
    isAvailable: true,
    state: 'Shutdown',
  });

  it('chooses an iPad on the newest iOS runtime', () => {
    const list = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [ipad('iPad (A16)', 'OLD')],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-10': [
          { name: 'iPhone 17', udid: 'PHONE', isAvailable: true },
          ipad('iPad Air 11-inch (M4)', 'NEWEST'),
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [ipad('iPad mini (A17 Pro)', 'MIDDLE')],
        'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [ipad('iPad lookalike', 'WATCH')],
      },
    };
    expect(simulatorFor(list)).toEqual({
      udid: 'NEWEST',
      name: 'iPad Air 11-inch (M4)',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-10',
    });
  });

  it('falls back to an older runtime when the newest has no iPad, and finds none in an empty list', () => {
    const list = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ name: 'iPhone 17', udid: 'PHONE' }],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [
          { ...ipad('iPad (A16)', 'GONE'), isAvailable: false },
          ipad('iPad (A16)', 'HERE'),
        ],
      },
    };
    expect(simulatorFor(list)?.udid).toBe('HERE');
    expect(simulatorFor({ devices: {} })).toBeNull();
    expect(simulatorFor(null)).toBeNull();
  });

  it('reads the process id `simctl launch` prints', () => {
    expect(launchedPid('dev.openzigs.onyourleft: 45059\n', EXPECTED.bundleId)).toBe(45059);
    expect(launchedPid('dev.openzigs.onyourleft.spike: 1\n', EXPECTED.bundleId)).toBeNull();
    expect(
      launchedPid('An error was encountered processing the command\n', EXPECTED.bundleId),
    ).toBeNull();
  });

  it('sees the app running only while launchctl lists it with a process', () => {
    const listing = [
      'PID\tStatus\tLabel',
      '45059\t0\tUIKitApplication:dev.openzigs.onyourleft[3f1a][rb-legacy]',
      '312\t0\tcom.apple.springboard',
    ].join('\n');
    expect(runningPid(listing, EXPECTED.bundleId)).toBe(45059);
    // Exited: still listed, with no process.
    expect(
      runningPid(
        '-\t11\tUIKitApplication:dev.openzigs.onyourleft[3f1a][rb-legacy]\n',
        EXPECTED.bundleId,
      ),
    ).toBeNull();
    expect(runningPid('312\t0\tcom.apple.springboard\n', EXPECTED.bundleId)).toBeNull();
    // Another app whose id starts with this one's is not this one.
    expect(
      runningPid(
        '77\t0\tUIKitApplication:dev.openzigs.onyourleft.spike[aa][rb-legacy]\n',
        EXPECTED.bundleId,
      ),
    ).toBeNull();
  });

  it('waits the thirty seconds the issue asks for', () => {
    expect(STILL_RUNNING_AFTER_S).toBeGreaterThanOrEqual(30);
  });
});

// --- The job, read from the workflow -----------------------------------------

const WORKFLOW = read('.github', 'workflows', 'rules.yml');

/** A workflow with its comment lines removed: what runs, not what is said of it. */
const uncommented = (/** @type {string} */ text) => text.replace(/^\s*#.*\n/gm, '');

/**
 * One job's lines, comments out, from its key at two spaces to the next.
 *
 * @param {string} workflow
 * @param {string} id
 */
function jobOf(workflow, id) {
  const code = uncommented(workflow);
  const header = new RegExp(`^ {2}${id}:\\n`, 'm').exec(code);
  if (header === null) return '';
  const rest = code.slice(header.index + header[0].length);
  const next = rest.search(/^ {2}[A-Za-z_][\w-]*:\n/m);
  return header[0] + (next === -1 ? rest : rest.slice(0, next));
}

/**
 * Every reason the iOS job is not the job #1756 asked for. Empty on the
 * workflow as committed; the cases below feed it altered copies.
 *
 * @param {string} workflow
 * @returns {string[]}
 */
function iosJobProblems(workflow) {
  const job = jobOf(workflow, 'ios');
  if (job === '') return ['rules.yml has no `ios` job'];
  const problems = [];
  const runsOn = /^ {4}runs-on: (.+)$/m.exec(job)?.[1]?.trim();
  // Exactly the standard label: every `-large` / `-xlarge` one is billed.
  if (runsOn !== 'macos-latest') problems.push(`runs-on is ${String(runsOn)}, not macos-latest`);
  const uses = [...job.matchAll(/^ +(?:- )?uses: (\S+)/gm)].map((match) => String(match[1]));
  if (uses.length === 0) problems.push('the job uses no action at all');
  for (const action of uses) {
    if (!/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/.test(action))
      problems.push(`${action} is not pinned to a commit`);
  }
  if (/pull_request_target/.test(uncommented(workflow)))
    problems.push('pull_request_target is banned');
  const developerDir =
    /^ {6}DEVELOPER_DIR: \/Applications\/Xcode_(\d+)(?:\.\d+)*\.app\/Contents\/Developer$/m.exec(
      job,
    );
  if (developerDir === null) problems.push('the job selects no Xcode through DEVELOPER_DIR');
  else if (Number(developerDir[1]) < XCODE_FLOOR) {
    problems.push(`the job selects Xcode ${String(developerDir[1])}, below the floor`);
  }
  for (const command of [
    'pnpm install --frozen-lockfile',
    'node apps/mobile/tools/ios-ci.mjs xcode',
    'pnpm --filter @onyourleft/mobile exec cap sync ios',
    'node apps/mobile/tools/ios-ci.mjs built-app ',
    'node apps/mobile/tools/ios-ci.mjs launch ',
  ]) {
    if (!job.includes(command)) problems.push(`the job does not run \`${command.trim()}\``);
  }
  const scheme = /xcodebuild [^\n]*-scheme (\S+)/.exec(job)?.[1];
  if (scheme !== config.ios.scheme) {
    problems.push(
      `xcodebuild builds the scheme ${String(scheme)}, not capacitor.config.ts’s ${config.ios.scheme}`,
    );
  }
  if (!/CODE_SIGNING_ALLOWED=NO/.test(job)) problems.push('the build is not unsigned');
  if (/secrets\./.test(job)) problems.push('the job reads a secret');
  // Each check reads the app the build step wrote.
  const products = [...job.matchAll(/ios-ci\.mjs (?:built-app|launch) "([^"]+)"/g)].map(
    (match) => match[1],
  );
  const derived = /-derivedDataPath "([^"]+)"/.exec(job)?.[1];
  for (const product of products) {
    if (
      derived === undefined ||
      product !== `${derived}/Build/Products/Debug-iphonesimulator/App.app`
    ) {
      problems.push(`a check reads ${String(product)}, which the build step does not write`);
    }
  }
  const rules = jobOf(workflow, 'rules');
  const needs = (/^ {4}needs: \[(.*)\]$/m.exec(rules)?.[1] ?? '').split(',').map((id) => id.trim());
  if (!needs.includes('ios')) problems.push('the required `rules` job does not need `ios`');
  return problems;
}

describe('the `ios` job of rules.yml — #1756', () => {
  it('is the job the issue asked for', () => {
    expect(iosJobProblems(WORKFLOW)).toEqual([]);
  });

  it('goes red on any runner label but macos-latest, billed ones first', () => {
    for (const label of [
      'macos-latest-xlarge',
      'macos-latest-large',
      'macos-26-xlarge',
      'macos-26',
      'ubuntu-latest',
    ]) {
      const altered = WORKFLOW.replace(/^ {4}runs-on: macos-latest$/m, `    runs-on: ${label}`);
      expect(altered, label).not.toBe(WORKFLOW);
      expect(iosJobProblems(altered), label).toEqual([`runs-on is ${label}, not macos-latest`]);
    }
  });

  it('goes red on an action pinned to a tag', () => {
    const altered = WORKFLOW.replace(
      /(^ {2}ios:\n[\s\S]*?uses: actions\/setup-node@)[0-9a-f]{40}/m,
      '$1v7',
    );
    expect(altered).not.toBe(WORKFLOW);
    expect(iosJobProblems(altered)).toEqual(['actions/setup-node@v7 is not pinned to a commit']);
  });

  it('goes red when the required check stops waiting for it', () => {
    const altered = WORKFLOW.replace(/, ios\]$/m, ']');
    expect(altered).not.toBe(WORKFLOW);
    expect(iosJobProblems(altered)).toEqual(['the required `rules` job does not need `ios`']);
  });

  it('goes red when no Xcode is selected, or one below the floor', () => {
    const unselected = WORKFLOW.replace(/^ {6}DEVELOPER_DIR: .*\n/m, '');
    expect(unselected).not.toBe(WORKFLOW);
    expect(iosJobProblems(unselected)).toEqual(['the job selects no Xcode through DEVELOPER_DIR']);
    const old = WORKFLOW.replace(/Xcode_\d+(\.\d+)*\.app/, 'Xcode_16.4.app');
    expect(iosJobProblems(old)).toEqual(['the job selects Xcode 16, below the floor']);
  });

  it('goes red when a check is dropped or reads another path', () => {
    const dropped = WORKFLOW.replace(
      /^ +run: node apps\/mobile\/tools\/ios-ci\.mjs launch .*\n/m,
      '',
    );
    expect(dropped).not.toBe(WORKFLOW);
    expect(iosJobProblems(dropped)).toEqual([
      'the job does not run `node apps/mobile/tools/ios-ci.mjs launch`',
    ]);
    const elsewhere = WORKFLOW.replace(
      /(ios-ci\.mjs built-app ")[^"]+"/,
      '$1apps/mobile/ios/App/App.app"',
    );
    expect(iosJobProblems(elsewhere)).toEqual([
      'a check reads apps/mobile/ios/App/App.app, which the build step does not write',
    ]);
  });

  it('builds the scheme capacitor.config.ts names', () => {
    expect(config.ios.scheme).toBe('App');
    const other = WORKFLOW.replace('-scheme App ', '-scheme Other ');
    expect(other).not.toBe(WORKFLOW);
    expect(iosJobProblems(other)).toEqual([
      'xcodebuild builds the scheme Other, not capacitor.config.ts’s App',
    ]);
  });
});
