// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **There is exactly one place a ride pauses itself, and the camera feeds it
 * rather than being a second one** — #390.
 *
 * #390: *"The signal is advisory to the existing auto-pause logic, not a second
 * pauser. A test asserts there is exactly one place a ride is paused, and that
 * this feeds it. Two independent pausers is the shape that produces a ride
 * which pauses and resumes in a loop."*
 *
 * The one place is `packages/domain`'s recording engine: it pauses a ride
 * **automatically** when no reading has counted as movement for its interval.
 * `recorder.test.ts` §"#390" shows the camera's answer reaching it — the pause
 * that results is the engine's `automatic` one, backdated by the engine's own
 * rule. This file is the other half, and it is a source scan because the
 * defect it prevents is a line somebody adds rather than a value a test can
 * read: a `pause()` reached for from the presence side.
 *
 * The shape is `camera/boundary.test.ts`'s: strip comments, fail closed on a
 * walk that finds nothing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every non-test source file under `apps/web/src`, relative to it. */
function sources(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
        found.push(relative(SOURCE_ROOT, path));
      }
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

function code(path: string): string {
  return stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));
}

/** A call that pauses or resumes something — a recording, a session, a player. */
const PAUSES = /\.(?:pause|resume)\s*\(/;
/** The one thing that is not a ride: a `<video>` element, in the camera adapter. */
const MEDIA_PAUSE = /\bvideo\.pause\s*\(/g;

/** The presence vocabulary, as code rather than prose. */
const PRESENCE_NAMES =
  /\b(?:riderPresence|RiderPresence|presenceAwareMovement|watchPresence|throttlePresence)\b/;

describe('the scan itself', () => {
  it('finds source, and the presence code in it', () => {
    expect(sources().length).toBeGreaterThan(100);
    expect(sources().filter((path) => PRESENCE_NAMES.test(code(path))).length).toBeGreaterThan(3);
  });

  it('would fire on a pause reached for from the presence side', () => {
    expect(PAUSES.test('if (camera.riderPresence() === "absent") void controller.pause();')).toBe(
      true,
    );
  });
});

describe('the camera is advisory to the one auto-pause', () => {
  it('no file that speaks of presence pauses or resumes anything, the two that own a pause aside', () => {
    // The two exceptions are the files that already carry the RIDER's pause —
    // the controller's `pause()` and the recorder's, which delegates it — and
    // each is held line by line below instead.
    const owners = new Set([join('ride', 'controller.ts'), join('recording', 'recorder.ts')]);
    const findings = sources()
      .filter((path) => !owners.has(path))
      .filter((path) => PRESENCE_NAMES.test(code(path)))
      .filter((path) => PAUSES.test(code(path).replace(MEDIA_PAUSE, '')));
    expect(findings, 'a second pauser: presence code that pauses a ride itself').toStrictEqual([]);
  });

  it('the ride controller hands presence to its recorders and does nothing else with it', () => {
    // Every line of the controller that names presence, and what each may be.
    // A line that branched on the answer — `if (presence() === 'absent')` —
    // matches none of these and is a red test: the controller already HAS a
    // `pause()`, so it is the one file where a second pauser is one line away.
    const allowed = [
      /^import type \{ RiderPresence, RiderPresencePort \} from '\.\/presence-port';$/,
      /^readonly presence\?: RiderPresencePort \| undefined;$/,
      /^const port = options\.presence;$/,
      /^const presence = port === undefined \? undefined : \(\): RiderPresence => port\.riderPresence\(\);$/,
      /^const found = await recoverRecorder\(\{ store, athleteId, sessionId: id, presence \}\);$/,
      /^presence,$/,
    ];
    const lines = code(join('ride', 'controller.ts'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /presence/i.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(allowed.length);
    const unexpected = lines.filter((line) => !allowed.some((pattern) => pattern.test(line)));
    expect(unexpected).toStrictEqual([]);
  });

  it('the camera’s answer reaches the ride in exactly one place: the recorder’s movement predicate', () => {
    // Not global: a `/g` pattern's `test` keeps `lastIndex` between files.
    const CALL = /(?<!function )\bpresenceAwareMovement\s*\(/;
    const callers = sources().filter((path) => CALL.test(code(path)));
    expect(callers).toStrictEqual([join('recording', 'recorder.ts')]);
    // …and there, only as the default auto-pause's `isMoving`, and every
    // other line of the recorder that names presence only carries it there.
    const allowed = [
      /^presenceAwareMovement,$/,
      /^type RiderPresence,$/,
      /^readonly presence\?: \(\(\) => RiderPresence\) \| undefined;$/,
      /^function autoPauseOption\(options: Pick<RecorderOptions, 'autoPause' \| 'presence'>\): \{$/,
      /^options\.presence === undefined \? isMovingReading : presenceAwareMovement\(options\.presence\),$/,
    ];
    const recorder = code(join('recording', 'recorder.ts'));
    expect(recorder).toMatch(/isMoving:\s*\n?\s*options\.presence === undefined/);
    expect(recorder.match(new RegExp(CALL.source, 'g'))).toHaveLength(1);
    const unexpected = recorder
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /presence/i.test(line))
      .filter((line) => !allowed.some((pattern) => pattern.test(line)));
    expect(unexpected).toStrictEqual([]);
  });
});
