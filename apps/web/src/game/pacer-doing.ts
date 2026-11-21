// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the AI pacer is doing, in words on the ride screen** — the owner's
 * ruling of 2026-11-20 on #2864: *"Show the pacer's power on the ride screen:
 * its current watts and what it is doing (e.g. "Pacer 185 W · waiting for
 * you", "Pacer 215 W · chasing")"*.
 *
 * A closed list, decided by `model-pacer.ts` §`pacerDoing` from the device's
 * decision in force and the surge the pacer rides, and drawn by
 * `hud/fields.ts` §`pacerPowerReading` under the pacer's watts. Its own module
 * so that the HUD reads the words without reaching the director.
 */

/** What the pacer is doing. @see PACER_DOING_TEXT */
export type PacerDoing =
  'starting' | 'waiting' | 'chasing' | 'with-you' | 'surging' | 'recovering' | 'saving' | 'pushing';

/**
 * The words under the pacer's watts. ⚠️ Draft wording for the owner, after
 * the two examples of the ruling; each short enough for the HUD's narrowest
 * track at the owner's 1280×800 (`ride-notices.browser.spec.ts` §"#2864").
 * With no decision in force the pacer rides #92's own rule: {@link PACER_OWN_PACE_TEXT}.
 */
export const PACER_DOING_TEXT: Readonly<Record<PacerDoing, string>> = {
  starting: 'starting with you',
  waiting: 'waiting for you',
  chasing: 'chasing',
  'with-you': 'riding with you',
  surging: 'surging',
  recovering: 'recovering',
  saving: 'saving for the climb',
  pushing: 'pushing on',
};

/** The words with no decision in force: the pacer rides #92's own rule. */
export const PACER_OWN_PACE_TEXT = 'at its own pace';
