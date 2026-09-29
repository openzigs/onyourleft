// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Room tickets (#772) and what another rider may see (#774), through the real
 * routes and the real room core (`room/core/room.ts`) with THIS book as its
 * admission — the verifier #779's core calls at hello.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createRoom, type Outbound } from '../room/core/room.ts';
import { FLAT_COURSE, helloText, reportText } from '../room/core/room-testing.ts';
import { roomSettings } from '../room/core/settings.ts';
import { TICKET_LIFETIME_MS } from './tickets.ts';
import { startIdentityInstance, testDevice, type IdentityInstance } from './identity-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const ROOM = 'room-1';

async function withRoom(): Promise<IdentityInstance> {
  world = await startIdentityInstance();
  await world.freshRead(async (store) => {
    for (const id of [ROOM, 'room-2']) {
      await store.putRoom({
        id,
        kind: 'race',
        visibility: 'private',
        routeSha256: 'a'.repeat(64),
        physicsVersion: 1,
      });
    }
  });
  return world;
}

async function rider(w: IdentityInstance, displayName: string) {
  const session = await w.signIn(await testDevice(), { displayName });
  return {
    athleteId: session.body.athleteId as string,
    token: session.body.sessionToken as string,
  };
}

async function ticketFor(
  w: IdentityInstance,
  token: string,
  mass: number,
  room = ROOM,
): Promise<string> {
  const answer = await w.call('POST', `/v1/rooms/${room}/ticket`, {
    token,
    body: { declaredMassKilograms: mass },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  const body = answer.body as { ticket: string; expiresAt: number };
  // Unix SECONDS, like every other expiresAt in the API (#861's review).
  expect(Number.isInteger(body.expiresAt)).toBe(true);
  expect(body.expiresAt * 1000 - w.clock.ms).toBeGreaterThan(0);
  expect(body.expiresAt * 1000 - w.clock.ms).toBeLessThanOrEqual(30_000);
  return body.ticket;
}

describe('a room ticket (#772)', () => {
  it('admits its athlete, with the mass they declared, once', async () => {
    const w = await withRoom();
    const anna = await rider(w, 'Anna');
    const ticket = await ticketFor(w, anna.token, 64.5);
    const admit = w.identity.admitterFor(ROOM);
    expect(admit(ticket)).toEqual({ athleteId: anna.athleteId, declaredMassKilograms: 64.5 });
    expect(admit(ticket), 'reused').toBeUndefined();
  });

  it('refuses an expired ticket', async () => {
    const w = await withRoom();
    const ticket = await ticketFor(w, (await rider(w, 'Anna')).token, 70);
    w.clock.ms += TICKET_LIFETIME_MS;
    expect(w.identity.admitterFor(ROOM)(ticket)).toBeUndefined();
  });

  it('refuses the session token presented as a ticket', async () => {
    const w = await withRoom();
    const anna = await rider(w, 'Anna');
    await ticketFor(w, anna.token, 70);
    expect(w.identity.admitterFor(ROOM)(anna.token)).toBeUndefined();
  });

  it('refuses a ticket for another room', async () => {
    const w = await withRoom();
    const ticket = await ticketFor(w, (await rider(w, 'Anna')).token, 70, 'room-2');
    expect(w.identity.admitterFor(ROOM)(ticket)).toBeUndefined();
  });

  it('is not minted without a live session, for a room that does not exist, or for an implausible mass', async () => {
    const w = await withRoom();
    const anna = await rider(w, 'Anna');
    expect(
      (await w.call('POST', `/v1/rooms/${ROOM}/ticket`, { body: { declaredMassKilograms: 70 } }))
        .status,
    ).toBe(401);
    expect(
      (
        await w.call('POST', '/v1/rooms/no-such-room/ticket', {
          token: anna.token,
          body: { declaredMassKilograms: 70 },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.call('POST', `/v1/rooms/${ROOM}/ticket`, {
          token: anna.token,
          body: { declaredMassKilograms: 2 },
        })
      ).status,
    ).toBe(400);
  });

  it('is what the room core’s hello takes: a reused ticket, an expired one and a session token are each refused there', async () => {
    const w = await withRoom();
    const anna = await rider(w, 'Anna');
    const room = createRoom(
      roomSettings({ kind: 'race', ridingPosition: 'hoods', course: FLAT_COURSE }),
      w.identity.admitterFor(ROOM),
    );
    const ticket = await ticketFor(w, anna.token, 70);
    const refused = (out: Outbound[], connection: number) =>
      out.some(
        (o) =>
          o.kind === 'send' &&
          o.connection === connection &&
          o.message.type === 'refuse' &&
          o.message.reason === 'ticket-refused',
      );
    expect(refused(room.receive(1, helloText(ticket), 0), 1)).toBe(false);
    expect(refused(room.receive(2, helloText(ticket), 0), 2), 'reused').toBe(true);
    expect(refused(room.receive(3, helloText(anna.token), 0), 3), 'session token').toBe(true);
    const late = await ticketFor(w, anna.token, 70);
    w.clock.ms += TICKET_LIFETIME_MS + 1;
    expect(refused(room.receive(4, helloText(late), 0), 4), 'expired').toBe(true);
  });
});

describe('what another rider sees (#774)', () => {
  it('never carries A’s declared mass to B — in a frame, the finish, or A’s profile', async () => {
    const w = await withRoom();
    const a = await rider(w, 'Anna');
    const b = await rider(w, 'Bea');
    // Masses no frame's integers could spell by accident.
    const MASS_A = 73.4567;
    const room = createRoom(
      roomSettings({
        kind: 'race',
        ridingPosition: 'hoods',
        course: { ...FLAT_COURSE, lengthMetres: 60 },
        countdownMs: 0,
      }),
      w.identity.admitterFor(ROOM),
    );
    const toB: string[] = [];
    const keep = (out: Outbound[]) => {
      for (const o of out)
        if (o.kind === 'send' && o.connection === 2) toB.push(JSON.stringify(o.message));
    };
    keep(room.receive(1, helloText(await ticketFor(w, a.token, MASS_A)), 0));
    keep(room.receive(2, helloText(await ticketFor(w, b.token, 81.2345)), 0));
    keep(room.start(0));
    for (let t = 0; t < 60 && room.view().phase !== 'finished'; t += 1) {
      keep(room.receive(1, reportText(t, t * 1000 + 500, 300), t * 1000 + 500));
      keep(room.receive(2, reportText(t, t * 1000 + 500, 200), t * 1000 + 500));
      keep(room.tick((t + 1) * 1000));
    }
    expect(room.view().phase).toBe('finished');
    expect(toB.some((line) => line.includes('"finish"'))).toBe(true);
    expect(toB.some((line) => line.includes('"frame"'))).toBe(true);

    const profile = await w.call('GET', `/v1/athletes/${a.athleteId}`, { token: b.token });
    expect(profile.body).toEqual({ athleteId: a.athleteId, displayName: 'Anna' });
    toB.push(JSON.stringify(profile.body));

    const everything = toB.join('\n');
    expect(everything).not.toContain('73.4567');
    expect(everything).not.toMatch(/mass/i);
  });

  it('answers not_found for an athlete who does not exist', async () => {
    const w = await withRoom();
    const b = await rider(w, 'Bea');
    expect((await w.call('GET', '/v1/athletes/nobody', { token: b.token })).status).toBe(404);
  });
});
