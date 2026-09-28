// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The controls a rider presses DURING a ride, by name — #669.
 *
 * The owner's ruling of 2026-09-27: ride-time controls — *Start*, *Pause*,
 * *End* and *Set target* — get a **48 px** touch target, and everything else
 * stays at `.oyl-button`'s 44 (#316, WCAG 2.2 SC 2.5.5, AAA — not SC 2.5.8,
 * which is the AA criterion and is 24). 48 × 48 is Android's own
 * accessibility guidance, and in a WebView one CSS px is one dp.
 *
 * ⚠️ **This list is the ruling, written down where a test can walk it.** Each
 * entry is a control a rider can put on the screen, named the way a rider
 * reads it (its accessible name), on the surface that renders it.
 * `browser/ride-targets.browser.spec.ts` renders every surface, finds every
 * entry, and fails when one is not found — so a control added here that no
 * scene renders is a red build rather than a silent pass — and measures each
 * the three ways #316 measures a button. `ride-time-controls.test.tsx` checks
 * the same list against the components in jsdom, which is the fast half.
 *
 * What is deliberately NOT on it:
 *
 * - **A workout's own pause.** There is none: the ride's *Pause* pauses the
 *   workout with it (`WorkoutPanel.tsx` §`STATUS_TEXT` member `paused`), and
 *   that *Pause* is on this list.
 * - ***End ERG***, beside *Set target*. It is measured as the ORDINARY button
 *   the ruling leaves at 44, in the same form, which is what shows the size
 *   did not leak through a container.
 * - ***Start a new ride*** after a stopped ride, the recovery offer's three
 *   controls, and the HUD's *Trainer notice* and *Stop side camera*. None is
 *   pressed at the bars mid-ride, and the ruling names four actions, not a
 *   screen.
 *
 * Test-facing: nothing in production reads this module. Every control on it
 * is sized at its own call site — `Button`'s `size="ride"`, or
 * `design/Button.tsx` §`RIDE_SIZE_CLASS` on the HUD's own buttons — and the
 * list is what holds those call sites to the ruling.
 */

/** Where a ride-time control is rendered. */
export type RideTimeSurface = 'ride-screen' | 'trainer-panel' | 'workout-panel' | 'game-hud';

export interface RideTimeControl {
  readonly surface: RideTimeSurface;
  /**
   * The accessible name, whitespace collapsed. For the workout's start this is
   * a PREFIX, because the control is named after the workout.
   */
  readonly name: string;
  readonly match: 'exact' | 'prefix';
}

/** The smallest a ride-time control may be, in CSS px, in both axes. */
export const RIDE_TIME_TARGET_PIXELS = 48;

/** How far apart two ride-time controls must be, box to box — Android's 8 dp. */
export const RIDE_TIME_SPACING_PIXELS = 8;

export const RIDE_TIME_CONTROLS: readonly RideTimeControl[] = [
  // `views/RideView.tsx` §`RideControls`.
  { surface: 'ride-screen', name: 'Start recording', match: 'exact' },
  { surface: 'ride-screen', name: 'Pause', match: 'exact' },
  { surface: 'ride-screen', name: 'Resume', match: 'exact' },
  { surface: 'ride-screen', name: 'Stop', match: 'exact' },
  { surface: 'ride-screen', name: 'Yes, stop the ride', match: 'exact' },
  { surface: 'ride-screen', name: 'Keep riding', match: 'exact' },
  // `ride/TrainerPanel.tsx`: the take-control step is pressed at the bars.
  { surface: 'trainer-panel', name: 'Ask the trainer for control', match: 'exact' },
  { surface: 'trainer-panel', name: 'Set target', match: 'exact' },
  // `ride/WorkoutPanel.tsx`.
  { surface: 'workout-panel', name: 'Ride ', match: 'prefix' },
  { surface: 'workout-panel', name: 'End workout', match: 'exact' },
  // `game/hud/HudPanel.tsx` and `game/SoundControls.tsx`.
  { surface: 'game-hud', name: 'Pause', match: 'exact' },
  { surface: 'game-hud', name: 'End ride', match: 'exact' },
  { surface: 'game-hud', name: 'Mute sounds', match: 'exact' },
];

/** Whether a control's accessible name is the one an entry names. */
export function namesControl(entry: RideTimeControl, name: string): boolean {
  return entry.match === 'exact' ? name === entry.name : name.startsWith(entry.name);
}
