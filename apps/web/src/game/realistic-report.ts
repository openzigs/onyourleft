// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Why the last realistic ride stepped down, or left the realistic world — #2289.
 *
 * On 2026-11-06 the owner's Pixel 8 left the realistic world within a minute
 * and nothing anywhere said why: `quality.ts`'s ladder reads a frame time and
 * keeps none. (The owner's measurement found it was the thermal forecast, which
 * the ladder no longer reads — it decides on frame time alone.) This is the
 * record a ride keeps instead, on the device, and the sentences Settings ›
 * Game world shows from it.
 *
 * ## What it holds, and what it never does
 *
 * Counts and milliseconds, the realistic rung, and how far into the ride a step came, in seconds. **No coordinate,
 * and nothing that could become one**: the route's name and the distance
 * ridden are left out too, because a distance from a route's start is a
 * position on it (`SECURITY.md`, ADR 0004 D).
 *
 * ⚠️ **The limit travels inside the record** (`frameMsLimit`)
 * rather than being imported from `quality.ts`, because the Settings chunk
 * reads this file and `quality.ts` carries the scenery, the landform and the
 * settlements for its constants — `world-preference.ts` §"A module of its
 * own" makes the same split. `realistic-watch.ts`, on the ride's side, writes
 * the ladder's own limit into it.
 *
 * On the DEVICE, as the choice itself is: what a GPU can hold is a property of
 * the machine. One record, the most recent; a ride that never settled into the
 * realistic world writes nothing and leaves the previous one.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const REALISTIC_REPORT_STORAGE_KEY = 'oyl.game.realisticReport.v1';

/** The frames ignored while the realistic world was handed to the view. @see quality.ts REALISTIC_SETTLING_SAMPLES */
export interface RealisticSettlingReading {
  /** Drawn frames ignored. */
  readonly frames: number;
  /** Of them, how many took longer than the frame-time limit. */
  readonly slow: number;
  /** The longest of them, in milliseconds. */
  readonly worstMs: number;
}

/** One step down the realistic ladder, and the samples that decided it. */
export interface RealisticStepReading {
  /** The realistic rung it stepped from: 0 is the top, 1 the reduced rung. */
  readonly rung: number;
  /** Whether this step left the realistic world for the rest of the ride. */
  readonly left: boolean;
  /** How far into the ride it came, in seconds of the ride's clock. */
  readonly rideSeconds: number;
  /** The samples read — the ladder's last decision window, or fewer. */
  readonly frames: number;
  /** Of them, how many were over the frame-time limit. */
  readonly overFrameMs: number;
  /** Their median frame time, in milliseconds. */
  readonly medianMs: number;
  /** Their longest frame time, in milliseconds. */
  readonly worstMs: number;
}

/** The last realistic ride's record. */
export interface RealisticWorldReport {
  /** The frame time the ladder reads as hot, in milliseconds. */
  readonly frameMsLimit: number;
  /** The settling window, once it has ended. */
  readonly settling?: RealisticSettlingReading;
  /** Each step down, in order. The last one left the world when `left` says so. */
  readonly steps: readonly RealisticStepReading[];
}

/** Keep it. `false` when the device refused; nothing on the ride depends on it. */
export function writeRealisticReport(
  storage: PreferenceStorage | undefined,
  report: RealisticWorldReport,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(REALISTIC_REPORT_STORAGE_KEY, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}

/** What this device recorded, or `undefined` for nothing or anything malformed. Never throws. */
export function readRealisticReport(
  storage: PreferenceStorage | undefined,
): RealisticWorldReport | undefined {
  let raw: unknown;
  try {
    const text = storage?.getItem(REALISTIC_REPORT_STORAGE_KEY) ?? null;
    if (text === null) return undefined;
    raw = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const { frameMsLimit, settling, steps } = raw;
  if (!isNumber(frameMsLimit) || !Array.isArray(steps)) {
    return undefined;
  }
  const readSteps = steps.map(stepOf);
  if (readSteps.some((step) => step === undefined)) return undefined;
  const readSettling = settling === undefined ? undefined : settlingOf(settling);
  if (settling !== undefined && readSettling === undefined) return undefined;
  return {
    frameMsLimit,
    ...(readSettling === undefined ? {} : { settling: readSettling }),
    steps: readSteps as RealisticStepReading[],
  };
}

/**
 * The record as sentences, one per line — what Settings › Game world shows.
 * Numbers rounded as a person reads them: whole milliseconds and seconds.
 */
export function realisticReportLines(report: RealisticWorldReport): readonly string[] {
  const limit = `${ms(report.frameMsLimit)} ms`;
  const lines: string[] = [];
  const settling = report.settling;
  if (settling !== undefined) {
    lines.push(
      `Its first ${String(settling.frames)} realistic frames were not counted while the world was handed over: ${String(settling.slow)} took longer than ${limit}, the longest ${ms(settling.worstMs)} ms.`,
    );
  }
  for (const step of report.steps) {
    const what = step.left
      ? 'It left the realistic world'
      : 'It stepped down within the realistic world';
    lines.push(
      `${what} ${ms(step.rideSeconds)} s into the ride, from realistic rung ${String(step.rung + 1)}, on frame time: of the last ${String(step.frames)} frames ${String(step.overFrameMs)} took longer than ${limit} (median ${ms(step.medianMs)} ms, longest ${ms(step.worstMs)} ms).`,
    );
  }
  if (!report.steps.some((step) => step.left)) {
    lines.push('It did not leave the realistic world.');
  }
  return lines;
}

function ms(value: number): string {
  return String(Math.round(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function settlingOf(value: unknown): RealisticSettlingReading | undefined {
  if (!isRecord(value)) return undefined;
  const { frames, slow, worstMs } = value;
  return isNumber(frames) && isNumber(slow) && isNumber(worstMs)
    ? { frames, slow, worstMs }
    : undefined;
}

function stepOf(value: unknown): RealisticStepReading | undefined {
  if (!isRecord(value)) return undefined;
  const { rung, left, rideSeconds, frames, overFrameMs, medianMs, worstMs } = value;
  if (
    !isNumber(rung) ||
    typeof left !== 'boolean' ||
    !isNumber(rideSeconds) ||
    !isNumber(frames) ||
    !isNumber(overFrameMs) ||
    !isNumber(medianMs) ||
    !isNumber(worstMs)
  ) {
    return undefined;
  }
  return {
    rung,
    left,
    rideSeconds,
    frames,
    overFrameMs,
    medianMs,
    worstMs,
  };
}
