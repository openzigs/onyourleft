// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the tripod phone's picture time goes, as numbers a debugger can
 * read** — [#1112](https://github.com/openzigs/onyourleft/issues/1112).
 *
 * The owner's phone sent about 0.3 pictures a second where ADR 0033 D-3 asks
 * for about five, and nothing on the phone said why: a tick that found the
 * last picture still being taken returned in silence, and so did a picture the
 * link refused as `busy`. This records every tick of `side-camera.ts`'
 * picture timer — what happened, and how long each stage took — in a bounded
 * ring, with a rolling summary, so the coordinating session can read it off
 * the owner's phone with `apps/mobile/tools/webview-probe.mjs`:
 *
 * ```bash
 * node apps/mobile/tools/webview-probe.mjs 'window.__oylSideCameraTimings?.summary().sentPerSecondSinceStart'
 * node apps/mobile/tools/webview-probe.mjs 'window.__oylSideCameraTimings?.snapshot().summary'
 * node apps/mobile/tools/webview-probe.mjs 'window.__oylSideCameraTimings?.snapshot()'
 * ```
 *
 * ## What it holds, and what it may never hold (ADR 0029 D-8, ADR 0033 D-8)
 *
 * **Numbers and enumerations only**: milliseconds, byte COUNTS, the frames
 * channel's `bufferedAmount`, a video's frame count, the page's visibility
 * word and which encoder ran. No byte of a picture, no pixel, no `Blob`, no
 * URL of any kind and no wall-clock time — every time is milliseconds since
 * filming began on this phone's own clock, the same basis a picture already
 * carries on the wire (`side-link-pictures.ts`). `side-picture-timings.test.ts`
 * walks a snapshot and fails on anything else.
 *
 * ## Why it is on `window` in every build
 *
 * It is a debugger's reading, and the only debugger that can reach it is the
 * one `webview-probe.mjs` attaches — which Capacitor allows for a debug build
 * and not for a release one (that tool's header). What a release build carries
 * is a few hundred numbers about timing, which say nothing about the rider or
 * the room, so there is no build flag to forget to set on the APK the owner
 * measures with.
 */

import type { SidePictureSent } from './side-camera-link-port';

/** Which encoder made a picture's JPEG. */
export type SidePictureEncoder = 'worker' | 'main-thread';

/**
 * How long one picture's two stages took on the phone, and how far the video
 * it was drawn from had got. Numbers only — this rides on `CapturedFrame`
 * (`camera-port.ts`) beside the picture and never inside it.
 */
export interface SidePictureStages {
  /** The `<video>` drawn into the small canvas. */
  readonly drawMilliseconds: number;
  /** The canvas encoded as a JPEG and its bytes in hand. */
  readonly encodeMilliseconds: number;
  /**
   * The video's decoded-frame count (`browser-camera.ts` §`frameProgress`)
   * when it was drawn. Two pictures with the same count are the same camera
   * frame twice: a video that has stopped advancing.
   */
  readonly videoFrames: number | undefined;
  readonly encoder: SidePictureEncoder;
}

/**
 * What one tick of the picture timer came to.
 *
 * - the four {@link SidePictureSent} answers — a picture was taken and offered;
 * - `still-taking` — the previous picture was not finished, so this tick did
 *   nothing. A run of these is a slow capture or encode;
 * - `link-not-ready` — filming, but the link is not `connected`;
 * - `no-picture` — the camera gave nothing back;
 * - `dropped` — the picture came back after the link went or the session
 *   stopped, and was let go (D-5).
 */
export type SideTickOutcome =
  SidePictureSent | 'still-taking' | 'link-not-ready' | 'no-picture' | 'dropped';

/** Every {@link SideTickOutcome}, for counting and for the test's walk. */
export const SIDE_TICK_OUTCOMES: readonly SideTickOutcome[] = [
  'sent',
  'busy',
  'no-link',
  'too-large',
  'still-taking',
  'link-not-ready',
  'no-picture',
  'dropped',
];

/** One tick, as the session records it. */
export interface SideTickRecord {
  /** When the tick fired, in milliseconds since filming began. */
  readonly tickAt: number;
  readonly outcome: SideTickOutcome;
  /** From the tick to the picture in hand: draw, encode and every wait between. */
  readonly captureMilliseconds?: number | undefined;
  readonly drawMilliseconds?: number | undefined;
  readonly encodeMilliseconds?: number | undefined;
  readonly videoFrames?: number | undefined;
  readonly encoder?: SidePictureEncoder | undefined;
  /** The picture's length in bytes — a count, never the bytes. */
  readonly bytes?: number | undefined;
  /** The frames channel's `bufferedAmount` just before the picture was offered. */
  readonly bufferedBefore?: number | undefined;
  /** When it was offered to the link, in milliseconds since filming began. */
  readonly sentAt?: number | undefined;
}

/** What the session hands a recorder. @see SidePictureTimings */
export interface SidePictureTimingsSink {
  /** Filming began: a fresh session's numbers start from nothing. */
  started(): void;
  record(record: SideTickRecord): void;
}

/** A recorded tick, with the page's visibility at that moment. */
export interface RecordedSideTick extends SideTickRecord {
  readonly visibility: string | undefined;
}

/** Fiftieth and ninety-fifth percentiles, or `undefined` for nothing measured. */
export interface SideTimingSpread {
  readonly count: number;
  readonly p50: number | undefined;
  readonly p95: number | undefined;
}

/** The rolling summary over the last {@link SIDE_TIMINGS_WINDOW_MILLISECONDS}. */
export interface SideTimingsSummary {
  /** The newest tick's time, in milliseconds since filming began. */
  readonly lastTickAt: number | undefined;
  readonly windowMilliseconds: number;
  /** Pictures the link accepted per second over the window — the last ten seconds only. */
  readonly sentPerSecond: number;
  /**
   * Pictures the link accepted per second since filming began: every accepted
   * picture (`totals.sent`, which the ring's trimming does not touch) over the
   * newest tick's time, which is how long the session has been filming. This
   * is the rate #1112's criterion 2 asks for over at least two minutes; the
   * windowed {@link sentPerSecond} says what the last ten seconds did.
   */
  readonly sentPerSecondSinceStart: number;
  /** Ticks per second over the window — five, unless the timer itself is slowed. */
  readonly ticksPerSecond: number;
  readonly outcomes: Readonly<Record<SideTickOutcome, number>>;
  /** Every tick since filming began, by outcome. */
  readonly totals: Readonly<Record<SideTickOutcome, number>>;
  readonly capture: SideTimingSpread;
  readonly draw: SideTimingSpread;
  readonly encode: SideTimingSpread;
  /** Between one accepted picture and the next. */
  readonly sendInterval: SideTimingSpread;
  readonly bytes: SideTimingSpread;
  readonly maxBufferedBefore: number | undefined;
  /** Accepted pictures whose video frame count had not moved since the last. */
  readonly repeatedVideoFrames: number;
  readonly encoder: SidePictureEncoder | undefined;
  readonly visibility: string | undefined;
}

/** What {@link SidePictureTimings.snapshot} returns: plain, and JSON-serialisable. */
export interface SideTimingsSnapshot {
  readonly records: readonly RecordedSideTick[];
  readonly summary: SideTimingsSummary;
}

/** How many ticks the ring keeps: 60 seconds at five a second. */
export const SIDE_TIMINGS_RECORDS = 300;

/** The summary's window. Ten seconds — 50 ticks at the designed rate. */
export const SIDE_TIMINGS_WINDOW_MILLISECONDS = 10_000;

/** The value at fraction `p` of `values` (nearest rank), or `undefined` for none. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

function spread(values: readonly number[]): SideTimingSpread {
  return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function numbers(
  records: readonly RecordedSideTick[],
  read: (record: RecordedSideTick) => number | undefined,
): number[] {
  const found: number[] = [];
  for (const record of records) {
    const value = read(record);
    if (value !== undefined && Number.isFinite(value)) {
      found.push(value);
    }
  }
  return found;
}

function counted(records: readonly RecordedSideTick[]): Record<SideTickOutcome, number> {
  const counts = Object.fromEntries(SIDE_TICK_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    SideTickOutcome,
    number
  >;
  for (const record of records) {
    counts[record.outcome] += 1;
  }
  return counts;
}

/** The recorder. One per page; {@link sidePictureTimingsForThisPage} makes it. */
export class SidePictureTimings implements SidePictureTimingsSink {
  readonly #visibility: () => string | undefined;
  readonly #size: number;
  #records: RecordedSideTick[] = [];
  #totals: Record<SideTickOutcome, number> = counted([]);

  constructor(
    options: {
      readonly visibility?: (() => string | undefined) | undefined;
      readonly size?: number | undefined;
    } = {},
  ) {
    this.#visibility = options.visibility ?? (() => undefined);
    this.#size = Math.max(1, options.size ?? SIDE_TIMINGS_RECORDS);
  }

  started(): void {
    this.#records = [];
    this.#totals = counted([]);
  }

  record(record: SideTickRecord): void {
    this.#records.push({ ...record, visibility: this.#visibility() });
    this.#totals[record.outcome] += 1;
    if (this.#records.length > this.#size) {
      this.#records.splice(0, this.#records.length - this.#size);
    }
  }

  snapshot(): SideTimingsSnapshot {
    return { records: this.#records.map((each) => ({ ...each })), summary: this.summary() };
  }

  summary(): SideTimingsSummary {
    const last = this.#records.at(-1);
    const lastTickAt = last?.tickAt;
    const from = lastTickAt === undefined ? 0 : lastTickAt - SIDE_TIMINGS_WINDOW_MILLISECONDS;
    const recent = this.#records.filter((record) => record.tickAt > from);
    // The span the window actually covers, so a session two seconds old is
    // not divided by ten. Times are measured from the moment filming began,
    // so the newest tick's time IS how long the session has been filming.
    const span =
      lastTickAt === undefined ? 0 : Math.min(SIDE_TIMINGS_WINDOW_MILLISECONDS, lastTickAt);
    const sent = recent.filter((record) => record.outcome === 'sent');
    const rate = (count: number, milliseconds: number): number =>
      milliseconds <= 0 ? 0 : Math.round((count / milliseconds) * 1000 * 100) / 100;
    const perSecond = (count: number): number => rate(count, span);
    const sentTimes = numbers(sent, (record) => record.sentAt);
    const intervals: number[] = [];
    for (let index = 1; index < sentTimes.length; index += 1) {
      intervals.push((sentTimes[index] ?? 0) - (sentTimes[index - 1] ?? 0));
    }
    let repeated = 0;
    for (let index = 1; index < sent.length; index += 1) {
      const before = sent[index - 1]?.videoFrames;
      const now = sent[index]?.videoFrames;
      if (before !== undefined && now !== undefined && now === before) {
        repeated += 1;
      }
    }
    const buffered = numbers(recent, (record) => record.bufferedBefore);
    return {
      lastTickAt,
      windowMilliseconds: SIDE_TIMINGS_WINDOW_MILLISECONDS,
      sentPerSecond: perSecond(sent.length),
      sentPerSecondSinceStart: rate(this.#totals.sent, lastTickAt ?? 0),
      ticksPerSecond: perSecond(recent.length),
      outcomes: counted(recent),
      totals: { ...this.#totals },
      capture: spread(numbers(recent, (record) => record.captureMilliseconds)),
      draw: spread(numbers(recent, (record) => record.drawMilliseconds)),
      encode: spread(numbers(recent, (record) => record.encodeMilliseconds)),
      sendInterval: spread(intervals),
      bytes: spread(numbers(sent, (record) => record.bytes)),
      maxBufferedBefore: buffered.length === 0 ? undefined : Math.max(...buffered),
      repeatedVideoFrames: repeated,
      encoder: [...recent].reverse().find((record) => record.encoder !== undefined)?.encoder,
      visibility: last?.visibility,
    };
  }
}

declare global {
  interface Window {
    /** #1112: the side camera's picture timings. Numbers only. @see side-picture-timings.ts */
    __oylSideCameraTimings?: SidePictureTimings;
  }
}

/** The page's visibility word, where there is a document. */
function documentVisibility(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.visibilityState;
}

/**
 * This page's one recorder, made on first use and published as
 * `window.__oylSideCameraTimings` for `webview-probe.mjs` to read.
 *
 * `target` is a parameter so a test can watch the publication without a
 * window of its own.
 */
export function sidePictureTimingsForThisPage(
  target: { __oylSideCameraTimings?: SidePictureTimings } = globalThis as {
    __oylSideCameraTimings?: SidePictureTimings;
  },
): SidePictureTimings {
  target.__oylSideCameraTimings ??= new SidePictureTimings({ visibility: documentVisibility });
  return target.__oylSideCameraTimings;
}
