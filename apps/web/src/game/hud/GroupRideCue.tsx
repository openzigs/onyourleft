// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The group ride's cue line on the HUD — #3305 (ADR 0101 D-5): one labelled
 * notice with the cue's sentence, among the HUD's other notices
 * (`HudPanelProps.notices`). `GameView` hands {@link groupCueNotice} the
 * sentence `group-ride-hud.ts` §`groupRideCueShowing` answers, so it is on
 * the HUD for the cue's shown time and then gone.
 *
 * Drawn as the AI pacer's line is, under its class (`theme.css`
 * §`.oyl-hud__pacer-say`, #2760: larger than the other notices, because "it
 * can be hard to see" while riding): the two never meet, since a ride with a
 * group has no pacer (ADR 0101 D-1.5).
 *
 * ⚠️ **Not `live`.** The HUD has one live region and `announce.ts` decides
 * what it says (rank 5d′); a second region here would say every cue twice.
 */

import type { JSX } from 'react';

import { StatusMessage } from '../../design/StatusMessage';

import { GROUP_RIDE_CUE_LABEL } from './group-ride-hud';

/** The class the cue line is drawn under: the pacer's line's. @see the module note */
export const GROUP_RIDE_CUE_CLASS = 'oyl-hud__pacer-say';

/** The cue line for `sentence`, or `undefined` while no cue is showing. */
export function groupCueNotice(sentence: string | undefined): JSX.Element | undefined {
  return sentence === undefined ? undefined : (
    <StatusMessage
      key="group-ride-cue"
      tone="info"
      label={GROUP_RIDE_CUE_LABEL}
      className={GROUP_RIDE_CUE_CLASS}
    >
      {sentence}
    </StatusMessage>
  );
}
