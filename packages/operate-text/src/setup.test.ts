// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { REGISTRATION_MODE_TEXT } from './accounts';
import {
  BACKUPS_EXPERT_LINES,
  expiresInText,
  ranAgoText,
  SETUP_EXPERT_SUMMARY,
  SETUP_REGISTRATION_MODE_TEXT,
  setupSummaryLines,
} from './setup';
import * as setup from './setup';

describe('the setup wizard’s words (#2784)', () => {
  it('says when a code stops working from the time it has left, never as a UTC moment', () => {
    expect(
      [0, 59, 60, 61, 119, 120, 599, 600, 7199, 7200, 47 * 3600, 48 * 3600, 7 * 86_400].map(
        expiresInText,
        ranAgoText,
      ),
    ).toEqual([
      'in less than a minute',
      'in less than a minute',
      'in 1 minute',
      'in 1 minute',
      'in 1 minute',
      'in 2 minutes',
      'in 9 minutes',
      'in 10 minutes',
      'in 119 minutes',
      'in 2 hours',
      'in 47 hours',
      'in 2 days',
      'in 7 days',
    ]);
  });

  it('says how long ago something ran, never as a UTC moment, and never a time yet to come (#2825)', () => {
    expect([-30, 0, 59, 60, 14 * 60, 3 * 3600 + 5 * 60, 2 * 86_400].map(ranAgoText)).toEqual([
      'less than a minute ago',
      'less than a minute ago',
      'less than a minute ago',
      '1 minute ago',
      '14 minutes ago',
      '3 hours 5 minutes ago',
      '2 days ago',
    ]);
  });

  it('names each mode in plain words, keeping the stored values and the app’s own words', () => {
    expect(Object.keys(SETUP_REGISTRATION_MODE_TEXT).sort()).toEqual(
      Object.keys(REGISTRATION_MODE_TEXT).sort(),
    );
    expect(Object.values(SETUP_REGISTRATION_MODE_TEXT).map((text) => text.short)).toEqual([
      'Anyone can join',
      'I approve each new rider',
      'Only people I invite',
      'Nobody new',
    ]);
    for (const text of Object.values(SETUP_REGISTRATION_MODE_TEXT)) {
      expect(`${text.short} ${text.meaning}`).not.toMatch(/moderator|\.env|OYL_/);
    }
  });

  it('lists where the server stands at the finish, one plain sentence each', () => {
    expect(
      setupSummaryLines({
        ownerClaimed: true,
        kit: 'downloaded',
        backups: 'this-computer-only',
        mode: 'open',
        invites: 1,
      }),
    ).toEqual([
      'Owner: your tablet owns this server.',
      'Emergency kit: downloaded.',
      'Backups: on this computer only. The copy kept elsewhere is not working.',
      'Who may join: Anyone can join.',
      'Invites made: 1.',
    ]);
    expect(
      setupSummaryLines({
        ownerClaimed: false,
        kit: 'none',
        backups: 'failed',
        mode: 'closed',
        invites: 0,
      }),
    ).toEqual([
      'Owner: nobody has claimed this server yet.',
      'Emergency kit: none needed, every secret is in .env.',
      'Backups: not working. The last backup failed.',
      'Who may join: Nobody new.',
      'Invites made: none.',
    ]);
  });

  it('keeps settings names and commands out of the plain sentences, in the expert block only', () => {
    const expert = new Set<unknown>([
      BACKUPS_EXPERT_LINES,
      setup.passkeyStepHow,
      // The locked page's, read before there is any session: where the code is, and how to get one.
      setup.SETUP_NEW_CODE_TEXT,
      setup.SETUP_LOCKED_LEAD,
      // The fixes a host's operator makes when the claim went wrong, or there are no keys.
      setup.CLAIMED_WRONG_TEXT,
      setup.CLAIM_NO_CARD_TEXT,
    ]);
    const plain = Object.values(setup as Record<string, unknown>).filter(
      (value): value is string => typeof value === 'string' && !expert.has(value),
    );
    expect(plain.length).toBeGreaterThan(40);
    for (const sentence of plain) expect(sentence).not.toMatch(/OYL_|docker compose|moderator/);
    expect(BACKUPS_EXPERT_LINES.join(' ')).toContain('OYL_OFFBOX_DIR');
    expect(SETUP_EXPERT_SUMMARY).toBe('For people comfortable with the command line');
  });
});
