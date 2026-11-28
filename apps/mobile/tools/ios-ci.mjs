#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The three checks the `ios` job of `.github/workflows/rules.yml` makes of the
 * iOS app it builds (#1756). Each reads the thing a release would ship, not a
 * source file that is supposed to become it:
 *
 *   node apps/mobile/tools/ios-ci.mjs xcode
 *       the Xcode `xcodebuild` actually runs is at least Apple's upload floor —
 *       the iOS counterpart of `REL002`
 *   node apps/mobile/tools/ios-ci.mjs built-app <App.app>
 *       the BUILT `.app`'s Info.plist, read through `plutil`: the bundle ID, the
 *       device families, the deployment target, the usage strings and exactly
 *       the background modes the shipped features use
 *   node apps/mobile/tools/ios-ci.mjs boot
 *       starts the simulator's boot early in the job, so it overlaps the build
 *   node apps/mobile/tools/ios-ci.mjs launch <App.app>
 *       the app installed in a booted iPad simulator, launched, and the same
 *       process still running {@link STILL_RUNNING_AFTER_S} seconds later — a
 *       crash at start-up from a missing key or plugin ends it sooner
 *
 * ⚠️ macOS only, like the job: `plutil` and `xcrun simctl` are Apple's. The
 * decisions — what a version string, a plist, a device list or a `launchctl`
 * listing means — are pure functions exported below, and
 * `ios-ci.test.mjs` drives them with synthetic input on any machine.
 *
 * ⚠️ Under `tools/` rather than `scripts/`, as `webview-probe.mjs` is: it needs
 * Xcode, so it can never be a bare-clone repository check.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/**
 * Apple's upload floor: since 2026-04-28 an app uploaded to App Store Connect
 * must be built with Xcode 26 or later, on an iOS 26 SDK.
 */
export const XCODE_FLOOR = 26;

/** How long the launched app must stay up, in seconds (#1756's criterion). */
export const STILL_RUNNING_AFTER_S = 30;

/**
 * What the built Info.plist must say.
 *
 * - `bundleId`: D-12, and the `appId` of `capacitor.config.ts` (the test holds
 *   the two to one string).
 * - `deviceFamily`: D-3, a universal app — 1 is iPhone, 2 is iPad.
 * - `minimumOS`: D-9, ruled 17 on 2026-11-26 (#1765).
 * - `backgroundModes`: D-7 follows spike S1 (#1753). With D-9 at 17 the iOS 26
 *   workout session (V3) is out, and D-10 rules out the location session
 *   (V2); both variants left, V1 and the native buffer V4, need
 *   `bluetooth-central` and nothing else. A key no shipped feature uses is an
 *   App Review rejection (guideline 2.5.4), so the list is EXACT.
 * - `usageDescriptions`: the plugin's documentation says the app crashes on
 *   first Bluetooth use without the Bluetooth string, and the camera (#383)
 *   needs its own. The local-network strings are #1774's, the encryption key
 *   #1777's.
 */
export const EXPECTED = Object.freeze({
  bundleId: 'dev.openzigs.onyourleft',
  deviceFamily: Object.freeze([1, 2]),
  minimumOS: '17.0',
  backgroundModes: Object.freeze(['bluetooth-central']),
  usageDescriptions: Object.freeze([
    'NSBluetoothAlwaysUsageDescription',
    'NSCameraUsageDescription',
  ]),
});

/**
 * The version `xcodebuild -version` prints on its first line, `Xcode 26.6`, or
 * `null` when there is none to read.
 *
 * @param {string} text
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseXcodeVersion(text) {
  const match = /^Xcode (\d+)(?:\.(\d+))?(?:\.(\d+))?[ \t]*$/m.exec(text);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

/**
 * Every reason the selected Xcode cannot build this app for upload: none when
 * it is at least the floor. Unreadable output is a failure, not a pass.
 *
 * @param {string} text what `xcodebuild -version` printed
 * @param {number} [floor]
 * @returns {string[]}
 */
export function xcodeProblems(text, floor = XCODE_FLOOR) {
  const version = parseXcodeVersion(text);
  if (version === null) {
    return [
      `no Xcode version in what \`xcodebuild -version\` printed: ${JSON.stringify(text.trim())}`,
    ];
  }
  if (version.major < floor) {
    const shown = `${String(version.major)}.${String(version.minor)}`;
    return [
      `Xcode ${shown} is older than Apple's upload floor, Xcode ${String(floor)} (since 2026-04-28)`,
    ];
  }
  return [];
}

/** @param {readonly unknown[]} values */
const sortedText = (values) => JSON.stringify([...values].map(String).sort());

/**
 * Every way a built Info.plist, as JSON, differs from {@link EXPECTED}.
 *
 * @param {unknown} info the plist, as `plutil -convert json` reads it
 * @param {typeof EXPECTED} [expected]
 * @returns {string[]}
 */
export function builtAppProblems(info, expected = EXPECTED) {
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    return ['the built Info.plist is not a dictionary'];
  }
  /** @type {Record<string, unknown>} */
  const plist = /** @type {Record<string, unknown>} */ (info);
  const problems = [];

  if (plist['CFBundleIdentifier'] !== expected.bundleId) {
    problems.push(
      `CFBundleIdentifier is ${JSON.stringify(plist['CFBundleIdentifier'])}, not ${JSON.stringify(expected.bundleId)}`,
    );
  }

  const family = plist['UIDeviceFamily'];
  if (
    !Array.isArray(family) ||
    !family.every((value) => typeof value === 'number') ||
    sortedText(family) !== sortedText(expected.deviceFamily)
  ) {
    problems.push(
      `UIDeviceFamily is ${JSON.stringify(family)}, not ${JSON.stringify(expected.deviceFamily)} (iPhone and iPad)`,
    );
  }

  if (plist['MinimumOSVersion'] !== expected.minimumOS) {
    problems.push(
      `MinimumOSVersion is ${JSON.stringify(plist['MinimumOSVersion'])}, not ${JSON.stringify(expected.minimumOS)}`,
    );
  }

  for (const key of expected.usageDescriptions) {
    const value = plist[key];
    // An unexpanded `$(VARIABLE)` is a build setting nobody defined: the
    // system would show the rider those characters.
    if (typeof value !== 'string' || value.trim() === '' || value.includes('$(')) {
      problems.push(`${key} is ${value === undefined ? 'missing' : JSON.stringify(value)}`);
    }
  }

  const modes = plist['UIBackgroundModes'];
  if (
    !Array.isArray(modes) ||
    new Set(modes).size !== modes.length ||
    sortedText(modes) !== sortedText(expected.backgroundModes)
  ) {
    problems.push(
      `UIBackgroundModes is ${JSON.stringify(modes)}, not exactly ${JSON.stringify(expected.backgroundModes)}`,
    );
  }

  return problems;
}

/**
 * A runtime's version, read from its identifier
 * (`com.apple.CoreSimulator.SimRuntime.iOS-26-5` is `[26, 5]`), or `null` for
 * any runtime that is not iOS.
 *
 * @param {string} runtime
 * @returns {number[] | null}
 */
function iosRuntimeVersion(runtime) {
  const match = /\.SimRuntime\.iOS-(\d+(?:-\d+)*)$/.exec(runtime);
  return match === null ? null : String(match[1]).split('-').map(Number);
}

/** @param {readonly number[]} a @param {readonly number[]} b */
function compareVersions(a, b) {
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const difference = (a[at] ?? 0) - (b[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The simulator to launch in: an available iPad on the newest iOS runtime,
 * because the app is iPad-first (#1780). `null` when there is none.
 *
 * @param {unknown} list what `xcrun simctl list devices available --json` printed, parsed
 * @returns {{ udid: string, name: string, runtime: string } | null}
 */
export function simulatorFor(list) {
  const devices =
    list !== null && typeof list === 'object' && 'devices' in list
      ? /** @type {{ devices: unknown }} */ (list).devices
      : undefined;
  if (devices === null || typeof devices !== 'object' || devices === undefined) return null;
  const runtimes = Object.keys(devices)
    .map((runtime) => ({ runtime, version: iosRuntimeVersion(runtime) }))
    .filter((entry) => entry.version !== null)
    .sort((a, b) => compareVersions(b.version ?? [], a.version ?? []));
  for (const { runtime } of runtimes) {
    const onRuntime = /** @type {Record<string, unknown>} */ (devices)[runtime];
    if (!Array.isArray(onRuntime)) continue;
    for (const device of onRuntime) {
      if (
        device !== null &&
        typeof device === 'object' &&
        typeof device.udid === 'string' &&
        typeof device.name === 'string' &&
        device.name.startsWith('iPad') &&
        device.isAvailable !== false
      ) {
        return { udid: device.udid, name: device.name, runtime };
      }
    }
  }
  return null;
}

/**
 * The process id `xcrun simctl launch` printed (`dev.openzigs.onyourleft: 4242`),
 * or `null`.
 *
 * @param {string} text
 * @param {string} bundleId
 * @returns {number | null}
 */
export function launchedPid(text, bundleId) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${bundleId}:`)) continue;
    const pid = /^\d+$/.exec(trimmed.slice(bundleId.length + 1).trim())?.[0];
    if (pid !== undefined) return Number(pid);
  }
  return null;
}

/**
 * The process id the simulator's `launchctl list` shows for the app, or `null`
 * when it shows none: the app is not loaded, or is loaded with no process (a
 * `-` in the first column, which is how an app that has exited is listed).
 *
 * @param {string} text `PID\tStatus\tLabel` lines
 * @param {string} bundleId
 * @returns {number | null}
 */
export function runningPid(text, bundleId) {
  for (const line of text.split('\n')) {
    const [pid = '', , label = ''] = line.trim().split(/\s+/);
    if (!label.startsWith(`UIKitApplication:${bundleId}[`)) continue;
    if (/^\d+$/.test(pid)) return Number(pid);
  }
  return null;
}

// --- What runs on the runner -------------------------------------------------

/**
 * A command, its output returned; a non-zero exit stops the check, naming it.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @returns {string}
 */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) {
    throw new Error(`${command} ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/** @param {string[]} problems @param {string} what */
function verdict(problems, what) {
  if (problems.length === 0) {
    console.log(`ios-ci: ${what}: ok`);
    return 0;
  }
  for (const problem of problems) console.error(`ios-ci: ${what}: ${problem}`);
  return 1;
}

function checkXcode() {
  const text = run('xcodebuild', ['-version']);
  console.log(text.trim());
  // `xcode-select -p` prints the developer directory in effect, the job's
  // DEVELOPER_DIR included, so the log names which Xcode was measured.
  console.log(`developer directory: ${run('xcode-select', ['-p']).trim()}`);
  return verdict(xcodeProblems(text), 'the selected Xcode');
}

/** @param {string} app */
function checkBuiltApp(app) {
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
  for (const key of [
    'CFBundleIdentifier',
    'UIDeviceFamily',
    'MinimumOSVersion',
    'UIBackgroundModes',
    ...EXPECTED.usageDescriptions,
  ]) {
    console.log(`${key} = ${JSON.stringify(info[key])}`);
  }
  return verdict(builtAppProblems(info), `${app}/Info.plist`);
}

/** @param {string} app */
/** A line of the log with the seconds since this process started. */
const phase = (/** @type {string} */ what) =>
  console.log(`[${(performance.now() / 1000).toFixed(1)} s] ${what}`);

/**
 * The simulator to use, booted: the same choice every time on one machine, so
 * that the `boot` step early in the job and the `launch` step after the build
 * reach the same device.
 *
 * @returns {{ udid: string, name: string, runtime: string } | null}
 */
function bootSimulator() {
  const simulator = simulatorFor(
    JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])),
  );
  if (simulator === null) return null;
  phase(`simulator: ${simulator.name} (${simulator.runtime}) ${simulator.udid}`);
  // Booted already when the `boot` step ran, or on a developer's Mac; `boot`
  // reports that as an error, and it is not one here.
  const boot = spawnSync('xcrun', ['simctl', 'boot', simulator.udid], { encoding: 'utf8' });
  if (boot.status !== 0 && !String(boot.stderr).includes('current state: Booted')) {
    throw new Error(`xcrun simctl boot ${simulator.udid}: ${String(boot.stderr)}`);
  }
  phase('boot requested');
  return simulator;
}

/**
 * The job's `boot` step, before the install and the build: a runner's
 * simulator takes minutes to finish its first boot (about eight on run
 * 46165807873), and started here it finishes while the app is built.
 */
function checkBoot() {
  const simulator = bootSimulator();
  return verdict(
    simulator === null ? ['no available iPad simulator on any iOS runtime'] : [],
    'boot',
  );
}

/** @param {string} app */
async function checkLaunch(app) {
  const simulator = bootSimulator();
  if (simulator === null)
    return verdict(['no available iPad simulator on any iOS runtime'], 'launch');
  run('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);
  phase('booted');
  run('xcrun', ['simctl', 'install', simulator.udid, app]);
  phase('installed');
  const launched = run('xcrun', ['simctl', 'launch', simulator.udid, EXPECTED.bundleId]);
  phase(launched.trim());
  const pid = launchedPid(launched, EXPECTED.bundleId);
  if (pid === null) return verdict(['`simctl launch` printed no process id'], 'launch');
  await wait(STILL_RUNNING_AFTER_S * 1000);
  phase(`waited ${String(STILL_RUNNING_AFTER_S)} s`);
  const now = runningPid(
    run('xcrun', ['simctl', 'spawn', simulator.udid, 'launchctl', 'list']),
    EXPECTED.bundleId,
  );
  const problems =
    now === pid
      ? []
      : [
          `process ${String(pid)} is not running ${String(STILL_RUNNING_AFTER_S)} s after launch ` +
            `(launchctl shows ${now === null ? 'no process' : `process ${String(now)}`}): ` +
            'a crash at start-up, most often a missing Info.plist key or plugin',
        ];
  if (problems.length > 0) {
    const log = spawnSync(
      'xcrun',
      [
        'simctl',
        'spawn',
        simulator.udid,
        'log',
        'show',
        '--last',
        '2m',
        '--style',
        'compact',
        '--predicate',
        'process == "App"',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    console.error(String(log.stdout).split('\n').slice(-60).join('\n'));
  }
  return verdict(problems, `launch, ${String(STILL_RUNNING_AFTER_S)} s`);
}

async function main() {
  const [command, app] = process.argv.slice(2);
  if (command === 'xcode') return checkXcode();
  if (command === 'boot') return checkBoot();
  if ((command === 'built-app' || command === 'launch') && app !== undefined) {
    return command === 'built-app' ? checkBuiltApp(app) : checkLaunch(app);
  }
  console.error(
    'usage: node apps/mobile/tools/ios-ci.mjs xcode | boot | built-app <App.app> | launch <App.app>',
  );
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
