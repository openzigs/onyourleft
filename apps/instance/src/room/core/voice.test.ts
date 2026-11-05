// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room's Discord voice link in its welcome (#875): said to a rider the room
 * admits, in every welcome from when it is set, and to nobody it refuses.
 */

import { describe, expect, it } from 'vitest';

import { closed, helloText, sentTo, testRoom } from './room-testing.ts';

const INVITE = 'https://discord.gg/inv1abc';
const NEWER = 'https://discord.gg/inv2abc';

describe('the voice link in a welcome — #875', () => {
  it('is in no welcome until it is set, and in every welcome after', () => {
    const room = testRoom({ kind: 'ride' });
    const before = sentTo(room.receive(1, helloText('ticket-ann'), 0), 1);
    expect(before[0]).toMatchObject({ type: 'welcome' });
    expect(before[0]).not.toHaveProperty('voiceInvite');

    room.setVoiceInvite(INVITE);
    const after = sentTo(room.receive(2, helloText('ticket-bea'), 10), 2);
    expect(after[0]).toMatchObject({ type: 'welcome', voiceInvite: INVITE });
  });

  it('is said again, newest first, when a rider rejoins', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.disconnect(1, 100);
    room.setVoiceInvite(NEWER);
    const rejoined = sentTo(room.receive(2, helloText('ticket-ann'), 200), 2);
    expect(rejoined[0]).toMatchObject({ type: 'welcome', riderId: 0, voiceInvite: NEWER });
  });

  it('is never said to a rider the room refuses — before admission there is no link', () => {
    const room = testRoom();
    room.setVoiceInvite(INVITE);
    for (const [connection, text] of [
      [1, helloText('not-a-ticket')],
      [2, helloText('ticket-ann', { protocol: 1 })],
      [3, helloText('ticket-ann', { physicsVersion: 1 })],
    ] as const) {
      const out = room.receive(connection, text, 0);
      expect(sentTo(out, connection).map((message) => message.type)).toEqual(['refuse']);
      expect(JSON.stringify(out)).not.toContain('discord');
      expect(closed(out)).toEqual([connection]);
    }
  });

  it('is said in nothing but a welcome: not a frame, a name or a countdown', () => {
    const room = testRoom();
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    const later = [
      ...room.receive(2, helloText('ticket-bea'), 10),
      ...room.start(20),
      ...room.tick(20 + 10_000),
      ...room.tick(20 + 11_000),
    ];
    const carrying = later.filter(
      (out) => out.kind === 'send' && JSON.stringify(out.message).includes('discord'),
    );
    expect(
      carrying.map((out) => (out.kind === 'send' ? [out.connection, out.message.type] : [])),
    ).toEqual([[2, 'welcome']]);
  });

  it('is cleared by setting none, and refuses anything that is not a Discord invite link', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.setVoiceInvite(undefined);
    expect(sentTo(room.receive(1, helloText('ticket-ann'), 0), 1)[0]).not.toHaveProperty(
      'voiceInvite',
    );
    for (const [index, bad] of [
      'http://discord.gg/inv1abc',
      'https://evil.example/inv1abc',
      'javascript:alert(1)',
      `${INVITE}?next=x`,
    ].entries()) {
      room.setVoiceInvite(bad);
      const welcome = sentTo(
        room.receive(10 + index, helloText(`ticket-r${String(index)}`), 0),
        10 + index,
      )[0];
      expect(welcome, bad).toMatchObject({ type: 'welcome' });
      expect(welcome, bad).not.toHaveProperty('voiceInvite');
    }
  });
});

describe('a changed voice link, told to the riders already welcomed — #876', () => {
  it('tells every connected rider the new link but the one it was changed about, and sends nothing when it is the same', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.receive(3, helloText('ticket-cai'), 0);
    const out = room.setVoiceInvite(NEWER, 'bea');
    expect(sentTo(out, 1)).toEqual([{ type: 'voice', voiceInvite: NEWER }]);
    expect(sentTo(out, 2)).toEqual([]);
    expect(sentTo(out, 3)).toEqual([{ type: 'voice', voiceInvite: NEWER }]);
    expect(room.setVoiceInvite(NEWER)).toEqual([]);
    // And the next welcome says the new one.
    expect(sentTo(room.receive(4, helloText('ticket-dee'), 0), 4)[0]).toMatchObject({
      voiceInvite: NEWER,
    });
  });

  it('tells them there is no voice any more, and tells nobody who is not connected', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.disconnect(2, 100);
    const out = room.setVoiceInvite(undefined);
    expect(out).toEqual([{ kind: 'send', connection: 1, message: { type: 'voice' } }]);
  });

  it('tells a rider the room removed nothing: they are gone before the link changes', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.remove('bea', 100);
    const out = room.setVoiceInvite(NEWER, 'bea');
    expect(sentTo(out, 2)).toEqual([]);
    expect(sentTo(out, 1)).toEqual([{ type: 'voice', voiceInvite: NEWER }]);
  });

  it('keeps a withheld rider out of every later change, whoever it is about', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.setVoiceInvite(NEWER, 'bea');
    const later = room.setVoiceInvite('https://discord.gg/inv3abc');
    expect(sentTo(later, 2)).toEqual([]);
    expect(sentTo(later, 1)).toEqual([
      { type: 'voice', voiceInvite: 'https://discord.gg/inv3abc' },
    ]);
  });

  it('keeps a withheld rider out of the link a later join makes after a rotation that made none', () => {
    const room = testRoom({ kind: 'ride' });
    room.setVoiceInvite(INVITE);
    room.receive(1, helloText('ticket-ann'), 0);
    room.receive(2, helloText('ticket-bea'), 0);
    room.setVoiceInvite(undefined, 'bea');
    const fresh = room.setVoiceInvite(NEWER);
    expect(sentTo(fresh, 2)).toEqual([]);
    expect(sentTo(fresh, 1)).toEqual([{ type: 'voice', voiceInvite: NEWER }]);
  });
});
