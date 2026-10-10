// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the analysis agent's tools may read, and nothing else** — #1098,
 * ADR 0046 D-7.
 *
 * Read-only by TYPE, the way `ErgSink` is a `Pick` of the trainer control
 * (`packages/sensors`): the store is handed to the tools as an
 * {@link AnalysisReads}, which has one method and it reads. No tool module
 * can name a write, because the object it holds has none to name — and no
 * tool module imports the store at all (`agent-safety.test.ts` walks them).
 *
 * The kinds are narrowed too: a tool can ask for a `ride-summary` or a `goal`
 * and for nothing else, so the side-camera report — which carries the pose
 * summary (ADR 0033 D-3; ADR 0040 D-2 item 1) — is not a kind any tool can
 * spell.
 */

/** The synced kinds a tool may read (ADR 0046 D-7's table; `workout` since #1100). */
export type ToolReadKind = 'ride-summary' | 'goal' | 'workout';

/**
 * One synced item, as a tool is allowed to see it: its bytes, and its key.
 *
 * The key is read for ONE thing (#1187): `recent_rides` leaves out the
 * asked-about ride, whose `ride-summary` is keyed by its synced id
 * (`history/passages.ts` §`RIDE_KINDS`). No tool returns a key, and
 * `tools.test.ts` holds that.
 */
export interface ReadItem {
  readonly key: string;
  readonly body: Uint8Array | null;
}

/** The one read the tools have. `SqlStore` satisfies it as it stands. */
export interface AnalysisReads {
  /** This athlete's live items of `kind`, newest first, at most `limit`. */
  listLiveSyncItems(
    athleteId: string,
    kind: ToolReadKind,
    limit: number,
  ): Promise<readonly ReadItem[]>;
}

/**
 * The history index, as the `history_search` tool may ask it (#1099, ADR 0040
 * D-8 amended by ADR 0046): the index's own in-process search
 * (`history/history.ts` §`History.searchFor`), never the HTTP route. The
 * athlete is the JOB's. `History` satisfies it as it stands.
 */
export interface AnalysisHistory {
  searchFor(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly passages: readonly {
            readonly kind: string;
            readonly label: string;
            readonly text: string;
          }[];
        };
      }
    | { readonly ok: false }
  >;
}
