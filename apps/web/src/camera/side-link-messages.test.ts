// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  controlMessageText,
  MAXIMUM_CONTROL_MESSAGE_LENGTH,
  phoneMessageFrom,
  tabletMessageFrom,
} from './side-link-messages';

describe('what the phone accepts from the tablet', () => {
  it('reads each of D-3’s tablet → phone messages', () => {
    expect(tabletMessageFrom(controlMessageText({ t: 'start', n: 0 }))).toEqual({
      t: 'start',
      n: 0,
    });
    expect(tabletMessageFrom(controlMessageText({ t: 'stop', n: 7 }))).toEqual({ t: 'stop', n: 7 });
    expect(tabletMessageFrom('{"t":"reference","reference":{"a":1}}')).toEqual({
      t: 'reference',
      reference: { a: 1 },
    });
    expect(tabletMessageFrom('{"t":"verdict","verdict":"matches"}')).toEqual({
      t: 'verdict',
      verdict: 'matches',
    });
    expect(tabletMessageFrom('{"t":"ping"}')).toEqual({ t: 'ping' });
  });

  it('refuses the phone’s own column — a tablet does not say hello or acknowledge', () => {
    expect(tabletMessageFrom('{"t":"hello","k":"x"}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"ack","n":1}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"state","s":"filming"}')).toBeUndefined();
  });

  it('refuses an unknown type, an extra field, a bad number, a non-string and an oversized message', () => {
    expect(tabletMessageFrom('{"t":"reboot"}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"start","n":1,"athlete":"a"}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"start","n":-1}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"start","n":1.5}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"start"}')).toBeUndefined();
    expect(tabletMessageFrom('{"t":"ping","extra":true}')).toBeUndefined();
    expect(tabletMessageFrom('not json')).toBeUndefined();
    expect(tabletMessageFrom('[1]')).toBeUndefined();
    expect(tabletMessageFrom(new Uint8Array(4))).toBeUndefined();
    expect(
      tabletMessageFrom(
        `{"t":"reference","reference":"${'x'.repeat(MAXIMUM_CONTROL_MESSAGE_LENGTH)}"}`,
      ),
    ).toBeUndefined();
  });
});

describe('what the tablet accepts from the phone', () => {
  it('reads each of D-3’s phone → tablet messages', () => {
    expect(phoneMessageFrom(controlMessageText({ t: 'hello', k: 'abc' }))).toEqual({
      t: 'hello',
      k: 'abc',
    });
    expect(
      phoneMessageFrom(controlMessageText({ t: 'state', report: { state: 'filming' } })),
    ).toEqual({ t: 'state', report: { state: 'filming' } });
    expect(
      phoneMessageFrom(
        controlMessageText({ t: 'state', report: { state: 'stopped', reason: 'link-lost' } }),
      ),
    ).toEqual({ t: 'state', report: { state: 'stopped', reason: 'link-lost' } });
    expect(phoneMessageFrom(controlMessageText({ t: 'ack', n: 3 }))).toEqual({ t: 'ack', n: 3 });
    expect(phoneMessageFrom('{"t":"ping"}')).toEqual({ t: 'ping' });
  });

  it('refuses the tablet’s own column — a phone does not command a tablet', () => {
    expect(phoneMessageFrom('{"t":"start","n":1}')).toBeUndefined();
    expect(phoneMessageFrom('{"t":"reference","reference":{}}')).toBeUndefined();
  });

  it('refuses a state that is not one of the phone’s, and a stop without a known reason', () => {
    expect(phoneMessageFrom('{"t":"state","s":"recording"}')).toBeUndefined();
    expect(phoneMessageFrom('{"t":"state","s":"stopped"}')).toBeUndefined();
    expect(phoneMessageFrom('{"t":"state","s":"stopped","why":"constructor"}')).toBeUndefined();
    expect(phoneMessageFrom('{"t":"state","s":"filming","why":"rider"}')).toBeUndefined();
    expect(phoneMessageFrom('{"t":"state","s":"filming","at":1727280000000}')).toBeUndefined();
  });

  it('refuses a hello whose secret is not a short string', () => {
    expect(phoneMessageFrom('{"t":"hello","k":7}')).toBeUndefined();
    expect(phoneMessageFrom(`{"t":"hello","k":"${'a'.repeat(65)}"}`)).toBeUndefined();
  });
});
