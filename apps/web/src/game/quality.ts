// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the renderer gives up, and when — #91's thermal criterion as a pure
 * function.
 *
 * > *"Under thermal pressure the renderer reduces internal resolution and/or
 * > frame cap rather than stuttering, and a test asserts the reduction path is
 * > exercised."*
 *
 * ## Why this is a decision table and not a branch inside the render loop
 *
 * The reduction path is the code that runs **only on a hot phone**, which is
 * exactly the code least likely to be exercised by anybody developing on a
 * desktop. Written inline in the render loop it would be unreachable in every
 * test the repository can run (jsdom has no GL, and the browser gate's runner
 * has no thermal API at all), and its first execution would be on a rider's
 * phone at minute fifty of a ride. Written here it is a pure function from two
 * numbers to a quality level, and every rung of the ladder gets a test.
 *
 * ## Two inputs, because either alone lies
 *
 * **`thermalHeadroom`** is Android's own forecast — `PowerManager.
 * getThermalHeadroom()`, API 30+, 0.0 to 1.0, where 1.0 means throttling is
 * imminent. It is the leading indicator, and it is the one Google's guidance
 * says to act on. ⚠️ It is **absent** on the web platform, absent below API 30,
 * and can return `NaN` on devices whose vendor never implemented it — so it is
 * optional here and its absence is not treated as "cool".
 *
 * **`recentFrameMs`** is what actually happened. It is the lagging indicator and
 * it cannot be missing, because we measure it ourselves. A phone whose thermal
 * API says nothing but whose frames have gone to 60 ms is throttling regardless
 * of what any API declines to tell us.
 *
 * Google's guidance also warns that once a device has overheated the workload
 * must drop **below** the sustainable level to recover, not merely back to it —
 * which is why {@link nextQuality} has hysteresis and why the recovery threshold
 * is not the reduction threshold.
 */

/** How hard the renderer is working. Lower is cooler. */
export type QualityLevel = 0 | 1 | 2 | 3;

/** What one quality level means to the renderer. */
export interface QualitySettings {
  /**
   * Multiplier on the drawing-buffer size, applied to `devicePixelRatio`.
   *
   * Resolution first, frame rate second — #91 quotes Google naming *"framebuffer
   * resolution and frame rate"* as the two parameters to reduce, and of the two
   * a rider notices resolution far less: the HUD is vector text drawn at full
   * resolution over the top, and the world behind it is a stylised corridor with
   * no fine detail to lose.
   */
  readonly renderScale: number;
  /** The frame cap, in frames per second. */
  readonly frameCap: number;
  /** A human-readable name, for the diagnostic line #91 asks to be recorded. */
  readonly label: string;
}

/**
 * The ladder, coolest last.
 *
 * Level 0 is the target #91 specifies — 30 fps at full render scale — and **not**
 * a "high" setting above it. There is deliberately no 60 fps rung: #91 is
 * explicit that *"30 fps is the right target, not a compromise"*, and that 60
 * "doubles the thermal bill for the entire ride". A rung above the target would
 * be a rung the device spends its headroom on before the ride has warmed up.
 */
export const QUALITY_LADDER: readonly QualitySettings[] = [
  { renderScale: 1, frameCap: 30, label: 'full' },
  { renderScale: 0.83, frameCap: 30, label: 'reduced resolution' },
  { renderScale: 0.67, frameCap: 24, label: 'reduced resolution and frame rate' },
  { renderScale: 0.5, frameCap: 20, label: 'minimum' },
];

/**
 * The headroom at which the next reduction is taken.
 *
 * 0.85 rather than 1.0: the forecast reaching 1.0 means throttling is happening,
 * and reducing then is reacting rather than avoiding. The whole value of a
 * *forecast* is spent by waiting for it to be right.
 */
export const HEADROOM_REDUCE_ABOVE = 0.85;

/**
 * The headroom below which quality is allowed back up.
 *
 * Well under {@link HEADROOM_REDUCE_ABOVE}, and that gap is the hysteresis. A
 * single threshold would oscillate: reduce, cool a little, restore, heat again —
 * and the oscillation is more visible to a rider than the lower setting would
 * have been, because each change is a visible resolution pop.
 */
export const HEADROOM_RESTORE_BELOW = 0.6;

/** The frame time above which quality is reduced regardless of the thermal API. */
export const FRAME_MS_REDUCE_ABOVE = 45;

/** The frame time below which quality is allowed back up. */
export const FRAME_MS_RESTORE_BELOW = 30;

/**
 * How long the measurement must agree before quality moves, in samples.
 *
 * A rider passing through a tunnel, a garbage collection, or one dropped frame
 * must not change the renderer's settings. #91's criterion is about a *sustained*
 * condition, and a single-sample trigger would make the resolution flicker on
 * ordinary jitter.
 */
export const SUSTAINED_SAMPLES = 30;

/** What the policy is tracking between calls. */
export interface QualityState {
  readonly level: QualityLevel;
  /** Consecutive samples arguing for a change, signed: positive means hotter. */
  readonly pressure: number;
}

/** A fresh ride starts at the target quality. */
export const INITIAL_QUALITY: QualityState = { level: 0, pressure: 0 };

/** One measurement. @see nextQuality */
export interface QualitySample {
  /** Android's forecast, 0–1, or `undefined` where the platform has none. */
  readonly thermalHeadroom?: number | undefined;
  /** A recent frame time in milliseconds. */
  readonly frameMs: number;
}

/**
 * The quality level after one more measurement.
 *
 * Pure: same state and sample in, same state out. The renderer applies the
 * result; it does not decide it.
 */
export function nextQuality(state: QualityState, sample: QualitySample): QualityState {
  const hot = isHot(sample);
  const cool = isCool(sample);

  // Neither: the measurement argues for nothing, so any accumulated pressure
  // decays rather than persisting. Without this a phone that was briefly hot an
  // hour ago would still be one sample from a reduction.
  if (!hot && !cool) {
    return { ...state, pressure: decayToward(state.pressure, 0) };
  }

  const pressure = hot ? Math.max(0, state.pressure) + 1 : Math.min(0, state.pressure) - 1;
  if (Math.abs(pressure) < SUSTAINED_SAMPLES) {
    return { level: state.level, pressure };
  }

  const wanted = hot ? state.level + 1 : state.level - 1;
  const level = clampLevel(wanted);
  // Pressure resets on a change so the next rung needs its own sustained run,
  // rather than the ladder being descended in consecutive frames.
  return { level, pressure: level === state.level ? pressure : 0 };
}

/** The settings for a level. */
export function qualitySettings(level: QualityLevel): QualitySettings {
  return QUALITY_LADDER[level] as QualitySettings;
}

/** Whether this sample argues for less work. */
function isHot(sample: QualitySample): boolean {
  const headroom = sample.thermalHeadroom;
  // ⚠️ `NaN > x` is false, so a vendor returning NaN reads as "not hot" here and
  // the frame time is what decides. That is the intended behaviour and it is
  // stated because the opposite reading — NaN as hot — would throttle every
  // device whose vendor never implemented the API.
  if (headroom !== undefined && Number.isFinite(headroom) && headroom > HEADROOM_REDUCE_ABOVE) {
    return true;
  }
  return sample.frameMs > FRAME_MS_REDUCE_ABOVE;
}

/** Whether this sample argues for more. Both signals must agree. */
function isCool(sample: QualitySample): boolean {
  const headroom = sample.thermalHeadroom;
  // Frames must be comfortable AND, where the platform reports it, the forecast
  // must be well clear. Restoring on frame time alone is how a device that is
  // hot but keeping up gets pushed back into throttling.
  if (sample.frameMs >= FRAME_MS_RESTORE_BELOW) {
    return false;
  }
  if (headroom === undefined || !Number.isFinite(headroom)) {
    return true;
  }
  return headroom < HEADROOM_RESTORE_BELOW;
}

function decayToward(pressure: number, target: number): number {
  if (pressure > target) {
    return pressure - 1;
  }
  return pressure < target ? pressure + 1 : target;
}

function clampLevel(level: number): QualityLevel {
  const last = QUALITY_LADDER.length - 1;
  const clamped = level < 0 ? 0 : level > last ? last : level;
  return clamped as QualityLevel;
}
