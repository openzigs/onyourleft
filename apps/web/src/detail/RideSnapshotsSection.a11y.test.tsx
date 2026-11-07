// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The side-camera snapshot section on a ride's page passes the audit, closed
 * and open, with a delete armed — #1063. Closed, its one control is the
 * section's own summary; open, every picture has a text alternative and every
 * control a name.
 */

import { act } from 'react';
import { activityId, type CameraFrameRecord } from '@onyourleft/store';
import { ATHLETE_A, resetFixtureIds, snapshotFor } from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import type { RideSnapshotsPort } from './ride-snapshots-port';
import { RideSnapshotsSection } from './RideSnapshotsSection';

const RIDE = activityId('ride-with-snapshots');

let mounted: Mounted | undefined;

beforeEach(() => {
  resetFixtureIds();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function port(rows: readonly CameraFrameRecord[]): RideSnapshotsPort {
  return {
    athleteId: ATHLETE_A,
    store: {
      countRideSnapshots: async () => Promise.resolve(rows.length),
      listRideSnapshots: async () => Promise.resolve([...rows]),
      deleteRideSnapshot: async () => Promise.resolve(false),
    },
    objectUrls: { create: () => 'blob:audit', revoke: () => undefined },
    holdSecureWindow: () => () => undefined,
  };
}

async function openPage(): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <h2>A ride</h2>
      <RideSnapshotsSection
        port={port([
          snapshotFor(ATHLETE_A, RIDE),
          snapshotFor(ATHLETE_A, RIDE, { withOutline: false }),
        ])}
        activityId={RIDE}
      />
    </main>,
  );
  await settle();
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('the snapshot section passes the audit', () => {
  it('closed', async () => {
    await openPage();
    expectClean('the snapshot section, closed');
  });

  it('open, and with a delete armed', async () => {
    await openPage();
    await act(async () => {
      const details = document.querySelector('details') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      await Promise.resolve();
    });
    await settle();
    expect(document.querySelectorAll('img')).toHaveLength(2);
    expectClean('the snapshot section, open');
    const remove = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete snapshot 1',
    );
    await activateWithKeyboard(remove as HTMLElement);
    expectClean('the snapshot section, with a delete armed');
  });
});
