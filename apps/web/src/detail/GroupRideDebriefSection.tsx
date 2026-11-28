// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The ride page's group ride debrief** — #3310, ADR 0101 D-5.8: pulls
 * taken, time on the front, in the draft and with the group, gaps opened and
 * closed, and the target average beside the average ridden.
 *
 * Counts and durations only (`group-ride-debrief.ts` says what each counts):
 * no judgement of the rider's body, no medical wording (ADR 0030), no
 * load-metric name, no place and no coordinate (ADR 0004 D), no praise and no
 * urging. Every word it can draw is in {@link GROUP_RIDE_DEBRIEF_WORDS}, and
 * `GroupRideDebriefSection.test.tsx` screens them. The figures are a count,
 * a duration or a speed in the rider's display units (ADR 0020): it is handed
 * no name, no route and no position, so it has none to draw.
 *
 * A ride with no group ride renders nothing here: no heading, no empty list.
 * The ride keeps its "Draft" row above (ADR 0066 D-5).
 *
 * A definition list in the page's own `.oyl-ride-summary` grid, as the
 * ride's figures are: it reflows at large text with no sideways scroll.
 */

import type { JSX } from 'react';

import type { ActivityRecord, GroupRideFact, UnitSystem } from '@onyourleft/store';

import { Reading } from '../design/Reading';
import { formatDuration } from '../format';
import { formatSpeed } from '../units/format';

import { groupRideDebrief } from './group-ride-debrief';

/** Every word the section draws, beside its figures. */
export const GROUP_RIDE_DEBRIEF_WORDS = {
  heading: 'Group ride',
  pulls: 'Pulls taken',
  averagePull: 'Average pull',
  front: 'Time on the front',
  draft: 'Time in the draft',
  withGroup: 'Time with the group',
  gapsOpened: 'Gaps opened',
  gapsClosed: 'Gaps closed',
  target: 'Target average',
  ridden: 'Average ridden',
  riddenNote: 'Time the group waited is not made up.',
  logCut: 'The ride changed more often than its log keeps, so these count its first part.',
} as const;

const WORDS = GROUP_RIDE_DEBRIEF_WORDS;

export interface GroupRideDebriefSectionProps {
  /** The ride's saved group ride, or `undefined` for a ride in none. */
  readonly groupRide: GroupRideFact | undefined;
  /** The ride's own totals, for the average ridden. */
  readonly ride: Pick<ActivityRecord, 'distance' | 'movingTime' | 'elapsedTime'>;
  readonly units: UnitSystem;
}

export function GroupRideDebriefSection({
  groupRide,
  ride,
  units,
}: GroupRideDebriefSectionProps): JSX.Element | null {
  if (groupRide === undefined) return null;
  const debrief = groupRideDebrief(groupRide, ride);
  const target = formatSpeed(debrief.targetSpeed, units);
  const ridden =
    debrief.riddenSpeed === undefined ? undefined : formatSpeed(debrief.riddenSpeed, units);
  return (
    <div className="oyl-group-debrief" data-oyl-group-debrief="">
      <h3>{WORDS.heading}</h3>
      {debrief.logCut ? <p className="oyl-muted">{WORDS.logCut}</p> : null}
      <dl className="oyl-ride-summary">
        <div>
          <dt>{WORDS.pulls}</dt>
          <dd>
            <Reading value={String(debrief.pulls)} />
          </dd>
        </div>
        {debrief.averagePullSeconds === undefined ? null : (
          <div>
            <dt>{WORDS.averagePull}</dt>
            <dd>
              <Reading value={formatDuration(debrief.averagePullSeconds)} />
            </dd>
          </div>
        )}
        <div>
          <dt>{WORDS.front}</dt>
          <dd>
            <Reading value={formatDuration(debrief.frontSeconds)} />
          </dd>
        </div>
        <div>
          <dt>{WORDS.draft}</dt>
          <dd>
            <Reading value={formatDuration(debrief.draftSeconds)} />
          </dd>
        </div>
        <div>
          <dt>{WORDS.withGroup}</dt>
          <dd>
            <Reading value={formatDuration(debrief.withGroupSeconds)} />
          </dd>
        </div>
        <div>
          <dt>{WORDS.gapsOpened}</dt>
          <dd>
            <Reading value={String(debrief.gapsOpened)} />
          </dd>
        </div>
        <div>
          <dt>{WORDS.gapsClosed}</dt>
          <dd>
            <Reading value={String(debrief.gapsClosed)} />
          </dd>
        </div>
        <div>
          <dt>{WORDS.target}</dt>
          <dd>
            <Reading value={target.value} unit={target.unit} />
          </dd>
        </div>
        {ridden === undefined ? null : (
          <div>
            <dt>{WORDS.ridden}</dt>
            <dd>
              <Reading value={ridden.value} unit={ridden.unit} />{' '}
              <span className="oyl-ride-summary__note oyl-muted">{WORDS.riddenNote}</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
