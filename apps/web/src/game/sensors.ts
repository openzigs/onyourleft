// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The live ride's sensors, as the game reads them.
 *
 * One small translation, and it exists because the two sides genuinely disagree
 * about how many states a sensor has. `ride/metrics.ts` models **four** —
 * `unpaired`, `waiting`, `live` and `stale` — and `hud/fields.ts` needs to know
 * which of them means "say nothing", which means "warn", and which carries a
 * number. Doing it here, once, is what stops each screen inventing its own
 * mapping and disagreeing about the one that matters.
 *
 * ## The distinction this file exists to preserve
 *
 * ⚠️ `unpaired` and `stale` both mean "no number right now" and must **not**
 * render the same way. `ride/metrics.ts` says why, and it is worth quoting
 * where the mapping is written rather than only where the states are:
 *
 * > *"A channel nobody is paired for is not 'unavailable' — it was never
 * > available, and telling a rider with no heart rate strap that their heart
 * > rate has been lost is a false alarm on every ride."*
 *
 * So `paired` carries the difference through to the HUD, which shows a bare dash
 * for a channel nobody owns a sensor for and "Sensor lost" for one that has gone
 * quiet.
 *
 * ⚠️ `waiting` is **paired and not yet live**, which is a third rendering again:
 * a trainer that has connected but not yet notified. It maps to paired-and-not-
 * live, so the HUD does warn — deliberately, because a sensor that connects and
 * then never speaks is a real fault, and the alternative is a screen that sits
 * silently on dashes while the rider wonders whether to re-pair.
 */

import type { RideMetric, RideSnapshot } from '../ride/controller';
import type { RideMetricId } from '../ride/metrics';
import { watts } from '@onyourleft/domain';
import type { SensorReading } from './hud/fields';
import type { RiderInput } from './simulation';

/** What the game screen samples each frame. */
export interface GameSensors {
  readonly rider: RiderInput;
  readonly cadence: SensorReading;
  readonly heartRate: SensorReading;
}

/** Nothing paired at all — what a screen shows before a rider has connected anything. */
export const NO_SENSORS: GameSensors = {
  rider: { power: watts(0), live: false, paired: false },
  cadence: { value: undefined, live: false, paired: false },
  heartRate: { value: undefined, live: false, paired: false },
};

/**
 * Reads one channel out of a ride snapshot.
 *
 * A channel with no metric in the snapshot at all is treated as unpaired rather
 * than as an error: the snapshot lists what the controller knows about, and a
 * missing entry means nothing supplies it.
 */
export function readingFor(snapshot: RideSnapshot, id: RideMetricId): SensorReading {
  const metric = snapshot.metrics.find((each: RideMetric) => each.id === id);
  if (metric === undefined || metric.state.kind === 'unpaired') {
    return { value: undefined, live: false, paired: false };
  }
  if (metric.state.kind === 'live') {
    return { value: metric.state.value, live: true, paired: true };
  }
  // `waiting` and `stale`: paired, and no number to show. See the header for why
  // these warn where `unpaired` does not.
  return { value: undefined, live: false, paired: true };
}

/**
 * Everything the game needs from a ride in progress.
 *
 * ⚠️ Power is branded on the way through, because the simulation integrates it
 * and `Watts` is non-negative by construction. A negative reading from a
 * misbehaving meter would throw here rather than inside `advance`, which is the
 * better place for it: this function names the sensor, and the integrator does
 * not.
 */
export function gameSensors(snapshot: RideSnapshot | undefined): GameSensors {
  if (snapshot === undefined) {
    return NO_SENSORS;
  }
  const power = readingFor(snapshot, 'power');
  return {
    rider: {
      power: watts(power.value ?? 0),
      live: power.live,
      paired: power.paired ?? false,
    },
    cadence: readingFor(snapshot, 'cadence'),
    heartRate: readingFor(snapshot, 'heartRate'),
  };
}
