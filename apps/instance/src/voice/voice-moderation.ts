// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A removal or a ban acts on Discord voice too** — #876, spike 0017 §3.3
 * and §8.3 item 3, after the owner chose option A on #794.
 *
 * A private room's riders join its voice by a link alone (0018 Q1), so the
 * instance does not know which Discord member a rider is, and cannot
 * disconnect one of them. The remedy is to **rotate**: delete the channel,
 * which disconnects everybody in it, make a new one, and give its link to the
 * riders still in the room — never to the rider the action was about.
 *
 * | After | What is rotated |
 * |---|---|
 * | a host's or a moderator's removal from a room (#789) | that room's channel |
 * | a suspension, the account-level ban (#775, #789) | every room with voice the athlete is a member of |
 *
 * The removal or the suspension is the instance's own decision and is logged
 * first, as it always was; the rider's socket is closed before the channel is
 * touched. **Moderation stays authoritative on our side**: what Discord does
 * or fails to do changes nothing that was decided, and the voice step can
 * neither undo nor delay it. What it did is appended to the moderation log
 * beside the action it followed, as `rotate_voice` with the room, in one of
 * {@link voiceActionReason}'s fixed sentences — which say when Discord would
 * not delete the old channel, so a moderator knows the rider may still be in
 * it until the next voice sweep (`room-voice.ts`, within ten minutes).
 *
 * ⚠️ **What this cannot do — a rider who LINKED their Discord account** (take
 * their role away and disconnect them alone, 0017 §3.3's right-hand column)
 * waits for account linking itself, #877, which waits on Discord's written
 * answer to spike 0018's Q1. Until then no rider is linked, and rotation is
 * the whole of it.
 *
 * Nothing here throws: a step that fails is logged by its error's name, and
 * the decision it followed stands.
 */

import { logEvent, type LogSink } from '../log.ts';
import { errorName } from './discord.ts';
import type { Rotation, RoomVoice } from './room-voice.ts';
import type { VoiceLogEntry } from '../store/sql-store.ts';

/** A removal from one room, as the moderation log recorded it. */
export interface RoomRemoval {
  readonly roomId: string;
  /** The moderator, or the room's host. */
  readonly actorId: string;
  /** The rider removed. */
  readonly targetId: string;
  /** The removal's own log entry. */
  readonly logId: number;
}

/** A suspension, as the moderation log recorded it. */
export interface Suspension {
  readonly actorId: string;
  readonly targetId: string;
  readonly logId: number;
}

export interface VoiceModeration {
  /** Rotates the room's channel, tells its riders, and logs it. Never throws. */
  afterRemoval(removal: RoomRemoval): Promise<void>;
  /** The same for every room with voice the suspended athlete is a member of. Never throws. */
  afterSuspension(suspension: Suspension): Promise<void>;
}

export interface VoiceModerationOptions {
  readonly voice: RoomVoice;
  /**
   * Tells the riders connected to `roomId` that its link is now `invite`,
   * all but `withheldFrom` — `room/node/router.ts` §`setVoiceInvite`.
   */
  readonly tell: (roomId: string, invite: string | undefined, withheldFrom: string) => void;
  /** Whether `athleteId` is a member of `roomId` — the store's own read. */
  readonly isMember: (roomId: string, athleteId: string) => Promise<boolean>;
  /** Appends the voice action to the moderation log — `SqlStore.logVoiceAction`. */
  readonly record: (entry: VoiceLogEntry) => Promise<number>;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly log: LogSink;
}

/**
 * What the log says a rotation did, naming the entry it followed. Fixed
 * sentences and a number: never a link, a channel id, a name or a place.
 */
export function voiceActionReason(rotation: Rotation, logId: number): string {
  const after = `after log entry ${String(logId)}`;
  const replaced =
    rotation.invite === undefined
      ? 'No new channel could be made, so the room has no voice now.'
      : 'The riders still in the room were given a new link.';
  return rotation.oldDeleted
    ? `The room’s voice channel was deleted ${after}, disconnecting everybody in it. ${replaced}`
    : `Discord did not delete the room’s voice channel ${after}, so the rider may still be in it until the instance’s next voice sweep. ${replaced}`;
}

export function createVoiceModeration(options: VoiceModerationOptions): VoiceModeration {
  const { voice, log } = options;

  async function rotate(roomId: string, actorId: string, targetId: string, logId: number) {
    const rotation = await voice.rotate(roomId);
    // A room with no voice: nothing was done to Discord, and nothing is logged.
    if (rotation === undefined) return;
    options.tell(roomId, rotation.invite, targetId);
    try {
      await options.record({
        actorAthleteId: actorId,
        targetAthleteId: targetId,
        roomId,
        reason: voiceActionReason(rotation, logId),
        at: Math.floor(options.now() / 1000),
      });
    } catch (error) {
      logEvent(log, 'voice-failed', { code: 'log', error: errorName(error) });
    }
  }

  return {
    async afterRemoval(removal) {
      await rotate(removal.roomId, removal.actorId, removal.targetId, removal.logId);
    },

    async afterSuspension(suspension) {
      for (const roomId of voice.rooms()) {
        let member: boolean;
        try {
          member = await options.isMember(roomId, suspension.targetId);
        } catch (error) {
          logEvent(log, 'voice-failed', { code: 'member', error: errorName(error) });
          continue;
        }
        if (member) await rotate(roomId, suspension.actorId, suspension.targetId, suspension.logId);
      }
    },
  };
}
