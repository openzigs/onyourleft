// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the realistic page says on its screen, and who reports its errors —
 * #480.
 *
 * Both were inline in `realistic-harness.ts`, and #479 fixed a defect in each
 * with no test that could see either: restoring the old readout left the
 * harness suite green, and so did dropping the error handoff. They are here so
 * that the page and a test call the same code.
 */

import type { EarlyRecord } from '../realistic-harness';
import { percentiles } from './config';
import { readoutMs, type MeasurementClock } from './loop';

/** What the readout line needs to know about the page. */
export interface ReadoutInput {
  readonly world: string;
  readonly rung: string;
  readonly phase: 'measured' | 'warming up' | 'sampling';
  readonly clock: MeasurementClock;
  readonly buffer: readonly [number, number];
  readonly notice: string | undefined;
}

/**
 * The line at the top of the page.
 *
 * ⚠️ **Its frame time is taken over {@link MeasurementClock.recent}, never over
 * the measurement window** — #478's `frame p50 NaN ms` on the tablet was
 * `percentiles(clock.samples.slice(-120))`, which is empty at every readout
 * once the page has published its measurement, because the page takes the
 * window every frame from then on. `reporting.test.ts` rides a clock past
 * that point and reads the line.
 */
export function readoutLine(input: ReadoutInput): string {
  const live = percentiles(input.clock.recent);
  return (
    `${input.world} world · ${input.rung} · ${input.phase}` +
    ` · frame p50 ${readoutMs(live.p50)} · ` +
    `buffer ${String(input.buffer[0])}×${String(input.buffer[1])}` +
    (input.notice === undefined ? '' : `\n${input.notice}`)
  );
}

/** Where the page listens for an error when no early script is there to hand them over. */
export type ErrorListen = (
  type: 'error' | 'unhandledrejection',
  listener: (event: { error?: unknown; message?: unknown; reason?: unknown }) => void,
) => void;

/**
 * The page's module takes over error reporting from `realistic.html`'s first
 * script (#478), or listens for itself where that script is absent — a page
 * built from an old `realistic.html`.
 *
 * ⚠️ **`early.report = fail` is the whole handoff.** The early script keeps
 * its own `error` and `unhandledrejection` listeners for the life of the page
 * and hands each error to `report` once it is set, buffering until then. Drop
 * the assignment and every error after the module loads is buffered into an
 * array nobody reads again: nothing reaches `__oylRealistic.errors`, the red
 * box, or the `OYL-REALISTIC-ERROR` line in `logcat`, and the page looks as
 * though it never failed — which is what #479's fix restored, and what
 * `early.test.ts` §"#480" now goes red for.
 */
export function takeOverReporting(
  early: EarlyRecord | undefined,
  fail: (message: string) => void,
  listen: ErrorListen,
  describe: (error: unknown) => string,
): void {
  if (early === undefined) {
    listen('error', (event) => {
      fail(describe(event.error ?? event.message));
    });
    listen('unhandledrejection', (event) => {
      fail(describe(event.reason));
    });
    return;
  }
  early.report = fail;
  for (const message of early.errors.splice(0)) fail(message);
}
