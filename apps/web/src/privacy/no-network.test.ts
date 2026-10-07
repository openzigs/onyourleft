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
 * ⚠️ **That opening sentence is history, and a reviewer who remembers it is
 * reading the old policy**: #387 made the Photos row collected, and #558 made
 * approximate location collected, because the map tile host's analytics keep
 * each request's IP address where this project's account can see it for up to
 * 7 days. §"the default basemap is disclosed" and
 * §"nothing claims the tile host keeps nothing" at the foot of this file are
 * what hold the policy and the form to that.
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
 *
 * ## Since #529 it sees WebRTC, and permits one peer connection
 *
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-9 recorded that
 * this scan did not match `RTCPeerConnection`, so a peer connection anywhere
 * in the client — pointed at a public STUN server — passed the gate under the
 * policy's first sentence. #529 did D-9's three steps in order: the scan
 * learned the primitive (and its prefixed spelling, and the `globalThis.`
 * spelling every other row deliberately skips), {@link PERMITTED_NETWORK_CALLS}
 * gained exactly one entry with the same three fixtures as #387's, and the
 * configuration the scan cannot see is asserted in
 * `camera/side-link-transport.test.ts`.
 *
 * ## What a text scan cannot see (#922)
 *
 * It reads spellings, line by line, and a spelling is not a value. These
 * ways of reaching a primitive pass it, and are written down here rather
 * than chased with patterns that would each find the next one:
 *
 * - **An alias.** `const g = globalThis; g.fetch(u)`, or `const { WebSocket:
 *   W } = window; new W(u)` — the name reaches the primitive through a
 *   binding the scan does not follow. (The destructuring form names
 *   `WebSocket` and is found; renaming the binding afterwards is not.)
 * - **A computed name.** `Reflect.get(globalThis, name)`, or
 *   `globalThis['fe' + 'tch']`, with the name built at run time: there is no
 *   spelling of the primitive in the source at all.
 * - **A primitive handed in.** A module given `fetch` as a parameter calls
 *   whatever it was given; the gate holds the module that HANDS it over, and
 *   that is where the one permitted `fetch` lives.
 *
 * - **Other spellings of a literal key** (#928's second review): a
 *   parenthesised object, `(globalThis)['fetch'](u)`; a method of the
 *   primitive, `window['fetch'].call(window, u)`; a key taken into a binding,
 *   `const f = globalThis['fetch']`; a comment between the key and the
 *   call's parenthesis; and anything split across lines, which a
 *   line-by-line scan cannot see. And one false positive, from the name's
 *   leading boundary: `obj.self['WebSocket']` and `foo.window['fetch'](u)`
 *   match, though neither is the global object.
 *
 * What IS matched: the bare name; the name through `globalThis`, `window` or
 * `self` with `.` or `?.` (#782's review, #922); the same through a cast,
 * `(globalThis as any).WebSocket` (#922); a call through `?.(` (#922); and a
 * literal key, `globalThis['fetch'](u)` or `window?.["WebSocket"]` (#928's
 * review).
 * A review of any module that reaches the global object by another road is
 * the gate for the rest.
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
 * The global object, reached as a name — `globalThis`, `window`, `self` — or
 * as that name cast, `(globalThis as any)`, and then a member access, `.` or
 * `?.`. #922 added the optional chain and the cast: `globalThis?.WebSocket`,
 * `window?.fetch(` and `(globalThis as any).WebSocket` all passed the gate.
 */
const GLOBAL_OBJECT = String.raw`(?:(?<![\w$])(?:globalThis|window|self)|\(\s*(?:globalThis|window|self)\s+as\s+[^()]*\))`;
const VIA_GLOBAL = String.raw`${GLOBAL_OBJECT}\s*\??\.\s*`;

/**
 * The global object's member by a LITERAL key: `globalThis['fetch']`,
 * `window?.["WebSocket"]`, `` self[`EventSource`] `` (#928's review). A
 * literal is a spelling; a key built at run time is not, and is a limit.
 */
function viaGlobalKey(name: string): string {
  return String.raw`${GLOBAL_OBJECT}\s*(?:\?\.\s*)?\[\s*(?:'${name}'|"${name}"|\`${name}\`)\s*\]`;
}

/** A call's opening parenthesis, directly or through an optional call, `?.(`. */
const CALLED = String.raw`\s*(?:\?\.\s*)?\(`;

/**
 * A primitive's row: its bare name, or the name reached through the global
 * object, by a member access or a literal key. `keyTail` follows the key's
 * `]`, where a word boundary could never match.
 */
function primitive(name: string, tail: string, keyTail = ''): RegExp {
  return new RegExp(
    String.raw`(?<![\w.$])${name}${tail}|${VIA_GLOBAL}${name}${tail}|${viaGlobalKey(name)}${keyTail}`,
    'g',
  );
}

/**
 * The primitives that can move bytes off the device.
 *
 * ⚠️ Matched with a preceding boundary, so `prefetch(`, `refetch(` and a method
 * named `fetchRides(` are not hits — a scan that fired on those would be
 * silenced within a week, which is the failure mode a noisy rule has.
 */
const NETWORK_PRIMITIVES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  // ⚠️ Each of these four is TWO spellings in one row, since #782's review
  // (B2): the bare name, with `.` in the lookbehind so `store.fetchRides(` and
  // `scope.fetch = …` stay quiet, OR the name reached through the global
  // object — `globalThis.`, `window.` or `self.`, and since #922 through `?.`
  // and a cast ({@link VIA_GLOBAL}) — which that lookbehind used to skip, so
  // `new globalThis.WebSocket(u)` anywhere in the client passed the gate. One
  // row per primitive rather than a second row, so a line naming both
  // spellings is one finding and the module-and-primitive count below is not
  // doubled. #529 closed the same hole for `RTCPeerConnection`.
  { name: 'fetch', pattern: primitive('fetch', CALLED, CALLED) },
  { name: 'XMLHttpRequest', pattern: primitive('XMLHttpRequest', String.raw`\b`) },
  { name: 'WebSocket', pattern: primitive('WebSocket', String.raw`\b`) },
  { name: 'EventSource', pattern: primitive('EventSource', String.raw`\b`) },
  { name: 'sendBeacon', pattern: /\.sendBeacon\s*\(/g },
  { name: 'navigator.sendBeacon', pattern: /(?<![\w.$])navigator\s*\.\s*sendBeacon\b/g },
  // #529, ADR 0033 D-9 step 1. ⚠️ **No `.` in the lookbehind, unlike every
  // row above**: `globalThis.RTCPeerConnection` is how a constructor this
  // client does not import is reached, and a scan that skipped it would be
  // blind to the one spelling the side-camera link actually uses. The prefixed
  // one is its own row because `webkitRTCPeerConnection` ends in the other
  // name after a word character, which the first pattern refuses to match.
  { name: 'RTCPeerConnection', pattern: /(?<![\w$])RTCPeerConnection\b/g },
  { name: 'webkitRTCPeerConnection', pattern: /(?<![\w$])webkitRTCPeerConnection\b/g },
  // #553. Capacitor's native HTTP, which sends from OUTSIDE the WebView and so
  // outside every rule the WebView applies — mixed content included. No `.` in
  // the lookbehind, for the WebRTC rows' reason: `Capacitor.Plugins.CapacitorHttp`
  // is a spelling, and so is the plugin's name as a string.
  { name: 'CapacitorHttp', pattern: /(?<![\w$])CapacitorHttp\b/g },
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

  it('finds a primitive through an optional chain or a cast of the global object — #922', () => {
    // Each of these passed the gate before #922.
    for (const [line, primitive] of [
      ['const Socket = globalThis?.WebSocket;', 'WebSocket'],
      ['await window?.fetch(url);', 'fetch'],
      ['new (globalThis as any).WebSocket(url)', 'WebSocket'],
      ['(window as unknown as { fetch: F }).fetch(url)', 'fetch'],
      ['const r = await self?.fetch?.(url);', 'fetch'],
      ['const r = await fetch?.(url);', 'fetch'],
      ['new (globalThis as Window).EventSource(url)', 'EventSource'],
      ['new window?.XMLHttpRequest()', 'XMLHttpRequest'],
      // A literal key (#928's review).
      ["await globalThis['fetch'](url);", 'fetch'],
      ['new window["WebSocket"](url)', 'WebSocket'],
      ['const S = self?.[`EventSource`];', 'EventSource'],
      ["new (globalThis as any)[ 'XMLHttpRequest' ]()", 'XMLHttpRequest'],
    ] as const) {
      expect(
        networkCallsIn(line).map((found) => found.primitive),
        line,
      ).toEqual([primitive]);
    }
    // Still quiet: a member of something that is not the global object, and a cast of one.
    for (const line of [
      'store?.fetchRides(x)',
      'client?.fetch(url)',
      '(scope as Worker).fetchAll()',
      'const prefetch = (x) => x;',
      "cache['fetch'](url)",
      "globalThis['fetchRides'](x)",
    ]) {
      expect(networkCallsIn(line), line).toEqual([]);
    }
  });

  it('finds a WebRTC peer connection, however it is reached — #529, ADR 0033 D-9', () => {
    // The finding D-9 reported: before #529 every one of these passed the gate.
    expect(networkCallsIn('const peer = new RTCPeerConnection({ iceServers: [] });')).toEqual([
      expect.objectContaining({ primitive: 'RTCPeerConnection' }),
    ]);
    expect(networkCallsIn('const Peer = globalThis.RTCPeerConnection;')[0]?.primitive).toBe(
      'RTCPeerConnection',
    );
    expect(networkCallsIn('const Peer = window.RTCPeerConnection;')[0]?.primitive).toBe(
      'RTCPeerConnection',
    );
    expect(networkCallsIn('new webkitRTCPeerConnection(config)')).toEqual([
      expect.objectContaining({ primitive: 'webkitRTCPeerConnection' }),
    ]);
  });

  it('finds Capacitor’s native HTTP, however it is reached — #553', () => {
    expect(networkCallsIn("import { CapacitorHttp } from '@capacitor/core';")).toHaveLength(1);
    expect(networkCallsIn('await Capacitor.Plugins.CapacitorHttp.request(o);')).toHaveLength(1);
    expect(networkCallsIn("registerPlugin('CapacitorHttp')")).toHaveLength(1);
    expect(networkCallsIn('const MyCapacitorHttpish = 1;')).toEqual([]);
  });

  it('finds the four reached through the global object, one finding a line — #782 review (B2)', () => {
    // Before #782's review every one of these passed the gate: the lookbehind
    // that keeps `store.fetchRides(` quiet skipped `globalThis.` too.
    for (const [source, primitive] of [
      ['const s = new globalThis.WebSocket(u);', 'WebSocket'],
      ['const s = new window.WebSocket(u);', 'WebSocket'],
      ['const s = new self . WebSocket(u);', 'WebSocket'],
      ['void globalThis.fetch(url);', 'fetch'],
      ['void window.fetch(url, init);', 'fetch'],
      ['void self.fetch(url);', 'fetch'],
      ['const e = new globalThis.EventSource(url);', 'EventSource'],
      ['const e = new window.EventSource(url);', 'EventSource'],
      ['const x = new globalThis.XMLHttpRequest();', 'XMLHttpRequest'],
      ['const x = new window.XMLHttpRequest();', 'XMLHttpRequest'],
    ] as const) {
      expect(networkCallsIn(source), source).toEqual([expect.objectContaining({ primitive })]);
    }
    // Both spellings on one line are one finding, not two.
    expect(networkCallsIn('const S = globalThis.WebSocket ?? WebSocket;')).toHaveLength(1);
    // And a member of something else is still not one.
    expect(networkCallsIn('const rides = await myself.fetchRides();')).toEqual([]);
    expect(networkCallsIn('scope.fetch = narrowed;')).toEqual([]);
    expect(networkCallsIn('const w = mywindow.WebSocket;')).toEqual([]);
  });

  it('does not fire on a name that merely contains one', () => {
    expect(networkCallsIn('const sideRTCPeerConnectionish = 1;')).toEqual([]);
    expect(networkCallsIn('interface MyRTCPeerConnectionLike {}')).toEqual([]);
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
}[] = [
  // ⚠️ Still ONE since #802: the ride analysis's text steps to the rider's own
  // computer (`ride-analysis/own-computer-step.ts`) are handed this same call
  // by `analysis-transport.ts` §`riderModelStepPort`, rather than a second.
  { module: join('camera', 'analysis-transport.ts'), primitive: 'fetch', count: 1 },
  // #529, ADR 0033 D-9 step 2: the side-camera link, and exactly one naming of
  // the constructor. What it is pointed at — no ICE server of any kind — is
  // not something this scan can see; `camera/side-link-transport.test.ts` is
  // where that is asserted (D-9 step 3).
  { module: join('camera', 'side-link-transport.ts'), primitive: 'RTCPeerConnection', count: 1 },
  // #530. ⚠️ **Not a call — a fence, pinned here so it cannot vanish.** The
  // pose worker's `XMLHttpRequest` is NARROWED to this app's own origin by
  // `camera/pose-fence.ts`, which has to name it to reach its prototype; the
  // worker's `fetch` is narrowed the same way, through a member spelling this
  // scan does not match. §"the pose worker's network fence" below says why a
  // dependency needs fencing at all. An exact count, so deleting the fence
  // is a red run here as well as in `browser/pose.browser.spec.ts`.
  { module: join('camera', 'pose-fence.ts'), primitive: 'XMLHttpRequest', count: 1 },
  // #518, ADR 0029's 2026-09-28 amendment: the hosted model on the rider's own
  // key — a question and never a picture — which the privacy policy names as
  // its second exception. Its own module, so that `camera/hosted-transport.test.ts`
  // can read off the imports that it cannot name a picture.
  { module: join('camera', 'hosted-transport.ts'), primitive: 'fetch', count: 1 },
  // #777, ADR 0036 D-3 (a): the ONE module permitted for instance traffic —
  // signing in, reading the session, the instance's name and source, the
  // device list, and signing out. A room's socket (#782) is opened through
  // this module, and that is a change to this entry, never a second module.
  // What leaves is argued in the module's header and walked for a coordinate
  // by `privacy/boundaries.test.ts`; `docs/privacy-policy.md` names it.
  { module: join('instance', 'instance-transport.ts'), primitive: 'fetch', count: 1 },
  // #782: a room's socket, opened THROUGH that same module (its
  // §`instanceRoomSocket`) — a second primitive in the one instance module,
  // never a second module. ADR 0036 D-3 (a) admits one module for instance
  // traffic, and this list now pins exactly one `fetch` AND exactly one
  // `WebSocket` to it: a WebSocket anywhere else in the client, a second one
  // here, or this one gone, is a red run (the fixtures below, "#782").
  { module: join('instance', 'instance-transport.ts'), primitive: 'WebSocket', count: 1 },
];

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
      // ⚠️ Keyed by the module AND the primitive since #782, when one module
      // was first permitted two: keyed by the module alone, its one `fetch`
      // and its one `WebSocket` summed to two and each rule read "2 where the
      // policy describes 1".
      const key = `${file.path}\u0000${finding.primitive}`;
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
  }
  for (const rule of permitted) {
    const seen = counted.get(`${rule.module}\u0000${rule.primitive}`) ?? 0;
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
  const LINK = join('camera', 'side-link-transport.ts');
  const link: ScannedFile = {
    path: LINK,
    source: 'const Peer = globalThis.RTCPeerConnection;',
  };
  const FENCE = join('camera', 'pose-fence.ts');
  const fence: ScannedFile = {
    path: FENCE,
    source: 'const scope = globalThis as unknown as { readonly XMLHttpRequest?: unknown };',
  };
  const HOSTED = join('camera', 'hosted-transport.ts');
  const hosted: ScannedFile = {
    path: HOSTED,
    source: 'const send: HostedSend = options.send ?? (async (url, init) => fetch(url, init));',
  };
  const INSTANCE = join('instance', 'instance-transport.ts');
  const instance: ScannedFile = {
    path: INSTANCE,
    source:
      'const sender: InstanceSend = send ?? (async (url, init) => fetch(url, init));\n' +
      'const platformSocket = (url, events) => { const socket = new WebSocket(url); return socket; };',
  };
  const quiet: ScannedFile = { path: join('views', 'CameraView.tsx'), source: 'const x = 1;' };

  it('is clean over a tree that is exactly what the policy describes', () => {
    expect(
      networkFindingsOutside(
        [instance, hosted, transport, link, quiet, fence],
        PERMITTED_NETWORK_CALLS,
      ),
    ).toEqual([]);
  });

  it('goes red for a fetch added anywhere else under apps/web/src', () => {
    // The fixture #387 asks for by name: the narrowed gate must still fire on
    // the change somebody makes without thinking about the policy.
    const elsewhere: ScannedFile = {
      path: join('views', 'CameraView.tsx'),
      source: "const r = await fetch('https://example.invalid/upload', { method: 'POST' });",
    };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, link, elsewhere, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(join('views', 'CameraView.tsx'));
  });

  it('goes red for a fetch in a file BESIDE the transport', () => {
    // A directory rule would have passed this; a path rule does not.
    const sibling: ScannedFile = {
      path: join('camera', 'analysis-helpers.ts'),
      source: 'void fetch(url);',
    };
    expect(
      networkFindingsOutside(
        [instance, hosted, transport, link, sibling, fence],
        PERMITTED_NETWORK_CALLS,
      ),
    ).toHaveLength(1);
  });

  it('goes red for a second fetch inside the permitted module', () => {
    const twice: ScannedFile = {
      path: TRANSPORT,
      source: `${transport.source}\nvoid fetch('https://example.invalid/telemetry');`,
    };
    expect(
      networkFindingsOutside([instance, hosted, twice, link, fence], PERMITTED_NETWORK_CALLS),
    ).toHaveLength(1);
  });

  it('goes red for a different primitive inside the permitted module', () => {
    const socket: ScannedFile = {
      path: TRANSPORT,
      source: `${transport.source}\nconst s = new WebSocket(url);`,
    };
    const findings = networkFindingsOutside(
      [instance, hosted, socket, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('WebSocket');
  });

  it('goes red when the permitted call is gone, so the list cannot outlive it', () => {
    const emptied: ScannedFile = { path: TRANSPORT, source: 'const send = options.send;' };
    const findings = networkFindingsOutside(
      [instance, hosted, emptied, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('0 fetch');
  });

  // ADR 0033 D-9 step 2: the three fixtures above, each with a WebRTC
  // counterpart.
  it('goes red for a second peer connection inside the side-link module', () => {
    const twice: ScannedFile = {
      path: LINK,
      source: `${link.source}\nconst another = new RTCPeerConnection(config);`,
    };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, twice, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('2 RTCPeerConnection');
  });

  it('goes red for a different primitive inside the side-link module', () => {
    const fetched: ScannedFile = {
      path: LINK,
      source: `${link.source}\nvoid fetch('https://stun.example.invalid');`,
    };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, fetched, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('fetch');
  });

  it('goes red for a peer connection anywhere else, the prefixed one included', () => {
    const elsewhere: ScannedFile = {
      path: join('camera', 'side-link.ts'),
      source: 'const peer = new webkitRTCPeerConnection({});',
    };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, link, elsewhere, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('webkitRTCPeerConnection');
  });

  // #530: the pose worker's fence, pinned like a call so that deleting it is
  // a red run.
  it('goes red when the pose worker’s fence is gone', () => {
    const findings = networkFindingsOutside(
      [instance, hosted, transport, link],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('0 XMLHttpRequest');
  });

  it('goes red for an XMLHttpRequest anywhere but the fence', () => {
    const elsewhere: ScannedFile = {
      path: join('camera', 'pose-worker.ts'),
      source: 'const request = new XMLHttpRequest();',
    };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, link, fence, elsewhere],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(join('camera', 'pose-worker.ts'));
  });

  // #518: the hosted transport's three, as #387's.
  it('goes red for a second fetch inside the hosted transport', () => {
    const twice: ScannedFile = {
      path: HOSTED,
      source: `${hosted.source}\nvoid fetch('https://example.invalid/telemetry');`,
    };
    const findings = networkFindingsOutside(
      [instance, transport, link, fence, twice],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('2 fetch');
  });

  it('goes red for a different primitive inside the hosted transport', () => {
    const socket: ScannedFile = {
      path: HOSTED,
      source: `${hosted.source}\nconst s = new WebSocket(url);`,
    };
    const findings = networkFindingsOutside(
      [instance, transport, link, fence, socket],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('WebSocket');
  });

  it('goes red when the hosted transport’s fetch is gone', () => {
    const emptied: ScannedFile = { path: HOSTED, source: 'const send = options.send;' };
    const findings = networkFindingsOutside(
      [instance, transport, link, fence, emptied],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(HOSTED);
    expect(findings[0]).toContain('0 fetch');
  });

  it('goes red when the side link’s peer connection is gone', () => {
    const emptied: ScannedFile = { path: LINK, source: 'const Peer = undefined;' };
    const findings = networkFindingsOutside(
      [instance, hosted, transport, emptied, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('0 RTCPeerConnection');
  });

  // #777, ADR 0036 D-3 (a): the instance transport's three, as #387's — the
  // ONE module permitted for instance traffic.
  it('goes red for a second fetch inside the instance transport', () => {
    const twice: ScannedFile = {
      path: INSTANCE,
      source: `${instance.source}\nvoid fetch('https://example.invalid/telemetry');`,
    };
    const findings = networkFindingsOutside(
      [twice, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('2 fetch');
  });

  it('goes red for a different primitive inside the instance transport', () => {
    const source: ScannedFile = {
      path: INSTANCE,
      source: `${instance.source}\nconst s = new EventSource('https://ride.example/v1/events');`,
    };
    const findings = networkFindingsOutside(
      [source, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('EventSource');
  });

  // #782: the room's socket, pinned like the fetch beside it — ONE module for
  // instance traffic (ADR 0036 D-3 (a)), and in it exactly one WebSocket.
  it('goes red for a second WebSocket inside the instance transport — #782', () => {
    const twice: ScannedFile = {
      path: INSTANCE,
      source: `${instance.source}\nconst s = new WebSocket('wss://ride.example/elsewhere');`,
    };
    const findings = networkFindingsOutside(
      [twice, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toEqual([expect.stringContaining('2 WebSocket')]);
  });

  it('goes red for a WebSocket anywhere else, the room code included — #782', () => {
    for (const path of [
      join('net', 'room-port.ts'),
      join('net', 'room-session.ts'),
      join('instance', 'instance-port.ts'),
      join('game', 'GameView.tsx'),
    ]) {
      const elsewhere: ScannedFile = { path, source: 'const socket = new WebSocket(url);' };
      const findings = networkFindingsOutside(
        [instance, elsewhere, hosted, transport, link, fence],
        PERMITTED_NETWORK_CALLS,
      );
      expect(findings, path).toEqual([expect.stringContaining(path)]);
    }
  });

  it('goes red for a WebSocket reached through the global object in the room code — #782 review (B2)', () => {
    for (const source of [
      'const socket = new globalThis.WebSocket(url);',
      'const socket = new window.WebSocket(url);',
      'void globalThis.fetch(url);',
    ]) {
      const path = join('net', 'room-port.ts');
      const elsewhere: ScannedFile = { path, source };
      const findings = networkFindingsOutside(
        [instance, elsewhere, hosted, transport, link, fence],
        PERMITTED_NETWORK_CALLS,
      );
      expect(findings, source).toEqual([expect.stringContaining(path)]);
    }
  });

  it('goes red when the instance transport’s WebSocket is gone — #782', () => {
    const emptied: ScannedFile = {
      path: INSTANCE,
      source: 'const sender: InstanceSend = send ?? (async (url, init) => fetch(url, init));',
    };
    const findings = networkFindingsOutside(
      [emptied, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toEqual([expect.stringContaining('0 WebSocket')]);
  });

  it('goes red when the instance transport’s fetch is gone', () => {
    const emptied: ScannedFile = {
      path: INSTANCE,
      source: 'const sender = send;\nconst socket = new WebSocket(url);',
    };
    const findings = networkFindingsOutside(
      [emptied, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(INSTANCE);
    expect(findings[0]).toContain('0 fetch');
  });

  it('goes red for a fetch beside the instance transport, in the same directory', () => {
    const sibling: ScannedFile = {
      path: join('instance', 'instance-port.ts'),
      source: "void fetch('https://ride.example/v1/auth/session');",
    };
    const findings = networkFindingsOutside(
      [instance, sibling, hosted, transport, link, fence],
      PERMITTED_NETWORK_CALLS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(join('instance', 'instance-port.ts'));
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
      'docs/privacy-policy.md says this client sends nothing except one picture, or a ride’s ' +
        'numbers when the rider asks for an analysis (#802), to a computer the ' +
        'rider configured and switched on, a start and a stop to a side-camera phone the rider ' +
        'paired by scanning, a question — never a picture — to a hosted service on the ' +
        'rider’s own key, a sign-in to an instance the rider chose (#777), and a room’s ' +
        'power reports to that instance (#782); that is now ' +
        'false, and the policy and the Data Safety form are what ' +
        'must change',
    ).toEqual([]);
  });
});

/**
 * **The Android shell's own source — #553.**
 *
 * The owner's 2026-09-26 ruling on #553 sends the picture to the rider's
 * computer through Capacitor's native HTTP inside the shell, because the
 * WebView blocks plain `http:` as mixed content (validation 0002 Part AF).
 * That call cannot live in `apps/web` — a browser must download no line of
 * Capacitor — so it lives in `apps/mobile`, which the scan above never read.
 * This reads it, with the same rule: **one module, one primitive, an exact
 * count**, and every other primitive anywhere in `apps/mobile/src` a finding.
 *
 * What limits WHERE that call may go is not here: the web transport refuses
 * anything but a private address written as numbers before the native call
 * exists (`camera/analysis-transport.test.ts` §"inside the Android shell").
 */
const MOBILE_SOURCE_ROOT = fileURLToPath(new URL('../../../mobile/src', import.meta.url));

/** The ONE place the shell's own source may make a network request, and how many times it names it. */
export const PERMITTED_MOBILE_NETWORK_CALLS: typeof PERMITTED_NETWORK_CALLS = [
  // Two namings: the import, and the default the adapter is built over. A
  // third — a second request, or a second module's reach for it — is red.
  { module: join('http', 'analysis-http.ts'), primitive: 'CapacitorHttp', count: 2 },
];

describe('the Android shell’s own source — #553', () => {
  const ADAPTER: ScannedFile = {
    path: join('http', 'analysis-http.ts'),
    source:
      "import { CapacitorHttp } from '@capacitor/core';\nexport const make = (http = CapacitorHttp) => http;",
  };

  it('is clean over a tree that is exactly what the policy describes', () => {
    expect(networkFindingsOutside([ADAPTER], PERMITTED_MOBILE_NETWORK_CALLS)).toEqual([]);
  });

  it('goes red for native HTTP anywhere else in the shell', () => {
    const elsewhere: ScannedFile = {
      path: join('ble', 'transport.ts'),
      source: 'void CapacitorHttp.request({ url });',
    };
    const findings = networkFindingsOutside([ADAPTER, elsewhere], PERMITTED_MOBILE_NETWORK_CALLS);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(join('ble', 'transport.ts'));
  });

  it('goes red for a fetch in the shell, and for a second native request in the adapter', () => {
    const fetched: ScannedFile = { path: join('thermal', 'thermal.ts'), source: 'void fetch(u);' };
    expect(networkFindingsOutside([ADAPTER, fetched], PERMITTED_MOBILE_NETWORK_CALLS)).toHaveLength(
      1,
    );
    const twice: ScannedFile = {
      path: ADAPTER.path,
      source: `${ADAPTER.source}\nvoid CapacitorHttp.get({ url });`,
    };
    expect(networkFindingsOutside([twice], PERMITTED_MOBILE_NETWORK_CALLS)).toHaveLength(1);
  });

  it('goes red when the adapter is gone, so the policy cannot outlive it', () => {
    expect(networkFindingsOutside([], PERMITTED_MOBILE_NETWORK_CALLS)[0]).toContain(
      '0 CapacitorHttp',
    );
  });

  it('makes no network request but the one the policy describes', () => {
    const files: ScannedFile[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          files.push({
            path: relative(MOBILE_SOURCE_ROOT, path),
            source: readFileSync(path, 'utf8'),
          });
        }
      }
    };
    walk(MOBILE_SOURCE_ROOT);
    // The population, asserted, for the reason `the client` gives.
    expect(files.length).toBeGreaterThan(10);
    expect(
      networkFindingsOutside(files, PERMITTED_MOBILE_NETWORK_CALLS),
      'docs/privacy-policy.md says the shell sends one picture, or a ride’s numbers (#802), to ' +
        'the rider’s own computer through native HTTP and nothing else; that is now false, and the policy and the Data Safety form ' +
        'are what must change',
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
 * **A dependency that would report home, and the fence that stops it** (#530).
 *
 * The scan above reads the source this project writes, so it cannot see a
 * request a DEPENDENCY makes — which is how `@mediapipe/tasks-vision` 1.0.1,
 * the side camera's pose model runtime, came to hold a usage logger that posts
 * to `https://odml.pa.googleapis.com/v1/log` every sixty seconds, in the
 * worker that analyses a rider's pictures, with nothing here noticing.
 * `camera/pose-runtime.ts` §`fenceWorkerNetwork` refuses every request off
 * the worker's own origin, and `browser/pose.browser.spec.ts` is the gate
 * that watches the real worker make its requests — measured both ways: with
 * the fence it reaches only this origin; with the fence's import deleted it
 * posts to that host, and the spec goes red naming it.
 *
 * What this block holds is the half a real engine is not needed for: that the
 * fence is the FIRST thing the worker evaluates. Module imports are evaluated
 * in order, before a module's own statements, so a fence imported after
 * MediaPipe — or called from the worker's body — would run after the library
 * had already been set up with the original `fetch`.
 */
describe('the pose worker’s network fence — #530', () => {
  const WORKER = join(SOURCE_ROOT, 'camera', 'pose-worker.ts');

  /** Every module specifier `source` imports, in order. */
  function importsOf(source: string): readonly string[] {
    const file = ts.createSourceFile('worker.ts', source, ts.ScriptTarget.Latest, true);
    return file.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
  }

  it('imports the fence before anything else, and before MediaPipe above all', () => {
    const imports = importsOf(readFileSync(WORKER, 'utf8'));
    expect(imports[0]).toBe('./pose-fence');
    const mediapipe = imports.findIndex((specifier) => specifier.startsWith('@mediapipe/'));
    expect(mediapipe).toBeGreaterThan(0);
  });

  it('would see a fence imported after MediaPipe — the rule is not vacuous', () => {
    expect(importsOf("import '@mediapipe/tasks-vision';\nimport './pose-fence';\n")[0]).not.toBe(
      './pose-fence',
    );
  });

  // ⚠️ **15 s, a ceiling rather than a budget — #682.** Vitest's default 5 s was nobody's choice
  // for this case: under coverage on CI it took 2.5 s to 4.8 s over thirteen green `main` runs on
  // 2026-09-28 (36370135206 to 36405580515), the slowest on 36395959573 (the slower of the two
  // runners, a job over 1 000 s) — 96 % of that default. 15 s is about three times the slowest, so
  // a slow-down is red. It is not a hang guard: this case is synchronous and Vitest cannot
  // interrupt one, so a genuine hang is caught only by the job’s own stop (docs/agents/ci.md §4c).
  it('is the only place in the client MediaPipe is imported', () => {
    const importers = scannable()
      .filter((file) =>
        importsOf(readFileSync(file, 'utf8')).some((each) => each.startsWith('@mediapipe/')),
      )
      .map((file) => relative(SOURCE_ROOT, file));
    // Anywhere else, the library would run in a scope with no fence.
    expect(importers).toEqual([join('camera', 'pose-worker.ts')]);
  }, 15_000);
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

  /**
   * #558: the host's own analytics keep each request's IP address, time and
   * device type — not which part of the map, #559 — where this project's
   * account can see them for up to 7 days. Both filed statements have to SAY
   * so — the policy
   * a rider reads and the `why` filed on Play — and this goes red if either
   * stops naming the retention. It checks the words are there, not that the
   * period is still right; `apps/mobile/RELEASE.md` §8 is where a person
   * re-checks that against the Cloudflare plan.
   */
  it('has its 7-day retention stated in the policy and in the Location `why` — #558', () => {
    const policy = readFileSync(join(REPOSITORY_ROOT, 'docs', 'privacy-policy.md'), 'utf8');
    // Both places #558 names, each on its own: the short version a rider reads
    // first, and the map tile bullet under "What leaves the device". A search
    // of the whole file is satisfied by either alone.
    for (const heading of ['The short version', 'What leaves the device']) {
      const section = normalised(policySection(policy, heading));
      expect(section, `the policy has no "${heading}" section`).not.toBe('');
      expect(
        section,
        `the policy's "${heading}" does not say how long the tile host keeps a request`,
      ).toContain('for up to 7 days');
      expect(section).toContain('ip address');
      // #559: the tile is picked by a Range header the kept record does not
      // include, so each place that states the record says what it is NOT.
      expect(
        section,
        `the policy's "${heading}" does not say the kept record leaves out which part of the map`,
      ).toContain('not which part of the map');
    }
    const why = locationWhy(
      readFileSync(
        join(REPOSITORY_ROOT, 'apps', 'mobile', 'src', 'android', 'data-safety.ts'),
        'utf8',
      ),
    );
    expect(
      why,
      'the Location answer does not say how long the tile host keeps a request',
    ).toContain('up to 7 days');
    expect(why).toContain('IP address');
    expect(why).toContain('not which part of the map');
  });

  it('is not satisfied by a comment — the parse sees the `why` string and nothing else', () => {
    // The review's finding, as a fixture: the host in a comment above the row,
    // and a `why` that does not name it. A whole-file search passes this.
    const fixture = [
      'export const DATA_SAFETY_DECLARATION = [',
      '  {',
      `    // tiles come from ${host}`,
      "    dataType: 'Location — approximate location',",
      '    collected: false,',
      "    why: 'nothing leaves the device',",
      '  },',
      '];',
    ].join('\n');
    expect(fixture).toContain(host);
    expect(locationWhy(fixture)).toBe('nothing leaves the device');
  });
});

const APPROXIMATE_LOCATION = 'Location — approximate location';

/**
 * The `why` string of the declaration's approximate-location row — the one
 * the tile request is filed under since #558 — read from the parsed source,
 * or `undefined` when there is no such row or its `why` is not a plain string.
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
      if (text(property('dataType')) === APPROXIMATE_LOCATION) {
        found = text(property('why'));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * **The retired promise about the tile host** (#558).
 *
 * #535 shipped a promise in the privacy policy and in Settings that nobody
 * kept a record of a map tile request, and filed the Location row as not
 * collected on the strength of it. It was false: Cloudflare's standard HTTP
 * analytics, on every zone and not switchable off, keep each request's IP
 * address, time and user agent for up to 7 days. The owner chose on 2026-09-26
 * to disclose that, and every such claim was removed.
 *
 * ⚠️ **#559 retired a second, opposite overclaim**: #558's first wording said
 * the kept record held *which map tiles were asked for*. It does not — the
 * basemap is one PMTiles file, the tile is chosen by a `Range` header the
 * analytics have no field for, and every app request had the same path when
 * measured on 2026-09-26 — so those phrases are on the list too.
 *
 * This scans what a rider or a reviewer reads — every Markdown file directly
 * under `docs/`, the repository and mobile READMEs, the release procedure,
 * and every non-test source file under both apps, comments
 * included, because `data-safety.ts`'s comment is where the filing is argued —
 * for the phrases that made the claim. Test files are skipped because they
 * name a phrase in order to assert its absence, which this file does.
 *
 * ⚠️ **What it cannot catch is a NEW wording of the same false claim.** It is
 * a list of phrases that were actually shipped, not a reading of meaning.
 */
const RETIRED_TILE_HOST_CLAIMS: readonly string[] = [
  'no record of the request',
  'nor have one kept for us',
  'keeps nothing this project reads',
  'host keeps nothing',
  'processed ephemerally',
  'which map tiles were asked for',
  'path of each tile asked for',
  'the tile path',
];

/**
 * Lower-cased, emphasis and code marks dropped, a JSX whitespace expression
 * (`{' '}`, `{" "}`) read as the space it renders, every run of whitespace one
 * space. Without the JSX step a phrase split across a line in a component —
 * `the{' '}` then `request` — escaped the scan (#559's review).
 */
function normalised(text: string): string {
  return text
    .replace(/\{\s*(['"`])\s+\1\s*\}/g, ' ')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Every retired tile-host claim in a text, in list order. */
function retiredTileHostClaimsIn(text: string): readonly string[] {
  const flat = normalised(text);
  return RETIRED_TILE_HOST_CLAIMS.filter((phrase) => flat.includes(phrase));
}

describe('nothing claims the tile host keeps nothing — #558', () => {
  const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

  const sources = (root: string): readonly string[] => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          found.push(path);
        }
      }
    };
    walk(root);
    return found;
  };

  const docs = join(REPOSITORY_ROOT, 'docs');
  const scanned = [
    // Every document directly under docs/ — the policy, the architecture and
    // anything written beside them (#559's review appended a retired phrase
    // to docs/architecture.md and every suite stayed green).
    ...readdirSync(docs, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(docs, entry.name)),
    join(REPOSITORY_ROOT, 'README.md'),
    join(REPOSITORY_ROOT, 'apps', 'mobile', 'README.md'),
    join(REPOSITORY_ROOT, 'apps', 'mobile', 'RELEASE.md'),
    ...sources(join(REPOSITORY_ROOT, 'apps', 'web', 'src')),
    ...sources(join(REPOSITORY_ROOT, 'apps', 'mobile', 'src')),
  ];

  it('scans the docs, the READMEs, the release procedure and both apps’ sources', () => {
    // A walk that found nothing would make the next case pass over nothing.
    const paths = scanned.map((path) => relative(REPOSITORY_ROOT, path));
    expect(paths).toContain(join('docs', 'privacy-policy.md'));
    expect(paths).toContain(join('docs', 'architecture.md'));
    expect(paths).toContain('README.md');
    expect(paths).toContain(join('apps', 'mobile', 'README.md'));
    expect(paths).toContain(join('apps', 'web', 'src', 'views', 'SettingsView.tsx'));
    expect(paths).toContain(join('apps', 'mobile', 'src', 'android', 'data-safety.ts'));
    expect(paths).not.toContain(join('apps', 'web', 'src', 'privacy', 'no-network.test.ts'));
  });

  it('finds none of the retired phrases', () => {
    const findings = scanned.flatMap((path) =>
      retiredTileHostClaimsIn(readFileSync(path, 'utf8')).map(
        (phrase) => `${relative(REPOSITORY_ROOT, path)}: “${phrase}”`,
      ),
    );
    expect(findings).toStrictEqual([]);
  });

  it('would find one wrapped across lines and emphasised — the rule is not vacuous', () => {
    // The shape #535 shipped in the policy: Markdown, hard-wrapped mid-phrase.
    expect(
      retiredTileHostClaimsIn('It sends no ride data, and we keep *no record of the\n  request*.'),
    ).toStrictEqual(['no record of the request']);
    // And the shape it shipped in Settings, as JSX text.
    expect(retiredTileHostClaimsIn("', and we keep no record of the request'")).toStrictEqual([
      'no record of the request',
    ]);
    // A phrase split across two lines of JSX by a `{' '}` — the shape Prettier
    // produces when a sentence wraps inside a component (#559's review).
    expect(
      retiredTileHostClaimsIn("data, and we keep no record of the{' '}\n            request."),
    ).toStrictEqual(['no record of the request']);
    expect(
      retiredTileHostClaimsIn('keeps a record — including which map tiles were{" "}\nasked for'),
    ).toStrictEqual(['which map tiles were asked for']);
    expect(retiredTileHostClaimsIn('Cloudflare keeps a record for up to 7 days.')).toStrictEqual(
      [],
    );
  });
});

/** The text under a `## heading` of a Markdown document, up to the next `## `, or ''. */
function policySection(markdown: string, heading: string): string {
  const marker = `\n## ${heading}\n`;
  const start = markdown.indexOf(marker);
  if (start === -1) {
    return '';
  }
  const body = markdown.slice(start + marker.length);
  const end = body.indexOf('\n## ');
  return end === -1 ? body : body.slice(0, end);
}

/**
 * **What an instance receives, class by class — #778.**
 *
 * `instance/instance-transport.ts` is in {@link PERMITTED_NETWORK_CALLS}
 * because a rider may connect to an instance, and #778 made that entry
 * conditional on the policy saying, per data class, what leaves the device,
 * to whom, when — only after the rider connects — and how to delete it (#35).
 * This pins those sentences, in the section the policy gives the instance,
 * so a rewrite that dropped a class, the operator, the network path or the
 * 18+ rule is a red build rather than a quieter policy.
 *
 * ⚠️ It checks that the words are there, not that they are true — whether a
 * class is sent is `instance-port.ts`'s and its tests', and the wording is a
 * DRAFT awaiting the owner's approval (#880).
 */
/**
 * Deleting instructions the policy may not give, because nothing in this build
 * carries them out (#892's review): no in-app screen removes a device or
 * changes the name, and no instance route erases an account. If one is built,
 * its phrase comes off this list in the same change that ships it.
 *
 * ⚠️ A denylist is a TRIPWIRE, not a proof (#892's second review): a synonym —
 * "delete your account on the instance" — is on no list and passes it. What
 * proves the section names no unbuilt path is the positive rule beside it,
 * {@link deletionRouteFaults}: every "How to delete it" cell names
 * *Disconnect*, the operator, or Discord (a separate service the rider acts on
 * themselves), or is a dash for a class this version does not send.
 */
const UNBUILT_DELETION_PATHS: readonly string[] = [
  'remove the device from your account on the instance',
  'change it on the instance',
  'erase your account on the instance',
  'until you erase your account',
  'until it is erased on the instance',
  'erase it on the instance',
];

/**
 * Every "How to delete it" cell of the instance section's table that names no
 * route this build has: *Disconnect*, the instance's operator, Discord, or a
 * dash (#892's second review). Answers the offending cells, normalised.
 */
function deletionRouteFaults(section: string): readonly string[] {
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').slice(1, -1));
  const heading = rows.findIndex((cells) =>
    normalised(cells.at(-1) ?? '').includes('how to delete'),
  );
  if (heading === -1) return ['no "how to delete it" column'];
  const cells = rows.slice(heading + 2).map((cells) => normalised(cells.at(-1) ?? '').trim());
  if (cells.length === 0) return ['no rows under "how to delete it"'];
  return cells.filter(
    (cell) =>
      cell !== '—' &&
      !cell.includes('disconnect') &&
      !cell.includes('operator') &&
      !cell.includes('discord'),
  );
}

describe('the instance is disclosed, class by class — #778', () => {
  const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  const policy = readFileSync(join(REPOSITORY_ROOT, 'docs', 'privacy-policy.md'), 'utf8');
  const section = normalised(policySection(policy, 'An instance you connect to'));

  it('has a section for the instance, while the transport is permitted', () => {
    // The pairing this block exists for: the permitted module and the words.
    expect(
      PERMITTED_NETWORK_CALLS.some(
        (rule) => rule.module === join('instance', 'instance-transport.ts'),
      ),
    ).toBe(true);
    expect(section, 'the policy has no "An instance you connect to" section').not.toBe('');
  });

  it('says nothing leaves until the rider connects, and to whom it goes', () => {
    expect(section).toContain(
      'nothing is sent to any instance until you type its address and press connect',
    );
    expect(section).toContain('only after you connect');
    expect(section).toContain('an instance you run yourself is yours');
    expect(section).toContain('the project’s own instance is ours'.replace('’', "'"));
  });

  it('names Cloudflare as the project instance’s network path, and its operator and where it runs', () => {
    expect(section).toContain('cloudflare tunnel');
    expect(section).toContain('cloudflare decrypts and carries the traffic');
    expect(section).toContain("maintainer's computer, at their home");
    expect(section).toContain('the maintainer is its operator');
  });

  it('gives each data class what leaves, to whom, when and how to delete it', () => {
    for (const phrase of [
      // What this version sends.
      "this device's public key",
      'the name other riders see',
      'your internet address',
      // What it does not send yet, each named rather than left out.
      'your rides, including their positions',
      'not sent by this version of the app',
      'power, cadence, the weight you declare, and your display name',
      // #784: a room's route — refused in a privacy zone, deleted when the room is over.
      'the route of a room you make',
      'a route that starts, ends or passes inside one of your privacy zones is refused before anything is sent',
      'the route is deleted from the instance when the room is over',
      // The owner's wording of 2026-09-30: no hard bound the ten-minute sweep could break.
      'deleted by the instance when the room is over — within about a day of being made',
      // #784's review (B2): every way a room is over, the unridden one's bound included.
      'when nobody is riding in it a day after it was made, whether or not anybody ever joined it',
      'when a race in it was interrupted because the instance restarted',
      'or when you erase your account on that instance',
      // #785's review (N2): no result while the race runs.
      "nobody can see a race's result until every rider is across the line or out of the race",
      'the instance keeps only a fingerprint of a room',
      // Ruling Q2.
      "visible to that race's participants only, until your account on the instance is erased",
      // #785: the publication rule (ADR 0028's 2026-09-22 amendment), and ruling Q2's erasure.
      'beside another rider it shows power-to-weight and never watts',
      "every rider in the race sees every rider's result, flags included",
      'show you as "a rider", with no name and nothing of yours',
      // #778's comment of 2026-09-29: Discord, what it receives, what others see.
      'it happens on discord',
      'discord receives your voice',
      'see your discord username and picture',
      'the instance keeps your discord id with your account',
      // How to delete: #35.
      'how to delete it',
      'disconnect makes this device forget the instance',
    ]) {
      expect(section, phrase).toContain(phrase);
    }
  });

  it('says when the name is sent and when it is kept, and that earlier names are kept — #892 review', () => {
    // `sign-in.ts` sends a typed name on EVERY Connect; the instance keeps it
    // only when it registers the key (`instance-port.test.ts` measures both).
    // The row used to say it was SENT only to an instance that had not seen
    // the device.
    expect(section).toContain('each time you press connect with a name typed');
    expect(section).toContain('keeps it with your account only the first time it sees this device');
    expect(section).not.toContain('when it has not seen this device before');
    // Migration 0004's `display_name_change`.
    expect(section).toContain('also keeps each earlier name, and when it changed');
    expect(section).toContain('for moderation');
  });

  it('says what the project’s own instance and Cloudflare keep of an internet address — #892 review', () => {
    // `apps/instance/src/log.ts` writes no address; the rate limiter holds one
    // in memory for a window of at most an hour, and forgets it when that
    // window ends with no further request — `apps/instance/src/auth/
    // rate-limit.test.ts` and `sign-in.test.ts` §"what the rate limits hold"
    // drive the clock past the window and read the address gone.
    expect(section).toContain('does not write your address to its log or its database');
    expect(section).toContain('in memory only, for at most an hour');
    // The tile section's wording, for the same Cloudflare account.
    expect(section).toContain('our cloudflare account can see for up to 7 days');
    expect(section).not.toContain("the instance's operator decides how long it is kept");
  });

  it('offers only ways of deleting that this build has — #892 review', () => {
    // No screen removes a device or changes the name, and nothing a rider can
    // reach erases an account: `DELETE /v1/account` (#893) is a sync route,
    // which a running instance answers `unavailable` because `instance.ts`
    // hands the handler no sync, and no screen calls it. A policy
    // telling a rider to do those "on the instance" names paths that do not
    // exist, so each such instruction is refused, here and across the policy.
    const whole = normalised(policy);
    for (const claim of UNBUILT_DELETION_PATHS) {
      expect(whole, claim).not.toContain(claim);
    }
    // What IS true: disconnecting, and asking the operator — the maintainer,
    // for the project's own instance, through the policy's contact route.
    expect(section).toContain('disconnecting is all this version of the app can do');
    expect(section).toContain("ask the instance's operator");
    expect(section).toContain("for the project's own instance, that is this project's maintainer");
    expect(section).toContain('as described under contact below');
    // #886/#887: a request about a rider's own data goes to the owner's private
    // address, never a public issue; the issue tracker is for what is not personal.
    const contact = normalised(policySection(policy, 'Contact'));
    expect(contact).toContain('matt@openzigs.ai');
    expect(contact).toContain('do not put a request about your own data in a public issue');
    expect(contact).toContain('for anything that is not personal, open an issue');
    expect(section).toContain('ask privately by email');
  });

  it('names only Disconnect, the operator or Discord in every "how to delete it" cell — #892 second review', () => {
    expect(deletionRouteFaults(policySection(policy, 'An instance you connect to'))).toEqual([]);
    // The prose paragraph under the table says the same.
    expect(section).toContain('disconnecting is all this version of the app can do');
    expect(section).toContain("ask the instance's operator to do them");
  });

  it('would find a synonym the denylist misses — the positive rule is not vacuous', () => {
    const table =
      '| Data | What | When | How to delete it |\n| --- | --- | --- | --- |\n' +
      '| A key | sent | always | delete your account on the instance |\n' +
      '| A name | sent | always | *Disconnect* |\n';
    expect(deletionRouteFaults(table)).toEqual(['delete your account on the instance']);
    expect(deletionRouteFaults('no table here')).toEqual(['no "how to delete it" column']);
  });

  it('would find an unbuilt deletion path — the rule is not vacuous', () => {
    for (const claim of UNBUILT_DELETION_PATHS) {
      expect(normalised(`You can ${claim} whenever you like.`)).toContain(claim);
    }
  });

  it('says public rooms are for adults, self-declared, and names the assessments that come first', () => {
    expect(section).toContain('for people aged 18 or over only');
    expect(section).toContain('confirm your age yourself');
    expect(section).toContain('online safety act');
    expect(section).toContain('digital services act');
    expect(section).toContain('/issues/886');
    expect(section).toContain('/issues/887');
  });

  it('refuses http and says so in the policy too', () => {
    expect(section).toContain('it refuses a plain http:// address, before sending anything');
  });

  it('would find a class missing — the rule is not vacuous', () => {
    expect(
      normalised(
        policySection('\n## An instance you connect to\nNothing.\n', 'An instance you connect to'),
      ),
    ).not.toContain('your internet address');
  });
});
