// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A capture ride's recorder figures, worked out in memory — #3152.
 *
 * The HUD's *Moving*, *Elapsed*, *Lap*, the ride so far and *Calories* are
 * the RECORDER's figures (`GameView.tsx` §`useRideMovingSeconds`,
 * §`useRideTotals`), and a capture ride records nothing: it has no trainer
 * port, which is the only way a game ride reaches a recording
 * (`capture-scene.ts`). So on a simulated ride each of them is a dash, and a
 * video of the full HUD would show five dashes a rider never sees.
 *
 * This keeps the same readings the HUD shows, one sample a second of the
 * ride's clock as the recorder keeps them, in a series of its own that is
 * never stored, and folds it with the recorder's own function
 * (`recording/totals.ts` §`rideTotals`), so the figures are the ones a ride
 * at those readings would show — never a second formula for them. Nothing is
 * written anywhere: the object is dropped with the screen.
 *
 * The climb is read from the route's elevation under the rider (`altitude`),
 * where a game ride's recording reads its laps; the run rule is the same.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type AltitudeMetres,
  type BeatsPerMinute,
  type MetresPerSecond,
  type RecordedSeries,
  type RevolutionsPerMinute,
  type Watts,
} from '@onyourleft/domain';
import type { RecordedCourseLap, RecordedLapMark, StreamChannelValue } from '@onyourleft/store';

import { lapFiguresOf, type CourseLineEvent, type LapFigures } from '../recording/laps';
import { rideTotals, type RideTotals } from '../recording/totals';

/** One second of a capture ride: what the HUD read, and where the rider was. */
export interface CaptureSample {
  readonly watts: number;
  readonly cadence: number | undefined;
  readonly heartRate: number | undefined;
  /** Metres a second. */
  readonly speed: number;
  /** The route's elevation under the rider, in metres. */
  readonly altitude: number;
}

/** A capture ride's 1 Hz series and the recorder's figures over it. */
export class CaptureRecording {
  readonly #power: (Watts | undefined)[] = [];
  readonly #heartRate: (BeatsPerMinute | undefined)[] = [];
  readonly #cadence: (RevolutionsPerMinute | undefined)[] = [];
  readonly #speed: (MetresPerSecond | undefined)[] = [];
  readonly #altitude: (AltitudeMetres | undefined)[] = [];
  /** #3153: the laps ended over a course's line, as the recorder keeps them. */
  readonly #laps: RecordedCourseLap[] = [];
  /** Where the lap in progress began: the ride's start, or the last line crossed. */
  #lapFrom: RecordedLapMark = lapMark(0);
  #totals: RideTotals | undefined;

  /**
   * Keep `second`'s sample — the ride's whole second just passed, from one
   * (`hud/recent-trace.ts` §`sampleSecond`). A second skipped by a long frame
   * is a gap, as the recorder leaves one; a second already kept is not kept
   * again.
   */
  sample(second: number, reading: CaptureSample): void {
    const slot = Math.floor(second) - 1;
    if (!Number.isFinite(slot) || slot < this.#power.length) return;
    while (this.#power.length < slot) {
      this.#power.push(undefined);
      this.#heartRate.push(undefined);
      this.#cadence.push(undefined);
      this.#speed.push(undefined);
      this.#altitude.push(undefined);
    }
    this.#power.push(watts(reading.watts));
    this.#heartRate.push(
      reading.heartRate === undefined ? undefined : beatsPerMinute(reading.heartRate),
    );
    this.#cadence.push(
      reading.cadence === undefined ? undefined : revolutionsPerMinute(reading.cadence),
    );
    this.#speed.push(metresPerSecond(reading.speed));
    this.#altitude.push(altitudeMetres(reading.altitude));
    this.#totals = undefined;
  }

  /** The seconds kept: the ride's moving, elapsed and lap time alike, since it never pauses. */
  get seconds(): number {
    return this.#power.length;
  }

  /**
   * #3153, the review of PR #3160: the seconds of the lap in progress — the
   * HUD's *Lap* — counted from the last line crossed, as the recorder counts
   * them (`GameView.tsx` §`useRideLapSeconds`). On a ride that crosses none, {@link seconds}.
   */
  get lapSeconds(): number {
    return this.#power.length - this.#lapFrom.movingTime;
  }

  /**
   * #3153, the review of PR #3160: the game said where its course's line is
   * (`trainer-port.ts` §`GameTrainerPort.courseLine`, which a capture has no
   * port for). A `lap` ends the lap in progress at the second kept last, with
   * the course's own distance and climb, and the laps come back as the lap
   * panel reads them (`recording/laps.ts` §`lapFiguresOf`, the recorder's
   * rule); `undefined` for an event that ends no lap.
   */
  courseLine(event: CourseLineEvent): readonly LapFigures[] | undefined {
    if (event.kind !== 'lap') return undefined;
    const to = lapMark(this.#power.length);
    this.#laps.push({
      from: this.#lapFrom,
      to,
      distance: event.distance,
      ascent: event.ascent,
      ...(event.partial ? { partial: true } : {}),
    });
    this.#lapFrom = to;
    this.#totals = undefined;
    const series = this.#series();
    return this.#laps.map((lap) => lapFiguresOf(series, lap));
  }

  #series(): RecordedSeries<StreamChannelValue> {
    return {
      startedAt: unixSeconds(0),
      sampleInterval: seconds(1),
      sampleCount: this.#power.length,
      channels: {
        power: [...this.#power],
        heartRate: [...this.#heartRate],
        cadence: [...this.#cadence],
        speed: [...this.#speed],
        altitude: [...this.#altitude],
      },
      pauses: [],
    };
  }

  /**
   * The ride so far, by `recording/totals.ts` §`rideTotals`, over the laps
   * ended so far. The same object until the next sample or lap, as the
   * recorder's port hands back.
   */
  totals(): RideTotals {
    this.#totals ??= rideTotals(this.#series(), this.#laps);
    return this.#totals;
  }
}

/** The mark of the line at the end of `second`s kept: a capture never pauses, so moving is elapsed. */
function lapMark(second: number): RecordedLapMark {
  return { at: unixSeconds(second), movingTime: seconds(second) };
}
