// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No transport type escapes the transport** — #387.
 *
 * `analysis-port.ts` is written so that a second transport — a native plugin,
 * a worker — could satisfy it unchanged, which is `packages/sensors`' rule
 * about Web Bluetooth types applied here. A `Response` or a `RequestInit` in a
 * view, or an `AbortSignal` in the port's signature, is a perfectly well-typed
 * program that has quietly chosen the browser's `fetch` as the only transport
 * there can be. `camera/boundary.test.ts` makes the same move for a
 * `MediaStream`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The one module that may name them. */
const TRANSPORT = join('camera', 'analysis-transport.ts');

/**
 * #518: the hosted transport, and the body reader both transports share. An
 * exact list, not the `camera/` directory: a file beside them that named a
 * `Response` would still be a finding.
 */
const MAY_NAME_HTTP_TYPES: readonly string[] = [
  TRANSPORT,
  join('camera', 'hosted-transport.ts'),
  join('camera', 'http-body.ts'),
  // #802: the ride analysis's step port to the rider's own computer. It builds
  // the request the one `fetch` in `analysis-transport.ts` sends, and cannot
  // live in that module, which carries pictures by design
  // (`no-picture-reachable.test.ts`).
  join('ride-analysis', 'own-computer-step.ts'),
  // #804: test support, never shipped — a model server as a `fetch` double,
  // which has to build the `Response` a server would. Named by path, so a
  // production module beside it that named one would still be a finding.
  join('ride-analysis', 'model-server-testing.ts'),
  // #784, #785: test support, never shipped — an instance's rooms routes as a
  // `fetch` double, which has to build the `Response` the instance would.
  join('rooms', 'rooms-testing.ts'),
  // #777: the one transport to an instance (ADR 0036 D-3 (a)). Its port,
  // `instance/instance-port.ts`, names no HTTP type — only what it read.
  join('instance', 'instance-transport.ts'),
];

/**
 * The service worker handles its OWN requests and responses — `offline/` is
 * the other place a `Response` is legitimately a value, and it has nothing to
 * do with the analysis. Listed by directory because a worker is not a seam
 * this rule is about; see `privacy/no-network.test.ts` for how its one call is
 * pinned instead.
 */
const WORKER_DIRECTORY = 'offline';

/** Types that belong to the platform's HTTP stack. */
const HTTP_TYPES =
  /(?<![\w.$])(?:Response|RequestInit|Headers|Request|ReadableStreamDefaultReader)\b/;

/** Cancellation types, forbidden in the analysis modules other than the transport. */
const CANCELLATION_TYPES = /(?<![\w.$])(?:AbortSignal|AbortController)\b/;

/** The modules on the near side of the port. */
const ABOVE_THE_TRANSPORT = [
  join('camera', 'analysis-port.ts'),
  // #799: the picture-free half of the port, split out of it — in
  // `@onyourleft/analysis` since #1094, as a path from `src`.
  join('..', '..', '..', 'packages', 'analysis', 'src', 'screen', 'model-answer.ts'),
  join('camera', 'analysis-endpoint.ts'),
  join('camera', 'analysis-response.ts'),
  join('camera', 'useAnalysis.ts'),
  join('camera', 'session.ts'),
  join('camera', 'hosted-port.ts'),
  join('camera', 'hosted-model.ts'),
  join('camera', 'useHostedCheck.ts'),
  join('views', 'CameraView.tsx'),
];

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

function code(path: string): string {
  return stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));
}

describe('the scan itself', () => {
  it('finds the transport, and finds its types in it', () => {
    expect(sources()).toContain(TRANSPORT);
    // The vacuous pass: a pattern that matched nothing would find nothing
    // anywhere and call it a boundary.
    expect(HTTP_TYPES.test(code(TRANSPORT))).toBe(true);
    expect(CANCELLATION_TYPES.test(code(TRANSPORT))).toBe(true);
  });

  it('finds every module it exempts, so the list cannot outlive them', () => {
    for (const path of MAY_NAME_HTTP_TYPES) {
      expect(sources()).toContain(path);
      expect(HTTP_TYPES.test(code(path)), path).toBe(true);
    }
  });

  it('does not fire on a comment that names one', () => {
    expect(HTTP_TYPES.test(stripComments('// a Response never leaves\nconst x = 1;'))).toBe(false);
  });
});

describe('no HTTP type escapes the transport', () => {
  it('names none of them anywhere else in the client, the service worker aside', () => {
    const findings = sources()
      .filter((path) => !MAY_NAME_HTTP_TYPES.includes(path))
      .filter((path) => path.split(/[/\\]/)[0] !== WORKER_DIRECTORY)
      .filter((path) => HTTP_TYPES.test(code(path)));
    expect(findings).toStrictEqual([]);
  });

  it('names no cancellation type on the near side of the port', () => {
    const findings = ABOVE_THE_TRANSPORT.filter((path) => CANCELLATION_TYPES.test(code(path)));
    expect(findings).toStrictEqual([]);
  });
});
