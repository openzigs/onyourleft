// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The gate under the privacy policy's first sentence**
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * [`docs/privacy-policy.md`](../../../../docs/privacy-policy.md) opens with
 * *"we collect nothing"*, and the Data Safety form filed on Google Play answers
 * "not collected" to every row. Both rest on one fact about the source: this
 * client contains no code that can send anything anywhere. A policy is a
 * promise; this is what makes it a property.
 *
 * Two suites, doing different jobs:
 *
 * - The **scan** cases fix what {@link networkCallsIn} counts, using fixtures.
 *   Without them the whole-tree case below could pass because the detector had
 *   stopped detecting — the "rule that cannot fire" shape, which this
 *   repository has shipped several times.
 * - The **whole-tree** case is the gate.
 *
 * ⚠️ **What it does NOT claim.** It scans the source this project writes, not
 * its dependencies: MapLibre requests map tiles when a basemap is configured,
 * which is the one outbound request the app can make and which the policy
 * discloses rather than omits. And a determined `globalThis['fet' + 'ch']`
 * would go unseen — this catches the change somebody makes without thinking
 * about the policy, which is the one that actually happens.
 *
 * ⚠️ **If this test ever goes red, the privacy policy is what needs changing**,
 * not the test. Phase 4's instance ([#7](https://github.com/openzigs/onyourleft/issues/7))
 * is exactly that moment.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The primitives that can move bytes off the device.
 *
 * ⚠️ Matched with a preceding boundary, so `prefetch(`, `refetch(` and a method
 * named `fetchRides(` are not hits — a scan that fired on those would be
 * silenced within a week, which is the failure mode a noisy rule has.
 */
const NETWORK_PRIMITIVES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'fetch', pattern: /(?<![\w.$])fetch\s*\(/g },
  { name: 'XMLHttpRequest', pattern: /(?<![\w.$])XMLHttpRequest\b/g },
  { name: 'WebSocket', pattern: /(?<![\w.$])WebSocket\b/g },
  { name: 'EventSource', pattern: /(?<![\w.$])EventSource\b/g },
  { name: 'sendBeacon', pattern: /\.sendBeacon\s*\(/g },
  { name: 'navigator.sendBeacon', pattern: /(?<![\w.$])navigator\s*\.\s*sendBeacon\b/g },
];

/** One place the client could transmit something. */
export interface NetworkFinding {
  readonly line: number;
  readonly primitive: string;
  readonly text: string;
}

/** Every network primitive in a source file, comments and imports aside. */
export function networkCallsIn(source: string): readonly NetworkFinding[] {
  const found: NetworkFinding[] = [];
  const lines = stripComments(source).split('\n');
  for (const [index, line] of lines.entries()) {
    for (const { name, pattern } of NETWORK_PRIMITIVES) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        found.push({ line: index + 1, primitive: name, text: line.trim() });
      }
    }
  }
  return found;
}

describe('the scan itself', () => {
  it('finds a bare fetch', () => {
    expect(networkCallsIn('const r = await fetch(url);')[0]?.primitive).toBe('fetch');
  });

  it('finds the older and the streaming ones', () => {
    expect(networkCallsIn('new XMLHttpRequest()')).toHaveLength(1);
    expect(networkCallsIn('const s = new WebSocket(url);')).toHaveLength(1);
    expect(networkCallsIn('new EventSource(url)')).toHaveLength(1);
    expect(networkCallsIn('navigator.sendBeacon(url, body);').length).toBeGreaterThan(0);
  });

  it('is not fooled by a comment that talks about one', () => {
    // This file, and `data-safety.ts`, both name these primitives in prose.
    expect(networkCallsIn('// we never call fetch( here\nconst x = 1;')).toEqual([]);
    expect(networkCallsIn('/* fetch( and WebSocket are forbidden */\nconst x = 1;')).toEqual([]);
  });

  it('does not fire on a name that merely ends in one', () => {
    expect(networkCallsIn('const rides = await store.fetchRides();')).toEqual([]);
    expect(networkCallsIn('prefetch(thing);')).toEqual([]);
  });
});

/** Every non-test source file in the client. */
function scannable(): readonly string[] {
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
      // A `.d.ts` declares somebody else's API rather than calling it.
      if (entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(path);
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

describe('the client', () => {
  it('has source to scan', () => {
    // The population, asserted. A walk that returned nothing would make the
    // case below pass over an empty list and report the strongest possible
    // privacy claim on no evidence at all.
    expect(scannable().length).toBeGreaterThan(100);
  });

  it('contains no call that could transmit an athlete’s data', () => {
    const findings: string[] = [];
    for (const file of scannable()) {
      for (const finding of networkCallsIn(readFileSync(file, 'utf8'))) {
        findings.push(
          `${relative(SOURCE_ROOT, file)}:${String(finding.line)} ${finding.primitive} — ${finding.text}`,
        );
      }
    }
    expect(
      findings,
      'docs/privacy-policy.md says this client transmits nothing; that is now false, and the policy and the Data Safety form are what must change',
    ).toEqual([]);
  });
});
