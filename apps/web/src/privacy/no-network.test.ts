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
 * its dependencies: MapLibre requests map tiles when a map is on screen, which
 * is the one outbound request the app makes without being asked to and which
 * the policy discloses rather than omits. ⚠️ **Since #534 that request goes
 * somewhere by default** — `map/basemap.ts` §`PUBLISHED_BASEMAP_URL` — so the
 * disclosure is no longer only prose: §"the default basemap is disclosed" at
 * the foot of this file fails when that host moves and the policy and the Data
 * Safety declaration do not move with it. And a determined `globalThis['fet' + 'ch']`
 * would go unseen — this catches the change somebody makes without thinking
 * about the policy, which is the one that actually happens.
 *
 * ⚠️ **If this test ever goes red, the privacy policy is what needs changing**,
 * not the test. Phase 4's instance ([#7](https://github.com/openzigs/onyourleft/issues/7))
 * is exactly that moment.
 *
 * ## Since #387 it permits ONE call, in ONE module, and is red for any other
 *
 * [#387](https://github.com/openzigs/onyourleft/issues/387) was the first time
 * the answer to a red run was to change the policy **and** re-state the test,
 * and ADR 0029's 2026-09-23 amendment says how narrowly:
 *
 * > **No network except a local endpoint the rider configured and switched on.**
 *
 * and, of this file: *"a `fetch` outside the one module that owns the
 * configured endpoint must still fail the build, and the module that owns it
 * must still be a module somebody chose. […] A gate rewritten as 'no network
 * except where we do' is the vacuous pass this repository keeps finding."*
 *
 * So the rule is not "no network" any more and it is not "no network except
 * where we do" either. It is {@link PERMITTED_NETWORK_CALLS}: **one module,
 * one primitive, an exact count** — and every other primitive, in that module
 * or anywhere else, is a finding. {@link networkFindingsOutside} is the rule as
 * a pure function, and the "narrowed gate" cases run it over fixture trees so
 * that it is shown to go red for a `fetch` added elsewhere, for a second
 * `fetch` in the permitted module, for a different primitive there, and for
 * the permitted call vanishing — which would leave this gate describing a
 * module that no longer does what the policy says it does.
 *
 * `docs/privacy-policy.md` and `apps/mobile/src/android/data-safety.ts` changed
 * in the same pull request. The rider's computer is the RIDER's — not #7's
 * instance, which is ours and does not exist — and the policy says so by name.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { basemapOrigin, readBasemapConfig } from '../map/basemap';
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

/**
 * The ONE place this client may call a network primitive, and how many times.
 *
 * ⚠️ **A path and a count, not a directory and not a pattern.** A directory
 * would let a second file beside the transport send; a pattern would let a
 * rename widen it. Moving the transport is an edit here in the same commit,
 * which is the point: the module that sends is a module somebody chose.
 */
export const PERMITTED_NETWORK_CALLS: readonly {
  readonly module: string;
  readonly primitive: string;
  readonly count: number;
}[] = [{ module: join('camera', 'analysis-transport.ts'), primitive: 'fetch', count: 1 }];

/** One source file, by its path relative to `apps/web/src`. */
export interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

/**
 * Every network call the policy does not permit, as readable lines — empty
 * when the tree is exactly what {@link PERMITTED_NETWORK_CALLS} says.
 *
 * Three kinds of finding, and each is a different way for the policy to be
 * false:
 *
 * 1. **a primitive anywhere else** — a second way off the device;
 * 2. **a different primitive, or more of the permitted one, in the permitted
 *    module** — a second way off the device that happens to share a file;
 * 3. **fewer of the permitted one than stated** — the policy describes a
 *    request the code no longer makes, and this gate describes a module that
 *    is not there. ⚠️ Not a leak, and still red: a count that could fall to
 *    nought silently is how this list would outlive the thing it pins.
 */
export function networkFindingsOutside(
  files: readonly ScannedFile[],
  permitted: typeof PERMITTED_NETWORK_CALLS,
): readonly string[] {
  const findings: string[] = [];
  const counted = new Map<string, number>();
  for (const file of files) {
    for (const finding of networkCallsIn(file.source)) {
      const rule = permitted.find(
        (each) => each.module === file.path && each.primitive === finding.primitive,
      );
      if (rule === undefined) {
        findings.push(
          `${file.path}:${String(finding.line)} ${finding.primitive} — ${finding.text}`,
        );
        continue;
      }
      counted.set(file.path, (counted.get(file.path) ?? 0) + 1);
    }
  }
  for (const rule of permitted) {
    const seen = counted.get(rule.module) ?? 0;
    if (seen !== rule.count) {
      findings.push(
        `${rule.module} — ${String(seen)} ${rule.primitive} call(s) where the policy describes ${String(rule.count)}`,
      );
    }
  }
  return findings;
}

describe('the narrowed gate itself — #387', () => {
  const TRANSPORT = join('camera', 'analysis-transport.ts');
  const transport: ScannedFile = {
    path: TRANSPORT,
    source: 'const send = options.send ?? (async (url, init) => fetch(url, init));',
  };
  const quiet: ScannedFile = { path: join('views', 'CameraView.tsx'), source: 'const x = 1;' };

  it('is clean over a tree that is exactly what the policy describes', () => {
    expect(networkFindingsOutside([transport, quiet], PERMITTED_NETWORK_CALLS)).toEqual([]);
  });

  it('goes red for a fetch added anywhere else under apps/web/src', () => {
    // The fixture #387 asks for by name: the narrowed gate must still fire on
    // the change somebody makes without thinking about the policy.
    const elsewhere: ScannedFile = {
      path: join('views', 'CameraView.tsx'),
      source: "const r = await fetch('https://example.invalid/upload', { method: 'POST' });",
    };
    const findings = networkFindingsOutside([transport, elsewhere], PERMITTED_NETWORK_CALLS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(join('views', 'CameraView.tsx'));
  });

  it('goes red for a fetch in a file BESIDE the transport', () => {
    // A directory rule would have passed this; a path rule does not.
    const sibling: ScannedFile = {
      path: join('camera', 'analysis-helpers.ts'),
      source: 'void fetch(url);',
    };
    expect(networkFindingsOutside([transport, sibling], PERMITTED_NETWORK_CALLS)).toHaveLength(1);
  });

  it('goes red for a second fetch inside the permitted module', () => {
    const twice: ScannedFile = {
      path: TRANSPORT,
      source: `${transport.source}\nvoid fetch('https://example.invalid/telemetry');`,
    };
    expect(networkFindingsOutside([twice], PERMITTED_NETWORK_CALLS)).toHaveLength(1);
  });

  it('goes red for a different primitive inside the permitted module', () => {
    const socket: ScannedFile = {
      path: TRANSPORT,
      source: `${transport.source}\nconst s = new WebSocket(url);`,
    };
    const findings = networkFindingsOutside([socket], PERMITTED_NETWORK_CALLS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('WebSocket');
  });

  it('goes red when the permitted call is gone, so the list cannot outlive it', () => {
    const emptied: ScannedFile = { path: TRANSPORT, source: 'const send = options.send;' };
    const findings = networkFindingsOutside([emptied], PERMITTED_NETWORK_CALLS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('0 fetch');
  });
});

describe('the client', () => {
  it('has source to scan', () => {
    // The population, asserted. A walk that returned nothing would make the
    // case below pass over an empty list and report the strongest possible
    // privacy claim on no evidence at all.
    expect(scannable().length).toBeGreaterThan(100);
  });

  it('makes no network call but the one the policy describes', () => {
    const files = scannable().map((file) => ({
      path: relative(SOURCE_ROOT, file),
      source: readFileSync(file, 'utf8'),
    }));
    expect(
      networkFindingsOutside(files, PERMITTED_NETWORK_CALLS),
      'docs/privacy-policy.md says this client sends nothing except one picture to a computer the ' +
        'rider configured and switched on; that is now false, and the policy and the Data Safety ' +
        'form are what must change',
    ).toEqual([]);
  });
});

/**
 * ⚠️ **Since #406 this client contains exactly one thing that can reach a
 * network, and this is where it is written down.**
 *
 * `NETWORK_PRIMITIVES` above does not fire on a member call: its lookbehind
 * excludes a preceding `.`, so `store.fetchRides()` is not a hit and neither is
 * the service worker's `scope.fetch(event.request)`. That exclusion was right
 * when nothing in the client called `fetch` on anything; it is no longer the
 * whole story, and leaving it at that would have added a network call to this
 * program under a gate written to notice exactly that.
 *
 * So the worker's call is pinned rather than excused. What keeps the policy
 * true is **not** that the call is absent — it is that it can only ever reach
 * the origin the app itself was served from:
 *
 * - `worker-core.ts` §`decideFetch` returns `untouched` for every origin but
 *   the worker's own scope, and `untouched` means `respondWith` is never
 *   called, so the request is the page's and the worker never sees it;
 * - the only requests the worker *does* answer are the app's own precached
 *   assets and its own shell, and the fallback re-issues a request the page
 *   had already made;
 * - nothing about a ride, an athlete or a coordinate is in any of them.
 *
 * `worker-core.test.ts` §"does not touch a request to any other origin" is the
 * assertion; this is the accounting.
 */
describe('the service worker’s one network call', () => {
  /** A `fetch(` reached through an object, which the scan above deliberately skips. */
  const MEMBER_FETCH = /(?<=[\w$])\s*\.\s*fetch\s*\(/g;

  function memberFetchesIn(source: string): number {
    const stripped = stripComments(source);
    MEMBER_FETCH.lastIndex = 0;
    return [...stripped.matchAll(MEMBER_FETCH)].length;
  }

  it('is the only one in the whole client, and it is in the worker', () => {
    const elsewhere: string[] = [];
    let inTheWorker = 0;
    for (const file of scannable()) {
      const count = memberFetchesIn(readFileSync(file, 'utf8'));
      if (count === 0) {
        continue;
      }
      if (relative(SOURCE_ROOT, file) === join('offline', 'worker-core.ts')) {
        inTheWorker += count;
        continue;
      }
      elsewhere.push(`${relative(SOURCE_ROOT, file)} — ${String(count)}`);
    }
    expect(
      elsewhere,
      'a second place in this client can now reach a network; docs/privacy-policy.md and the Data Safety form are what must be re-read',
    ).toEqual([]);
    // Exactly one: the cache-miss fallback. A second inside the worker is as
    // much of a change to think about as one outside it, and the number going
    // to nought would mean the fallback was deleted and this whole block is
    // describing something that is not there.
    expect(inTheWorker).toBe(1);
  });
});

/**
 * **The one host the shipped app contacts without being asked to** (#534).
 *
 * Until #534 no build configured a basemap, so the policy could say "no tile
 * host is configured in this build" and be true. Now every build that is not
 * told otherwise draws `map/basemap.ts` §`PUBLISHED_BASEMAP_URL`, and a rider
 * who opens a ride with a GPS track asks that host for tiles covering roughly
 * where they rode. MapLibre makes the request, so the scan above cannot see
 * it; this is what ties the disclosure to the constant instead.
 *
 * ⚠️ **It reads the host out of the code, never a copy of it.** A test that
 * wrote `tiles.openzigs.com` here would go on passing after the default moved
 * to a host the policy has never named, which is the failure it exists for.
 *
 * ⚠️ **The declaration is PARSED, not searched** (#535's review). A search of
 * the whole file was satisfied by the comment above the Location row naming
 * the host, even with the `why` string — the part that corresponds to what is
 * filed on Play — no longer naming it. So `data-safety.ts` is parsed with the
 * TypeScript compiler's own parser and the host is looked for in the Location
 * row's `why` string alone; a comment is not in the tree that is read. The
 * policy is still read as a whole file, because prose is the only place a
 * policy can name a host.
 *
 * ⚠️ **What it cannot check** is that the words around the host are true. It
 * says the policy and the declaration NAME the host; whether the declaration's
 * answer is right is a filing decision, argued in `data-safety.ts`'s Location
 * row and made by a person.
 */
describe('the default basemap is disclosed — #534', () => {
  const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  const unset = readBasemapConfig({});

  it('exists, so there is a host to disclose', () => {
    // Without this the two cases below would pass over `undefined` the day the
    // default was removed, and say nothing about a build that contacts nobody.
    expect(unset).toBeDefined();
  });

  const host = unset === undefined ? '' : new URL(basemapOrigin(unset)).host;

  it('is named in docs/privacy-policy.md', () => {
    expect(host).not.toBe('');
    expect(
      readFileSync(join(REPOSITORY_ROOT, 'docs', 'privacy-policy.md'), 'utf8'),
      `the shipped app requests map tiles from ${host} by default, and the privacy policy does not say so`,
    ).toContain(host);
  });

  it('is named in the Location row’s `why` in apps/mobile/src/android/data-safety.ts', () => {
    expect(host).not.toBe('');
    const path = join(REPOSITORY_ROOT, 'apps', 'mobile', 'src', 'android', 'data-safety.ts');
    const why = locationWhy(readFileSync(path, 'utf8'));
    // Found at all, or a renamed field would make this pass over nothing.
    expect(why, 'no Location row with a string `why` was found in data-safety.ts').toBeDefined();
    expect(
      why,
      `the shipped app requests map tiles from ${host} by default, and the Location answer does not say so`,
    ).toContain(host);
  });

  it('is not satisfied by a comment — the parse sees the `why` string and nothing else', () => {
    // The review's finding, as a fixture: the host in a comment above the row,
    // and a `why` that does not name it. A whole-file search passes this.
    const fixture = [
      'export const DATA_SAFETY_DECLARATION = [',
      '  {',
      `    // tiles come from ${host}`,
      "    dataType: 'Location (approximate or precise)',",
      '    collected: false,',
      "    why: 'nothing leaves the device',",
      '  },',
      '];',
    ].join('\n');
    expect(fixture).toContain(host);
    expect(locationWhy(fixture)).toBe('nothing leaves the device');
  });
});

/**
 * The `why` string of the declaration's Location row, read from the parsed
 * source — the object literal whose `dataType` starts with `Location` — or
 * `undefined` when there is no such row or its `why` is not a plain string.
 */
function locationWhy(source: string): string | undefined {
  const file = ts.createSourceFile('data-safety.ts', source, ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  const text = (node: ts.Node | undefined): string | undefined =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const property = (name: string): ts.Expression | undefined => {
        for (const member of node.properties) {
          if (
            ts.isPropertyAssignment(member) &&
            ts.isIdentifier(member.name) &&
            member.name.text === name
          ) {
            return member.initializer;
          }
        }
        return undefined;
      };
      if (text(property('dataType'))?.startsWith('Location') === true) {
        found = text(property('why'));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
