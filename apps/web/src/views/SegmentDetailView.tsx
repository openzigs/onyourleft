// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One segment's effort history, and the overlay comparing two of them (#67).
 *
 * ## The chart is not the feature; the table is
 *
 * #67's third criterion asks for *"a non-visual equivalent — a table or
 * accessible summary conveying the same comparison"*, and this screen is built
 * the way round that makes that true rather than bolted on: the comparison is
 * computed as **checkpoints**, the table renders them, and the chart draws the
 * same numbers. Delete the chart and the feature still works; delete the table
 * and a real fraction of riders lose it entirely (#48's sixth criterion).
 *
 * ## ⚠️ Nothing here is encoded in colour alone
 *
 * The personal best carries the word "Personal best", not a highlight; the two
 * compared efforts are named in the table's own column headers, not
 * distinguished by line colour. `AnalysisView.tsx` records the same rule for
 * the same reason.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { personalBest, RANKING_BASIS_LABEL, rankEfforts } from '@onyourleft/domain';
import { segmentId, type SegmentEffortRecord, type UnitSystem } from '@onyourleft/store';

import { StatusMessage } from '../design/StatusMessage';
import { formatDuration } from '../format';
import { loadHistory, loadOverlay, type EffortHistory, type OverlayResult } from '../efforts/load';
import type { EffortPort } from '../efforts/store-port';
import { hrefForActivity } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatSmallDistance, measurementText } from '../units/format';

/** A signed difference, as a rider reads it. */
function formatDelta(seconds: number): string {
  if (Math.abs(seconds) < 0.5) {
    return 'level';
  }
  const rounded = Math.round(Math.abs(seconds));
  return seconds > 0 ? `+${String(rounded)} s` : `−${String(rounded)} s`;
}

/**
 * A segment-scale distance — metres, or feet for a rider who reads in them
 * (#238). The small scale for `SegmentsView.tsx`'s reason: "0.4 km" throws
 * away the digit that tells one climb from another.
 */
function formatSegmentDistance(value: number, units: UnitSystem): string {
  return measurementText(formatSmallDistance(value, units));
}

export interface SegmentDetailViewProps {
  readonly port: EffortPort | undefined;
  /** The `:segment` capture. Absent when the audit renders the bare route. */
  readonly segment: string | undefined;
}

export function SegmentDetailView({ port, segment }: SegmentDetailViewProps): JSX.Element {
  const [history, setHistory] = useState<EffortHistory | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [overlay, setOverlay] = useState<OverlayResult | undefined>(undefined);
  const units = useUnits();

  useEffect(() => {
    if (port === undefined || segment === undefined || segment.startsWith(':')) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    // ⚠️ Every store read is wrapped, which is #67's seventh criterion: "all of
    // it works with the network stubbed to throw". There is no network in Phase
    // 1, so what that criterion really asks is that a failing read produce a
    // sentence rather than a blank screen — and an unhandled rejection inside
    // an effect takes the whole tree down.
    loadHistory(port, segmentId(segment))
      .then((found) => {
        if (cancelled) {
          return;
        }
        setHistory(found);
        setProblem(found === undefined ? 'No segment on this device has that address.' : undefined);
      })
      .catch(() => {
        if (!cancelled) {
          setProblem('This device could not read its own segment store.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [port, segment]);

  const ranked = useMemo(
    () => (history === undefined ? [] : rankEfforts(history.rows.map((row) => row.effort))),
    [history],
  );
  const best = useMemo(() => personalBest(ranked), [ranked]);

  const toggle = useCallback((id: string) => {
    setOverlay(undefined);
    setChosen((current) => {
      if (current.includes(id)) {
        return current.filter((one) => one !== id);
      }
      // Two at a time: picking a third drops the oldest, so the control never
      // reaches a state where the rider has to deselect before selecting.
      return current.length < 2 ? [...current, id] : [current[1] ?? '', id];
    });
  }, []);

  const compare = useCallback(() => {
    if (port === undefined || history === undefined || chosen.length !== 2) {
      return;
    }
    const find = (id: string): SegmentEffortRecord | undefined =>
      history.rows.find((row) => row.effort.id === id)?.effort;
    const first = find(chosen[0] ?? '');
    const second = find(chosen[1] ?? '');
    if (first === undefined || second === undefined) {
      return;
    }
    loadOverlay(port, first, second)
      .then(setOverlay)
      .catch(() => {
        setProblem('This device could not read the rides those efforts came from.');
      });
  }, [port, history, chosen]);

  if (problem !== undefined) {
    return <StatusMessage tone="warning">{problem}</StatusMessage>;
  }
  if (port === undefined || segment === undefined || segment.startsWith(':')) {
    return (
      <StatusMessage tone="info">
        Open a segment from the segments list to see every effort you have on it.
      </StatusMessage>
    );
  }
  if (loading || history === undefined) {
    return <StatusMessage tone="info">Reading this device’s efforts…</StatusMessage>;
  }

  const rowOf = (id: string): EffortHistory['rows'][number] | undefined =>
    history.rows.find((row) => row.effort.id === id);

  return (
    <section aria-labelledby="segment-heading">
      <h2 id="segment-heading">{history.segment.name}</h2>
      <p>
        {formatSegmentDistance(history.segment.distance, units)} · {ranked.length}{' '}
        {ranked.length === 1 ? 'effort' : 'efforts'} · {RANKING_BASIS_LABEL}.
      </p>
      {history.truncated ? (
        <StatusMessage tone="info">
          Showing your fastest {String(history.rows.length)} efforts. This device holds more.
        </StatusMessage>
      ) : null}

      {ranked.length === 0 ? (
        <StatusMessage tone="info">
          You have no efforts on this segment yet. Efforts appear after a ride is matched against
          it.
        </StatusMessage>
      ) : (
        <>
          <table className="oyl-data-table">
            <caption>Your efforts on this segment, fastest first. {RANKING_BASIS_LABEL}.</caption>
            <thead>
              <tr>
                <th scope="col">Compare</th>
                <th scope="col">Time</th>
                <th scope="col">Ride</th>
                <th scope="col">Standing</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((effort) => {
                const row = rowOf(effort.id);
                return (
                  <tr key={effort.id}>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.includes(effort.id)}
                          onChange={() => {
                            toggle(effort.id);
                          }}
                        />{' '}
                        <span>Compare {formatDuration(effort.elapsed)} effort</span>
                      </label>
                    </td>
                    <td>{formatDuration(effort.elapsed)}</td>
                    <td>
                      {row?.activity === undefined ? (
                        'Ride no longer on this device'
                      ) : (
                        <a href={hrefForActivity(effort.activityId)}>{row.activity.name}</a>
                      )}
                    </td>
                    <td>
                      {/* Words, never a colour or an icon alone (#48). */}
                      {effort.id === best?.id ? 'Personal best' : ''}
                      {effort.visibility === 'private-match'
                        ? `${effort.id === best?.id ? ' · ' : ''}In a privacy zone — yours only`
                        : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button type="button" onClick={compare} disabled={chosen.length !== 2}>
            Compare the two selected efforts
          </button>
          {chosen.length !== 2 ? <p>Select two efforts to compare where the time went.</p> : null}
        </>
      )}

      {overlay === undefined ? null : <Overlay result={overlay} />}
    </section>
  );
}

/** The comparison, as a table. The chart is a later addition over the same rows. */
function Overlay({ result }: { readonly result: OverlayResult }): JSX.Element {
  const units = useUnits();
  if (result.kind === 'no-track') {
    return (
      <StatusMessage tone="info">
        One of those efforts came from a ride with no recorded track, so there is nothing to lay
        alongside. An indoor ride records no position.
      </StatusMessage>
    );
  }

  const { comparison } = result;
  if (comparison.checkpoints.length === 0) {
    return (
      <StatusMessage tone="info">
        Those two efforts share no recorded distance, so there is nothing to compare.
      </StatusMessage>
    );
  }

  return (
    <section aria-labelledby="overlay-heading">
      <h3 id="overlay-heading">Where the time went</h3>
      <p>
        The second effort finished {formatDelta(comparison.durationDelta)} against the first.{' '}
        {/* The sample rates, stated. Two efforts are rarely recorded at the same
            rate, and a reader comparing two times is entitled to know that one
            of them is pinned to a sample further from the mark than the other. */}
        Recorded every {comparison.first.sampleIntervalSeconds.toFixed(1)} s and every{' '}
        {comparison.second.sampleIntervalSeconds.toFixed(1)} s.
      </p>
      <table className="oyl-data-table">
        <caption>
          Elapsed time at each point along the shorter of the two efforts, from the nearest recorded
          sample.
        </caption>
        <thead>
          <tr>
            <th scope="col">Distance</th>
            <th scope="col">First effort</th>
            <th scope="col">Second effort</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {comparison.checkpoints.map((checkpoint) => (
            <tr key={checkpoint.distance}>
              <th scope="row">{formatSegmentDistance(checkpoint.distance, units)}</th>
              <td>
                {checkpoint.first === undefined ? '—' : formatDuration(checkpoint.first.elapsed)}
              </td>
              <td>
                {checkpoint.second === undefined ? '—' : formatDuration(checkpoint.second.elapsed)}
              </td>
              <td>{checkpoint.delta === undefined ? '—' : formatDelta(checkpoint.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
