// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told while the stall rescue holds a WORKOUT's target down —
 * #585.
 *
 * The workout path eased a stalled rider and said nothing: `player.ts` set a
 * reason and neither `workout/session.ts` nor `ride/WorkoutPanel.tsx` rendered
 * it, so a rider whose cadence sensor died mid-stall rode the rest of the
 * workout at the trainer's lowest target with nothing saying why. The manual
 * ERG form already explained the same state (#567, `ride/TrainerPanel.tsx`
 * §`rescueSentence`); this is the workout's counterpart.
 *
 * ⚠️ **The reason is the rescue's own fixed sentence**, from
 * `packages/domain/src/workout/erg-safety.ts` — the same words the manual ERG
 * panel shows, including `CADENCE_SILENT_REASON`. Nothing here writes a
 * second wording of why; it adds only what the rescue cannot know: that the
 * workout's own target comes back by itself, and how to leave it.
 *
 * ⚠️ **ONE builder for both screens**, with the way out as the one thing that
 * differs: *End workout* is a button on the Ride screen, and the game has no
 * such button — its HUD says where the button is instead. A sentence written
 * twice is two sentences that drift.
 */

import { TREND_WINDOW, type WorkoutRescue } from '@onyourleft/domain';

/**
 * What opens the sentence when it is SPOKEN, on either screen — so the one
 * announcer that said it can take a waiting one back once the rescue has
 * cleared (PR #599's review, N1). The label a rider SEES is `StatusMessage`'s.
 */
export const EASED_SPOKEN_PREFIX = 'Eased: ';

/** Whether a spoken event is a workout's eased sentence. @see EASED_SPOKEN_PREFIX */
export function isEasedAnnouncement(event: {
  readonly kind: string;
  readonly text: string;
}): boolean {
  return event.kind === 'workout-fault' && event.text.startsWith(EASED_SPOKEN_PREFIX);
}

/** Where the sentence is shown, which decides how it says to leave the workout. */
export type RescueTextPlace = 'ride-screen' | 'game';

/** The way out, by where the rider is reading it. */
const WAY_OUT: Readonly<Record<RescueTextPlace, string>> = {
  'ride-screen': 'Press End workout to leave it.',
  game: 'End the workout on the Ride screen to leave it.',
};

/**
 * The sentence for a workout's stall rescue.
 *
 * The window is read off {@link TREND_WINDOW} rather than typed, for
 * `TrainerPanel.tsx` §`rescueSentence`'s reason (PR #582's review).
 */
export function workoutRescueText(rescue: WorkoutRescue, place: RescueTextPlace): string {
  const steady = `your cadence has held steady for ${String(TREND_WINDOW)} seconds`;
  // From the floor the way back is two steps, as on the manual ERG panel:
  // a lighter target once the rider pedals, the workout's own once that holds.
  const lighterFirst =
    rescue.kind === 'floor'
      ? ' Once you are pedalling again it steps up to a lighter target first.'
      : '';
  return (
    `${rescue.reason}${lighterFirst} The workout’s own target comes back by itself once ` +
    `${steady}. ${WAY_OUT[place]}`
  );
}
