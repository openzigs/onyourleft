// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one sentence the Android shell changes, and the far more important thing
 * it does not (#383).
 *
 * ⚠️ **The static-import assertion at the bottom is the half that matters.**
 * The wording is a nicety; a browser downloading Capacitor is a regression
 * every visitor pays for. `main.tsx` reaches `@onyourleft/mobile` only through
 * an `import()` behind `isNativeShell`, and CLAUDE.md §4h records how that was
 * measured (`grep -c BleClient` over the entry chunk returns 0) — a hand
 * measurement, which is exactly the kind that stops being run. This is the
 * durable half of it: no module the browser build renders may name
 * `@onyourleft/mobile` in a **static** import.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANDROID_CAMERA_DENIED } from '@onyourleft/mobile';

import { cameraNotice } from './notice';
import { shellCameraNotice } from './shell-camera';

describe('the shell’s wording', () => {
  it('replaces the refusal sentence with Android’s own', () => {
    const shell = shellCameraNotice('not-permitted', ANDROID_CAMERA_DENIED);
    expect(shell.instruction).toContain('Permissions');
    // And it really differs from the browser's, which is the whole reason the
    // module exists. If these two ever agree, delete the module rather than
    // keeping a seam that changes nothing.
    expect(shell.instruction).not.toBe(cameraNotice('not-permitted').instruction);
  });

  it('marks a refusal recoverable, because it is fixed outside the app', () => {
    expect(shellCameraNotice('not-permitted', ANDROID_CAMERA_DENIED).recoverable).toBe(true);
  });

  it('falls through to the shared table for every other state', () => {
    // Total over the union by delegation rather than by a second table: a
    // second copy of a sentence that did not need to differ is how two
    // platforms drift.
    for (const kind of ['unsupported', 'no-camera', 'unavailable', 'no-consent'] as const) {
      expect(shellCameraNotice(kind, ANDROID_CAMERA_DENIED), kind).toStrictEqual(
        cameraNotice(kind),
      );
    }
  });
});

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      if (entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(relative(SOURCE_ROOT, path));
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/**
 * A `import … from '@onyourleft/mobile'` that is **not** a dynamic `import(`.
 *
 * ⚠️ A **type-only** import is permitted and is not a hit: `import type` is
 * erased entirely by the compiler, so it puts nothing in any chunk.
 * `support/shell-support.ts` relies on exactly that to name
 * `PermissionNotice` without dragging Capacitor in.
 */
const STATIC_MOBILE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]@onyourleft\/mobile['"]/m;

describe('a browser downloads no line of Capacitor', () => {
  it('has source to scan', () => {
    // The vacuous pass: a walk returning nothing would report the strongest
    // possible claim about the entry chunk on no evidence at all.
    expect(sources().length).toBeGreaterThan(100);
  });

  it('would fire on a static import', () => {
    expect(
      STATIC_MOBILE_IMPORT.test("import { capacitorBlePort } from '@onyourleft/mobile';"),
    ).toBe(true);
  });

  it('does not fire on a dynamic one, or on a type-only one', () => {
    expect(STATIC_MOBILE_IMPORT.test("const mobile = await import('@onyourleft/mobile');")).toBe(
      false,
    );
    expect(
      STATIC_MOBILE_IMPORT.test("import type { PermissionNotice } from '@onyourleft/mobile';"),
    ).toBe(false);
  });

  it('names @onyourleft/mobile in no static import anywhere in the client', () => {
    const findings = sources().filter((path) =>
      STATIC_MOBILE_IMPORT.test(readFileSync(join(SOURCE_ROOT, path), 'utf8')),
    );
    expect(
      findings,
      'a static import of @onyourleft/mobile puts Capacitor in the entry chunk for every ' +
        'visitor, including the ones who will never run the shell',
    ).toStrictEqual([]);
  });
});
