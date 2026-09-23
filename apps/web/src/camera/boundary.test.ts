// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No camera platform type escapes this directory, and there is exactly one
 * camera port and one consent module** (#382).
 *
 * Two rules in one file because both are source scans over the same walk, and
 * both exist for reasons `check:wiring` and the typechecker cannot cover:
 *
 * - **The escape rule** is `packages/sensors`': *"Web Bluetooth types must not
 *   escape above the transport boundary"*. A `MediaStream` reaching a view or a
 *   store is not a type error — it is a perfectly well-typed program that
 *   #383's Android path and #328's classifier can then never satisfy without
 *   the interface changing under them.
 * - **The uniqueness rule** is #377's epic criterion, and it is here because
 *   **`check:wiring` cannot catch a duplicate**: two wired modules are both
 *   wired, and a second camera port with a second consent flow would pass every
 *   gate in this repository while quietly giving the product two answers to
 *   "has the rider agreed to this".
 *
 * The shape is `units/no-inline-units.test.ts`'s: walk the source, strip
 * comments, and fail closed if the walk finds nothing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAMERA_DIRECTORY = 'camera';

/**
 * The names that may not appear outside `camera/`.
 *
 * ⚠️ **Matched with a word boundary and after comments are stripped**, so this
 * file's own prose — and `AppShell`'s, and the ADR references scattered through
 * the client — are not hits. A scan that fired on a comment would be silenced
 * within a week, which is the failure mode `privacy/no-network.test.ts`
 * §`NETWORK_PRIMITIVES` records for the same reason.
 */
const PLATFORM_CAMERA_NAMES: readonly RegExp[] = [
  /(?<![\w.$])MediaStream\b/,
  /(?<![\w.$])MediaStreamTrack\b/,
  /(?<![\w.$])HTMLVideoElement\b/,
  /(?<![\w.$])getUserMedia\b/,
  /(?<![\w.$])ImageCapture\b/,
  /(?<![\w.$])mediaDevices\b/,
];

/** Every non-test source file under `apps/web/src`, relative to it. */
function sources(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(relative(SOURCE_ROOT, path));
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/** Files inside `apps/web/src/camera/`. */
function inCamera(path: string): boolean {
  return path.split(/[/\\]/)[0] === CAMERA_DIRECTORY;
}

describe('the scan itself', () => {
  it('finds source to scan', () => {
    // The vacuous pass this whole file exists to avoid: a walk returning
    // nothing would report the strongest possible boundary claim on no
    // evidence at all.
    expect(sources().length).toBeGreaterThan(100);
    expect(sources().filter(inCamera).length).toBeGreaterThan(3);
  });

  it('would fire on a platform type in ordinary code', () => {
    const stripped = stripComments('const stream: MediaStream = start();');
    expect(PLATFORM_CAMERA_NAMES.some((pattern) => pattern.test(stripped))).toBe(true);
  });

  it('does not fire on a comment that names one', () => {
    const stripped = stripComments('// a MediaStream never leaves this module\nconst x = 1;');
    expect(PLATFORM_CAMERA_NAMES.some((pattern) => pattern.test(stripped))).toBe(false);
  });
});

describe('no camera platform type escapes apps/web/src/camera', () => {
  it('names none of them anywhere else in the client', () => {
    const findings: string[] = [];
    for (const path of sources()) {
      if (inCamera(path)) {
        continue;
      }
      // A test may legitimately need one; the rule is about what ships. The
      // one place it matters — `main.tsx` — is NOT a test and is checked.
      if (/\.test\.tsx?$/.test(path)) {
        continue;
      }
      const stripped = stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));
      for (const pattern of PLATFORM_CAMERA_NAMES) {
        if (pattern.test(stripped)) {
          findings.push(`${path} — ${pattern.source}`);
        }
      }
    }
    expect(
      findings,
      'a camera platform type has escaped apps/web/src/camera; #383’s Android path and #328’s ' +
        'classifier both have to be satisfiable by the same interface',
    ).toStrictEqual([]);
  });

  it('does not let the frame type itself escape either', () => {
    // `CapturedFrame` is opaque above this module (ADR 0029 D-1, and
    // `camera-port.ts`'s own note). A view or a store that named it would be
    // holding a picture, which is the thing Phase C decides and this issue
    // does not.
    const findings = sources()
      .filter((path) => !inCamera(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) =>
        /(?<![\w.$])CapturedFrame\b/.test(
          stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8')),
        ),
      );
    expect(findings).toStrictEqual([]);
  });
});

describe('there is exactly one camera port and one consent module', () => {
  it('has one *camera-port.ts', () => {
    const ports = sources().filter((path) => /camera-port\.ts$/.test(path));
    expect(ports, '#377’s epic criterion: ONE camera-capture pipeline').toStrictEqual([
      join(CAMERA_DIRECTORY, 'camera-port.ts'),
    ]);
  });

  it('has one consent module, and it is the camera’s', () => {
    const consents = sources().filter((path) => /(?:^|[/\\])consent\.ts$/.test(path));
    expect(consents, '#377’s epic criterion: ONE consent flow').toStrictEqual([
      join(CAMERA_DIRECTORY, 'consent.ts'),
    ]);
  });

  it('has one module that declares the consent wording', () => {
    // The duplicate that would actually happen is not a second file called
    // `consent.ts` — it is a second copy of the sentence, pasted into a view
    // because the import felt awkward. `consent.test.ts` pins the wording to
    // the ADR; this pins where it lives.
    const declaring = sources().filter((path) =>
      /BYSTANDER_SENTENCE\s*=/.test(stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'))),
    );
    expect(declaring).toStrictEqual([join(CAMERA_DIRECTORY, 'consent.ts')]);
  });
});
