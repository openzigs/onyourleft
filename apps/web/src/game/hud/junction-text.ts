// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What an open-world ride's junction prompt says — #2898, under ADR 0088
 * D-1.2, D-1.5 and D-3's keyboard and screen-reader row.
 *
 * The words the prompt draws on each way (`JunctionChoicePrompt.tsx`), and the
 * sentences the HUD's one live region says: once when a junction's prompt
 * appears, naming its ways and the default; once each time the choice changes;
 * and once when the choice locks (D-3). A junction whose lock is already
 * behind the rider when it becomes the next one (D-1.5) says so instead of the
 * first.
 *
 * ## Owed until said, one sentence at a time
 *
 * `announce.ts` drops a lower event behind a higher one in the same window,
 * so a caller that offered each sentence once could lose the lock to a fault
 * beside it. On #647's "owed" rule (`delivery-announce.ts`), the caller offers
 * {@link junctionEvent} on every frame and hands back what the core said
 * through {@link junctionSpoken}, and a sentence is owed until it is said. At
 * most ONE is owed: a newer sentence about the same junction replaces an older
 * one (the lock says the way taken, so a choice still owed is not lost to it),
 * and a junction passed owes nothing, because a sentence about a junction
 * behind the rider is noise.
 *
 * ## No position in words; a street by its mapped name
 *
 * A way is named by how it turns from the rider's heading, and since #3052
 * (ADR 0096) by the street's mapped name beside it where the map gives one —
 * "Right onto Third Avenue" — never by a node, a coordinate or a position
 * (ADR 0004 D). A way with no name is named by its turn alone: nothing here
 * invents one. The name is shown and said, and never logged.
 *
 * ## The words are new, for the owner's approval
 *
 * Every word and sentence below is new rider-facing wording, listed in
 * #2898's pull request.
 */

import type { RollingWay } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatSmallDistance } from '../../units/format';
import type { JunctionPrompt } from '../open-world/junction-choice';
import type { AnnouncementEvent, AnnouncementKind } from './announce';

/** The prompt's title, and the name of its group. */
export const JUNCTION_PROMPT_TITLE = 'Junction ahead';

/** What a way that is the default, and the way chosen, say beside their names. */
export const JUNCTION_DEFAULT_WORD = 'Default';
export const JUNCTION_CHOSEN_WORD = 'Chosen';

/** The U-turn button's name (ADR 0088 D-1.6, D-3). */
export const U_TURN_NAME = 'U-turn';

/** The line the prompt shows once the choice is final (D-1.5). */
export const JUNCTION_LOCKED_LINE = 'Choice locked';

/**
 * What the prompt says while the HUD's touch lock is on (D-3.1.3): the ways
 * still show the choice and take no tap, and a key, a pad or a remote still
 * chooses.
 */
export const JUNCTION_BY_KEY_SENTENCE = 'Screen locked: choose with a key, a pad or a remote.';

/**
 * A way's name, by its turn from the rider's heading, in degrees with
 * negative left (`RollingWay.turnDegrees`): within 15° either side is
 * straight on, to 60° a bear, to 135° a turn, and past that a sharp turn.
 * *#2898's choice*, for the owner.
 */
export function wayWord(turnDegrees: number): string {
  const size = Math.abs(turnDegrees);
  if (size <= 15) return 'Straight on';
  const side = turnDegrees < 0 ? 'left' : 'right';
  if (size <= 60) return `Bear ${side}`;
  if (size <= 135) return side === 'left' ? 'Left' : 'Right';
  return `Sharp ${side}`;
}

/**
 * The street a way is, as mapped (#3052, ADR 0096), or `undefined` where the
 * map names none.
 */
export function wayStreet(way: Pick<RollingWay, 'edge'>): string | undefined {
  const name = way.edge.name;
  return name === undefined || name.length === 0 ? undefined : name;
}

/**
 * The words under a way's turn that name its street — "onto Third Avenue",
 * or "along Main Street" for the way straight on — or `undefined` with no
 * name (#3052).
 */
export function wayStreetLine(way: Pick<RollingWay, 'edge' | 'turnDegrees'>): string | undefined {
  const street = wayStreet(way);
  if (street === undefined) return undefined;
  return `${Math.abs(way.turnDegrees) <= 15 ? 'along' : 'onto'} ${street}`;
}

/** A way in a sentence: its turn, and its street where it has one — "right onto Third Avenue". */
export function wayPhrase(way: Pick<RollingWay, 'edge' | 'turnDegrees'>): string {
  const line = wayStreetLine(way);
  const word = wayWord(way.turnDegrees).toLowerCase();
  return line === undefined ? word : `${word} ${line}`;
}

/** The line the prompt shows until the choice is final: how far until it is, in tens of the rider's unit. */
export function lockLine(toLock: number, units: UnitSystem): string {
  const measured = formatSmallDistance(toLock, units);
  const tens = Math.max(10, Math.round(Number(measured.value) / 10) * 10);
  return `Choice locks in ${String(tens)} ${measured.unit}`;
}

function wordOf(shown: JunctionPrompt, id: string): string {
  const way = shown.ways.find((each) => each.edge.id === id);
  return way === undefined ? wayWord(0).toLowerCase() : wayPhrase(way);
}

/** "a, b or c". */
function listed(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1] as string}`;
}

/** The sentence said as a junction's prompt appears: its ways, and the default. */
function aheadSentence(shown: JunctionPrompt): string {
  const ways = listed(shown.ways.map(wayPhrase));
  return `${JUNCTION_PROMPT_TITLE}: ${ways}. The default is ${wordOf(shown, shown.defaultWay)}.`;
}

/** The sentence said when the prompt appears with its choice already final (D-1.5). */
function tooCloseSentence(shown: JunctionPrompt): string {
  return `${JUNCTION_PROMPT_TITLE}, too close to choose: ${wordOf(shown, shown.chosen)}.`;
}

/** The sentence said when the choice changes. */
function chosenSentence(shown: JunctionPrompt): string {
  const word = wordOf(shown, shown.chosen);
  return shown.chosen === shown.defaultWay ? `Chosen: ${word}, the default.` : `Chosen: ${word}.`;
}

/** The sentence said when the choice becomes final (D-1.5). */
function lockedSentence(shown: JunctionPrompt): string {
  return `Junction choice locked: ${wordOf(shown, shown.chosen)}.`;
}

/** What the caller threads back in. Returned, never kept here. */
export interface JunctionAnnounced {
  /** The ride distance of the junction last prompted, or `undefined` with none. */
  readonly junction: number | undefined;
  /** The way chosen there when last seen. */
  readonly chosen: string | undefined;
  /** Whether it was locked when last seen. */
  readonly locked: boolean;
  /** The one sentence owed, until the announcer says it. */
  readonly owed: string | undefined;
}

/** Nothing said yet: `GameView` starts each open-world ride from it (#3013). */
export const NO_JUNCTION_ANNOUNCED: JunctionAnnounced = Object.freeze({
  junction: undefined,
  chosen: undefined,
  locked: false,
  owed: undefined,
});

/**
 * This frame's junction event, if one is owed, from the prompt as the rider
 * stands now (`JunctionChoice.prompt`).
 *
 * `GameView` offers it to `announce.ts` every frame of an open-world ride,
 * beside the ride's other events (#3013). `JunctionChoicePrompt.a11y.test.tsx`
 * drives it into the HUD's region as `GameView` does.
 */
export function junctionEvent(
  announced: JunctionAnnounced,
  shown: JunctionPrompt | undefined,
): { readonly event: AnnouncementEvent | undefined; readonly announced: JunctionAnnounced } {
  if (shown === undefined) return { event: undefined, announced: NO_JUNCTION_ANNOUNCED };
  let owed = announced.owed;
  if (shown.distance !== announced.junction) {
    owed = shown.locked ? tooCloseSentence(shown) : aheadSentence(shown);
  } else if (shown.locked && !announced.locked) {
    owed = lockedSentence(shown);
  } else if (shown.chosen !== announced.chosen) {
    owed = chosenSentence(shown);
  }
  const next: JunctionAnnounced = {
    junction: shown.distance,
    chosen: shown.chosen,
    locked: shown.locked,
    owed,
  };
  return {
    event: owed === undefined ? undefined : { kind: 'junction', text: owed },
    announced: next,
  };
}

/**
 * The state after the announcer said `kind` this frame: a junction sentence
 * said is owed no longer.
 *
 * `GameView` hands back each frame's `Announcement.kind` (#3013).
 */
export function junctionSpoken(
  announced: JunctionAnnounced,
  kind: AnnouncementKind | undefined,
): JunctionAnnounced {
  return kind === 'junction' ? { ...announced, owed: undefined } : announced;
}
