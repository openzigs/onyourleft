// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The announcement preference, kept on the DEVICE — #397, as #395 decided.
 *
 * ⚠️ **The round trip crosses the boundary.** CLAUDE.md §5's four causes —
 * wrong storage, wrong layer, wrong time, wrong harness — are why nothing here
 * asserts against the object it just wrote: a write goes through the public
 * path into a `Storage`, every handle to it is dropped, and a FRESH one over
 * the same backing store is read through the path `GameView` reads through.
 * A writer that kept the value in memory, or under a key the reader does not
 * use, passes a same-object test and fails this one.
 */

import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  readAnnouncementPreference,
  writeAnnouncementPreference,
  type AnnouncementPreference,
  type PreferenceStorage,
} from './announce-preference';

/** The backing store a browser keeps across reloads. */
type Disk = Map<string, string>;

/** A `Storage` handle over a disk — a fresh one per "page load". */
function handleOver(disk: Disk): PreferenceStorage {
  return {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => {
      disk.set(key, value);
    },
  };
}

const CHOSEN: AnnouncementPreference = {
  enabled: true,
  powerEverySeconds: 30,
  distanceEvery: 5,
  intervalLeadSeconds: 'never',
  climbLeadMetres: 500,
};

describe('the announcement preference — #397', () => {
  it('is OFF when nothing has been chosen', () => {
    expect(readAnnouncementPreference(handleOver(new Map()))).toEqual(DEFAULT_ANNOUNCEMENTS);
    expect(DEFAULT_ANNOUNCEMENTS.enabled).toBe(false);
  });

  it('survives a reload: written through one handle, read through a fresh one', () => {
    const disk: Disk = new Map();
    expect(writeAnnouncementPreference(handleOver(disk), CHOSEN)).toBe(true);
    // Every handle that wrote is gone; this is the next page load's.
    const reloaded = handleOver(disk);
    expect(readAnnouncementPreference(reloaded)).toEqual(CHOSEN);
    expect(disk.has(ANNOUNCEMENTS_STORAGE_KEY)).toBe(true);
  });

  it('renders the defaults when the store refuses to be read', () => {
    const blocked: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readAnnouncementPreference(blocked)).toEqual(DEFAULT_ANNOUNCEMENTS);
    expect(readAnnouncementPreference(undefined)).toEqual(DEFAULT_ANNOUNCEMENTS);
  });

  it('says so when the store refuses to be written, rather than pretending', () => {
    const full: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeAnnouncementPreference(full, CHOSEN)).toBe(false);
    expect(writeAnnouncementPreference(undefined, CHOSEN)).toBe(false);
  });

  it('treats a value this build does not know as the default, one field at a time', () => {
    const disk: Disk = new Map([
      [
        ANNOUNCEMENTS_STORAGE_KEY,
        JSON.stringify({ enabled: true, powerEverySeconds: 7, distanceEvery: 'lots' }),
      ],
    ]);
    expect(readAnnouncementPreference(handleOver(disk))).toEqual({
      ...DEFAULT_ANNOUNCEMENTS,
      enabled: true,
    });
    disk.set(ANNOUNCEMENTS_STORAGE_KEY, '{not json');
    expect(readAnnouncementPreference(handleOver(disk))).toEqual(DEFAULT_ANNOUNCEMENTS);
  });
});
