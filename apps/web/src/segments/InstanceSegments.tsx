// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The segments other riders published on the rider's instance** (#68), on
 * the Segments screen: each one the rider adds is stored on this device as
 * their own segment, under the instance's identifier, so "Match my rides"
 * finds their efforts on it and the segment's screen shows its board.
 *
 * Read when the section opens — one sealed request, the list's names and
 * distances, never a path. A segment's path is fetched only when the rider
 * presses *Add*, and checked against the identifier it is filed under
 * (`instance/leaderboard-port.ts` §`addSegment`).
 */

import { useCallback, useEffect, useState, type JSX } from 'react';

import type { UnitSystem } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ScrollTable } from '../design/ScrollTable';
import { StatusMessage } from '../design/StatusMessage';
import type { InstanceSegment, LeaderboardPort } from '../instance/leaderboard-port';
import { useUnits } from '../units/context';
import { formatSmallDistance, measurementText } from '../units/format';

/** What adding a segment does, said before the press. */
export const ADD_SENTENCE =
  'Adding a segment keeps a copy of it on this device, so “Match my rides” finds your efforts on it. Nothing of your rides is sent by adding one.';

export interface InstanceSegmentsProps {
  readonly port: LeaderboardPort;
  /** The segments already on this device, by id. */
  readonly held: ReadonlySet<string>;
  /** Told after a segment was added, so the screen reads its own list again. */
  readonly onAdded: () => void;
}

function distanceText(metres: number, units: UnitSystem): string {
  return measurementText(formatSmallDistance(metres, units));
}

export function InstanceSegments({ port, held, onAdded }: InstanceSegmentsProps): JSX.Element {
  const instance = port.instanceName() ?? 'your instance';
  const [segments, setSegments] = useState<readonly InstanceSegment[] | 'unavailable' | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState<{ tone: 'success' | 'warning'; text: string } | undefined>(
    undefined,
  );
  const units = useUnits();

  useEffect(() => {
    let cancelled = false;
    void port.listSegments().then((found) => {
      if (!cancelled) setSegments(found ?? 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [port]);

  const add = useCallback(
    async (segment: InstanceSegment): Promise<void> => {
      setBusy(segment.segmentId);
      try {
        const outcome = await port.addSegment(segment.segmentId);
        if (outcome === 'unavailable') {
          setSaid({
            tone: 'warning',
            text: `“${segment.name}” could not be fetched from ${instance}, so nothing was added.`,
          });
          return;
        }
        setSaid({
          tone: 'success',
          text:
            outcome === 'added'
              ? `Added “${segment.name}”. Match your rides to find your efforts on it.`
              : `“${segment.name}” is already on this device.`,
        });
        onAdded();
      } finally {
        setBusy(undefined);
      }
    },
    [port, instance, onAdded],
  );

  return (
    <section aria-labelledby="segments-instance">
      <h2 id="segments-instance">Segments on {instance}</h2>
      <p className="oyl-muted">
        Segments riders published on {instance}: this instance only, not every instance.
      </p>
      <p className="oyl-muted">{ADD_SENTENCE}</p>
      {segments === undefined ? (
        <p className="oyl-muted">Asking {instance}…</p>
      ) : segments === 'unavailable' ? (
        <StatusMessage tone="warning">{instance} could not send its segments.</StatusMessage>
      ) : segments.length === 0 ? (
        <p>Nobody has published a segment on {instance} yet.</p>
      ) : (
        <ScrollTable className="oyl-data-table" caption={`Segments on ${instance}, newest first`}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Distance</th>
              <th scope="col">On this device</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.segmentId}>
                <td>{segment.yours ? `${segment.name} (yours)` : segment.name}</td>
                <td>{distanceText(segment.distanceMetres, units)}</td>
                <td>
                  {segment.yours || held.has(segment.segmentId) ? (
                    'Yes'
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy !== undefined}
                      onClick={() => void add(segment)}
                    >
                      {busy === segment.segmentId ? 'Adding…' : `Add “${segment.name}”`}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {said === undefined ? null : (
        <StatusMessage tone={said.tone} live>
          {said.text}
        </StatusMessage>
      )}
    </section>
  );
}
