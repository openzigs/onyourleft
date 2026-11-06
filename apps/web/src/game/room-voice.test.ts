// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RoomSessionStatus } from '../net/room-session';
import { voiceLinkShown, voiceNoticeAfter } from './room-voice';

const INVITE = 'https://discord.gg/inv1abc';
const NEWER = 'https://discord.gg/inv2abc';
const CONFIG = {
  kind: 'ride',
  ridingPosition: 'hoods',
  reportIntervalMs: 500,
  frameIntervalMs: 1000,
  drafting: 'on',
} as const;
const joined = (voiceInvite?: string): RoomSessionStatus => ({
  kind: 'joined',
  riderId: 0,
  config: CONFIG,
  ...(voiceInvite === undefined ? {} : { voiceInvite }),
});

describe('voiceNoticeAfter — #875', () => {
  it('starts a new link’s span now, and keeps the same link’s span', () => {
    const first = voiceNoticeAfter(undefined, joined(INVITE), 4);
    expect(first).toEqual({ invite: INVITE, from: 4 });
    expect(voiceNoticeAfter(first, joined(INVITE), 9)).toBe(first);
    expect(voiceNoticeAfter(first, joined(NEWER), 9)).toEqual({ invite: NEWER, from: 9 });
  });

  it('a welcome with no link takes it away; a room refused, gone or left has none', () => {
    const kept = { invite: INVITE, from: 0 };
    expect(voiceNoticeAfter(kept, joined(), 1)).toBeUndefined();
    for (const status of [
      { kind: 'refused', reason: 'room-full' },
      { kind: 'gone' },
      { kind: 'left' },
    ] as const) {
      expect(voiceNoticeAfter(kept, status, 1), status.kind).toBeUndefined();
    }
    expect(voiceNoticeAfter(kept, undefined, 1)).toBeUndefined();
  });

  it('a room connecting or lost keeps what it had, and never starts one', () => {
    const kept = { invite: INVITE, from: 0 };
    expect(voiceNoticeAfter(kept, { kind: 'lost', since: 5 }, 1)).toBe(kept);
    expect(voiceNoticeAfter(kept, { kind: 'connecting' }, 1)).toBe(kept);
    expect(voiceNoticeAfter(undefined, { kind: 'connecting' }, 1)).toBeUndefined();
  });
});

describe('voiceLinkShown — #875', () => {
  const notice = { invite: INVITE, from: 10 };

  const asNotice = { invite: INVITE, place: 'notice' };
  const inTheRace = { invite: INVITE, place: 'race' };

  it('a group ride shows it as a notice for the span from when it came, and not after', () => {
    expect(voiceLinkShown(notice, { kind: 'not-a-race' }, 10, 15)).toEqual(asNotice);
    expect(voiceLinkShown(notice, { kind: 'not-a-race' }, 24.9, 15)).toEqual(asNotice);
    expect(voiceLinkShown(notice, { kind: 'not-a-race' }, 25, 15)).toBeUndefined();
    expect(voiceLinkShown(notice, undefined, 10, 15)).toEqual(asNotice);
  });

  it('a race shows it in its own notice while it holds the rider on its line, however long', () => {
    expect(voiceLinkShown(notice, { kind: 'waiting' }, 500, 15)).toEqual(inTheRace);
    expect(voiceLinkShown(notice, { kind: 'counting', endsAtLocalMs: 1 }, 500, 15)).toEqual(
      inTheRace,
    );
  });

  it('a race that has started or is over shows it nowhere, inside the span or not', () => {
    expect(voiceLinkShown(notice, { kind: 'running' }, 10, 15)).toBeUndefined();
    expect(
      voiceLinkShown(notice, { kind: 'finished', order: [0] } as never, 10, 15),
    ).toBeUndefined();
  });

  it('shows nothing with no link', () => {
    expect(voiceLinkShown(undefined, { kind: 'waiting' }, 0, 15)).toBeUndefined();
  });
});
