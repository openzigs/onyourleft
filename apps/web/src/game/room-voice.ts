// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Join voice on Discord** — #875, spike 0017 option A (the owner's choice on
 * #794): a room's Discord voice link on the HUD, where the rider's instance
 * offers voice.
 *
 * ## Only after admission
 *
 * The link arrives in the room's `welcome` (`@onyourleft/protocol`
 * §`Welcome.voiceInvite`), which a room sends to a rider it admits and to
 * nobody else, and it is read from the session's `joined` status
 * (`net/room-session.ts`). A refused, lost-for-good or left room shows none,
 * and a room with no voice — an instance with no bot, a public room, a room an
 * operator opened — shows nothing at all: the ride is exactly as it was.
 *
 * ## When, and where, the HUD shows it
 *
 * - **A race holding the rider on its line** (`room-ride.ts`
 *   §`heldOnTheLine`), which is when its riders gather: as the last line of
 *   the race's own notice, under *Start the race* (`place: 'race'`), for as
 *   long as the race waits — and **on a tablet only** (`theme.css` §"A RACE'S
 *   VOICE LINK, ON ITS LINE"): on a phone there is no line to spare beside a
 *   race's notice, and a notice of its own put the cell 10 px into the
 *   leaning rider at 360×752 (measured in the browser gate, #875).
 * - **A group ride**: a notice of its own (`place: 'notice'`) for a standing
 *   notice's span of ride from when the link first came —
 *   `GameView` §`STANDING_NOTICE_SECONDS`, the world notice's rule (#475) —
 *   because on a phone a notice costs the route panel's cell (#437). A new
 *   link (the room's channel replaced, #876) starts its own span.
 * - **A race that has started, or is over**: not at all. A racer is not
 *   offered a link to another app mid-race.
 *
 * ## What it says
 *
 * The link's own words, *Join voice on Discord*, and after them that it
 * opens Discord — one line on the narrowest phone, so a race's notice grows
 * by a line at most. It opens with `target="_blank"`, which inside the
 * Android shell hands it to the system (`views/AboutView.tsx`). What
 * Discord receives is said where the app names Discord as a third party
 * (`views/InstanceView.tsx`, #778). ⚠️ Draft wording awaiting the owner's
 * approval, with screenshots, before merge.
 */

import type { RoomRace, RoomSessionStatus } from '../net/room-session';
import { heldOnTheLine } from './room-ride';

/** The label the HUD gives the voice notice. */
export const VOICE_NOTICE_LABEL = 'Voice';

/** Every rider-facing word of the link. ⚠️ Draft wording for the owner's approval. */
export const VOICE_TEXT = {
  /** The link's own words. */
  link: 'Join voice on Discord',
  /** What follows it: one line on the narrowest phone, so a race's notice grows by one line at most. */
  after: ' (opens Discord)',
} as const;

/** Where the HUD shows the link: inside a race's notice, or as a notice of its own. */
type VoicePlace = 'race' | 'notice';

/** The room's voice link, and the ride's elapsed seconds when it first came. */
export interface VoiceNotice {
  readonly invite: string;
  readonly from: number;
}

/**
 * The voice notice to keep once the room's status is `status`, at `elapsed`
 * seconds of ride: a new link starts its span now, the same link keeps its
 * span, a welcome with none takes it away, and a room that is refused, gone
 * or left has none. A room that is connecting or lost keeps what it had: its
 * next welcome says again.
 */
export function voiceNoticeAfter(
  kept: VoiceNotice | undefined,
  status: RoomSessionStatus | undefined,
  elapsed: number,
): VoiceNotice | undefined {
  switch (status?.kind) {
    case 'joined': {
      const invite = status.voiceInvite;
      if (invite === undefined) return undefined;
      return kept?.invite === invite ? kept : { invite, from: elapsed };
    }
    case 'connecting':
    case 'lost':
      return kept;
    default:
      return undefined;
  }
}

/**
 * The link the HUD shows now and where, or `undefined`: in a race's notice
 * while the race holds the rider on its line; as a notice of its own in a
 * group ride, for `standingSeconds` of ride from when it came; and never in a
 * race that has started or is over.
 */
export function voiceLinkShown(
  notice: VoiceNotice | undefined,
  race: RoomRace | undefined,
  elapsed: number,
  standingSeconds: number,
): { readonly invite: string; readonly place: VoicePlace } | undefined {
  if (notice === undefined) return undefined;
  if (heldOnTheLine(race)) return { invite: notice.invite, place: 'race' };
  if (race !== undefined && race.kind !== 'not-a-race') return undefined;
  return elapsed - notice.from < standingSeconds
    ? { invite: notice.invite, place: 'notice' }
    : undefined;
}
