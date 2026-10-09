// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing registers `oyl-instance:` as a URL the operating system may hand
 * the app** — #1190, ADR 0047 D-6.
 *
 * The card's prefix is a label inside a string the rider scans or pastes on
 * the screen that asks for it. Any app may claim a custom scheme, so a
 * registered one would let another app intercept a card, or hand this one a
 * card nobody showed the rider. This reads the three places a handler could
 * be declared — the Android manifest, the web app manifest and the Capacitor
 * config — and fails on any URL handler at all, so a new scheme is a decision
 * someone makes here rather than a line that slips in. Since #1207 it also
 * reads the SOURCE the app ships, for the two ways code could register one at
 * run time: `navigator.registerProtocolHandler`, and a listener for
 * Capacitor's `appUrlOpen`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const file = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const ANDROID_MANIFEST = file('../../../mobile/android/app/src/main/AndroidManifest.xml');
const WEB_MANIFEST = file('../../public/manifest.webmanifest');
const CAPACITOR_CONFIG = file('../../../mobile/capacitor.config.ts');

/** The directories whose code ships: the web client, the shell's TypeScript and its Java. */
const SHIPPED_SOURCE = [
  '../',
  '../../../mobile/src/',
  '../../../mobile/android/app/src/main/java/',
];

/** Every non-test source file under `relative`, as [path, text]. */
function sourceFiles(relative: string): (readonly [string, string])[] {
  const root = fileURLToPath(new URL(relative, import.meta.url));
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:tsx?|jsx?|mjs|java|kt)$/.test(name))
    .filter((name) => !/\.test\.|-testing\.|[/\\]testing[/\\.]/.test(name))
    .map((name) => [name, readFileSync(join(root, name), 'utf8')] as const);
}

describe('no URL handler for oyl-instance: (#1190, ADR 0047 D-6)', () => {
  it('reads three non-empty files, so a moved file is a red test rather than a pass', () => {
    expect(ANDROID_MANIFEST).toContain('<manifest');
    expect(WEB_MANIFEST).toContain('"name"');
    expect(CAPACITOR_CONFIG).toContain('webDir');
  });

  it('the Android manifest declares no scheme, host or VIEW intent', () => {
    expect(ANDROID_MANIFEST).not.toMatch(/oyl-instance/i);
    expect(ANDROID_MANIFEST).not.toMatch(/android:scheme/);
    expect(ANDROID_MANIFEST).not.toMatch(/android\.intent\.action\.VIEW/);
    expect(ANDROID_MANIFEST).not.toMatch(/android\.intent\.category\.BROWSABLE/);
  });

  it('the web app manifest declares no protocol handler', () => {
    const manifest = JSON.parse(WEB_MANIFEST) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty('protocol_handlers');
    expect(WEB_MANIFEST).not.toMatch(/oyl-instance/i);
  });

  it('no shipped source registers a protocol handler or listens for appUrlOpen (#1207)', () => {
    const files = SHIPPED_SOURCE.flatMap(sourceFiles);
    // Read something from each place, so a moved directory is red, not a pass.
    for (const where of ['main.tsx', '.ts', '.java']) {
      expect(
        files.some(([name]) => name.endsWith(where)),
        where,
      ).toBe(true);
    }
    const found = files
      .filter(([, text]) => /registerProtocolHandler|appUrlOpen/.test(text))
      .map(([name]) => name);
    expect(found).toEqual([]);
  });

  it('the Capacitor config registers no scheme of its own for a card', () => {
    expect(CAPACITOR_CONFIG).not.toMatch(/oyl-instance/i);
    expect(CAPACITOR_CONFIG).not.toMatch(/appUrlOpen|deepLink|customUrlScheme/i);
  });
});
