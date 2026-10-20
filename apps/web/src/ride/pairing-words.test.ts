// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1435: each failure code becomes a sentence chosen by the code and the step,
 * and never the transport's own message. The controller-level read-back is in
 * `controller.test.ts` §"#1435"; this pins every branch of the mapping.
 */

import { describe, expect, it } from 'vitest';

import { SensorError, type SensorErrorCode } from '@onyourleft/sensors';

import {
  BLUETOOTH_OFF,
  CONTROL_LINK_GONE,
  CONTROL_REFUSED,
  CONTROL_UNANSWERED,
  controlRefusalWords,
  linkNotMade,
  NO_BLUETOOTH_HERE,
  NOT_FOUND,
  NOT_PAIRED_TRY_AGAIN,
  NOT_PERMITTED,
  pairingFailureWords,
  POWER_BUT_NO_CONTROL,
  PRESS_AGAIN,
  TOO_MANY_DEVICES,
} from './pairing-words';

/** A message no rider should see: a device address, as Chrome's can carry. */
const RAW = 'GATT operation failed for 00:11:22:33:44:55';

const failure = (code: SensorErrorCode): SensorError => new SensorError(code, RAW);

describe('pairingFailureWords', () => {
  it.each([
    ['no-device-selected', 'choosing', NOT_FOUND],
    ['not-permitted', 'choosing', NOT_PERMITTED],
    ['transport-unsupported', 'choosing', NO_BLUETOOTH_HERE],
    ['user-gesture-required', 'choosing', PRESS_AGAIN],
    ['adapter-unavailable', 'choosing', BLUETOOTH_OFF],
    ['device-not-found', 'choosing', NOT_PAIRED_TRY_AGAIN],
    ['connection-budget-exceeded', 'linking', TOO_MANY_DEVICES],
    ['adapter-unavailable', 'linking', linkNotMade('KICKR 1F2A')],
    ['not-connected', 'linking', linkNotMade('KICKR 1F2A')],
    ['capability-unsupported', 'linking', linkNotMade('KICKR 1F2A')],
  ] as const)('%s while %s says its own sentence', (code, step, words) => {
    const said = pairingFailureWords(failure(code), step, 'KICKR 1F2A');

    expect(said).toBe(words);
    expect(said).not.toContain('00:11:22');
  });

  it('names the chosen device when its link did not come up, and the one-controller cause', () => {
    expect(linkNotMade('KICKR 1F2A')).toMatch(/^KICKR 1F2A was found/);
    expect(linkNotMade('KICKR 1F2A')).toContain('one app or bike computer at a time');
  });

  it('keeps the message of a failure that is not a sensor state', () => {
    expect(pairingFailureWords(new Error('the store is full'), 'linking', 'X')).toBe(
      'the store is full',
    );
    expect(pairingFailureWords('odd', 'choosing', 'X')).toBe('odd');
  });

  it('gives each state a different sentence', () => {
    const sentences = [
      NOT_FOUND,
      NOT_PERMITTED,
      BLUETOOTH_OFF,
      NO_BLUETOOTH_HERE,
      PRESS_AGAIN,
      TOO_MANY_DEVICES,
      NOT_PAIRED_TRY_AGAIN,
      linkNotMade('X'),
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('controlRefusalWords', () => {
  it.each([
    ['control-not-held', POWER_BUT_NO_CONTROL],
    ['control-timed-out', CONTROL_UNANSWERED],
    ['not-connected', CONTROL_LINK_GONE],
    ['control-rejected', CONTROL_REFUSED],
  ] as const)('%s says its own sentence, not the machine’s op code', (code, words) => {
    const said = controlRefusalWords(failure(code));

    expect(said).toBe(words);
    expect(said).not.toContain('0x');
  });

  it('keeps the message of a failure that is not a sensor state', () => {
    expect(controlRefusalWords(new Error('bridge gone'))).toBe('bridge gone');
    expect(controlRefusalWords(7)).toBe('7');
  });
});
