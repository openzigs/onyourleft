// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the analysis agent and its tools can reach** — #1098, ADR 0046 D-7,
 * CLAUDE.md §6.
 *
 * Every module under `src/analysis/` is walked through its imports,
 * transitively, and held to three things, each with a red control that
 * plants the import it forbids:
 *
 * 1. **The tools are read-only and reach no network** (D-7): no module a tool
 *    reaches imports the SQL store, the sync write path, the rooms, `ws`,
 *    `node:http` or any other socket, or names `fetch`. A tool reads through
 *    `tools/reads.ts`' one method and nothing else.
 * 2. **Nothing reaches a trainer** (§6): no module here reaches
 *    `@onyourleft/sensors` or anything about a trainer, and the agent itself
 *    reaches no network either — the model is the connection it is HANDED,
 *    so what a reply says cannot add a path. The instance has no Bluetooth
 *    path at all.
 * 3. **No picture** (#799's walk, on the server path): no module here reaches
 *    anything about a camera, a frame, an image or a photo.
 *
 * A type-only import (`import type`) is erased before the code runs, so it
 * reaches nothing and is not followed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..');

type Read = (path: string) => string;

const onDisk: Read = (path) => readFileSync(path, 'utf8');

/** Every value import of a module's source: the specifier, relative or bare. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:^|\n)\s*(import|export)(\s+type)?[^'"`;]*?from\s*'([^']+)'/g,
  )) {
    if (match[2] === undefined) found.push(match[3] ?? '');
  }
  for (const match of source.matchAll(/import\(\s*'([^']+)'\s*\)/g)) found.push(match[1] ?? '');
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+'([^']+)'/g)) found.push(match[1] ?? '');
  return found;
}

/** Every module and bare specifier `entries` reach through value imports. */
function reach(entries: readonly string[], read: Read) {
  const modules = new Set<string>();
  const bare = new Set<string>();
  const visit = (path: string): void => {
    if (modules.has(path)) return;
    modules.add(path);
    for (const specifier of specifiers(read(path))) {
      if (specifier.startsWith('.')) visit(resolve(dirname(path), specifier));
      else bare.add(specifier);
    }
  };
  for (const entry of entries) visit(entry);
  return { modules: [...modules], bare: [...bare] };
}

/** Every shipped module under `directory`, at any depth. */
function shippedUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shippedUnder(path);
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('-testing.ts')
      ? [path]
      : [];
  });
}

/** What a module path, relative to `src/`, may not be for a tool. */
const WRITE_OR_NETWORK_PATH = /^(?:store|sync|room|rooms|blob|auth|moderation|operator)\//;

/** Bare specifiers that open a socket or a model connection. */
const NETWORK_MODULE =
  /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process)$|^ws$|^undici$|^ai$|^@ai-sdk\//;

/** A path or a package through which anything reaches a trainer. */
const TRAINER = /sensors|trainer|bluetooth|ftms|erg/i;

/** A path that names a picture or a camera. */
const PICTURE = /camera|picture|frame|image|photo|video/i;

/** What a set of entries reaches that a tool may not. */
function toolFindings(entries: readonly string[], read: Read, root: string): string[] {
  const { modules, bare } = reach(entries, read);
  return [
    ...modules
      .map((path) => relative(root, path))
      .filter((path) => WRITE_OR_NETWORK_PATH.test(path) || path === 'analysis/model.ts'),
    ...bare.filter((specifier) => NETWORK_MODULE.test(specifier)),
    ...modules
      .filter((path) => /\bfetch\s*\(|\bWebSocket\b/.test(read(path)))
      .map((path) => `fetch in ${relative(root, path)}`),
  ];
}

const TOOL_MODULES = shippedUnder(join(HERE, 'tools'));
const ANALYSIS_MODULES = shippedUnder(HERE);

describe('the tools are read-only and reach no network (ADR 0046 D-7)', () => {
  it('walks every tool module, and finds nothing they may not reach', () => {
    expect(TOOL_MODULES.map((path) => relative(HERE, path)).sort()).toStrictEqual([
      'tools/reads.ts',
      'tools/tools.ts',
    ]);
    expect(toolFindings(TOOL_MODULES, onDisk, SOURCE)).toStrictEqual([]);
  });

  it('finds a planted import of the store, the sync path, a socket or a fetch — the controls', () => {
    const root = '/src';
    const tree: Record<string, string> = {
      '/src/analysis/tools/tools.ts': [
        "import { x } from '../../store/sql-store.ts';",
        "import { y } from '../../sync/sync.ts';",
        "import { WebSocketServer } from 'ws';",
        "import { request } from 'node:http';",
        "import type { Fine } from '../../store/schema.ts';",
      ].join('\n'),
      '/src/store/sql-store.ts': '',
      '/src/sync/sync.ts': 'export const put = () => fetch("http://x");',
      '/src/store/schema.ts': '',
    };
    const findings = toolFindings(
      ['/src/analysis/tools/tools.ts'],
      (path) => tree[path] ?? '',
      root,
    );
    expect(findings).toStrictEqual([
      'store/sql-store.ts',
      'sync/sync.ts',
      'ws',
      'node:http',
      'fetch in sync/sync.ts',
    ]);
  });
});

describe('nothing the agent is made of reaches a trainer, or a network but the one it is handed (§6)', () => {
  it('the agent and its tools reach no trainer module and no socket', () => {
    const entry = join(HERE, 'agent.ts');
    const { modules, bare } = reach([entry], onDisk);
    expect(
      [...modules.map((path) => relative(SOURCE, path)), ...bare].filter((path) =>
        TRAINER.test(path),
      ),
    ).toStrictEqual([]);
    expect(toolFindings([entry], onDisk, SOURCE)).toStrictEqual([]);
  });

  it('no module under analysis/ reaches a trainer', () => {
    const { modules, bare } = reach(ANALYSIS_MODULES, onDisk);
    expect(
      [...modules.map((path) => relative(SOURCE, path)), ...bare].filter((path) =>
        TRAINER.test(path),
      ),
    ).toStrictEqual([]);
  });

  it('finds a planted trainer import — the control', () => {
    const tree: Record<string, string> = {
      '/src/analysis/agent.ts': "import { erg } from '@onyourleft/sensors/protocol';",
    };
    const { bare } = reach(['/src/analysis/agent.ts'], (path) => tree[path] ?? '');
    expect(bare.filter((path) => TRAINER.test(path))).toStrictEqual([
      '@onyourleft/sensors/protocol',
    ]);
  });

  it('the model connection is the only module here that reaches the SDK', () => {
    const reachingSdk = ANALYSIS_MODULES.filter((path) =>
      reach([path], onDisk).bare.some((specifier) => /^ai$|^@ai-sdk\//.test(specifier)),
    ).map((path) => relative(HERE, path));
    expect(reachingSdk).toStrictEqual(['model.ts']);
  });
});

describe('no picture (#799’s walk, over src/analysis/)', () => {
  it('reaches nothing about a camera, a frame, an image or a photo', () => {
    expect(ANALYSIS_MODULES.length).toBeGreaterThanOrEqual(5);
    const { modules, bare } = reach(ANALYSIS_MODULES, onDisk);
    expect(
      [...modules.map((path) => relative(SOURCE, path)), ...bare].filter((path) =>
        PICTURE.test(path),
      ),
    ).toStrictEqual([]);
  });

  it('finds such an import when there is one — the control', () => {
    const tree: Record<string, string> = {
      '/src/analysis/agent.ts': "import { x } from './tools/tools.ts';",
      '/src/analysis/tools/tools.ts': "import { frame } from '../../camera/frame.ts';",
      '/src/camera/frame.ts': '',
    };
    const { modules } = reach(['/src/analysis/agent.ts'], (path) => tree[path] ?? '');
    expect(modules.filter((path) => PICTURE.test(path))).toStrictEqual(['/src/camera/frame.ts']);
  });
});
