// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A ride's snapshots: counted in words, closed until opened, and nothing
 * read, made or mounted before that** — #1063, ADR 0044 D-1, D-3, D-6 and
 * D-12.
 *
 * The store here is a double that records every call, because what is under
 * test is WHEN the section reads a picture, makes a URL and holds the secure
 * window — none of which a real store can report. That a delete really
 * removes the row, read back on a fresh connection, is
 * `packages/store/src/camera-frame-store.test.ts` §"one snapshot is deleted".
 */

import { act } from 'react';
import { activityId, type CameraFrameId, type CameraFrameRecord } from '@onyourleft/store';
import { ATHLETE_A, resetFixtureIds, snapshotFor } from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import type { RideSnapshotsPort } from './ride-snapshots-port';
import {
  RIDE_SNAPSHOTS_HEADING,
  RideSnapshotsSection,
  snapshotAlt,
  snapshotCountText,
} from './RideSnapshotsSection';

const RIDE = activityId('ride-with-snapshots');

let mounted: Mounted | undefined;

beforeEach(() => {
  resetFixtureIds();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function portOver(initial: readonly CameraFrameRecord[]) {
  let rows = [...initial];
  const calls: string[] = [];
  const made: string[] = [];
  const revoked: string[] = [];
  let holds = 0;
  let given = 0;
  const port: RideSnapshotsPort = {
    athleteId: ATHLETE_A,
    store: {
      countRideSnapshots: (owner, activity) => {
        calls.push(`count:${owner}:${activity}`);
        return Promise.resolve(rows.length);
      },
      listRideSnapshots: (owner, activity) => {
        calls.push(`list:${owner}:${activity}`);
        return Promise.resolve([...rows]);
      },
      deleteRideSnapshot: (owner, activity, id: CameraFrameId) => {
        calls.push(`delete:${owner}:${activity}:${id}`);
        const before = rows.length;
        rows = rows.filter((row) => row.id !== id);
        return Promise.resolve(rows.length < before);
      },
    },
    objectUrls: {
      create: () => {
        const url = `blob:test/${String(made.length + 1)}`;
        made.push(url);
        return url;
      },
      revoke: (url) => {
        revoked.push(url);
      },
    },
    holdSecureWindow: () => {
      holds += 1;
      return () => {
        given += 1;
      };
    },
  };
  return {
    port,
    calls,
    made,
    revoked,
    holds: () => holds,
    given: () => given,
  };
}

function details(): HTMLDetailsElement {
  const found = document.querySelector('details');
  if (found === null) throw new Error('no snapshot section');
  return found;
}

async function toggle(open: boolean): Promise<void> {
  await act(async () => {
    details().open = open;
    details().dispatchEvent(new Event('toggle'));
    await Promise.resolve();
  });
  await settle();
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  );
}

describe('the snapshot section on a ride’s page', () => {
  it('renders nothing for a ride with no snapshot', async () => {
    const double = portOver([]);
    mounted = await mount(<RideSnapshotsSection port={double.port} activityId={RIDE} />);
    await settle();
    expect(document.body.textContent).not.toContain(RIDE_SNAPSHOTS_HEADING);
  });

  it('is closed by default: a count in words, and no picture read, no URL made, no window held', async () => {
    const double = portOver([snapshotFor(ATHLETE_A, RIDE), snapshotFor(ATHLETE_A, RIDE)]);
    mounted = await mount(<RideSnapshotsSection port={double.port} activityId={RIDE} />);
    await settle();
    expect(document.body.textContent).toContain(RIDE_SNAPSHOTS_HEADING);
    expect(details().open).toBe(false);
    expect(details().querySelector('summary')?.textContent).toBe(snapshotCountText(2));
    expect(document.querySelectorAll('img, canvas, video')).toHaveLength(0);
    expect(double.calls).toStrictEqual([`count:${ATHLETE_A}:${RIDE}`]);
    expect(double.made).toStrictEqual([]);
    expect(double.holds()).toBe(0);
  });

  it('opened, shows each picture with its outline and no time, holds the secure window; closed, lets every URL and the hold go', async () => {
    const first = snapshotFor(ATHLETE_A, RIDE);
    const second = snapshotFor(ATHLETE_A, RIDE, { withOutline: false });
    const double = portOver([first, second]);
    mounted = await mount(<RideSnapshotsSection port={double.port} activityId={RIDE} />);
    await settle();
    await toggle(true);

    const images = [...document.querySelectorAll('img')];
    expect(images.map((image) => image.getAttribute('src'))).toStrictEqual([
      'blob:test/1',
      'blob:test/2',
    ]);
    expect(images.map((image) => image.alt)).toStrictEqual([snapshotAlt(1, 2), snapshotAlt(2, 2)]);
    // The outline is drawn over the first, from its numbers; none over the second.
    const figures = [...document.querySelectorAll('figure')];
    expect(figures[0]?.querySelectorAll('circle').length).toBe(first.outline?.landmarks.length);
    expect(figures[1]?.querySelector('svg')).toBeNull();
    // Never where in the ride it was taken, nor any reading (D-3): no clock
    // time, no date and no unit anywhere in the section.
    const text = document.querySelector('[data-oyl-ride-snapshots]')?.textContent ?? '';
    expect(text).not.toMatch(/\d{1,2}:\d{2}|\bW\b|bpm|rpm|km|mph/);
    expect(double.holds()).toBe(1);

    await toggle(false);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect([...double.revoked].sort()).toStrictEqual(['blob:test/1', 'blob:test/2']);
    expect(double.given()).toBe(1);
  });

  it('lets every URL and the hold go when the page is left with the section open', async () => {
    const double = portOver([snapshotFor(ATHLETE_A, RIDE)]);
    mounted = await mount(<RideSnapshotsSection port={double.port} activityId={RIDE} />);
    await settle();
    await toggle(true);
    mounted.unmount();
    mounted = undefined;
    expect(double.revoked).toStrictEqual(['blob:test/1']);
    expect(double.given()).toBe(1);
  });

  it('deletes one snapshot on the second press, owner and ride first, and reads the list again', async () => {
    const gone = snapshotFor(ATHLETE_A, RIDE);
    const stays = snapshotFor(ATHLETE_A, RIDE);
    const double = portOver([gone, stays]);
    mounted = await mount(<RideSnapshotsSection port={double.port} activityId={RIDE} />);
    await settle();
    await toggle(true);

    await activateWithKeyboard(buttonNamed('Delete snapshot 1') as HTMLElement);
    // One press arms it; nothing is deleted yet.
    expect(double.calls.some((call) => call.startsWith('delete:'))).toBe(false);
    await activateWithKeyboard(buttonNamed('Yes, delete snapshot 1') as HTMLElement);
    await settle();

    expect(double.calls).toContain(`delete:${ATHLETE_A}:${RIDE}:${gone.id}`);
    // Read again, not assumed: the list and the count after the delete.
    expect(double.calls.filter((call) => call.startsWith('list:'))).toHaveLength(2);
    expect(details().querySelector('summary')?.textContent).toBe(snapshotCountText(1));
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });
});
