// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Discord voice channel per private room (#874), asserted against a double
 * of Discord's API that holds channels and invites as state: each test reads
 * back what Discord would hold, not what the bot said it sent.
 */

import { describe, expect, it } from 'vitest';

import { createDiscordClient } from './discord.ts';
import { fakeDiscord, TEST_BOT_TOKEN, TEST_GUILD_ID, type FakeDiscord } from './discord-testing.ts';
import {
  createRoomVoice,
  INVITE_MAX_AGE_SECONDS,
  INVITE_ORIGIN,
  type RoomVoice,
  type RoomVoiceOptions,
} from './room-voice.ts';

const ROOM = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER_ROOM = '0123456789abcdef0123456789abcdef';

function voiceOver(
  discord: FakeDiscord,
  extra: Partial<Omit<RoomVoiceOptions, 'discord' | 'log'>> = {},
): { voice: RoomVoice; lines: string[] } {
  const lines: string[] = [];
  const voice = createRoomVoice({
    discord: createDiscordClient({
      settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
      version: '0.0.0',
      fetch: discord.fetch,
      sleep: () => Promise.resolve(),
    }),
    log: (line) => lines.push(line),
    ...extra,
  });
  return { voice, lines };
}

const records = (lines: readonly string[]) =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe('a room’s voice channel and invite (#874)', () => {
  it('is made on the first ask, and the same invite is answered after, even asked twice at once', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.start();
    const [first, second] = await Promise.all([voice.inviteFor(ROOM, 8), voice.inviteFor(ROOM, 8)]);
    expect(first).toMatch(new RegExp(`^${INVITE_ORIGIN}[A-Za-z0-9-]+$`));
    expect(second).toBe(first);
    expect(await voice.inviteFor(ROOM, 8)).toBe(first);
    // One channel and one invite, held by Discord.
    expect(discord.ourChannels()).toHaveLength(1);
    expect(discord.invites.size).toBe(1);
  });

  it('names the channel from the room’s opaque id alone: no topic, no category, sized to the room', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.inviteFor(ROOM, 8);
    const [channel] = discord.ourChannels();
    expect(channel).toEqual({
      id: channel?.id,
      name: `oyl-ride-${ROOM.slice(0, 12)}`,
      type: 2,
      user_limit: 8,
    });
    const made = discord.requests.find(
      (each) => each.method === 'POST' && each.path.endsWith('/channels'),
    );
    expect(Object.keys(made?.body as object).sort()).toEqual(['name', 'type', 'user_limit']);
  });

  it('makes a temporary, unique invite for at most the room’s riders, for a day', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.inviteFor(ROOM, 12);
    const [invite] = [...discord.invites.values()];
    expect(invite).toMatchObject({
      max_age: INVITE_MAX_AGE_SECONDS,
      max_uses: 12,
      temporary: true,
      unique: true,
    });
    expect(INVITE_MAX_AGE_SECONDS).toBe(86_400);
  });

  it('caps the invite at Discord’s 100 uses and the channel at 99 people', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.inviteFor(ROOM, 100);
    expect(discord.ourChannels()[0]?.user_limit).toBe(99);
    expect([...discord.invites.values()][0]?.max_uses).toBe(100);
  });

  it('asks nothing of Discord for an id that is not a room’s, or for no riders', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    for (const id of ['', 'ROOM', `${ROOM}0`, ROOM.toUpperCase(), '../../guilds']) {
      expect(await voice.inviteFor(id, 8), id).toBeUndefined();
    }
    expect(await voice.inviteFor(ROOM, 0)).toBeUndefined();
    expect(discord.requests).toEqual([]);
  });

  it('deletes the channel it just made when Discord refuses its invite', async () => {
    const discord = fakeDiscord();
    discord.failNext(/^POST \/channels\/[0-9]+\/invites$/, { status: 403 });
    const { voice, lines } = voiceOver(discord);
    expect(await voice.inviteFor(ROOM, 8)).toBeUndefined();
    expect(discord.ourChannels()).toEqual([]);
    expect(records(lines)).toContainEqual({ event: 'voice-failed', code: 'invite', status: 403 });
    // And asks again next time.
    expect(await voice.inviteFor(ROOM, 8)).toBeDefined();
  });

  it(`opens no more than its cap of rooms at once`, async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord, { maximumRooms: 1 });
    expect(await voice.inviteFor(ROOM, 8)).toBeDefined();
    expect(await voice.inviteFor(OTHER_ROOM, 8)).toBeUndefined();
    await voice.close(ROOM);
    expect(await voice.inviteFor(OTHER_ROOM, 8)).toBeDefined();
  });
});

describe('a room that closes has its channel deleted (#874)', () => {
  it('deletes the invite and then the channel, and Discord holds neither', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.inviteFor(ROOM, 8);
    await voice.inviteFor(OTHER_ROOM, 8);
    await voice.close(ROOM);
    expect(discord.ourChannels().map((each) => each.name)).toEqual([
      `oyl-ride-${OTHER_ROOM.slice(0, 12)}`,
    ]);
    expect([...discord.invites.values()].map((each) => each.channelId)).toEqual([
      discord.ourChannels()[0]?.id,
    ]);
    const deletes = discord.requests
      .filter((each) => each.method === 'DELETE')
      .map((each) => each.path);
    expect(deletes[0]).toMatch(/^\/invites\//);
    expect(deletes[1]).toMatch(/^\/channels\//);
  });

  it('a room with no voice asks nothing of Discord when it closes', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    await voice.close(ROOM);
    expect(discord.requests).toEqual([]);
  });

  it('a delete Discord refuses is logged, never thrown, and the next sweep deletes the channel', async () => {
    const discord = fakeDiscord();
    const { voice, lines } = voiceOver(discord);
    await voice.inviteFor(ROOM, 8);
    discord.failNext(/^DELETE \/channels\//, { status: 500 });
    await voice.close(ROOM);
    expect(discord.ourChannels()).toHaveLength(1);
    expect(records(lines)).toContainEqual({
      event: 'voice-failed',
      code: 'delete-channel',
      status: 500,
    });
    expect(await voice.sweep()).toBe(1);
    expect(discord.ourChannels()).toEqual([]);
  });

  it('a closed room is given a NEW channel if it is asked for again, never the old link', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    const first = await voice.inviteFor(ROOM, 8);
    await voice.close(ROOM);
    const again = await voice.inviteFor(ROOM, 8);
    expect(again).not.toBe(first);
  });
});

describe('rotating a room’s channel (#874, for #876)', () => {
  it('replaces the channel and the invite: the old ones are gone from Discord', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    const first = await voice.inviteFor(ROOM, 8);
    const before = discord.ourChannels()[0]?.id;
    const rotated = await voice.rotate(ROOM);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(first);
    expect(discord.ourChannels()).toHaveLength(1);
    expect(discord.ourChannels()[0]?.id).not.toBe(before);
    expect(discord.invites.size).toBe(1);
    // The same riders as before: the room's capacity is kept.
    expect([...discord.invites.values()][0]?.max_uses).toBe(8);
    // And the rotated link is the room's link from now on.
    expect(await voice.inviteFor(ROOM, 8)).toBe(rotated);
  });

  it('a room with no voice is not given one by a rotation', async () => {
    const discord = fakeDiscord();
    const { voice } = voiceOver(discord);
    expect(await voice.rotate(ROOM)).toBeUndefined();
    expect(discord.requests).toEqual([]);
  });
});

describe('voice off (#874, spike 0018 §5.2, §5.3)', () => {
  it('a token Discord refuses at start turns voice off, says so once, and sends nothing more', async () => {
    const discord = fakeDiscord('another-bots-token.not-ours.0123456789');
    const { voice, lines } = voiceOver(discord);
    await voice.start();
    expect(voice.offCode).toBe('token-refused');
    expect(await voice.inviteFor(ROOM, 8)).toBeUndefined();
    expect(await voice.sweep()).toBe(0);
    expect(discord.requests).toHaveLength(1);
    expect(records(lines)).toEqual([{ event: 'voice', state: 'off', code: 'token-refused' }]);
  });

  it('a token refused later turns voice off from then on', async () => {
    const discord = fakeDiscord();
    const { voice, lines } = voiceOver(discord);
    await voice.start();
    discord.failNext(/^POST \/guilds\//, { status: 401 });
    expect(await voice.inviteFor(ROOM, 8)).toBeUndefined();
    const sent = discord.requests.length;
    expect(await voice.inviteFor(OTHER_ROOM, 8)).toBeUndefined();
    expect(discord.requests).toHaveLength(sent);
    expect(records(lines)).toEqual([
      { event: 'voice', state: 'on' },
      { event: 'voice', state: 'off', code: 'token-refused' },
    ]);
  });

  it('a server with Membership Screening on turns voice off: riders would be let in unable to speak', async () => {
    const discord = fakeDiscord();
    discord.features = ['COMMUNITY', 'MEMBER_VERIFICATION_GATE_ENABLED'];
    const { voice, lines } = voiceOver(discord);
    await voice.start();
    expect(voice.offCode).toBe('membership-screening');
    expect(await voice.inviteFor(ROOM, 8)).toBeUndefined();
    expect(records(lines)).toEqual([
      { event: 'voice', state: 'off', code: 'membership-screening' },
    ]);
  });

  it('a server Discord will not show the bot turns voice off', async () => {
    const discord = fakeDiscord();
    discord.failNext(/^GET \/guilds\/[0-9]+$/, { status: 403 });
    const { voice, lines } = voiceOver(discord);
    await voice.start();
    expect(voice.offCode).toBe('guild-unreachable');
    expect(records(lines)).toEqual([
      { event: 'voice-failed', code: 'guild', status: 403 },
      { event: 'voice', state: 'off', code: 'guild-unreachable' },
    ]);
  });

  it('a call made while start is still asking waits for its answer', async () => {
    const discord = fakeDiscord('another-bots-token.not-ours.0123456789');
    const { voice } = voiceOver(discord);
    const starting = voice.start();
    const asked = voice.inviteFor(ROOM, 8);
    await starting;
    expect(await asked).toBeUndefined();
    expect(discord.requests.map((each) => each.method)).toEqual(['GET']);
  });
});

describe('the voice sweep (#874)', () => {
  it('deletes channels of ours no open room holds — and their invites — and nothing else', async () => {
    const discord = fakeDiscord();
    const leftover = discord.addChannel({ name: 'oyl-ride-0123456789ab', type: 2 });
    discord.invites.set('left1', {
      code: 'left1',
      channelId: leftover.id,
      max_age: 1,
      max_uses: 1,
      temporary: true,
      unique: true,
    });
    const general = discord.addChannel({ name: 'General', type: 2 });
    const text = discord.addChannel({ name: 'oyl-ride-0123456789ab', type: 0 });
    const lookalike = discord.addChannel({ name: 'oyl-ride-0123456789abX', type: 2 });
    const { voice, lines } = voiceOver(discord);
    await voice.start();
    await voice.inviteFor(ROOM, 8);
    const held = discord
      .ourChannels()
      .find((each) => each.id !== leftover.id && each.id !== lookalike.id);

    expect(await voice.sweep()).toBe(1);
    expect([...discord.channels.keys()].sort()).toEqual(
      [general.id, text.id, lookalike.id, held?.id].sort(),
    );
    expect(discord.invites.has('left1')).toBe(false);
    expect(records(lines)).toContainEqual({ event: 'voice-swept', deleted: 1 });
    // The held room's link still opens its channel.
    expect(discord.invites.size).toBe(1);
  });

  it('leaves alone a channel being made while it lists', async () => {
    const discord = fakeDiscord();
    // Discord answers the channel's creation, and the sweep lists, before the invite.
    let release = (): void => undefined;
    const inviteHeld = new Promise<void>((resolve) => (release = resolve));
    const inner = discord.fetch;
    const slowed = ((input: string | URL, init?: RequestInit) =>
      input.toString().endsWith('/invites') && init?.method === 'POST'
        ? inviteHeld.then(() => inner(input, init))
        : inner(input, init)) as typeof globalThis.fetch;
    const lines: string[] = [];
    const slow = createRoomVoice({
      discord: createDiscordClient({
        settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
        version: '0',
        fetch: slowed,
      }),
      log: (line) => lines.push(line),
    });
    const asked = slow.inviteFor(ROOM, 8);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(discord.ourChannels()).toHaveLength(1);
    expect(await slow.sweep()).toBe(0);
    release();
    expect(await asked).toBeDefined();
    expect(discord.ourChannels()).toHaveLength(1);
    expect(lines).toEqual([]);
  });
});

describe('the bot token never reaches a log line (#874, spike 0017 §3.5)', () => {
  it('every failure — a throw carrying the token, an error NAMED by it, a 5xx echoing it — is logged by name only', async () => {
    const discord = fakeDiscord();
    const named = new Error('x');
    named.name = TEST_BOT_TOKEN;
    const { voice, lines } = voiceOver(discord);
    discord.failNext(/^GET \/guilds\/[0-9]+$/, {
      throws: new TypeError(`connect failed: Authorization: Bot ${TEST_BOT_TOKEN}`),
    });
    await voice.start();
    // A second voice, whose start succeeds, to reach every other step.
    const second = voiceOver(discord);
    await second.voice.start();
    discord.failNext(/^POST \/guilds\//, { throws: named });
    await second.voice.inviteFor(ROOM, 8);
    discord.failNext(/^POST \/guilds\//, {
      status: 500,
      body: { message: `bad token ${TEST_BOT_TOKEN}` },
    });
    await second.voice.inviteFor(ROOM, 8);
    discord.failNext(/^POST \/guilds\//, { unparsable: true });
    await second.voice.inviteFor(ROOM, 8);
    await second.voice.inviteFor(ROOM, 8);
    discord.failNext(/^DELETE \/invites\//, {
      throws: new Error(`Bot ${TEST_BOT_TOKEN} was refused`),
    });
    discord.failNext(/^DELETE \/channels\//, {
      throws: new Error(`Bot ${TEST_BOT_TOKEN} was refused`),
    });
    await second.voice.close(ROOM);
    discord.failNext(/^GET \/guilds\/[0-9]+\/channels$/, {
      throws: new Error(TEST_BOT_TOKEN),
    });
    await second.voice.sweep();

    const every = [...lines, ...second.lines];
    expect(every.length).toBeGreaterThan(5);
    for (const line of every) {
      expect(line).not.toContain(TEST_BOT_TOKEN);
      expect(line).not.toContain('not-real');
      expect(line).not.toContain(TEST_GUILD_ID);
    }
    expect(records(every)).toEqual([
      { event: 'voice-failed', code: 'guild', error: 'TypeError' },
      { event: 'voice', state: 'off', code: 'guild-unreachable' },
      { event: 'voice', state: 'on' },
      { event: 'voice-failed', code: 'channel', error: 'unknown' },
      { event: 'voice-failed', code: 'channel', status: 500 },
      { event: 'voice-failed', code: 'channel', error: 'SyntaxError' },
      { event: 'voice-failed', code: 'delete-invite', error: 'Error' },
      { event: 'voice-failed', code: 'delete-channel', error: 'Error' },
      { event: 'voice-failed', code: 'list', error: 'Error' },
    ]);
  });
});
