// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A removal or a ban acts on Discord voice too (#876): the room's channel
 * rotated against a double of Discord's API, its riders told the new link
 * with the rider the action was about left out, and what was done appended
 * to the log — read back from what the double holds and what was recorded.
 */

import { describe, expect, it } from 'vitest';

import type { VoiceLogEntry } from '../store/sql-store.ts';
import { createDiscordClient } from './discord.ts';
import { fakeDiscord, TEST_BOT_TOKEN, TEST_GUILD_ID, type FakeDiscord } from './discord-testing.ts';
import { createRoomVoice } from './room-voice.ts';
import { createVoiceModeration, voiceActionReason } from './voice-moderation.ts';

const ROOM = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER_ROOM = '0123456789abcdef0123456789abcdef';
const THIRD_ROOM = 'fedcba9876543210fedcba9876543210';
const HOST = 'athlete-host';
const BEA = 'athlete-bea';

function world(members: Readonly<Record<string, readonly string[]>> = {}) {
  const discord: FakeDiscord = fakeDiscord();
  const lines: string[] = [];
  const voice = createRoomVoice({
    discord: createDiscordClient({
      settings: { botToken: TEST_BOT_TOKEN, guildId: TEST_GUILD_ID },
      version: '0',
      fetch: discord.fetch,
    }),
    log: (line) => lines.push(line),
  });
  const told: { roomId: string; invite: string | undefined; withheldFrom: string }[] = [];
  const recorded: VoiceLogEntry[] = [];
  const failing = { record: false };
  const moderation = createVoiceModeration({
    voice,
    tell: (roomId, invite, withheldFrom) => told.push({ roomId, invite, withheldFrom }),
    isMember: (roomId, athleteId) => Promise.resolve(members[roomId]?.includes(athleteId) ?? false),
    record: (entry) => {
      if (failing.record) return Promise.reject(new Error(`no disk for ${TEST_BOT_TOKEN}`));
      recorded.push(entry);
      return Promise.resolve(recorded.length);
    },
    now: () => 1_790_000_000_000,
    log: (line) => lines.push(line),
  });
  return { discord, voice, moderation, told, recorded, lines, failing };
}

describe('after a removal from a room — #876', () => {
  it('replaces the room’s channel, tells its riders the new link but the removed rider, and logs it', async () => {
    const w = world();
    const before = await w.voice.inviteFor(ROOM, 8);
    const oldChannel = w.discord.ourChannels()[0]?.id;
    await w.moderation.afterRemoval({ roomId: ROOM, actorId: HOST, targetId: BEA, logId: 41 });

    // Discord: the old channel — and everybody in it — gone; one new one.
    expect(w.discord.channels.has(oldChannel ?? '')).toBe(false);
    expect(w.discord.ourChannels()).toHaveLength(1);
    const now = await w.voice.inviteFor(ROOM, 8);
    expect(now).not.toBe(before);
    expect(w.told).toEqual([{ roomId: ROOM, invite: now, withheldFrom: BEA }]);
    expect(w.recorded).toEqual([
      {
        actorAthleteId: HOST,
        targetAthleteId: BEA,
        roomId: ROOM,
        reason:
          'The room’s voice channel was deleted after log entry 41, disconnecting everybody in it. The riders still in the room were given a new link.',
        at: 1_790_000_000,
      },
    ]);
  });

  it('does nothing — no request, no word, no log — in a room with no voice', async () => {
    const w = world();
    await w.moderation.afterRemoval({ roomId: ROOM, actorId: HOST, targetId: BEA, logId: 41 });
    expect(w.discord.requests).toEqual([]);
    expect(w.told).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it('says so in the log when Discord would not delete the old channel: the rider may still be in it', async () => {
    const w = world();
    await w.voice.inviteFor(ROOM, 8);
    w.discord.failNext(/^DELETE \/channels\//, { status: 500 });
    await w.moderation.afterRemoval({ roomId: ROOM, actorId: HOST, targetId: BEA, logId: 7 });
    expect(w.recorded[0]?.reason).toBe(
      'Discord did not delete the room’s voice channel after log entry 7, so the rider may still be in it until the instance’s next voice sweep. The riders still in the room were given a new link.',
    );
  });

  it('tells the riders the room has no voice now when no new channel could be made', async () => {
    const w = world();
    await w.voice.inviteFor(ROOM, 8);
    w.discord.failNext(/^POST \/guilds\//, { status: 403 });
    await w.moderation.afterRemoval({ roomId: ROOM, actorId: HOST, targetId: BEA, logId: 7 });
    expect(w.told).toEqual([{ roomId: ROOM, invite: undefined, withheldFrom: BEA }]);
    expect(w.recorded[0]?.reason).toContain(
      'No new channel could be made, so the room has no voice now.',
    );
  });

  it('never throws when the log cannot be written: the removal stands, and the failure is logged by name', async () => {
    const w = world();
    await w.voice.inviteFor(ROOM, 8);
    w.failing.record = true;
    await expect(
      w.moderation.afterRemoval({ roomId: ROOM, actorId: HOST, targetId: BEA, logId: 7 }),
    ).resolves.toBeUndefined();
    expect(w.lines.map((line) => JSON.parse(line) as unknown)).toContainEqual({
      event: 'voice-failed',
      code: 'log',
      error: 'Error',
    });
    for (const line of w.lines) expect(line).not.toContain(TEST_BOT_TOKEN);
  });
});

describe('after a suspension, the account-level ban — #876', () => {
  it('replaces the channel of every room with voice the rider is a member of, and only those', async () => {
    const w = world({ [ROOM]: [HOST, BEA], [OTHER_ROOM]: [BEA], [THIRD_ROOM]: [HOST] });
    for (const roomId of [ROOM, OTHER_ROOM, THIRD_ROOM]) await w.voice.inviteFor(roomId, 8);
    const third = w.discord
      .ourChannels()
      .find((each) => each.name.endsWith(THIRD_ROOM.slice(0, 12)));

    await w.moderation.afterSuspension({ actorId: 'moderator', targetId: BEA, logId: 90 });

    expect(w.told.map((each) => each.roomId).sort()).toEqual([OTHER_ROOM, ROOM].sort());
    expect(w.told.every((each) => each.withheldFrom === BEA && each.invite !== undefined)).toBe(
      true,
    );
    expect(
      w.recorded.map((each) => [each.roomId, each.targetAthleteId, each.actorAthleteId]).sort(),
    ).toEqual(
      [
        [OTHER_ROOM, BEA, 'moderator'],
        [ROOM, BEA, 'moderator'],
      ].sort(),
    );
    expect(w.recorded.every((each) => each.reason.includes('after log entry 90'))).toBe(true);
    // The room she is not in keeps its channel.
    expect(w.discord.channels.has(third?.id ?? '')).toBe(true);
  });
});

describe('voiceActionReason — #876', () => {
  it('names the entry it followed and nothing about anybody', () => {
    for (const rotation of [
      { oldDeleted: true, invite: 'https://discord.gg/inv9abc' },
      { oldDeleted: false, invite: undefined },
    ]) {
      const reason = voiceActionReason(rotation, 12);
      expect(reason).toContain('after log entry 12');
      expect(reason).not.toContain('discord.gg');
    }
  });
});
