// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { SyncStore } from './sync';

import {
  importWalk,
  readFromDisk,
  type ImportClosure,
  type ReadSource,
} from '../camera/import-walk-testing';

import {
  instanceHttp,
  instanceRoomSocket,
  InstanceUnreachableError,
  isRoomId,
  roomPath,
  MAXIMUM_INSTANCE_ANSWER_BYTES,
  type InstanceSend,
} from './instance-transport';

const ORIGIN = 'https://ride.example';

function answering(status: number, body: string): InstanceSend & ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(new Response(body === '' ? null : body, { status })));
}

describe('the one transport to an instance — #777', () => {
  it('sends nothing to an origin the address rule refuses', () => {
    const send = answering(200, '{}');
    for (const origin of ['http://ride.example', 'https://ride.example/', 'ride.example', '']) {
      expect(() => instanceHttp(origin, send), origin).toThrow(InstanceUnreachableError);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('appends a path and nothing else — a caller cannot point it at another host', async () => {
    const send = answering(200, '{}');
    const http = instanceHttp(ORIGIN, send);
    for (const path of ['//evil.example/v1', 'v1/auth/session', '@evil.example']) {
      await expect(http.call('GET', path), path).rejects.toThrow(InstanceUnreachableError);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('sends no path fetch would rewrite: no dot segment, query, fragment, escape or backslash — #782 review (B1)', async () => {
    const send = answering(200, '{}');
    const http = instanceHttp(ORIGIN, send);
    for (const path of [
      // The reproduction: a room id that steered the ticket's bearer POST.
      '/v1/rooms/x/../../auth/devices/PK/revoke?/ticket',
      '/v1/rooms/../x/ticket',
      '/v1/./auth/session',
      '/v1/auth/..',
      '/v1/auth/session?x=1',
      '/v1/auth/session#x',
      '/v1/rooms/%2E%2E/ticket',
      '/v1/rooms\\..\\auth/session',
    ]) {
      await expect(http.call('POST', path, { token: 't' }), path).rejects.toMatchObject({
        why: 'refused-path',
      });
    }
    expect(send).not.toHaveBeenCalled();
    // A segment that merely CONTAINS a dot is a name, not a dot segment.
    await http.call('GET', '/v1/files/a.b..c');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a path holding any C0 control character, which the URL parser strips — #922', async () => {
    const send = answering(200, '{}');
    const http = instanceHttp(ORIGIN, send);
    // The reproduction: the parser drops the tab, and `.\t.` becomes `..`.
    expect(new URL(`${ORIGIN}/v1/rooms/.\t./auth/x`).pathname).toBe('/v1/auth/x');
    for (let code = 0; code < 0x20; code += 1) {
      const path = `/v1/rooms/.${String.fromCharCode(code)}./auth/x`;
      await expect(
        http.call('POST', path, { token: 't' }),
        `U+${code.toString(16)}`,
      ).rejects.toMatchObject({
        why: 'refused-path',
      });
    }
    expect(send).not.toHaveBeenCalled();
    // A space is not a control character, and is sent as the parser encodes it.
    await http.call('GET', '/v1/files/a b');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('appends a query only as encoded names and values, which cannot reach the path — #961', async () => {
    const send = answering(200, '{}');
    const http = instanceHttp(ORIGIN, send);
    await http.call('GET', '/v1/moderation/log', {
      query: { limit: '25', cursor: '../../auth/session?x=1#y%2F/..' },
    });
    const [url] = send.mock.calls[0] as [string, RequestInit];
    const sent = new URL(url);
    expect(sent.origin).toBe(ORIGIN);
    expect(sent.pathname).toBe('/v1/moderation/log');
    expect(sent.hash).toBe('');
    expect([...sent.searchParams]).toEqual([
      ['limit', '25'],
      ['cursor', '../../auth/session?x=1#y%2F/..'],
    ]);
    // No query is no `?` at all.
    await http.call('GET', '/v1/moderation/log', { query: {} });
    expect((send.mock.calls[1] as [string])[0]).toBe(`${ORIGIN}/v1/moderation/log`);
    // And a path with a query of its own is still refused, query option or not.
    await expect(
      http.call('GET', '/v1/moderation/log?limit=1', { query: { cursor: 'c' } }),
    ).rejects.toMatchObject({ why: 'refused-path' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('builds both of a room’s paths from one checked id — #782 review (B1)', () => {
    expect(roomPath('room-1', 'ticket')).toBe('/v1/rooms/room-1/ticket');
    expect(roomPath('room-1', 'socket')).toBe('/v1/rooms/room-1/socket');
    for (const roomId of ['../x', 'x/../../auth/devices/PK/revoke?', 'a?b', 'a%2F', 'a.b', '']) {
      expect(() => roomPath(roomId, 'ticket'), roomId).toThrow(InstanceUnreachableError);
      expect(isRoomId(roomId), roomId).toBe(false);
    }
  });

  it('sends JSON with the bearer token, follows no redirect and carries nothing ambient', async () => {
    const send = answering(200, '{"ok":true}');
    const answer = await instanceHttp(ORIGIN, send).call('POST', '/v1/auth/session', {
      body: { publicKey: 'ab' },
      token: 'the-token',
    });
    expect(answer).toEqual({ status: 200, body: { ok: true } });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/auth/session`);
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"publicKey":"ab"}',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(init.headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer the-token',
      'content-type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says the instance could not be reached when nothing answers', async () => {
    const send: InstanceSend = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(instanceHttp(ORIGIN, send).call('GET', '/instance')).rejects.toMatchObject({
      why: 'no-answer',
    });
  });

  it('stops reading an answer past its limit', async () => {
    const send = answering(200, 'x'.repeat(MAXIMUM_INSTANCE_ANSWER_BYTES + 1));
    await expect(instanceHttp(ORIGIN, send).call('GET', '/instance')).rejects.toMatchObject({
      why: 'too-large',
    });
  });

  it('reads an empty or unreadable body as null, never as a guess', async () => {
    expect(
      await instanceHttp(ORIGIN, answering(204, '')).call('DELETE', '/v1/auth/session'),
    ).toEqual({ status: 204, body: null });
    expect(await instanceHttp(ORIGIN, answering(502, '<html>')).call('GET', '/instance')).toEqual({
      status: 502,
      body: null,
    });
  });
});

/**
 * ADR 0036 D-3 (d): a picture never leaves through the instance. What reaches
 * this module is what `instance/` imports, so no module there may import from
 * the camera or name a frame — read off the parsed imports, as
 * `camera/hosted-transport.test.ts` does for its own module.
 */
describe('no camera type can reach the instance module — ADR 0036 D-3 (d)', () => {
  const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

  function importsOf(source: string): readonly string[] {
    const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
    return file.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
  }

  const modules = readdirSync(DIRECTORY).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'testing.ts',
  );

  it('reads the modules there are', () => {
    expect(modules).toEqual(
      expect.arrayContaining([
        'address.ts',
        'instance-port.ts',
        'instance-transport.ts',
        'sign-in.ts',
      ]),
    );
  });

  /**
   * ⚠️ **The instance modules THEMSELVES are held to a wider pattern than
   * what they reach** (#892's merge review). The walk below allows
   * `@onyourleft/store` whole, and that package exports `CameraFrameRecord` —
   * a kept picture's JPEG bytes — which `CapturedFrame|FrameBytes|frame` does
   * not match. A module here that imported it, or called `listCameraFrames`,
   * passed every gate. So a module in `instance/` may not name a camera frame
   * in any spelling, in code or in what it imports; comments are stripped, so
   * a sentence saying why is not a finding. The wider pattern is NOT applied
   * to what the walk reaches: `transfer/store-port.ts`'s `AccountStore` is the
   * one port that returns a picture, for the account export, by design.
   */
  const PICTURE_IN_AN_INSTANCE_MODULE =
    /CapturedFrame|FrameBytes|CameraFrame|\bframes?\b|\bjpe?g\b|\bpicture/i;

  function namedImportsOf(source: string): readonly string[] {
    const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
    return file.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
      const bindings = statement.importClause?.namedBindings;
      return bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
        : [];
    });
  }

  function instanceModuleFaults(name: string, source: string): string[] {
    const faults: string[] = [];
    for (const specifier of importsOf(source)) {
      if (/camera|side-link|pose/.test(specifier)) faults.push(`${name} imports ${specifier}`);
    }
    for (const imported of namedImportsOf(source)) {
      if (/frame|picture|jpe?g/i.test(imported)) faults.push(`${name} imports ${imported}`);
    }
    const found = PICTURE_IN_AN_INSTANCE_MODULE.exec(codeOf(name, source));
    if (found !== null) faults.push(`${name} names ${found[0]}`);
    return faults;
  }

  it('imports nothing from the camera, and names no frame — in any spelling', () => {
    for (const name of modules) {
      expect(instanceModuleFaults(name, readFileSync(join(DIRECTORY, name), 'utf8'))).toEqual([]);
    }
  });

  it('gives sync no way to read a kept picture — pinned at compile time', () => {
    // `SyncStore` is what sync may do to the device's store. The directives
    // below are the pin: give it `listCameraFrames`, `countCameraFrames` or
    // `putCameraFrame` and each becomes TS2578 (an unused directive), and a
    // method whose name says Frame turns the last line red as well.
    const store = {} as SyncStore;
    // @ts-expect-error — sync cannot list a kept picture.
    expect(store.listCameraFrames).toBeUndefined();
    // @ts-expect-error — nor count them.
    expect(store.countCameraFrames).toBeUndefined();
    // @ts-expect-error — nor write one.
    expect(store.putCameraFrame).toBeUndefined();
    const framed: [
      Extract<keyof SyncStore, `${string}${'Frame' | 'frame' | 'Picture'}${string}`>,
    ] extends [never]
      ? true
      : false = true;
    expect(framed).toBe(true);
  });

  it('would find a kept picture imported from the store package — the rule is not vacuous', () => {
    const sync = readFileSync(join(DIRECTORY, 'sync.ts'), 'utf8');
    const planted =
      "import type { CameraFrameRecord } from '@onyourleft/store';\n" +
      sync +
      '\nexport async function leak(store: { listCameraFrames(o: string): Promise<CameraFrameRecord[]> }) {\n' +
      "  return (await store.listCameraFrames('a')).map((record) => record.bytes);\n}\n";
    expect(instanceModuleFaults('sync.ts', planted)).toEqual(
      expect.arrayContaining(['sync.ts imports CameraFrameRecord', 'sync.ts names CameraFrame']),
    );
    // A comment saying why is not a finding.
    expect(instanceModuleFaults('sync.ts', `// no CameraFrameRecord here\n${sync}`)).toEqual([]);
  });

  /**
   * ⚠️ **Walked, not read one module deep, since the merge with #893.** #892
   * held every module here to importing only this directory and
   * `@onyourleft/domain`; #893's `sync.ts` imports `@onyourleft/store` and the
   * activity-file codec in `transfer/`, which it needs to sign and export a
   * ride. So what is held now is the whole closure: every module an instance
   * module reaches, however far, stays out of the camera and names no frame,
   * and the only packages it reaches are the three that cannot import a
   * client module at all (`boundaries/dependencies`, docs/agents/lint-boundaries.md §4d).
   */
  const PACKAGES_REACHED = ['@onyourleft/domain', '@onyourleft/fit', '@onyourleft/store'];

  /** A module's code without its comments: a comment that says "frame" carries none. */
  function codeOf(path: string, source: string): string {
    const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, kind);
    return ts.createPrinter({ removeComments: true }).printFile(file);
  }

  function cameraFaults(walked: ImportClosure, read: ReadSource): string[] {
    const faults: string[] = [];
    for (const path of walked.modules) {
      const chain = (walked.chainTo(path) ?? [path]).join(' → ');
      if (/(^|\/)(camera|side-link|pose)/.test(path)) faults.push(`reaches ${chain}`);
      else if (/CapturedFrame|FrameBytes|\bframe\b/i.test(codeOf(path, read(path) ?? ''))) {
        faults.push(`names a frame: ${chain}`);
      }
    }
    for (const specifier of walked.bare) {
      if (!PACKAGES_REACHED.includes(specifier)) faults.push(`imports ${specifier}`);
    }
    return faults;
  }

  const roots = modules.map((name) => `instance/${name}`);

  it('reaches no camera module, no frame and no other package, however far it is walked', () => {
    const walked = importWalk().closure(roots);
    // Past this directory: the walk is not over nothing.
    expect([...walked.modules]).toContain('transfer/export-activity.ts');
    expect(cameraFaults(walked, readFromDisk)).toEqual([]);
  });

  it('would find a camera module two imports away — the walk is not vacuous', () => {
    const planted: ReadSource = (path) =>
      path === 'instance/sync.ts'
        ? `${readFromDisk(path) ?? ''}\nimport { helper } from '../transfer/helper';\n`
        : path === 'transfer/helper.ts'
          ? "import { capturedFrame } from '../camera/frame';\nexport const helper = 1;\n"
          : readFromDisk(path);
    expect(cameraFaults(importWalk(planted).closure(roots), planted)).toEqual(
      expect.arrayContaining([
        'reaches instance/sync.ts → transfer/helper.ts → camera/frame.ts',
        'names a frame: instance/sync.ts → transfer/helper.ts',
      ]),
    );
  });

  it('would see a camera import — the rule is not vacuous', () => {
    expect(importsOf("import { capturedFrame } from '../camera/frame';\n")).toEqual([
      '../camera/frame',
    ]);
  });
});

describe('a room’s socket, through the same one module — #782', () => {
  const quiet = { onOpen: () => undefined, onText: () => undefined, onClose: () => undefined };

  it('opens the room’s own path on the address’s socket origin, wss for https and ws for loopback', () => {
    const urls: string[] = [];
    const open = (url: string) => {
      urls.push(url);
      return { send: () => undefined, close: () => undefined };
    };
    instanceRoomSocket(ORIGIN, 'room_1-a', quiet, open);
    instanceRoomSocket('http://127.0.0.1:8787', 'room', quiet, open);
    expect(urls).toEqual([
      'wss://ride.example/v1/rooms/room_1-a/socket',
      'ws://127.0.0.1:8787/v1/rooms/room/socket',
    ]);
  });

  it('opens nothing for an origin the address rule refuses, or a room id that is a path', () => {
    const open = vi.fn(() => ({ send: () => undefined, close: () => undefined }));
    for (const origin of ['http://ride.example', 'https://ride.example/', 'ride.example']) {
      expect(() => instanceRoomSocket(origin, 'room', quiet, open), origin).toThrow(
        InstanceUnreachableError,
      );
    }
    for (const room of ['', '../auth', 'a/b', 'x?y', 'x'.repeat(129)]) {
      expect(() => instanceRoomSocket(ORIGIN, room, quiet, open), room).toThrow(
        InstanceUnreachableError,
      );
    }
    expect(open).not.toHaveBeenCalled();
  });
});
