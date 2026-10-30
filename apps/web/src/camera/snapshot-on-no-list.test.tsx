// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **ADR 0029 D-11 rule 1, with a side-camera snapshot on the device** —
 * #1063, ADR 0044 D-6.
 *
 * > No frame, thumbnail, crop or filmstrip appears on the activity library
 * > row, in the ride detail view's default render, … in a share sheet's
 * > preview, or in any list.
 *
 * The real shell over the real store, with a ride and its snapshot written
 * through the public path, opened at Home, the library, the library with the
 * ride selected, the ride's own page, and that page's shared-copy preview.
 * On none of them is there an image, a canvas or a video, a `blob:` or
 * `data:` URL, an object URL made, or Android's secure window held — the
 * last two because a picture that is never mounted needs neither.
 *
 * ⚠️ **The control is the last case**: the same page with the snapshot
 * section OPENED must show an image and make a URL. Without it every
 * assertion above is also true of a section that cannot show one at all.
 */

import { act } from 'react';
import type { ActivityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  snapshotFor,
  streamSetFor,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RideSnapshotsPort } from '../detail/ride-snapshots-port';
import { RIDE_SNAPSHOTS_HEADING, snapshotCountText } from '../detail/RideSnapshotsSection';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let harness: StoreHarness;
let store: PersistentStore;
let mounted: Mounted | undefined;
let made: string[];
let holds: number;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
  store = indexedDbStoreFactory.open(harness.databaseName);
  made = [];
  holds = 0;
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  store.close();
  await harness.destroy();
});

/** The ride page's snapshot port as `main.tsx` builds it, recording what it is asked. */
function snapshotsPort(): RideSnapshotsPort {
  return {
    store,
    athleteId: ATHLETE_A,
    objectUrls: {
      create: () => {
        const url = `blob:snapshot/${String(made.length + 1)}`;
        made.push(url);
        return url;
      },
      revoke: () => undefined,
    },
    holdSecureWindow: () => {
      holds += 1;
      return () => undefined;
    },
  };
}

/** A ride with a GPS trace (so its page offers the shared-copy preview) and a snapshot. */
async function rideWithSnapshot(): Promise<ActivityId> {
  const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
  await harness.write(async (writer) => {
    await writer.putStreamSet(streamSetFor(ride, { sampleCount: 120 }));
    await writer.putCameraFrame(snapshotFor(ATHLETE_A, ride.id));
  });
  return ride.id;
}

async function openShell(path: string): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      library={{ store, athleteId: ATHLETE_A }}
      detail={{ store, athleteId: ATHLETE_A }}
      analysis={{ store, athleteId: ATHLETE_A }}
      rideSnapshots={snapshotsPort()}
    />,
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await settle();
  }
}

/**
 * Every image on the page that is not the app's own artwork — the wordmark is
 * a committed PNG under `src/brand/`, in the header of every route.
 */
function picturesOnPage(): Element[] {
  return [...document.querySelectorAll('img, canvas, video, picture')].filter(
    (element) => !(element.getAttribute('src') ?? '').startsWith('/src/brand/'),
  );
}

/** Everything a picture could be on the page, and everything that would make one. */
function noPictureAnywhere(): void {
  expect(picturesOnPage()).toHaveLength(0);
  const html = document.body.innerHTML;
  expect(html).not.toMatch(/blob:|data:image/);
  expect(made).toStrictEqual([]);
  expect(holds).toBe(0);
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  );
}

describe('a snapshot is on no list and in no default render (ADR 0029 D-11 rule 1)', () => {
  it('Home', async () => {
    await rideWithSnapshot();
    await openShell('/');
    noPictureAnywhere();
  });

  it('the activity library and its rows', async () => {
    const id = await rideWithSnapshot();
    const ride = await harness.read(async (reader) => reader.getActivity(ATHLETE_A, id));
    await openShell('/activities');
    // The row is there — the list rendered the ride — and carries no picture.
    expect(document.body.textContent).toContain(ride?.name);
    noPictureAnywhere();
  });

  it('the library with the ride selected beside it', async () => {
    const id = await rideWithSnapshot();
    await openShell(`/activities/selected/${id}`);
    noPictureAnywhere();
  });

  it('the ride’s own page, by default — the section is there, closed, counted in words', async () => {
    const id = await rideWithSnapshot();
    await openShell(`/activities/${id}`);
    expect(document.body.textContent).toContain(RIDE_SNAPSHOTS_HEADING);
    expect(document.body.textContent).toContain(snapshotCountText(1));
    noPictureAnywhere();
  });

  it('the shared-copy preview of that ride', async () => {
    const id = await rideWithSnapshot();
    await openShell(`/activities/${id}`);
    const reveal = buttonNamed('Show what a shared copy would contain');
    expect(reveal).toBeDefined();
    await act(async () => {
      reveal?.click();
      await Promise.resolve();
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await settle();
    }
    noPictureAnywhere();
  });

  it('CONTROL: the same page with the section opened does show the picture', async () => {
    // The page's list read decodes the stored bytes, which under jsdom are
    // another realm's typed array; the store refuses those, so the read is
    // served by a port whose list answers with the snapshot as written. What
    // is under test is that the probe above CAN see a picture.
    const id = await rideWithSnapshot();
    const written = snapshotFor(ATHLETE_A, id);
    const port = snapshotsPort();
    globalThis.location.hash = `#/activities/${id}`;
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        detail={{ store, athleteId: ATHLETE_A }}
        rideSnapshots={{
          ...port,
          store: {
            countRideSnapshots: async () => Promise.resolve(1),
            listRideSnapshots: async () => Promise.resolve([written]),
            deleteRideSnapshot: async () => Promise.resolve(false),
          },
        }}
      />,
    );
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await settle();
    }
    const section = document.querySelector('[data-oyl-ride-snapshots] details');
    expect(section).not.toBeNull();
    await act(async () => {
      (section as HTMLDetailsElement).open = true;
      section?.dispatchEvent(new Event('toggle'));
      await Promise.resolve();
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await settle();
    }
    expect(picturesOnPage()).toHaveLength(1);
    expect(made).toHaveLength(1);
    expect(holds).toBe(1);
  });
});
