// SPDX-License-Identifier: Apache-2.0

/**
 * The connection lifecycle, asserted as a table rather than a handful of cases.
 *
 * Every ordered pair of states is checked, so adding a state without deciding
 * what it may move to fails here rather than being discovered by a transport.
 */

import { describe, expect, it } from 'vitest';

import {
  canReportMeasurements,
  CONNECTION_STATES,
  isConnectionTransitionAllowed,
  type ConnectionState,
} from './index';

/** Every transition the lifecycle permits, restated independently of the source. */
const PERMITTED: ReadonlySet<string> = new Set([
  'disconnected>connecting',
  'disconnected>unavailable',
  'connecting>connected',
  'connecting>disconnected',
  'connecting>unavailable',
  'connected>reconnecting',
  'connected>disconnected',
  'connected>unavailable',
  'reconnecting>connected',
  'reconnecting>disconnected',
  'reconnecting>unavailable',
  'unavailable>disconnected',
]);

describe('the five states', () => {
  it('are exactly the ones #39 requires', () => {
    expect([...CONNECTION_STATES]).toEqual([
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
      'unavailable',
    ]);
  });
});

describe('every ordered pair of states', () => {
  for (const from of CONNECTION_STATES) {
    for (const to of CONNECTION_STATES) {
      const expected = from === to || PERMITTED.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'rejected'}`, () => {
        expect(isConnectionTransitionAllowed(from, to)).toBe(expected);
      });
    }
  }
});

describe('the transitions that carry the design', () => {
  it('cannot jump from disconnected straight to connected', () => {
    // Every connection passes through `connecting`, so a UI has somewhere to
    // put a spinner and a transport cannot announce a link it has not made.
    expect(isConnectionTransitionAllowed('disconnected', 'connected')).toBe(false);
  });

  it('cannot resume from unavailable to anything but disconnected', () => {
    // Bluetooth coming back on does not restore a link. On Web Bluetooth it
    // does not even restore permission to attempt one without a gesture.
    expect(isConnectionTransitionAllowed('unavailable', 'connecting')).toBe(false);
    expect(isConnectionTransitionAllowed('unavailable', 'connected')).toBe(false);
    expect(isConnectionTransitionAllowed('unavailable', 'reconnecting')).toBe(false);
    expect(isConnectionTransitionAllowed('unavailable', 'disconnected')).toBe(true);
  });

  it('lets a native stack drop into reconnecting and come back', () => {
    expect(isConnectionTransitionAllowed('connected', 'reconnecting')).toBe(true);
    expect(isConnectionTransitionAllowed('reconnecting', 'connected')).toBe(true);
  });

  it('accepts a redundant re-announcement of the current state', () => {
    // Android fires STATE_CONNECTED on a link that was already up. A lifecycle
    // that called that a fault would fail on a correct adapter.
    for (const state of CONNECTION_STATES) {
      expect(isConnectionTransitionAllowed(state, state)).toBe(true);
    }
  });
});

describe('only a connected device may report measurements', () => {
  it('is true of connected and of nothing else', () => {
    const reporting = CONNECTION_STATES.filter((state: ConnectionState) =>
      canReportMeasurements(state),
    );
    expect(reporting).toEqual(['connected']);
  });

  it('excludes reconnecting, which is the tempting one', () => {
    // A transport that buffered notifications across a drop and flushed them on
    // recovery would deliver samples whose receive instants are minutes old,
    // and a recorder cannot tell those from live data.
    expect(canReportMeasurements('reconnecting')).toBe(false);
  });
});
