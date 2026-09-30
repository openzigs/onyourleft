// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { closeFrames, REFUSAL_CLOSE } from './close-codes.ts';
import { helloText, testRoom } from './core/room-testing.ts';

describe('the close code a room socket gets — #780 criterion 1', () => {
  it('closes a hello with an unknown ticket as 4003 ticket-refused', () => {
    const out = testRoom().receive(1, helloText('forged'), 0);
    expect(closeFrames(out).get(1)).toEqual({ code: 4003, reason: 'ticket-refused' });
  });

  it('closes a hello with no ticket at all as 1008 hello-expected — it is not a hello', () => {
    const noTicket = JSON.parse(helloText('ticket-ann')) as Record<string, unknown>;
    delete noTicket.ticket;
    const out = testRoom().receive(1, JSON.stringify(noTicket), 0);
    expect(closeFrames(out).get(1)).toEqual({ code: 1008, reason: 'hello-expected' });
  });

  it('closes the older socket of an athlete who connected again as 4006 replaced', () => {
    const room = testRoom();
    room.receive(1, helloText('ticket-ann'), 0);
    const out = room.receive(2, helloText('ticket-ann'), 10);
    expect(closeFrames(out).get(1)).toEqual({ code: 4006, reason: 'replaced' });
    expect(closeFrames(out).has(2)).toBe(false);
  });

  it('has a distinct application code for every refusal the protocol names', () => {
    const codes = Object.values(REFUSAL_CLOSE).map((frame) => frame.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toBeGreaterThanOrEqual(4000);
  });
});
