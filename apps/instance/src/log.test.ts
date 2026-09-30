// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import { startTestInstance, type TestInstance } from './instance-testing.ts';
import { logEvent, loggedMethod, logUnhandled, REDACTED } from './log.ts';

let running: TestInstance | undefined;
afterEach(async () => {
  await running?.listening.close();
  running = undefined;
});

const TOKEN = 'oyl-device-token-5f2c9e1b';
const LATITUDE = '51.501364';
const LONGITUDE = '-0.141890';

describe('what the instance logs about a request (#767)', () => {
  it('writes no body, no token and no coordinate, whatever the request carried', async () => {
    running = await startTestInstance({ config: { bodyLimitBytes: 1024 * 1024 } });
    const body = JSON.stringify({ lat: Number(LATITUDE), lon: Number(LONGITUDE), note: 'ride' });
    const requests = [
      // A matched route, carrying all three.
      fetch(`${running.url}/health?token=${TOKEN}&lat=${LATITUDE}`, {
        headers: { authorization: `Bearer ${TOKEN}`, cookie: `session=${TOKEN}` },
      }),
      // An unmatched path that IS the secret, with a body.
      fetch(`${running.url}/v1/rides/${TOKEN}/${LATITUDE},${LONGITUDE}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body,
      }),
      // The wrong method on a real route, with the same body.
      fetch(`${running.url}/source?lon=${LONGITUDE}`, { method: 'PUT', body }),
    ];
    const statuses = await Promise.all(requests.map(async (request) => (await request).status));
    expect(statuses).toEqual([200, 404, 405]);

    const written = running.lines.join('\n');
    expect(running.lines).toHaveLength(3);
    for (const secret of [
      TOKEN,
      LATITUDE,
      LONGITUDE,
      '51.50',
      '0.1418',
      'Bearer',
      'ride',
      'rides',
    ]) {
      expect(written).not.toContain(secret);
    }
    // …while still saying something useful: what matched, and how it ended.
    expect(running.lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'request', method: 'GET', route: '/health', status: 200 }),
        expect.objectContaining({ event: 'request', method: 'POST', route: null, status: 404 }),
        expect.objectContaining({ event: 'request', method: 'PUT', route: null, status: 405 }),
      ]),
    );
  });

  it('logs an exception by its name, never its message', () => {
    const lines: string[] = [];
    logUnhandled((line) => lines.push(line), null, new RangeError(`bad ${LATITUDE}`));
    const odd = new Error('x');
    odd.name = `Name with ${TOKEN} in it`;
    logUnhandled((line) => lines.push(line), null, odd);
    logUnhandled((line) => lines.push(line), null, 'a thrown string');
    expect(lines).toEqual([
      '{"event":"unhandled","route":null,"error":"RangeError"}',
      '{"event":"unhandled","route":null,"error":"unknown"}',
      '{"event":"unhandled","route":null,"error":"unknown"}',
    ]);
  });

  it('logs a method it does not know as OTHER', () => {
    expect(loggedMethod('GET')).toBe('GET');
    expect(loggedMethod(`X-${TOKEN}`)).toBe('OTHER');
  });

  it('passes every line through one redaction: a token, a signature, a latitude and a display name do not survive — #791', () => {
    const lines: string[] = [];
    const signature = 'ab'.repeat(64);
    logEvent((line) => lines.push(line), 'sign-in', {
      sessionToken: TOKEN,
      signature,
      latitude: Number(LATITUDE),
      displayName: 'Ann Rider',
      nested: { lat: LATITUDE },
      // Under a key that IS loggable, a long secret is still cut.
      code: signature,
      status: 401,
    });
    const written = lines.join('');
    for (const secret of [TOKEN, signature, LATITUDE, '51.50', 'Ann Rider']) {
      expect(written).not.toContain(secret);
    }
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      event: 'sign-in',
      sessionToken: REDACTED,
      signature: REDACTED,
      latitude: REDACTED,
      displayName: REDACTED,
      nested: REDACTED,
      code: REDACTED,
      status: 401,
    });
  });
});
