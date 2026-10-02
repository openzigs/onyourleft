// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **"May be raced" on a ride's page** (#793, ADR 0021 D-5.1): off by default,
 * set and revoked here, read back rather than assumed — and, beside it, the
 * privacy-zone refusal of ADR 0021 D-5.2.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  openActivityStore,
  privacyZoneId,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  routeFor,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView, READING_RIDE_TEXT } from '../views/ActivityDetailView';

import {
  RACE_CONSENT_LABEL,
  RACE_CONSENT_NOT_SAVED,
  RACE_CONSENT_SENTENCE,
  RACE_CONSENT_ZONE_REFUSAL,
} from './RaceConsentSection';
import type { DetailPort } from './store-port';
import { stubActivity, stubDetail, type StubRide } from './testing';

const ATHLETE = athleteId('athlete-a');

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
});

const READ_TURNS = 200;

/** Let the page finish whatever it is reading. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await settle();
}

async function open(port: DetailPort, id: string): Promise<HTMLInputElement> {
  mounted = await mount(<ActivityDetailView port={port} activityId={id} />);
  for (let turn = 0; (document.body.textContent ?? '').includes(READING_RIDE_TEXT); turn += 1) {
    if (turn >= READ_TURNS) throw new Error('the ride’s page never finished reading its ride');
    await settle();
  }
  await settled();
  const label = [...document.querySelectorAll('label')].find((each) =>
    (each.textContent ?? '').includes(RACE_CONSENT_LABEL),
  );
  const box = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (box === null || box === undefined) throw new Error('no “may be raced” box on the page');
  return box;
}

async function press(box: HTMLInputElement): Promise<void> {
  await activateWithKeyboard(box);
  await settled();
}

const text = (): string => (document.body.textContent ?? '').replace(/\s+/g, ' ');

/** A zone at `route`'s first point — its start — or 5 km north of it. */
function zoneAt(route: RouteRecord, where: 'start' | 'far'): PrivacyZoneRecord {
  const first = route.profile.positions[0]!;
  return {
    id: privacyZoneId(`zone-${where}`),
    athleteId: ATHLETE,
    centre:
      where === 'start'
        ? first
        : geographicPosition(
            degreesLatitude(first.latitude + 5000 / 111_195),
            degreesLongitude(first.longitude),
          ),
    radius: metres(200),
    label: 'home',
    createdAt: unixSeconds(1_760_000_000),
  };
}

function stub(overrides: Partial<StubRide> = {}, zones: readonly PrivacyZoneRecord[] = []) {
  return stubDetail(
    ATHLETE,
    { activity: stubActivity(), channels: {}, laps: [], ...overrides },
    zones,
  );
}

describe('the consent is off by default, and says what it allows', () => {
  it('renders the box unticked, with the sentence it is described by', async () => {
    const box = await open(stub(), 'ride-1');

    expect(box.checked).toBe(false);
    expect(text()).toContain(RACE_CONSENT_SENTENCE);
    const described = document.getElementById(box.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(RACE_CONSENT_SENTENCE);
  });

  it('stays a checkbox, not a switch: it is an agreement the rider makes (#994)', async () => {
    const box = await open(stub(), 'ride-1');
    expect(box.getAttribute('role')).toBeNull();
  });

  it('shows a consent already given as given', async () => {
    const box = await open(stub({ activity: stubActivity({ mayBeRaced: true }) }), 'ride-1');
    expect(box.checked).toBe(true);
  });
});

describe('set and revoked from the page, read back', () => {
  it('writes the consent through the real store, and a fresh connection reads it', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A, { id: activityId('ride-real') });
    const store = openActivityStore(harness.databaseName);
    try {
      const box = await open({ athleteId: ATHLETE_A, store }, ride.id);
      expect(box.checked).toBe(false);

      await press(box);
      expect(box.checked).toBe(true);
      const given = await harness.read(async (fresh) => fresh.getActivity(ATHLETE_A, ride.id));
      expect(given?.mayBeRaced).toBe(true);

      await press(box);
      expect(box.checked).toBe(false);
      const revoked = await harness.read(async (fresh) => fresh.getActivity(ATHLETE_A, ride.id));
      expect(revoked?.mayBeRaced).toBe(false);
      expect(text()).not.toContain(RACE_CONSENT_NOT_SAVED);
    } finally {
      store.close();
    }
  });

  it('shows what the store holds, and says so, when the write does not land', async () => {
    const box = await open(stub({ consentWrite: 'refuse' }), 'ride-1');

    await press(box);

    expect(box.checked).toBe(false);
    expect(text()).toContain(RACE_CONSENT_NOT_SAVED);
  });
});

describe('the privacy-zone refusal beside it — ADR 0021 D-5.2', () => {
  const route = routeFor(ATHLETE);

  it('says a ride whose route starts in a zone is never offered', async () => {
    const port = stub({ activity: stubActivity({ routeId: route.id }), route }, [
      zoneAt(route, 'start'),
    ]);
    await open(port, 'ride-1');
    expect(text()).toContain(RACE_CONSENT_ZONE_REFUSAL);
  });

  it('says nothing of the kind when every zone is off the route — the control', async () => {
    const port = stub({ activity: stubActivity({ routeId: route.id }), route }, [
      zoneAt(route, 'far'),
    ]);
    await open(port, 'ride-1');
    expect(text()).not.toContain(RACE_CONSENT_ZONE_REFUSAL);
    expect(port.zoneReads.length).toBeGreaterThan(0);
  });

  it('reads no zone for a ride on no route', async () => {
    const port = stub({}, [zoneAt(route, 'start')]);
    await open(port, 'ride-1');
    expect(text()).not.toContain(RACE_CONSENT_ZONE_REFUSAL);
    expect(port.zoneReads).toStrictEqual([]);
  });
});
