// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin Rooms page (#2649, ADR 0069 D-2, D-4, D-8), driven through the
 * REAL handler over a real SQLite file, with the room workers a list the
 * test fills (`operate/rooms-testing.ts`). What the page shows is held to
 * what `GET /v1/operate/rooms` answers the owner's SEALED request in the same
 * test; an end is read back through that route, the store and the operator
 * log. That the sockets close `4005` on real workers is
 * `rooms-page-instance.test.ts`'s, on the running instance.
 */

import { ROOM_NOT_ENDED_TEXT, roomLine } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { escapeHtml } from '../html.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  startModerationWorld,
  type ModerationWorld,
  type Rider,
} from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { roomShortCode } from '../operate/operate.ts';
import { fakeRoomRouter, type FakeRoomRouter } from '../operate/rooms-testing.ts';
import { json, type Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { madeRoom } from '../rooms/rooms-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import {
  adminBrowser,
  handlerOver,
  passkeySessionOn,
  signInWith,
  steppedUpForm,
  type AdminBrowser,
  type HandlerOver,
  type PasskeySession,
} from './admin-testing.ts';
import { ROOM_ENDED_TEXT, ROOMS_READS_ONLY_TEXT } from './pages.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

const PORT = 8788;

interface Opened {
  readonly made: ModerationWorld;
  readonly router: FakeRoomRouter;
  readonly ann: Rider;
  readonly bea: Rider;
  readonly cal: Rider;
  /** Ann's race, which Bea is in, and Cal's group ride. */
  readonly race: { readonly roomId: string; readonly code: string };
  readonly ride: { readonly roomId: string };
}

/** Two rooms with three riders in them, as the workers hold them. */
async function opened(
  options: { readonly loopbackPort?: number; readonly routes?: readonly Route[] } = {},
): Promise<Opened> {
  const router = fakeRoomRouter();
  const made = await startModerationWorld({
    admin: options.loopbackPort === undefined ? {} : { loopbackPort: options.loopbackPort },
    operateRooms: router,
    ...(options.routes === undefined ? {} : { routes: options.routes }),
  });
  worlds.push(made);
  const ann = await made.rider('Ann');
  const bea = await made.rider('Bea');
  const cal = await made.rider('Cal');
  const race = await madeRoom(made, ann.token);
  expect((await made.as(bea, 'POST', '/v1/rooms/join', { code: race.code })).status).toBe(200);
  made.clock.ms += 60_000;
  const ride = await madeRoom(made, cal.token, { kind: 'group' });
  router.held.push(
    { roomId: race.roomId, phase: 'countdown', athleteIds: [ann.athleteId, bea.athleteId] },
    { roomId: ride.roomId, phase: 'running', athleteIds: [cal.athleteId] },
  );
  return { made, router, ann, bea, cal, race, ride };
}

const paths = (made: ModerationWorld) => ({ database: made.path, blobs: `${made.path}.blobs` });
const clockOf = (made: ModerationWorld) => () => new Date(made.clock.ms);
const tunnel = (made: ModerationWorld): AdminBrowser => adminBrowser(made.instance.handler);
const passkeySession = (made: ModerationWorld, browser = tunnel(made)): Promise<PasskeySession> =>
  passkeySessionOn(browser, paths(made), clockOf(made));

async function codeSession(made: ModerationWorld): Promise<string> {
  const { code } = await adminCode(paths(made), clockOf(made));
  return signInWith(made.instance.handler, code);
}

interface RoomAnswer {
  readonly roomId: string;
  readonly shortCode: string;
  readonly kind: 'group' | 'race' | 'lap-race';
  readonly visibility: 'private' | 'public';
  readonly phase: 'lobby' | 'countdown' | 'riding' | 'finished';
  readonly openedAt: string;
  readonly host: string | null;
  readonly riders: readonly (string | null)[];
}

/** The rooms as the app's Rooms panel reads them: sealed, through the real route. */
async function rooms(made: ModerationWorld): Promise<RoomAnswer[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/rooms');
  expect(read.status).toBe(200);
  return (read.body as { rooms: RoomAnswer[] }).rooms;
}

const isOpen = async (made: ModerationWorld, roomId: string): Promise<boolean> =>
  (await made.freshRead((store) => store.getPrivateRoom(roomId)))?.closedAt === null;

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

async function endLog(made: ModerationWorld): Promise<LogEntry[]> {
  const read = await made.as(made.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries
    .filter((entry) => entry.action === 'room_ended')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();
}

async function page(browser: AdminBrowser, token: string): Promise<string> {
  const answer = await browser.send('GET', '/admin/rooms', { cookie: token });
  expect(answer.status).toBe(200);
  return answer.text();
}

/** End room as the page's script makes it: a step-up over these fields, then the form. */
async function endThrough(
  browser: AdminBrowser,
  session: PasskeySession,
  fields: Readonly<Record<string, string>>,
): Promise<Response> {
  const form = await steppedUpForm(browser, session, 'room_end', fields, { page: '/admin/rooms' });
  return browser.send('POST', '/admin/rooms/end', { cookie: session.token, form });
}

/**
 * Whether a drawn page says `needle`, looking past the runs of hex it draws:
 * a room id is 32 hex digits and the CSRF token 64, and a short number is in
 * one of them by chance, about one run in twenty (found by flaking, once).
 */
const says = (html: string, needle: string): boolean =>
  html.replace(/[0-9a-fA-F]{12,}/g, '').includes(needle);

/** A room's row as the page draws it (#2771), from the package's words. */
const lineHtml = (room: RoomAnswer): string => {
  const { kind, rest } = roomLine(room, 'UTC');
  return `<tr><td><strong>${escapeHtml(kind)}</strong></td><td>${rest
    .map((part, index) =>
      typeof part === 'string'
        ? escapeHtml(index === 0 ? part.replace(/^, /, '') : part)
        : `<code>${escapeHtml(part.code)}</code>`,
    )
    .join('')}</td></tr>`;
};

describe('the Rooms page is the route’s answer (#2649)', () => {
  it('draws every open room as GET /v1/operate/rooms answers it, and a code session no End room', async () => {
    const { made, race, ride } = await opened();
    const html = await page(tunnel(made), await codeSession(made));
    const listed = await rooms(made);
    expect(listed.map((room) => room.roomId)).toEqual([ride.roomId, race.roomId]);
    for (const room of listed) expect(html).toContain(lineHtml(room));
    expect(html).toContain('2 riders: Ann and Bea.');
    expect(html).toContain(escapeHtml(ROOMS_READS_ONLY_TEXT));
    expect(html).not.toContain('data-step-up');
  });

  it('copies only the route’s declared fields: a place and a power an answer carried are never drawn', async () => {
    const planted: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/rooms' && route.method === 'GET'
        ? {
            ...route,
            handle: async (context) => {
              const real = (await (await route.handle(context)).json()) as {
                rooms: Record<string, unknown>[];
              };
              return json({
                rooms: real.rooms.map((room) => ({
                  ...room,
                  distanceMeters: 48_213.75,
                  powerWatts: 317,
                  positions: [{ lat: 51.5074, lon: -0.1278 }],
                })),
              });
            },
          }
        : route,
    );
    const { made } = await opened({ routes: planted });
    const session = await passkeySession(made);
    for (const html of [
      await page(tunnel(made), session.token),
      await page(tunnel(made), await codeSession(made)),
    ]) {
      expect(html).toContain('Ann and Bea');
      for (const absent of ['317', '48213', '51.5074', '-0.1278', 'powerWatts', 'lat']) {
        expect(says(html, absent), absent).toBe(false);
      }
    }
  });

  it('says the rooms could not be read when the route’s answer is not in its shape', async () => {
    const routes: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/rooms' && route.method === 'GET'
        ? { ...route, handle: () => Promise.resolve(json({ rooms: [{ roomId: 1 }] })) }
        : route,
    );
    const { made } = await opened({ routes });
    expect(await page(tunnel(made), await codeSession(made))).toContain(
      'The rooms could not be read from the instance',
    );
  });
});

describe('End room through the page is the route’s own (#2649, ADR 0069 D-2, D-8)', () => {
  it('ends the race by its typed code: closed, gone from the list on a reload, the ride still listed, and logged under admin_tunnel', async () => {
    const { made, router, race, ride } = await opened();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const answer = await endThrough(browser, session, {
      roomId: race.roomId,
      reason: 'abuse',
      confirm: roomShortCode(race.roomId).toUpperCase(),
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await answer.text()).toContain(ROOM_ENDED_TEXT);
    // Read back: the workers were asked to close it, the store holds it closed, the route lists the ride alone.
    expect(router.ended).toEqual([race.roomId]);
    expect(await isOpen(made, race.roomId)).toBe(false);
    expect(await isOpen(made, ride.roomId)).toBe(true);
    expect((await rooms(made)).map((room) => room.roomId)).toEqual([ride.roomId]);
    const reloaded = await page(browser, session.token);
    expect(reloaded).not.toContain(race.roomId);
    expect(reloaded).toContain(ride.roomId);
    expect(await endLog(made)).toEqual([
      {
        source: 'admin_tunnel',
        action: 'room_ended',
        detail: 'abuse,race,riders=2',
        outcome: 'done',
      },
    ]);
  });

  it('logs an end on the server machine under admin_loopback', async () => {
    const { made, race } = await opened({ loopbackPort: PORT });
    const browser = adminBrowser(made.instance.handler, { loopback: PORT });
    const session = await passkeySession(made, browser);
    const answer = await endThrough(browser, session, {
      roomId: race.roomId,
      reason: 'stuck',
      confirm: roomShortCode(race.roomId),
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await endLog(made)).toEqual([
      {
        source: 'admin_loopback',
        action: 'room_ended',
        detail: 'stuck,race,riders=2',
        outcome: 'done',
      },
    ]);
  });

  it('does not say the room was ended when the route answered so and the list read back still holds it', async () => {
    const routes: readonly Route[] = ROUTES.map((route) =>
      route.path === '/v1/operate/rooms/{roomId}/end'
        ? { ...route, handle: () => Promise.resolve(json({ endedAt: '2026-09-21T00:00:00.000Z' })) }
        : route,
    );
    const { made, race } = await opened({ routes });
    const answer = await endThrough(tunnel(made), await passkeySession(made), {
      roomId: race.roomId,
      reason: 'other',
      confirm: roomShortCode(race.roomId),
    });
    const html = await answer.text();
    expect(html).not.toContain(ROOM_ENDED_TEXT);
    expect(html).toContain(escapeHtml(ROOM_NOT_ENDED_TEXT));
  });

  it('does not say the room was left as it was when it ended and the list cannot be read back', async () => {
    let ended = false;
    const routes: readonly Route[] = ROUTES.map((route) => {
      if (route.path === '/v1/operate/rooms/{roomId}/end') {
        return {
          ...route,
          handle: async (context) => {
            const answer = await route.handle(context);
            ended = answer.status === 200;
            return answer;
          },
        };
      }
      if (route.path === '/v1/operate/rooms' && route.method === 'GET') {
        return {
          ...route,
          handle: (context) =>
            ended ? Promise.resolve(json({ rooms: [{ roomId: 1 }] })) : route.handle(context),
        };
      }
      return route;
    });
    const { made, race } = await opened({ routes });
    const answer = await endThrough(tunnel(made), await passkeySession(made), {
      roomId: race.roomId,
      reason: 'other',
      confirm: roomShortCode(race.roomId),
    });
    expect(answer.status).toBe(200);
    expect(await isOpen(made, race.roomId)).toBe(false);
    const html = await answer.text();
    expect(html).toContain('The rooms could not be read from the instance');
    expect(html).not.toContain(escapeHtml(ROOM_NOT_ENDED_TEXT));
  });
});

describe('a wrong code, no code, or a step-up for another change ends nothing (#2649, ADR 0069 D-4)', () => {
  it('leaves both rooms open, nothing asked of the workers, and nothing logged', async () => {
    const { made, router, race, ride } = await opened();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, session.token))?.[1];

    // The wrong code, with a step-up made for it: the route's own check refuses it.
    const wrong = await endThrough(browser, session, {
      roomId: race.roomId,
      reason: 'other',
      confirm: roomShortCode(ride.roomId),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain(escapeHtml(ROOM_NOT_ENDED_TEXT));

    // No code at all: the form names no one change.
    const missing = await browser.send('POST', '/admin/rooms/end', {
      cookie: session.token,
      form: { csrf: csrf as string, roomId: race.roomId, reason: 'other' },
    });
    expect(missing.status).toBe(400);

    // A step-up for back up now, posted with End room's fields.
    const other = await steppedUpForm(browser, session, 'backup_now', {}, { page: '/admin/rooms' });
    const elsewhere = await browser.send('POST', '/admin/rooms/end', {
      cookie: session.token,
      form: { ...other, roomId: race.roomId, reason: 'other', confirm: roomShortCode(race.roomId) },
    });
    expect(elsewhere.status).toBe(403);

    // A step-up for the ride, posted for the race.
    const forRide = await steppedUpForm(
      browser,
      session,
      'room_end',
      { roomId: ride.roomId, reason: 'other', confirm: roomShortCode(ride.roomId) },
      { page: '/admin/rooms' },
    );
    const swapped = await browser.send('POST', '/admin/rooms/end', {
      cookie: session.token,
      form: { ...forRide, roomId: race.roomId, confirm: roomShortCode(race.roomId) },
    });
    expect(swapped.status).toBe(403);

    // A code session, and a room id the route could not have named.
    const code = await codeSession(made);
    const codeCsrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page(browser, code))?.[1];
    const fromCode = await browser.send('POST', '/admin/rooms/end', {
      cookie: code,
      form: {
        csrf: codeCsrf as string,
        roomId: race.roomId,
        reason: 'other',
        confirm: roomShortCode(race.roomId),
      },
    });
    expect(fromCode.status).toBe(403);
    const malformed = await browser.send('POST', '/admin/rooms/end', {
      cookie: session.token,
      form: { csrf: csrf as string, roomId: '../../log', reason: 'other', confirm: 'x' },
    });
    expect(malformed.status).toBe(400);
    // A reason that is not one of the closed list, and a typed code past any room's.
    for (const bad of [
      { reason: 'because', confirm: roomShortCode(race.roomId) },
      { reason: 'other', confirm: 'x'.repeat(65) },
    ]) {
      const refused = await browser.send('POST', '/admin/rooms/end', {
        cookie: session.token,
        form: { csrf: csrf as string, roomId: race.roomId, ...bad },
      });
      expect(refused.status, bad.reason).toBe(400);
    }

    expect(router.ended).toEqual([]);
    expect(await isOpen(made, race.roomId)).toBe(true);
    expect(await isOpen(made, ride.roomId)).toBe(true);
    expect((await rooms(made)).map((room) => room.roomId)).toEqual([ride.roomId, race.roomId]);
    expect(await endLog(made)).toEqual([]);
  });
});

describe('owner-only, checked on the instance (#2649, the epic’s constraint)', () => {
  it('with no session, sent to sign in; once the owner key names another athlete, refused and the session ended — the room still open, read back', async () => {
    const { made, router, race } = await opened();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(
      browser,
      session,
      'room_end',
      { roomId: race.roomId, reason: 'other', confirm: roomShortCode(race.roomId) },
      { page: '/admin/rooms' },
    );
    const none = await browser.send('POST', '/admin/rooms/end', { form });
    expect(none.status).toBe(303);
    expect(none.headers.get('location')).toBe('/admin/sign-in');

    const moved = await handlerOver(made.path, made.clock, {
      owner: made.deputy.device.publicKey,
    });
    restarted.push(moved);
    const refused = await adminBrowser(moved.handler).send('POST', '/admin/rooms/end', {
      cookie: session.token,
      form,
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/admin/sign-in');
    expect(await isOpen(made, race.roomId)).toBe(true);
    expect(router.asked).toEqual([]);
    expect(
      await made.freshRead(async (store) => store.findAdminSession(await sha256Hex(session.token))),
    ).toBeUndefined();
    expect(await endLog(made)).toEqual([]);
  });
});

describe('the operator log entry is the close’s: a log that cannot be written leaves the room open (#2649)', () => {
  it('answers that something went wrong, the room is still open in the store and the route, and the attempt is logged failed', async () => {
    const { made, race } = await opened();
    const browser = tunnel(made);
    const session = await passkeySession(made);
    const form = await steppedUpForm(
      browser,
      session,
      'room_end',
      { roomId: race.roomId, reason: 'other', confirm: roomShortCode(race.roomId) },
      { page: '/admin/rooms' },
    );
    const database = openDatabase(made.path);
    try {
      database.exec(
        "create trigger refuse_room_log before insert on operator_log when new.action = 'room_ended' and new.outcome = 'done' begin select raise(abort, 'the log is down'); end",
      );
    } finally {
      database.close();
    }
    const answer = await browser.send('POST', '/admin/rooms/end', { cookie: session.token, form });
    expect(answer.status).toBe(500);
    expect(await answer.text()).toContain('Nothing was changed.');
    expect(await isOpen(made, race.roomId)).toBe(true);
    expect((await rooms(made)).some((room) => room.roomId === race.roomId)).toBe(true);
    expect(await endLog(made)).toEqual([
      { source: 'admin_tunnel', action: 'room_ended', detail: null, outcome: 'failed' },
    ]);
  });
});

describe('no secret and no coordinate on any Rooms answer (#2649, CLAUDE.md §6)', () => {
  it('says none of the instance’s secrets, tokens or codes, nor any rider’s id', async () => {
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2649-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2649');
    const { made, ann, bea, cal, race, ride } = await opened();
    const browser = tunnel(made);
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const { code } = await adminCode(paths(made), clockOf(made));
    const codeToken = await signInWith(made.instance.handler, code);
    const session = await passkeySession(made);
    const said: string[] = [];
    const keep = async (answer: Response): Promise<void> => {
      for (const [name, value] of answer.headers.entries()) {
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      said.push(await answer.text());
    };
    await keep(await browser.send('GET', '/admin/rooms', { cookie: codeToken }));
    await keep(await browser.send('GET', '/admin/rooms', { cookie: session.token }));
    await keep(
      await endThrough(browser, session, { roomId: ride.roomId, reason: 'other', confirm: 'nope' }),
    );
    await keep(
      await endThrough(browser, session, {
        roomId: race.roomId,
        reason: 'other',
        confirm: roomShortCode(race.roomId),
      }),
    );
    await keep(await browser.send('POST', '/admin/rooms/end', { cookie: codeToken, form: {} }));
    said.push(...made.instance.lines, JSON.stringify(await endLog(made)));
    const everything = said.join('\n');
    for (const marker of [
      secret,
      'MARKER-metrics-token-2649',
      'MARKER-tunnel-token-2649',
      made.owner.token,
      ann.token,
      session.token,
      codeToken,
      code,
      code.replaceAll('-', ''),
      made.owner.device.publicKey,
      ann.athleteId,
      bea.athleteId,
      cal.athleteId,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
    expect(everything).not.toMatch(/-?\d{1,3}\.\d{4,}/);
  });
});
