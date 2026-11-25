// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's sex and year of birth (#2432) never leave the device except in
 * their own account export — the owner's ruling of 2026-11-09 on #2430.
 *
 * **And the rider drawn (`riderBody`, #2839) with them**: since the owner's
 * ruling of 2026-11-20 it is the same word as the calorie sex, so sending it
 * sends the sex. The owner's room-privacy ruling of the same day is that it
 * may leave **only through the multiplayer room path that shows other riders
 * your rider**, as any game avatar is shown; nothing else of the calorie
 * inputs ever does.
 *
 * ⚠️ **No room sends the rider today.** `net/room-session.ts` and the room
 * wire format (`packages/protocol`) carry no rider, so this guard admits no
 * path at all. The rooms lane that sends it admits its one module here, for
 * `riderBody` only, in the change that sends it — `calorieSex` and `birthYear`
 * stay admitted nowhere.
 *
 * Two halves, each with its limit stated:
 *
 * - **By behaviour**: the ride-analysis input, which an instance's write-up
 *   (`ride-analysis/instance-analysis.ts`) and a synced ride summary
 *   (`ride-analysis/ride-summary.ts`) are both built from, is read through
 *   the real store for a rider who has chosen a rider and set a year, and
 *   carries none of the three. The sync bodies themselves are held in
 *   `instance/sync.test.ts` §"the calorie inputs never leave the device
 *   through a sync".
 * - **By source**: no module that builds an instance-bound, room-bound or
 *   model-bound body — instance analysis, sync, ride write-ups, camera
 *   uploads, re-plan jobs, rooms and their wire format, the AI pacer's state
 *   (`game/model-pacer.ts`, `packages/domain/src/pacer`) — names any of the
 *   three fields. A module that only hands a sender port on, or reads its
 *   replies, is named in `PASS_THROUGH` and scanned too, so a module that
 *   type-imports a port and builds the body it is handed (#2845's review:
 *   `model-pacer.ts` for `PacerPort.decidePacer`) is under a root or red.
 *   This is what catches a future body that reads the row and copies them,
 *   which no behavioural test written today can foresee; it
 *   cannot catch a spread of the whole athlete row, which the behavioural half
 *   and `export-everything.ts`' named-fields rule are for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unixSeconds } from '@onyourleft/domain';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRideInput } from '../ride-analysis/read-input';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('the calorie inputs stay on the device (#2432)', () => {
  it('are in no ride-analysis input, which a write-up and a synced summary are built from', async () => {
    const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
      await store.setAthleteRider(ATHLETE_A, 'female');
      await store.setAthleteBirthYear(ATHLETE_A, 1985);
    });

    const input = await harness.read(async (store) =>
      readRideInput(store, ATHLETE_A, ride.id, { templateVersion: 't', cameraConsented: true }),
    );
    expect(input).toBeDefined();
    const sent = JSON.stringify(input);
    expect(sent).not.toContain('calorieSex');
    expect(sent).not.toContain('birthYear');
    expect(sent).not.toContain('riderBody');
    expect(sent).not.toContain('female');
    expect(sent).not.toContain('1985');
  });

  it('are named by no module that builds a body for an instance, a room or a model', () => {
    const offenders: string[] = [];
    for (const root of [...BODY_ROOTS, ...PASS_THROUGH.map((name) => join(HERE, '..', name))]) {
      for (const file of sources(root)) {
        if (FIELDS.test(readFileSync(file, 'utf8'))) offenders.push(relative(HERE, file));
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('every module that reaches an instance or a room is under a root the scan reads', () => {
    // So a new sender in a directory nobody listed is red here rather than
    // unscanned: a module that imports a transport, or imports a sender port
    // even for its type, is under a root, a named pass-through, or one of the
    // named modules that draw the rider.
    const web = join(HERE, '..');
    const scanned = (file: string): boolean => BODY_ROOTS.some((root) => file.startsWith(root));
    const outside: string[] = [];
    for (const file of sources(web)) {
      const name = relative(web, file);
      if (scanned(file) || PASS_THROUGH.includes(name) || name in DRAWS_THE_RIDER) continue;
      if (SENDS.test(readFileSync(file, 'utf8'))) outside.push(name);
    }
    expect(outside).toStrictEqual([]);
  });

  it('the completeness check is red for a module that type-imports a sender port', () => {
    expect(SENDS.test("import type { PacerPort } from '../instance/pacer-port';")).toBe(true);
    expect(SENDS.test("import type { RoomConnection } from '../net/room-port';")).toBe(true);
    expect(SENDS.test("import { createSyncPort } from './instance/sync-port';")).toBe(true);
    expect(SENDS.test("import type { SealedInstance } from './instance-transport';")).toBe(false);
    expect(SENDS.test("import type { InstancePort } from '../instance/instance-port';")).toBe(
      false,
    );
  });

  it('the scan is red for a body that names the rider drawn', () => {
    expect(FIELDS.test('const body = { riderBody: athlete.riderBody };')).toBe(true);
    expect(FIELDS.test('const body = { calorieSex };')).toBe(true);
    expect(FIELDS.test('const body = { birthYear };')).toBe(true);
    expect(FIELDS.test('const body = { kitColour };')).toBe(false);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));

/** The three fields, which are one health input since 2026-11-20. */
const FIELDS = /\b(calorieSex|birthYear|riderBody)\b/;

/** Where a body bound for an instance, a room or a model is built. */
const BODY_ROOTS = [
  join(HERE, '..', 'instance'),
  join(HERE, '..', 'net'),
  join(HERE, '..', 'rooms'),
  join(HERE, '..', 'ride-analysis'),
  join(HERE, '..', 'camera'),
  join(HERE, '..', 'workout'),
  join(HERE, '..', 'game', 'lap-race'),
  join(HERE, '..', 'game', 'room-ride.ts'),
  join(HERE, '..', 'game', 'hud', 'RoomReport.tsx'),
  join(HERE, '..', 'game', 'model-pacer.ts'),
  join(HERE, '..', 'detail', 'write-up.ts'),
  join(HERE, '..', '..', '..', '..', 'packages', 'analysis', 'src'),
  join(HERE, '..', '..', '..', '..', 'packages', 'protocol', 'src'),
  join(HERE, '..', '..', '..', '..', 'packages', 'domain', 'src', 'pacer'),
];

/**
 * The ports whose calls carry a body the caller built from the ride or the
 * rider, to an instance, a room or a model. A module that imports one, even
 * for its type, may be handing it the body (#2845's review), so it is under a
 * root or named below. The account and operator ports (`instance-port`,
 * `statements-`, `blocks-`, `moderation-`, `operate-`, `hosted-settings-port`)
 * carry no ride or rider state and are not listed.
 */
const SENDER_PORTS = [
  'instance/pacer-port',
  'instance/sync-port',
  'instance/ghost-port',
  'instance/leaderboard-port',
  'net/room-port',
  'net/rooms-port',
  'ride-analysis/instance-analysis-port',
  'workout/replan-port',
  'game/lap-race/model-tactics-port',
  'camera/side-instance-port',
];

/**
 * A value import of the one instance transport (#777), the room session or the
 * room wire format — a type-only import of those sends nothing — or any
 * import of a {@link SENDER_PORTS} module.
 */
const SENDS = new RegExp(
  String.raw`\bimport\s+(?!type\b)[^;]*?from '[^']*(instance-transport|net\/room-session|@onyourleft\/protocol)'` +
    String.raw`|\bimport\s[^;]*?from '[^']*/(` +
    SENDER_PORTS.map((port) => port.split('/').at(-1)).join('|') +
    `)'`,
);

/**
 * Modules outside the roots that hand a sender port on, or read its replies,
 * and build no body. Scanned for the three fields like a root.
 */
const PASS_THROUGH = [
  'detail/RideWriteUpSection.tsx', // hands the write-up port to the write-up control
  'game/StageChooser.tsx', // reads the pacer's status
  'ride/controller.ts', // hands the re-plan port to `workout/replan-session.ts`
  'segments/InstanceBoard.tsx', // reads leaderboard answers
  'segments/InstanceSegments.tsx', // reads leaderboard answers
  'views/ActivityDetailView.tsx', // hands the write-up port on
  'views/CameraView.tsx', // hands the side-picture port on
  'views/InstanceDevices.tsx', // the sync key's fingerprint
  'views/InstanceView.tsx', // hands the sync port on
  'views/SegmentDetailView.tsx', // hands the leaderboard port on
  'views/SegmentsView.tsx', // hands the leaderboard port on
  'views/SideInstancePictures.tsx', // asks for the pictures the side camera kept
  'views/SyncPanel.tsx', // runs a sync, whose bodies `instance/sync.ts` builds
];

/**
 * Modules that hand the sender ports on and name the rider to draw it, so the
 * name scan cannot read them; each is held by the test named.
 */
const DRAWS_THE_RIDER: Readonly<Record<string, string>> = {
  'main.tsx': 'composes the ports; rider-at-start-up.test.ts',
  'shell/AppShell.tsx':
    'hands the rider to GameView to draw; instance/sync.test.ts holds the sync bodies',
  'game/GameView.tsx': 'model-pacer-wiring.test.tsx §"sends no rider drawn"',
  'testing/populated-shell.tsx': 'a test shell',
};

function* sources(dir: string): Generator<string> {
  if (/\.tsx?$/.test(dir)) {
    yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}
