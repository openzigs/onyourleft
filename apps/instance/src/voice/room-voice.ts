// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A temporary Discord voice channel for each private room** — #874, spike
 * 0017 §3 and §8.1, spike 0018 §7. The owner chose option A on #794
 * (2026-09-29), and private rooms first, by a link alone (0018 Q1).
 *
 * ```text
 * inviteFor(room)  POST /guilds/{guild}/channels      a voice channel, named from the room's opaque id
 *                  POST /channels/{channel}/invites    temporary, unique, at most the room's riders, a day
 * rotate(room)     close, then inviteFor again         #876: a removed rider loses the link
 * close(room)      DELETE /invites/{code}              explicitly: 0018 §5.3 could not establish that
 *                  DELETE /channels/{channel}          deleting a channel deletes its invites
 * sweep()          GET /guilds/{guild}/channels        every channel of ours no room holds, deleted
 * ```
 *
 * ## Optional, and off unless the operator turned it on
 *
 * With no bot token and server configured there is no `RoomVoice` at all, and
 * a room works exactly as it did. A rider with no Discord account loses
 * nothing else. On, {@link RoomVoice.start} asks Discord about the server once
 * and turns voice **off** — saying so in the log, never refusing to start —
 * when the token is refused, the server cannot be reached, or the server has
 * Membership Screening on, which would let riders in who cannot speak (0018
 * §5.3). A `401` at any later time turns it off the same way ({@link
 * DiscordClient.off}).
 *
 * ## The instance's own state decides, never Discord's
 *
 * A channel lives exactly as long as its room (0017 §3.2): the room's ONE
 * close (`rooms/rooms.ts` §`over`) calls {@link RoomVoice.close}. Which
 * channels are a room's is kept **in this process's memory only**, never in
 * the database or a backup — so no Discord data is at rest on the instance
 * (0018 §7 item 3, the Q2 ruling) — and {@link RoomVoice.sweep}, run with
 * every room sweep (`instance.ts`: as the instance opens, and every ten
 * minutes), deletes any channel of ours that no open room holds: what a
 * restart, or a delete Discord refused, left behind.
 *
 * ## What reaches Discord — 0018 §7 item 8
 *
 * A channel's name is `oyl-ride-` and the first twelve hex digits of the
 * room's id, which `rooms.ts` draws from the CSPRNG and which names no athlete.
 * No topic, no category (0018 §5.3: fifty channels a category), no audit-log
 * reason, and nothing a rider typed, nor any ride or health data.
 *
 * ## What reaches the log
 *
 * Fixed words and numbers only: `voice` (`state`, `code`), `voice-failed`
 * (`code` — the step — and `status` or `error`, an error's NAME), and
 * `voice-swept` (`deleted`). Never a token, an invite, a channel id or a room id.
 */

import { logEvent, type LogSink } from '../log.ts';
import type { DiscordAnswer, DiscordClient } from './discord.ts';

/** A room id as `rooms/rooms.ts` mints it: 16 random bytes, lowercase hex. */
const ROOM_ID = /^[0-9a-f]{32}$/;

/** What every channel this instance makes is called, and so how its leftovers are found. */
export const CHANNEL_PREFIX = 'oyl-ride-';

/** A channel of ours: the prefix and the first twelve hex digits of its room's id. */
const OUR_CHANNEL = /^oyl-ride-[0-9a-f]{12}$/;

/** A Discord id: a snowflake, in decimal. */
const SNOWFLAKE = /^[0-9]{17,20}$/;

/** An invite's code, as Discord writes it. */
const INVITE_CODE = /^[A-Za-z0-9-]{2,32}$/;

/** Discord's channel type for a guild voice channel. */
const GUILD_VOICE = 2;

/** Where an invite opens. */
export const INVITE_ORIGIN = 'https://discord.gg/';

/**
 * How long an invite lasts: a day, in seconds — the longest a room nobody is
 * riding stays open (`rooms.ts` §`UNRIDDEN_ROOM_LIFETIME_MS`), and under
 * Discord's 7-day ceiling. Written out so this module reaches no store.
 */
export const INVITE_MAX_AGE_SECONDS = 86_400;

/** The most uses Discord allows one invite, and the most people a voice channel may limit itself to. */
const MAXIMUM_INVITE_USES = 100;
const MAXIMUM_USER_LIMIT = 99;

/**
 * The most rooms with voice at once: 400. ⚠️ The author's number, under the
 * 500 channels a Discord server holds (0018 §5.3), so the operator's own
 * channels still fit. A room past it simply has no voice.
 */
export const MAXIMUM_VOICE_ROOMS = 400;

/**
 * How long {@link RoomVoice.close} makes its caller wait. A room is over when
 * its close commits; Discord's latency (timeouts, rate-limit waits) must not
 * hold up an account erase or the instance's stop. The delete carries on in
 * the background, and one that fails is the sweep's to find.
 */
export const CLOSE_WAIT_MS = 2000;

/** Why voice is off, as the log says it. */
export type VoiceOffCode = 'token-refused' | 'guild-unreachable' | 'membership-screening';

/**
 * What a rotation did (#876): whether Discord deleted the old channel — and
 * with it disconnected everybody in it — and the new link, or `undefined`
 * when no new channel could be made and the room has no voice now.
 */
export interface Rotation {
  readonly oldDeleted: boolean;
  readonly invite: string | undefined;
}

export interface RoomVoice {
  /**
   * The room's invite link, its channel made on the first ask and the same
   * link after — or `undefined`: voice is off, the room id is not one, the
   * instance is at {@link MAXIMUM_VOICE_ROOMS}, or Discord refused. `riders`
   * bounds the invite's uses and the channel's size: the room's capacity.
   */
  inviteFor(roomId: string, riders: number): Promise<string | undefined>;
  /**
   * The room's channel and invite replaced by new ones — #876's remedy for a
   * rider removed from a room they joined by a link (0017 §3.3): everybody in
   * the old channel is disconnected, and only riders still in the room get the
   * new link. `undefined` when the room had no voice; otherwise what was done.
   */
  rotate(roomId: string): Promise<Rotation | undefined>;
  /** The rooms that have voice now (#876): what a ban rotates, among the banned rider's. */
  rooms(): readonly string[];
  /** The room is over: its invite and channel deleted. Never throws. */
  close(roomId: string): Promise<void>;
  /** Asks Discord about the server once, and logs whether voice is on. Never throws; every other call waits for it. */
  start(): Promise<void>;
  /** Deletes every channel of ours no open room holds, and answers how many. Never throws. */
  sweep(): Promise<number>;
  /** Why voice is off, or `undefined` while it is on. */
  readonly offCode: VoiceOffCode | undefined;
}

export interface RoomVoiceOptions {
  readonly discord: DiscordClient;
  readonly log: LogSink;
  /** {@link MAXIMUM_VOICE_ROOMS} unless a test's. */
  readonly maximumRooms?: number;
  /** {@link CLOSE_WAIT_MS} unless a test's. */
  readonly closeWaitMs?: number;
}

/** A room's voice, as this process holds it. */
interface Held {
  readonly channelId: string;
  readonly inviteCode: string;
  readonly riders: number;
}

export function createRoomVoice(options: RoomVoiceOptions): RoomVoice {
  const { discord, log } = options;
  const maximumRooms = options.maximumRooms ?? MAXIMUM_VOICE_ROOMS;
  const closeWaitMs = options.closeWaitMs ?? CLOSE_WAIT_MS;
  const held = new Map<string, Held>();
  /** Rooms whose channel is being made: the sweep leaves a channel of theirs alone. */
  const opening = new Set<string>();
  /** Slots taken by a room being given its channel: the cap counts them with `held`. */
  let reserved = 0;
  const turns = new Map<string, Promise<void>>();
  /** Whether the guild check failed in a way that may pass later: no answer, or a 5xx. */
  let startRetryable = false;
  let refusedAtStart: VoiceOffCode | undefined;
  let started: Promise<void> | undefined;

  const offCode = (): VoiceOffCode | undefined =>
    refusedAtStart ?? (discord.off ? 'token-refused' : undefined);

  let saidOff = false;
  /** Logs that voice is off, once, if it is. */
  function sayIfOff(): void {
    const code = offCode();
    if (code === undefined || saidOff) return;
    saidOff = true;
    logEvent(log, 'voice', { state: 'off', code });
  }

  function failed(step: string, answer: DiscordAnswer): void {
    if (answer.kind === 'off') sayIfOff();
    else if (answer.kind === 'refused')
      logEvent(log, 'voice-failed', { code: step, status: answer.status });
    else if (answer.kind === 'failed')
      logEvent(log, 'voice-failed', { code: step, error: answer.error });
  }

  /** `work`, once every earlier holder of `roomId`'s turn is done. */
  async function inTurn<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const before = turns.get(roomId) ?? Promise.resolve();
    let done = (): void => undefined;
    const tail = before.then(() => new Promise<void>((resolve) => (done = resolve)));
    turns.set(roomId, tail);
    await before;
    try {
      return await work();
    } finally {
      done();
      if (turns.get(roomId) === tail) turns.delete(roomId);
    }
  }

  const prefixOf = (roomId: string): string => roomId.slice(0, 12);

  /** Deletes one channel, and its invite when it is known. `true` once it is gone. */
  async function deleteChannel(channelId: string, inviteCode?: string): Promise<boolean> {
    if (inviteCode !== undefined) {
      const invite = await discord.request(
        'DELETE /invites/:code',
        'DELETE',
        `/invites/${inviteCode}`,
      );
      if (invite.kind !== 'ok' && !(invite.kind === 'refused' && invite.status === 404)) {
        failed('delete-invite', invite);
      }
    }
    const channel = await discord.request(
      'DELETE /channels/:id',
      'DELETE',
      `/channels/${channelId}`,
    );
    if (channel.kind === 'ok' || (channel.kind === 'refused' && channel.status === 404))
      return true;
    failed('delete-channel', channel);
    return false;
  }

  /** A new channel and invite for `roomId`, or `undefined`; a channel whose invite failed is deleted. */
  async function open(roomId: string, riders: number): Promise<Held | undefined> {
    opening.add(prefixOf(roomId));
    try {
      const channel = await discord.request(
        'POST /guilds/:id/channels',
        'POST',
        `/guilds/${discord.guildId}/channels`,
        {
          name: `${CHANNEL_PREFIX}${prefixOf(roomId)}`,
          type: GUILD_VOICE,
          user_limit: Math.min(riders, MAXIMUM_USER_LIMIT),
        },
      );
      const channelId =
        channel.kind === 'ok' ? (channel.body as { id?: unknown } | null)?.id : undefined;
      if (typeof channelId !== 'string' || !SNOWFLAKE.test(channelId)) {
        failed('channel', channel.kind === 'ok' ? { kind: 'failed', error: 'unknown' } : channel);
        return undefined;
      }
      const invite = await discord.request(
        'POST /channels/:id/invites',
        'POST',
        `/channels/${channelId}/invites`,
        {
          max_age: INVITE_MAX_AGE_SECONDS,
          max_uses: Math.min(riders, MAXIMUM_INVITE_USES),
          temporary: true,
          unique: true,
        },
      );
      const code =
        invite.kind === 'ok' ? (invite.body as { code?: unknown } | null)?.code : undefined;
      if (typeof code !== 'string' || !INVITE_CODE.test(code)) {
        failed('invite', invite.kind === 'ok' ? { kind: 'failed', error: 'unknown' } : invite);
        // No channel nobody can be invited to.
        await deleteChannel(channelId);
        return undefined;
      }
      return { channelId, inviteCode: code, riders };
    } finally {
      opening.delete(prefixOf(roomId));
    }
  }

  const link = (voice: Held): string => `${INVITE_ORIGIN}${voice.inviteCode}`;

  /** Whether voice may be used now: started, and not turned off. */
  async function usable(): Promise<boolean> {
    await (started ?? Promise.resolve());
    sayIfOff();
    return offCode() === undefined;
  }

  /** Asks Discord whether the bot can use the server, and records the answer. */
  async function checkGuild(): Promise<void> {
    const guild = await discord.request('GET /guilds/:id', 'GET', `/guilds/${discord.guildId}`);
    let code: VoiceOffCode | undefined;
    startRetryable = false;
    if (guild.kind === 'off') {
      code = 'token-refused';
    } else if (guild.kind !== 'ok') {
      failed('guild', guild);
      code = 'guild-unreachable';
      startRetryable = guild.kind === 'failed' || guild.status >= 500;
    } else {
      const features = (guild.body as { features?: unknown } | null)?.features;
      if (Array.isArray(features) && features.includes('MEMBER_VERIFICATION_GATE_ENABLED')) {
        code = 'membership-screening';
      }
    }
    refusedAtStart = code;
    if (offCode() === undefined) {
      saidOff = false;
      logEvent(log, 'voice', { state: 'on' });
    } else sayIfOff();
  }

  const roomVoice: RoomVoice = {
    async inviteFor(roomId, riders) {
      if (!ROOM_ID.test(roomId) || !Number.isSafeInteger(riders) || riders < 1) return undefined;
      return inTurn(roomId, async () => {
        const already = held.get(roomId);
        if (already !== undefined) return link(already);
        // The slot is taken before the first await: rooms' turns are per room,
        // so every room's ask reaches this line before any has made a channel.
        if (held.size + reserved >= maximumRooms) return undefined;
        reserved += 1;
        try {
          if (!(await usable())) return undefined;
          const made = await open(roomId, riders);
          if (made === undefined) return undefined;
          held.set(roomId, made);
          return link(made);
        } finally {
          reserved -= 1;
        }
      });
    },

    async rotate(roomId) {
      return inTurn(roomId, async () => {
        const old = held.get(roomId);
        if (old === undefined) return undefined;
        held.delete(roomId);
        reserved += 1;
        try {
          // A channel Discord would not delete is the sweep's to find.
          const oldDeleted = await deleteChannel(old.channelId, old.inviteCode);
          if (!(await usable())) return { oldDeleted, invite: undefined };
          const made = await open(roomId, old.riders);
          if (made === undefined) return { oldDeleted, invite: undefined };
          held.set(roomId, made);
          return { oldDeleted, invite: link(made) };
        } finally {
          reserved -= 1;
        }
      });
    },

    async close(roomId) {
      const deleted = inTurn(roomId, async () => {
        const voice = held.get(roomId);
        if (voice === undefined) return;
        // Forgotten first: a delete Discord refuses leaves a channel no room
        // holds, which the next sweep deletes.
        held.delete(roomId);
        if (offCode() !== undefined) return;
        await deleteChannel(voice.channelId, voice.inviteCode);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, closeWaitMs);
      });
      try {
        await Promise.race([deleted, waited]);
      } finally {
        clearTimeout(timer);
      }
    },

    start() {
      started ??= checkGuild();
      return started;
    },

    async sweep() {
      // A guild that could not be read for a reason that may pass (no answer,
      // a 5xx) is asked again, by this sweep, rather than left off until a restart.
      if (startRetryable) {
        startRetryable = false;
        started = checkGuild();
      }
      if (!(await usable())) return 0;
      const listed = await discord.request(
        'GET /guilds/:id/channels',
        'GET',
        `/guilds/${discord.guildId}/channels`,
      );
      if (listed.kind !== 'ok' || !Array.isArray(listed.body)) {
        failed('list', listed.kind === 'ok' ? { kind: 'failed', error: 'unknown' } : listed);
        return 0;
      }
      let deleted = 0;
      for (const each of listed.body as unknown[]) {
        const channel = each as { id?: unknown; name?: unknown; type?: unknown } | null;
        const id = channel?.id;
        const name = channel?.name;
        if (
          channel?.type !== GUILD_VOICE ||
          typeof id !== 'string' ||
          !SNOWFLAKE.test(id) ||
          typeof name !== 'string' ||
          !OUR_CHANNEL.test(name)
        ) {
          continue;
        }
        if (opening.has(name.slice(CHANNEL_PREFIX.length))) continue;
        if ([...held.values()].some((voice) => voice.channelId === id)) continue;
        // Its invites first, as `close` deletes them (0018 §5.3).
        const invites = await discord.request(
          'GET /channels/:id/invites',
          'GET',
          `/channels/${id}/invites`,
        );
        if (invites.kind === 'ok' && Array.isArray(invites.body)) {
          for (const invite of invites.body as unknown[]) {
            const code = (invite as { code?: unknown } | null)?.code;
            if (typeof code === 'string' && INVITE_CODE.test(code)) {
              await discord.request('DELETE /invites/:code', 'DELETE', `/invites/${code}`);
            }
          }
        }
        if (await deleteChannel(id)) deleted += 1;
        if (offCode() !== undefined) break;
      }
      if (deleted > 0) logEvent(log, 'voice-swept', { deleted });
      return deleted;
    },

    rooms: () => [...held.keys()],

    get offCode() {
      return offCode();
    },
  };
  return roomVoice;
}
