// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one-off review, the full reset's request, and the codes a rider types
 * from a mail (#1194, ADR 0047 D-8). The drafted sentences are asserted whole
 * where they carry a rule, so a change to one is a change a reviewer sees.
 */

import { describe, expect, it } from 'vitest';

import { noticeText, type AccountChangeEntry } from './account-change-notices';
import {
  accountPredatesPin,
  HOLD_TEXT,
  markReviewed,
  REPLACE_ADDRESS_STEPS,
  resetRequest,
  reviewDue,
  reviewOf,
  reviewStorageKey,
  typedCode,
  type ReviewStorage,
} from './recovery-review';

const ORIGIN = 'https://ride.example';

function memoryStorage(): ReviewStorage & { readonly keys: () => string[] } {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    keys: () => [...held.keys()],
  };
}

describe('a mailed code is typed, never followed', () => {
  it.each([
    'https://ride.example/recover?code=abcd',
    'http://ride.example/abcd',
    'HTTPS://RIDE.EXAMPLE/ABCD',
    'oyl-instance:abcd',
    'intent://recover#Intent;scheme=oyl;end',
    'www.ride.example/abcd',
    '  https://ride.example/x  ',
  ])('refuses %s as a code', (input) => {
    expect(typedCode(input)).toEqual({ ok: false, problem: 'link' });
  });

  it('takes a code as it was typed, trimmed', () => {
    expect(typedCode('  Xk3_9aB-cD  ')).toEqual({ ok: true, code: 'Xk3_9aB-cD' });
    expect(typedCode('abcd-efgh-jkmn-pqrs')).toEqual({ ok: true, code: 'abcd-efgh-jkmn-pqrs' });
    expect(typedCode('   ')).toEqual({ ok: false, problem: 'empty' });
  });
});

describe('the full reset is built only with a step-up', () => {
  it('builds nothing without a recovery code or a mailed code — so the review never resets by itself', () => {
    expect(resetRequest({})).toEqual({ ok: false, problem: 'step-up' });
    expect(resetRequest({ recoveryCode: '  ' })).toEqual({ ok: false, problem: 'step-up' });
    expect(resetRequest({ recoveryCode: 'abcd', emailToken: 'efgh' })).toEqual({
      ok: false,
      problem: 'step-up',
    });
  });

  it('builds the body with exactly the one step-up given, and refuses a link in its place', () => {
    expect(resetRequest({ recoveryCode: ' abcd-efgh-jkmn-pqrs ' })).toEqual({
      ok: true,
      body: { recoveryCode: 'abcd-efgh-jkmn-pqrs' },
    });
    expect(resetRequest({ emailToken: 'Xk3_9aB' })).toEqual({
      ok: true,
      body: { emailToken: 'Xk3_9aB' },
    });
    expect(resetRequest({ emailToken: 'https://ride.example/recover?t=Xk3' })).toEqual({
      ok: false,
      problem: 'link',
    });
  });
});

describe('the one-off review is per device', () => {
  const devices = [
    { publicKey: 'x', addedAt: 100, lastUsedAt: 500, revokedAt: null, thisDevice: true },
    { publicKey: 'y', addedAt: 200, lastUsedAt: null, revokedAt: null, thisDevice: false },
    { publicKey: 'z', addedAt: 900, lastUsedAt: 950, revokedAt: null, thisDevice: false },
  ];

  it('key X completing the review leaves device Y still shown it', () => {
    const storage = memoryStorage();
    const predates = accountPredatesPin(devices, 800);
    expect(predates).toBe(true);
    expect(reviewDue(storage, ORIGIN, 'x', predates)).toBe(true);
    expect(reviewDue(storage, ORIGIN, 'y', predates)).toBe(true);
    markReviewed(storage, ORIGIN, 'x', 1_000);
    expect(reviewDue(storage, ORIGIN, 'x', predates)).toBe(false);
    expect(reviewDue(storage, ORIGIN, 'y', predates)).toBe(true);
    // Kept under the device's own key, so a shared profile does not share it.
    expect(storage.keys()).toEqual([reviewStorageKey(ORIGIN, 'x')]);
    // And per instance: X's review on another instance is not this one's.
    expect(reviewDue(storage, 'https://other.example', 'x', predates)).toBe(true);
  });

  it('…and device Y is shown X’s reset and revoke as account-change notices naming X', () => {
    const changes: AccountChangeEntry[] = [
      {
        id: 7,
        at: 1_790_000_000,
        kind: 'codes_replaced',
        actorKey: 'x',
        subjectKey: null,
        subjectAddedAt: null,
        via: null,
        address: null,
      },
      {
        id: 8,
        at: 1_790_000_000,
        kind: 'key_revoked',
        actorKey: 'x',
        subjectKey: 'z',
        subjectAddedAt: 900,
        via: null,
        address: null,
      },
    ];
    const day = (seconds: number): string => `day ${String(seconds)}`;
    expect(changes.map((entry) => noticeText(entry, devices, 'y', day))).toEqual([
      'On day 1790000000 the key added on day 100 replaced your recovery codes. If that was not you, revoke that key.',
      'On day 1790000000 the key added on day 100 revoked the key added on day 900. If that was not you, revoke that key.',
    ]);
  });

  it('is not shown on an account made after the pin', () => {
    expect(accountPredatesPin(devices, 50)).toBe(false);
    expect(reviewDue(memoryStorage(), ORIGIN, 'x', false)).toBe(false);
  });

  it('shows every device with the keys from before the pin marked, every address, and recommends the reset — and changes nothing', () => {
    const addresses = [
      { address: 'mine@example.org', confirmedAt: null, heldUntil: null, boundByKey: null },
    ];
    const review = reviewOf(devices, addresses, 800);
    expect(review.devices.map((device) => [device.publicKey, device.beforePin])).toEqual([
      ['x', true],
      ['y', true],
      ['z', false],
    ]);
    expect(review.addresses).toBe(addresses);
    expect(review.recommendReset).toBe(true);
  });
});

describe('the drafted order and the hold sentence', () => {
  it('offers replacing an address in three steps, the new one first', () => {
    expect(REPLACE_ADDRESS_STEPS).toHaveLength(3);
    expect(REPLACE_ADDRESS_STEPS[0]).toMatch(/^Give your new address/);
    expect(REPLACE_ADDRESS_STEPS[2]).toMatch(/^Then clear the old address/);
  });

  it('says a new address recovers nothing for a week', () => {
    expect(HOLD_TEXT).toContain('A new address recovers nothing for a week.');
  });
});
