// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **ADR 0040 D-11's rider-text disclosure names who reads the text** — #1104's
 * H. The sentence it replaces said the matching parts go "to the model you set
 * up — on your own computer, or … a service you chose", and neither device
 * path sends history: the instance's agent reads it (`goals`,
 * `history_search`), and sends it on, masked, only to a hosted service the
 * rider agreed to there.
 */

import { describe, expect, it } from 'vitest';

import { RIDER_TEXT_DISCLOSURE_DETAIL } from './disclosure';

describe('the rider-text disclosure (#1104 H)', () => {
  it('says the instance’s model reads the matching parts, and a hosted service is sent them masked', () => {
    expect(RIDER_TEXT_DISCLOSURE_DETAIL).toContain(
      'When you ask your instance for an analysis, the model it uses may read the parts that match, and if you agreed to a hosted service there, those parts are sent to that service after the details on your list are masked.',
    );
  });

  it('no longer names a device path that never sends this text', () => {
    expect(RIDER_TEXT_DISCLOSURE_DETAIL).not.toContain('on your own computer');
    expect(RIDER_TEXT_DISCLOSURE_DETAIL).not.toContain('the model you set up');
  });

  it('says where the searchable copy is worked out, as the policy does (the ruling of 2026-10-26)', () => {
    expect(RIDER_TEXT_DISCLOSURE_DETAIL).toContain(
      'worked out by a model on that machine or its own private network, not sent anywhere else to do it',
    );
  });
});
