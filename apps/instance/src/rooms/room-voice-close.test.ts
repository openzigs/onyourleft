// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room's Discord voice channel goes when the room is over (#874), by each of
 * the ways a room is over (`rooms.ts` §`over`), asserted against a double of
 * Discord's API that holds channels as state.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
} from '../auth/identity-testing.ts';
import { createDiscordClient } from '../voice/discord.ts';
import {
  fakeDiscord,
  TEST_BOT_TOKEN,
  TEST_GUILD_ID,
  type FakeDiscord,
} from '../voice/discord-testing.ts';
import { createRoomVoice, type RoomVoice } from '../voice/room-voice.ts';
import { erasedAccount, madeRoom, riderIn } from './rooms-testing.ts';
import { UNRIDDEN_ROOM_LIFETIME_MS } from './rooms.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function withVoice(): Promise<{
  w: IdentityInstance;
  discord: FakeDiscord;
  voice: RoomVoice;
}> {
  const discord = fakeDiscord();
  const voice = createRoomVoice({
    discord: createDiscordClient({
      settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
      version: '0.0.0',
      fetch: discord.fetch,
    }),
    log: () => undefined,
  });
  await voice.start();
  world = await startIdentityInstance({ voice });
  return { w: world, discord, voice };
}

const everyRoomClaimed = { claim: () => true, release: () => undefined };

describe('a room that is over deletes its voice channel (#874)', () => {
  it('a finished race: the channel and its invite are gone from Discord, and the room is over', async () => {
    const { w, discord, voice } = await withVoice();
    const anna = await riderIn(w, await testDevice());
    const room = await madeRoom(w, anna.token);
    const other = await madeRoom(w, anna.token);
    expect(await voice.inviteFor(room.roomId, 8)).toBeDefined();
    expect(await voice.inviteFor(other.roomId, 8)).toBeDefined();
    expect(discord.ourChannels()).toHaveLength(2);

    await w.rooms.roomLetGo(room.roomId, 'finished');

    expect(discord.ourChannels().map((each) => each.name)).toEqual([
      `oyl-ride-${other.roomId.slice(0, 12)}`,
    ]);
    expect(discord.invites.size).toBe(1);
    const route = await w.call('GET', `/v1/rooms/${room.roomId}/route`, { token: anna.token });
    expect(route.status).toBe(404);
  });

  it('a group ride whose lobby emptied is not over, and keeps its channel', async () => {
    const { w, discord, voice } = await withVoice();
    const anna = await riderIn(w, await testDevice());
    const room = await madeRoom(w, anna.token, { kind: 'group' });
    await voice.inviteFor(room.roomId, 8);
    await w.rooms.roomLetGo(room.roomId, 'lobby');
    expect(discord.ourChannels()).toHaveLength(1);
  });

  it('a room its creator erased goes with the account, and so does its channel', async () => {
    const { w, discord, voice } = await withVoice();
    const anna = await riderIn(w, await testDevice());
    const room = await madeRoom(w, anna.token);
    await voice.inviteFor(room.roomId, 8);
    expect((await erasedAccount(w, anna)).status).toBe(204);
    expect(discord.ourChannels()).toEqual([]);
  });

  it('a room nobody rode for a day is swept, and so is its channel', async () => {
    const { w, discord, voice } = await withVoice();
    const anna = await riderIn(w, await testDevice());
    const room = await madeRoom(w, anna.token);
    await voice.inviteFor(room.roomId, 8);
    w.clock.ms += UNRIDDEN_ROOM_LIFETIME_MS + 1000;
    expect(await w.rooms.sweep(everyRoomClaimed)).toBe(1);
    expect(discord.ourChannels()).toEqual([]);
  });

  it('Discord refusing the delete never keeps a room open', async () => {
    const { w, discord, voice } = await withVoice();
    const anna = await riderIn(w, await testDevice());
    const room = await madeRoom(w, anna.token);
    await voice.inviteFor(room.roomId, 8);
    discord.failNext(/^DELETE \/channels\//, { throws: new TypeError('network') });
    await w.rooms.roomLetGo(room.roomId, 'finished');
    expect(await w.freshRead((store) => store.countOpenPrivateRoomsMadeBy(anna.athleteId))).toBe(0);
    // The channel no room holds is the voice sweep's.
    expect(await voice.sweep()).toBe(1);
    expect(discord.ourChannels()).toEqual([]);
  });
});
