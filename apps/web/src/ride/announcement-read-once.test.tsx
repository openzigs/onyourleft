// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Ride screen reads the rider's announcement choice ONCE — #740 (#655's
 * review, N2).
 *
 * Two components decide between them who answers a held *Set*: the ERG form
 * (`TrainerPanel`, with announcements off) and the ride's one region
 * (`RideAnnouncer`, with them on). Each used to read the choice for itself.
 * They agreed only because both read this device's storage in one mount pass,
 * and a storage double handed to either would have made the rider hear the
 * answer twice or never. Now `RideView` reads it and hands the same object to
 * both; this counts the reads, through the real module, so a second one is red.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';
import { RideView } from '../views/RideView';

import { ridingSnapshot, stubRideController } from './testing';

const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../game/hud/announce-preference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game/hud/announce-preference')>();
  return {
    ...actual,
    readAnnouncementPreference: (...args: Parameters<typeof actual.readAnnouncementPreference>) => {
      reads.count += 1;
      return actual.readAnnouncementPreference(...args);
    },
  };
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
});

describe('the Ride screen and its announcement choice — #740', () => {
  it('reads it once, for the ERG form and the ride’s one region together', async () => {
    reads.count = 0;
    const stub = stubRideController({ ...ridingSnapshot(), workout: undefined });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();
    // The region is there, so a count of one is not a screen that rendered
    // neither voice.
    expect(document.querySelector('[data-oyl-announcer="ride"]')).not.toBeNull();
    expect(reads.count).toBe(1);
  });
});
