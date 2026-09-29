// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  instanceHttp,
  InstanceUnreachableError,
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

  it('imports nothing from the camera, and names no frame', () => {
    for (const name of modules) {
      const source = readFileSync(join(DIRECTORY, name), 'utf8');
      for (const specifier of importsOf(source)) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/camera|side-link|pose/);
        // Only this directory and the two packages whose types it signs with.
        expect(
          specifier.startsWith('./') || specifier === '@onyourleft/domain',
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
      expect(source, name).not.toMatch(/CapturedFrame|FrameBytes|\bframe\b/i);
    }
  });

  it('would see a camera import — the rule is not vacuous', () => {
    expect(importsOf("import { capturedFrame } from '../camera/frame';\n")).toEqual([
      '../camera/frame',
    ]);
  });
});
