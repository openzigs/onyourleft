// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rule 2 of ADR 0028 D-2, one second at a time — the room's incremental form
 * of `@onyourleft/physics`' `plausibility`.
 *
 * `plausibility` takes a whole power series and walks every window of every
 * ceiling: right for a finished ride, and for a room it would be the whole
 * ride again every tick — about 5 000 additions per rider per second an hour
 * in. This keeps one running sum per ceiling instead, updated with **the same
 * additions and subtractions in the same order** `bestMeanPower` makes, so the
 * mean it compares at each second is the same double `plausibility` would find
 * for that window. `ceilings.test.ts` holds the two to the same verdict over
 * traces that breach and traces that do not.
 *
 * It judges the power the room **simulated** — a coasted second is a zero,
 * never a gap — for `plausibility`'s own reason: a gap would let a rider
 * escape the 5 s ceiling by having one report in five refused.
 *
 * A breach **flags**, and a flag is never cleared: rule 3, and a rider who
 * breached a ceiling has breached it whatever they do next.
 *
 * ## What a result publishes from it — #785
 *
 * A race's result shows, for every rider, **which** durations were flagged
 * ({@link CeilingWatch.flaggedDurationsSeconds}: #785's "the duration it was
 * raised for") and the rider's mean power-to-weight over the seconds the room
 * simulated ({@link CeilingWatch.wattsPerKilogram}, ruling Q17). Never their
 * watts, and never a ceiling's power: ADR 0028's 2026-09-22 amendment counts a
 * flag on the same side as the figure it bounds, and a race publishes W/kg
 * (`rooms/publication.ts`).
 */

import type { PlausibilityLimits } from '@onyourleft/physics';

export class CeilingWatch {
  readonly #series: number[] = [];
  readonly #sums: number[];
  readonly #massKilograms: number;
  readonly #limits: PlausibilityLimits;
  #flagged = false;
  /** Which ceilings have been breached, by index into `limits.ceilings`. */
  readonly #breached = new Set<number>();
  /** Every second's power, summed: the mean's numerator. */
  #totalWatts = 0;

  constructor(massKilograms: number, limits: PlausibilityLimits) {
    this.#massKilograms = massKilograms;
    this.#limits = limits;
    this.#sums = limits.ceilings.map(() => 0);
  }

  /** Whether any ceiling has ever been breached. */
  get flagged(): boolean {
    return this.#flagged;
  }

  /**
   * The durations, in seconds, of every ceiling breached so far, shortest
   * first — each once, however often it was breached.
   */
  get flaggedDurationsSeconds(): readonly number[] {
    return [...this.#breached]
      .map((which) => this.#limits.ceilings[which]?.durationSeconds as number)
      .sort((a, b) => a - b);
  }

  /**
   * The mean power over every second recorded, divided by the declared mass —
   * or `null` before the first second. A coasted second counts as the zero it
   * was simulated as, for `plausibility`'s own reason above.
   */
  get wattsPerKilogram(): number | null {
    const count = this.#series.length;
    return count === 0 ? null : this.#totalWatts / count / this.#massKilograms;
  }

  /** One second of simulated power, in watts. */
  record(powerWatts: number): void {
    const index = this.#series.length;
    this.#series.push(powerWatts);
    this.#totalWatts += powerWatts;
    this.#limits.ceilings.forEach((ceiling, which) => {
      const window = ceiling.durationSeconds;
      if (!Number.isInteger(window) || window < 1) {
        return; // `bestMeanPower` judges no such window, so neither does this.
      }
      let sum = (this.#sums[which] as number) + powerWatts;
      if (index + 1 > window) {
        sum -= this.#series[index - window] as number;
      }
      this.#sums[which] = sum;
      if (index + 1 >= window && sum / window / this.#massKilograms > ceiling.wattsPerKilogram) {
        this.#flagged = true;
        this.#breached.add(which);
      }
    });
  }
}
