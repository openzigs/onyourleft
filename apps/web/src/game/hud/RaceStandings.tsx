// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A race's standings on the HUD** — #1347,
 * [ADR 0051](../../../../../docs/adr/0051-live-race-standings.md): the
 * riders around this one, in the room's order, each with the room's time gap
 * to them and their live W/kg, and this rider's own line marked.
 *
 * ⚠️ **Not a live region, on purpose** — #1347's "a screen reader gets the
 * standings on request, not announced every second". The list changes every
 * second; spoken, it would drown every other sentence the HUD's one region
 * (`announce.ts`) has to say, and nothing here feeds that region. It is a
 * labelled section in the document, so a screen-reader user reaches it when
 * they ask — by its landmark, or by moving to it — and reads it as it is now.
 *
 * ⚠️ **Shown on a tablet and visually hidden on a phone** (`theme.css`
 * §"A RACE'S STANDINGS"): the corners of a phone's stage are taken, and
 * `browser/ride.browser.spec.ts` §"#1347" measures it clear of the rider and
 * of every panel at the three tablet viewports. On a phone it stays in the
 * document for a screen reader, and the rider has *Follow* and its one gap.
 */

import type { JSX } from 'react';

import { STANDINGS_TEXT, type RaceStandingsView } from '../room-ride';

export function RaceStandings(props: { readonly standings: RaceStandingsView }): JSX.Element {
  const { lines, place, of } = props.standings;
  return (
    <section className="oyl-hud__panel oyl-hud__standings" aria-label="Race standings">
      <p className="oyl-hud__standings-summary">{STANDINGS_TEXT.summary(place, of)}</p>
      {/*
        `role="list"` because list-style none makes WebKit drop the semantics,
        and `start` because the list is windowed: its own numbering must agree
        with the place drawn beside the first line.
      */}
      <ol className="oyl-hud__standings-list" role="list" start={lines[0]?.place}>
        {lines.map((line) => (
          <li
            key={line.riderId}
            className={
              line.you
                ? 'oyl-hud__standings-line oyl-hud__standings-line--you'
                : 'oyl-hud__standings-line'
            }
            aria-current={line.you ? 'true' : undefined}
          >
            {/*
              The spaces between the parts are the words' own: a screen
              reader reads a line as one run of text, and "1Ann−8 s" is not
              a line anybody could follow. The grid drops them visually.
            */}
            <span className="oyl-hud__standings-place">{line.place}</span>{' '}
            <span className="oyl-hud__standings-who">{line.who}</span>{' '}
            <span className="oyl-hud__standings-gap">{line.gap}</span>{' '}
            <span className="oyl-hud__standings-figure">
              {line.figure}
              {line.flagged ? (
                <span className="oyl-hud__standings-flag"> {STANDINGS_TEXT.flagged}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
