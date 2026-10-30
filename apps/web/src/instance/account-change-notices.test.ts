// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drafted account-change wording and the device-list marks after a
 * revoke (#1193, ADR 0047 D-8 and D-14 Q6). The sentences are asserted whole,
 * so a change to one is a change a reviewer sees here.
 */

import { describe, expect, it } from 'vitest';

import {
  AFTER_REVOKE_TEXT,
  formatDay,
  formatIsoDay,
  formatTime,
  keyName,
  noticeText,
  REVOKE_MARK_TEXT,
  revokeKeyName,
  revokeMarks,
  type AccountChangeEntry,
  type ListedKey,
} from './account-change-notices';

const day = (unixSeconds: number): string => `day ${String(unixSeconds)}`;

const KEYS: readonly ListedKey[] = [
  { publicKey: 'mine', addedAt: 100 },
  { publicKey: 'september', addedAt: 200 },
  { publicKey: 'october', addedAt: 300 },
];

const entry = (overrides: Partial<AccountChangeEntry>): AccountChangeEntry => ({
  id: 1,
  at: 900,
  kind: 'link_code_minted',
  actorKey: 'september',
  subjectKey: null,
  subjectAddedAt: null,
  via: null,
  address: null,
  ...overrides,
});

describe('a notice (#1193 draft wording)', () => {
  it('names a key by the day it was added, this device as itself, and a lost one plainly', () => {
    expect(keyName('september', KEYS, 'mine', day)).toBe('the key added on day 200');
    expect(keyName('mine', KEYS, 'mine', day)).toBe('this device');
    expect(keyName('gone', KEYS, 'mine', day)).toBe('a key this account no longer lists');
  });

  it('says what another key did, when, and what to do if it was not the rider', () => {
    const text = (overrides: Partial<AccountChangeEntry>): string =>
      noticeText(entry(overrides), KEYS, 'mine', day);
    expect(text({ kind: 'codes_replaced' })).toBe(
      'On day 900 the key added on day 200 replaced your recovery codes. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'address_added', address: 'a@example.org' })).toBe(
      'On day 900 the key added on day 200 added a recovery address, a@example.org. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'address_cleared', address: 'a@example.org' })).toBe(
      'On day 900 the key added on day 200 cleared a recovery address, a@example.org. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'link_code_minted' })).toBe(
      'On day 900 the key added on day 200 made a link code. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'key_revoked', subjectKey: 'october', subjectAddedAt: 300 })).toBe(
      'On day 900 the key added on day 200 revoked the key added on day 300. If that was not you, revoke that key.',
    );
  });

  it('names a revoked key by the day it was added, from the entry, and never as this device', () => {
    // The owner's example, in the device's own calendar: local noon, so the
    // day is the same in every time zone a test runs in (#1511).
    const noon = (month: number, date: number): number =>
      new Date(2026, month, date, 12).getTime() / 1000;
    const keys: readonly ListedKey[] = [{ publicKey: 'september', addedAt: noon(8, 12) }];
    expect(
      noticeText(
        entry({
          at: noon(9, 3),
          kind: 'key_revoked',
          subjectKey: 'august',
          subjectAddedAt: noon(7, 1),
        }),
        keys,
        'mine',
      ),
    ).toBe(
      'On 3 October the key added on 12 September revoked the key added on 1 August. If that was not you, revoke that key.',
    );
    // Even an entry naming the reading device's own key is named by its day:
    // a revoked key reads nothing, so "this device" would be false.
    expect(
      noticeText(
        entry({ kind: 'key_revoked', subjectKey: 'mine', subjectAddedAt: 100 }),
        KEYS,
        'mine',
        day,
      ),
    ).toBe(
      'On day 900 the key added on day 200 revoked the key added on day 100. If that was not you, revoke that key.',
    );
    // The day comes from the entry, not the list: a key missing from the list is still named.
    expect(
      noticeText(
        entry({ kind: 'key_revoked', subjectKey: 'unlisted', subjectAddedAt: 50 }),
        KEYS,
        'mine',
        day,
      ),
    ).toBe(
      'On day 900 the key added on day 200 revoked the key added on day 50. If that was not you, revoke that key.',
    );
  });

  it('says a key revoked itself, and asks nobody to revoke it again (#1208)', () => {
    // #1209's final review: a key that revoked itself is gone, so "revoke
    // that key" would ask the rider for something that cannot be done.
    expect(
      noticeText(
        entry({
          kind: 'key_revoked',
          actorKey: 'september',
          subjectKey: 'september',
          subjectAddedAt: 200,
        }),
        KEYS,
        'mine',
        day,
      ),
    ).toBe('On day 900 the key added on day 200 revoked itself.');
  });

  it('says a new key was added, and how', () => {
    const text = (via: AccountChangeEntry['via']): string =>
      noticeText(entry({ kind: 'key_added', subjectKey: 'october', via }), KEYS, 'mine', day);
    expect(text('link_code')).toBe(
      'A new key was added to your account on day 900, by a link code from the key added on day 200.',
    );
    expect(text('recovery_code')).toBe(
      'A new key was added to your account on day 900, with a recovery code.',
    );
    expect(text('email_token')).toBe(
      'A new key was added to your account on day 900, with a code mailed to a recovery address.',
    );
  });

  it('writes a day as the day and the month', () => {
    // Local noon, so the day is the same in every time zone a test runs in:
    // noon UTC is already the next day east of UTC+12 (#1511).
    expect(formatDay(new Date(2026, 9, 3, 12).getTime() / 1000)).toBe('3 October');
  });

  it("writes a time on the device's own 24-hour clock", () => {
    // Local times, so the clock read is the one the rider's device keeps.
    expect(formatTime(new Date(2026, 8, 22, 14, 5).getTime() / 1000)).toBe('14:05');
    expect(formatTime(new Date(2026, 8, 22, 0, 5).getTime() / 1000)).toBe('00:05');
  });
});

describe("the Devices row's day (#1511)", () => {
  const local = (date: number, hour: number, minute: number): number =>
    new Date(2026, 8, date, hour, minute).getTime() / 1000;

  it("writes a day as the year, month and day, on the device's own calendar", () => {
    expect(formatIsoDay(local(22, 0, 30))).toBe('2026-09-22');
    expect(formatIsoDay(local(22, 23, 30))).toBe('2026-09-22');
    expect(formatIsoDay(new Date(2026, 0, 5, 12).getTime() / 1000)).toBe('2026-01-05');
  });

  it('names the same day the revoke button does, near midnight too', () => {
    for (const at of [local(21, 23, 59), local(22, 0, 1)]) {
      const [, , date] = formatIsoDay(at).split('-');
      expect(formatDay(at)).toBe(`${String(Number(date))} September`);
    }
  });
});

describe('a key to revoke, named (#1208, owner ruling 2026-10-20)', () => {
  const time = (unixSeconds: number): string => `time ${String(unixSeconds)}`;
  // `day` here writes the hundreds, so 200 and 250 fall on one day.
  const byHundred = (unixSeconds: number): string => `day ${String(Math.floor(unixSeconds / 100))}`;

  it('names a key added on a day no other key was by that day alone', () => {
    const keys: readonly ListedKey[] = [
      { publicKey: 'a', addedAt: 100 },
      { publicKey: 'b', addedAt: 200 },
    ];
    expect(revokeKeyName({ publicKey: 'b', addedAt: 200 }, keys, byHundred, time)).toBe(
      'the key added on day 2',
    );
  });

  it('names two keys added the same day by their day and time, so they differ', () => {
    const keys: readonly ListedKey[] = [
      { publicKey: 'a', addedAt: 100 },
      { publicKey: 'b', addedAt: 200 },
      { publicKey: 'c', addedAt: 250 },
    ];
    const [, b, c] = keys as [ListedKey, ListedKey, ListedKey];
    expect(revokeKeyName(b, keys, byHundred, time)).toBe('the key added on day 2 at time 200');
    expect(revokeKeyName(c, keys, byHundred, time)).toBe('the key added on day 2 at time 250');
    // The key alone on its day is still named by the day.
    expect(revokeKeyName(keys[0] as ListedKey, keys, byHundred, time)).toBe(
      'the key added on day 1',
    );
  });

  it("uses the device's calendar and clock by default", () => {
    const at = (hour: number, minute: number): number =>
      new Date(2026, 8, 22, hour, minute).getTime() / 1000;
    const keys: readonly ListedKey[] = [
      { publicKey: 'a', addedAt: at(9, 30) },
      { publicKey: 'b', addedAt: at(14, 5) },
    ];
    expect(revokeKeyName(keys[1] as ListedKey, keys)).toBe(
      'the key added on 22 September at 14:05',
    );
    expect(revokeKeyName(keys[0] as ListedKey, keys)).toBe(
      'the key added on 22 September at 09:30',
    );
  });
});

describe('the device list after a revoke (#1193)', () => {
  it('marks keys added since the revoked key, and — apart — keys added with a code it minted', () => {
    const changes = [
      entry({
        id: 1,
        kind: 'key_added',
        actorKey: 'mine',
        subjectKey: 'september',
        via: 'link_code',
      }),
      entry({
        id: 2,
        kind: 'key_added',
        actorKey: 'september',
        subjectKey: 'october',
        via: 'link_code',
      }),
    ];
    const marks = revokeMarks(KEYS, changes, 'september');
    expect([...marks.entries()]).toEqual([['october', 'linked-by-revoked']]);
    // Revoking the oldest key marks every key added since.
    expect([...revokeMarks(KEYS, [], 'mine').entries()].sort()).toEqual([
      ['october', 'added-since'],
      ['september', 'added-since'],
    ]);
    // An earlier key linked by the revoked one is still marked as linked by it.
    expect(
      revokeMarks(
        KEYS,
        [entry({ kind: 'key_added', actorKey: 'october', subjectKey: 'mine', via: 'link_code' })],
        'october',
      ).get('mine'),
    ).toBe('linked-by-revoked');
    // A key added by `recover` is not marked as linked by anybody.
    expect(
      revokeMarks(
        KEYS,
        [
          entry({
            kind: 'key_added',
            actorKey: 'october',
            subjectKey: 'mine',
            via: 'recovery_code',
          }),
        ],
        'october',
      ).get('mine'),
    ).toBeUndefined();
  });

  it('has words for every mark, and says the codes are unchanged', () => {
    expect(Object.keys(REVOKE_MARK_TEXT).sort()).toEqual(['added-since', 'linked-by-revoked']);
    expect(AFTER_REVOKE_TEXT).toContain('your recovery codes are unchanged');
  });
});
