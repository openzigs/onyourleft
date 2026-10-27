// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readReleaseChannel } from './release-channel';

describe('the release channel a build was made for (#1745)', () => {
  it('reads the two channels the release workflow sets', () => {
    expect(readReleaseChannel({ VITE_OYL_RELEASE_CHANNEL: 'play' })).toBe('play');
    expect(readReleaseChannel({ VITE_OYL_RELEASE_CHANNEL: 'direct' })).toBe('direct');
    expect(readReleaseChannel({ VITE_OYL_RELEASE_CHANNEL: ' direct\n' })).toBe('direct');
  });

  it('claims no channel for a build that set none, or set something else', () => {
    for (const value of [undefined, '', 'Play', 'apk', 'github']) {
      expect(
        readReleaseChannel({ VITE_OYL_RELEASE_CHANNEL: value }),
        String(value),
      ).toBeUndefined();
    }
    expect(readReleaseChannel({})).toBeUndefined();
  });
});
