// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The device's masking limits and the instance's are one set** — #1796.
 *
 * The device reads its guard from its own store with `@onyourleft/analysis`
 * §`readMaskingGuard` and sends it as the `masking` item's body
 * (`apps/web` §`hosted-settings.ts` §`sendMaskingGuard`, whose shape is
 * {@link MaskingItemBody}). Here that read runs over the widest store the
 * device can hold, the body is built as the device builds it, and the
 * instance's reader must take every word and every zone of it. Then the sync
 * write path: a list the instance cannot read is refused when it is sent, so
 * the device is told then, not by every hosted job failing later.
 */

import {
  MAXIMUM_MASKED_WORD_LENGTH,
  MAXIMUM_MASKED_WORDS,
  readMaskingGuard as readDeviceGuard,
  type MaskingGuard,
  type MaskingZone,
} from '@onyourleft/analysis';
import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { authorised, syncWorld } from '../sync/sync-testing.ts';
import { MASKING_ITEM_KEY, parseMaskingItem, type MaskingItemBody } from './masking-item.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** The body as the device sends it: `sendMaskingGuard`'s mapping, field for field. */
function deviceBody(guard: MaskingGuard): string {
  return JSON.stringify({
    words: guard.words,
    zones: guard.zones.map((zone) => ({
      label: zone.label,
      latitude: zone.centre.latitude,
      longitude: zone.centre.longitude,
      radius: zone.radius,
    })),
  } satisfies MaskingItemBody);
}

function zone(latitude: number, longitude: number, radius: number, label: string): MaskingZone {
  return {
    centre: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
    radius,
    label,
  };
}

describe('every list the device can send is one the instance reads (#1796)', () => {
  it('reads the most words at their longest, and every zone the device’s store can hold', async () => {
    // More than the device keeps, and longer: the device's own read drops them
    // before anything is sent, so the instance never sees one it would refuse.
    const stored = Array.from(
      { length: MAXIMUM_MASKED_WORDS + 5 },
      (_unused, index) =>
        `${String(index).padStart(3, '0')}${'w'.repeat(MAXIMUM_MASKED_WORD_LENGTH - 3)}`,
    );
    stored.push('x'.repeat(MAXIMUM_MASKED_WORD_LENGTH + 1));
    const zones = [
      // Nought is a distance the store's `metres` accepts: until #1796 it refused the whole list.
      zone(51.5, -0.12, 0, 'Home'),
      zone(-89.999, 179.999, 250, 'Grand-mère’s — 祖母の家'),
      zone(0, 0, 1e7, ''),
    ];
    const guard = await readDeviceGuard(
      {
        getAthlete: async () => Promise.resolve({ maskedWords: stored }),
        listPrivacyZones: async () => Promise.resolve(zones),
      },
      'athlete',
    );
    expect(guard.words).toHaveLength(MAXIMUM_MASKED_WORDS);
    const read = parseMaskingItem(deviceBody(guard));
    expect(read).toStrictEqual(guard);
    expect(read?.zones.map((each) => each.radius)).toStrictEqual([0, 250, 1e7]);
  });

  it('still refuses what no device store holds: a negative radius, a latitude past the pole', () => {
    const body = (radius: number, latitude: number) =>
      JSON.stringify({ words: [], zones: [{ label: 'x', latitude, longitude: 0, radius }] });
    expect(parseMaskingItem(body(0, 0))).toBeDefined();
    expect(parseMaskingItem(body(-0.5, 0))).toBeUndefined();
    expect(parseMaskingItem(body(5, 90.5))).toBeUndefined();
  });
});

describe('the sync write path refuses a list it could not read (#1796)', () => {
  it('answers validation_failed, naming no word or coordinate, and keeps nothing', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const path = `/v1/sync/items/masking/${MASKING_ITEM_KEY}`;
    const unreadable = JSON.stringify({
      words: ['Zennor'],
      zones: [{ label: 'Home', latitude: 50.1903, longitude: -5.5672, radius: -1 }],
    });
    const refused = await authorised(world, token, 'POST', path, { body: unreadable });
    expect(refused.status).toBe(400);
    const said = await refused.text();
    expect(said).toContain('must be a masking list of words and privacy zones');
    for (const value of ['Zennor', 'Home', '50.19', '-5.56']) expect(said).not.toContain(value);
    expect((await authorised(world, token, 'GET', path)).status).toBe(404);

    // The control: the same list with a radius the device's store holds is kept.
    const readable = unreadable.replace('"radius":-1', '"radius":0');
    expect((await authorised(world, token, 'POST', path, { body: readable })).status).toBe(200);
    expect((await authorised(world, token, 'GET', path)).status).toBe(200);
  });

  it('takes any other kind of item as it is sent', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const answer = await authorised(world, token, 'POST', '/v1/sync/items/note/n-1', {
      body: 'not a masking list, and not meant to be',
    });
    expect(answer.status).toBe(200);
  });
});

describe('a deleted item leaves no bytes behind (#1796)', () => {
  /** A place no other bytes in the database spell: a zone's label and its centre. */
  const LABEL = 'Penwith-1796-Lane';
  const LATITUDE = 50.190_317;
  const LIST = JSON.stringify({
    words: ['Anneliese'],
    zones: [{ label: LABEL, latitude: LATITUDE, longitude: -5.567_2, radius: 300 }],
  } satisfies MaskingItemBody);

  it('withdrawing the agreement deletes the list, and its zones are in neither the database nor its log', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const path = `/v1/sync/items/masking/${MASKING_ITEM_KEY}`;
    expect((await authorised(world, token, 'POST', path, { body: LIST })).status).toBe(200);
    expect(await world.databaseBytes(), 'the control: it was there').toContain(LABEL);

    const withdrawn = await world.call('DELETE', '/v1/analysis/hosted/consent', { token });
    expect(withdrawn.status).toBe(200);
    // Read at once: a later request's own writes could checkpoint the log for it.
    const after = await world.databaseBytes();
    expect(after).not.toContain(LABEL);
    expect(after).not.toContain(String(LATITUDE));
    expect((await authorised(world, token, 'GET', path)).status).toBe(404);
  });

  it('a sync delete of any other kind scrubs it too: a note naming a street', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const path = '/v1/sync/items/note/n-1796';
    const note = `Meet at ${LABEL}, by the gate.`;
    expect((await authorised(world, token, 'POST', path, { body: note })).status).toBe(200);
    expect(await world.databaseBytes(), 'the control: it was there').toContain(LABEL);
    expect((await authorised(world, token, 'DELETE', path)).status).toBe(204);
    expect(await world.databaseBytes()).not.toContain(LABEL);
  });
});

describe('an overwritten item leaves no bytes behind (#1944)', () => {
  /** A place no other bytes in the database spell: a zone's label and its centre. */
  const LABEL = 'Lamorna-1944-Cove';
  const LATITUDE = 50.061_429;
  const LIST = JSON.stringify({
    words: ['x'],
    zones: [{ label: LABEL, latitude: LATITUDE, longitude: -5.563_1, radius: 250 }],
  } satisfies MaskingItemBody);
  const WITHOUT_THE_ZONE = JSON.stringify({ words: ['x'], zones: [] } satisfies MaskingItemBody);

  it('a removed privacy zone is in neither the database nor its log once the list is sent again', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const path = `/v1/sync/items/masking/${MASKING_ITEM_KEY}`;
    expect((await authorised(world, token, 'POST', path, { body: LIST })).status).toBe(200);
    expect((await world.databaseBytes()).includes(LABEL), 'the control: it was there').toBe(true);

    // The device rewrites the list before every hosted job; this one has the zone removed.
    const sent = await authorised(world, token, 'POST', path, { body: WITHOUT_THE_ZONE });
    expect(sent.status).toBe(200);
    // Read at once: a later request's own writes could checkpoint the log for it.
    const after = await world.databaseBytes();
    expect(after.includes(LABEL), 'the removed zone’s label').toBe(false);
    expect(after.includes(String(LATITUDE)), 'the removed zone’s centre').toBe(false);
    const read = await authorised(world, token, 'GET', path);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { body: string }).body).toBe(WITHOUT_THE_ZONE);
  });

  it('any other kind is scrubbed on an overwrite too: a note that named a street', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    const path = '/v1/sync/items/note/n-1944';
    const note = `Meet at ${LABEL}, by the gate.`;
    expect((await authorised(world, token, 'POST', path, { body: note })).status).toBe(200);
    expect((await world.databaseBytes()).includes(LABEL), 'the control: it was there').toBe(true);
    const edited = 'Meet at the usual place.';
    expect((await authorised(world, token, 'POST', path, { body: edited })).status).toBe(200);
    expect((await world.databaseBytes()).includes(LABEL), 'the edited-out street').toBe(false);
    const read = await authorised(world, token, 'GET', path);
    expect(((await read.json()) as { body: string }).body).toBe(edited);
  });
});
