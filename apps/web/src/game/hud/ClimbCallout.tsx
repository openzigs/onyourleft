// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The climb callout — #2593, the owner from the tablet: *"inform on screen
 * when a climb is approaching with feet or meters until climb … and once in a
 * climb show distance to end of climb."*
 *
 * As a climb comes within `look-ahead.ts` §`CLIMB_CALLOUT_LEAD_METRES` it
 * says how far to its start, its average grade and its length; on the climb
 * it counts down to the top, and at the top it is gone. The climb is
 * `look-ahead.ts` §`calloutClimb`, which is `climbAhead` over `slopeAhead`:
 * the strip's caption and the announcer read the same two, so the three never
 * disagree about what a climb is or how steep it is. Display only: nothing
 * here reaches the trainer.
 *
 * ## Where it stands
 *
 * In the HUD's notice cell (`HudCore.tsx`), the cell the layout already holds
 * clear of the leaning rider and of every panel at every viewport
 * (`theme.css` §"CORNERS", §"WHERE THERE IS NO FREE CELL"), and only when the
 * cell is otherwise EMPTY: it gives way to every notice, the lap's (#1312)
 * included, because a climb is nothing to act on and the strip's caption still
 * names it. ⚠️ On a phone the cell is the route panel's, so while the callout
 * stands there the route panel is not drawn, as for every notice (#437).
 * ⚠️ **Not on a Delivery round**, either way it is drawn: on its game strip
 * (#2514) the roadsides are kept clear for the throws (#2513's lesson), and
 * drawn as *Everything* on the 4:3 tablet the round's taller readings leave
 * the notice row 36 px, so the callout ran into the map credit at its foot
 * (`ride-delivery.browser.spec.ts` §"drawn as Everything", measured).
 *
 * ## What it says to a screen reader
 *
 * The phrase is plain text, read where it stands. ⚠️ **Its announcement is a
 * sentence of its own, live only while the HUD's one region does NOT say
 * climbs** ({@link ClimbCalloutProps.live}, `announce-preference.ts`
 * §`climbsSpoken`) — #1312's lap notice's rule: with the region saying the
 * climb, a second live sentence would say it twice. ⚠️ **And the sentence is
 * held for the phase**, set when the callout appears and again when the rider
 * reaches the climb, and never as the countdown moves: a live region whose
 * text changed every ten metres is the continuous speech #395 exists to
 * prevent.
 */

import { useState, type JSX } from 'react';

import type { UnitSystem } from '@onyourleft/store';

import { climbCalloutSentence, climbCalloutText, type ClimbAhead } from './look-ahead';

export interface ClimbCalloutProps {
  /** The climb, as `look-ahead.ts` §`calloutClimb` found it. */
  readonly climb: ClimbAhead;
  readonly units: UnitSystem;
  /**
   * Whether its sentence is a live region: `true` only where nothing else
   * says the climb — `GameView` hands in `!climbsSpoken(...)`.
   */
  readonly live: boolean;
}

/** One phase of a callout: a climb ahead, or the rider on it. */
function phaseOf(climb: ClimbAhead): string {
  return `${climb.where}:${String(climb.slope.start)}`;
}

/** The callout. @see the module note */
export function ClimbCallout(props: ClimbCalloutProps): JSX.Element {
  const phase = phaseOf(props.climb);
  // The sentence as the phase began — React's "state from the previous
  // render" pattern, so a new phase sets it once and the countdown never does.
  const [held, setHeld] = useState(() => ({
    phase,
    sentence: climbCalloutSentence(props.climb, props.units),
  }));
  let sentence = held.sentence;
  if (held.phase !== phase) {
    sentence = climbCalloutSentence(props.climb, props.units);
    setHeld({ phase, sentence });
  }
  return (
    <div
      className="oyl-hud__panel oyl-hud__climb-callout"
      data-testid="oyl-hud-climb-callout"
      data-climb={props.climb.where}
    >
      <p className="oyl-hud__climb-callout-text">{climbCalloutText(props.climb, props.units)}</p>
      {props.live ? (
        <p className="oyl-visually-hidden" role="status" data-oyl-climb-callout-sentence="">
          {sentence}
        </p>
      ) : null}
    </div>
  );
}
