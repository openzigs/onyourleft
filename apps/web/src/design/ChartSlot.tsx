// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a chart goes, and what is there when it is not.
 *
 * #48's seventh acceptance criterion: *"the shell renders and is navigable with
 * JavaScript-heavy charts absent, so a failed chart bundle does not blank the
 * page."* Without a boundary that is precisely what happens — an exception
 * thrown while rendering unmounts the whole React tree, so one broken chart
 * takes the header, the navigation and every other view with it, and the athlete
 * is left with an empty document and no way out of it.
 *
 * ## The fallback is a table, not an apology
 *
 * The alternative — "the chart could not be loaded" — throws away the data the
 * chart was drawing. A table of the same values is:
 *
 * - what a screen-reader user would have wanted in the first place, since a
 *   canvas chart is a single unlabelled image to a reader;
 * - what a keyboard user can move through;
 * - what survives a chart bundle that fails to load at all.
 *
 * So the table is not a degraded mode. It is the base case, and the chart is
 * the enhancement — which is also why {@link ChartSlot} renders the table
 * directly when no chart is supplied, as every view in this shell does today.
 * #50's activity detail view supplies the first chart.
 */

import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

interface RenderBoundaryProps {
  readonly fallback: ReactNode;
  readonly children: ReactNode;
  /** Called with whatever the subtree threw, so a caller can report it. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface RenderBoundaryState {
  readonly failed: boolean;
}

/**
 * Catches a render error in its subtree and shows `fallback` instead.
 *
 * A class component because React provides no hook equivalent — `componentDidCatch`
 * and `getDerivedStateFromError` are class-only and have been for the whole life
 * of the feature. This is the one class in the client.
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  override state: RenderBoundaryState = { failed: false };

  static getDerivedStateFromError(): RenderBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface ChartSlotProps {
  /** Names the data. Rendered as the table's `<caption>`. */
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Nothing here yet, said in the table's own terms. */
  readonly emptyMessage: string;
  /**
   * The chart, when there is one.
   *
   * Left undefined by every view in this shell: #50 owns the first chart, and a slot
   * that renders its table until then is the same component doing its job
   * rather than a placeholder to be replaced.
   *
   * ⚠️ **This prop has no production caller yet, so the boundary below is
   * exercised only by `degradation.a11y.test.tsx`.** #48's seventh criterion —
   * the shell renders with charts absent — is genuinely met without it, but the
   * *lazy* half of that criterion is not this file's to meet: it depends on #50
   * loading each chart through `React.lazy`, and a `lazy` component that fails
   * to load throws during render, which is what {@link RenderBoundary} catches.
   * A chart imported eagerly by #50 would take the page down before this
   * boundary ever ran. Recorded here rather than discovered there (#143).
   */
  readonly chart?: ReactNode;
}

/** The table half, which is also the fallback half. */
function DataTable({
  caption,
  columns,
  rows,
  emptyMessage,
}: Omit<ChartSlotProps, 'chart'>): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="oyl-panel">
        <p className="oyl-muted">
          <strong>{caption}.</strong> {emptyMessage}
        </p>
      </div>
    );
  }
  return (
    <table className="oyl-data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {/*
          Keyed by POSITION, not by content. The row key was the row's own
          cells joined on U+001F, which made two rows carrying the SAME values
          share a key -- and a ride's table has every reason to repeat a row,
          two laps at the same split for instance. React treats duplicate keys
          as one child, so the second row is dropped from the rendered table
          and the athlete reads a table that is quietly short. The cell key had
          the same shape on `column:cell` and the same hole.

          Position is the honest key here: `rows` is ordered data with no
          identity of its own, and it is replaced wholesale rather than
          reordered in place. It also gets an invisible C0 control character
          out of a source file. #143.
        */}
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A chart with a table underneath it, in both senses.
 *
 * @param onChartError reports what the chart threw, so a caller can log it.
 * The shell does not log it anywhere today: with no server there is nowhere to
 * send it (owner decision D6), and a console message the athlete will not open
 * is what #48 exists to stop relying on.
 */
export function ChartSlot({
  caption,
  columns,
  rows,
  emptyMessage,
  chart,
  onChartError,
}: ChartSlotProps & {
  readonly onChartError?: (error: Error, info: ErrorInfo) => void;
}): JSX.Element {
  const table = (
    <DataTable caption={caption} columns={columns} rows={rows} emptyMessage={emptyMessage} />
  );
  if (chart === undefined) {
    return table;
  }
  return (
    <RenderBoundary fallback={table} onError={onChartError}>
      {chart}
    </RenderBoundary>
  );
}
