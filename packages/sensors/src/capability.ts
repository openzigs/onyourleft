// SPDX-License-Identifier: Apache-2.0

/**
 * What a device can do, expressed as the quantities it reports rather than as
 * the GATT services it exposes.
 *
 * ## Why the seam is here and not at the characteristic
 *
 * A capability is "this device reports power", not "this device implements
 * 0x1818". The distinction is the whole of #39. Cadence reaches this program
 * from at least three unrelated wire formats — the Cycling Power service's
 * optional crank-revolution fields, the Cycling Speed and Cadence service, and
 * the FTMS Indoor Bike Data notification — and a consumer that wants cadence
 * wants cadence. Naming the service in the capability would push the choice of
 * wire format up into the recorder and the UI, which is the coupling that makes
 * a second transport a rewrite instead of an adapter.
 *
 * It also makes the multi-capability requirement fall out rather than needing
 * special handling. A modern smart trainer is simultaneously an FTMS machine, a
 * power meter and a speed/cadence sensor; here it is one device whose
 * capability set happens to be large, so the UI lists it once.
 *
 * ## Where the fan-out happens
 *
 * One FTMS Indoor Bike Data notification carries power, cadence and speed
 * together. The transport adapter (#40, and the clients in #41–#43) splits that
 * single notification into one measurement per capability, **all stamped with
 * the same instant**, so a consumer can still correlate them. Splitting there
 * rather than here is deliberate: the composite shape is a property of one wire
 * format, and building it into the interface would make every other transport
 * pretend to have it.
 */

/**
 * A quantity a device reports as a stream of measurements.
 *
 * Four, and no more, because these are the four #41–#44 deliver. Adding a
 * capability nothing implements would produce a `MeasurementFor<C>` case with
 * no producer and no test.
 */
export type MeasurementCapability =
  /** Heart rate, in beats per minute. Chest straps, arm bands, some watches. */
  | 'heart-rate'
  /**
   * Mechanical power at the pedals, in watts. Power meters, and smart trainers
   * — which is the overlap the connection budget turns into a decision; see
   * `plan.ts`.
   */
  | 'power'
  /** Crank cadence, in revolutions per minute. */
  | 'cadence'
  /**
   * Ground or simulated ground speed, in metres per second.
   *
   * ⚠️ A wheel-speed sensor reports *wheel revolutions*, and turning those into
   * a speed needs the athlete's wheel circumference, which is a rider setting
   * and not a device property. That conversion belongs to #42 with the setting
   * in hand — this capability means "reports a speed", and a device that can
   * only report revolutions does not have it until #42 gives it one.
   */
  | 'speed';

/**
 * Something a device lets this program *do*, as opposed to report.
 *
 * ⚠️ **The command surface is not defined here — it is #43's.** This capability
 * is a descriptor: it is what lets the UI know a trainer can be put into ERG
 * mode before anything tries. It carries no measurement, which is why it is
 * outside `MeasurementCapability` rather than inside it with an empty payload.
 *
 * SECURITY.md is explicit that trainer control is a *safety* problem and not
 * only a security one — resistance is applied to a person who is pedalling — so
 * the command surface arriving with its own issue, its own review and its own
 * bounds checks is the intended sequencing, not an oversight.
 */
export type ControlCapability = 'trainer-control';

/** Anything a device may be described as providing. */
export type SensorCapability = MeasurementCapability | ControlCapability;

/**
 * Every measurement capability, in a stable order.
 *
 * Exported so a caller can iterate them without restating the union — a
 * restated list is the one that goes stale. The order is the order a rider
 * reads them, not an alphabetical one.
 */
const MEASUREMENT_CAPABILITY_ORDER = {
  power: 0,
  cadence: 1,
  'heart-rate': 2,
  speed: 3,
} as const satisfies Record<MeasurementCapability, number>;

/**
 * Every measurement capability, in a stable order.
 *
 * Exported so a caller can iterate them without restating the union — a
 * restated list is the one that goes stale.
 *
 * ## Why this is derived rather than written out
 *
 * Review of PR #108 falsified the claim this file used to make. The list was a
 * literal annotated `readonly MeasurementCapability[]`, which checks only that
 * every ENTRY is in the union — it says nothing about every union member being
 * an entry. Adding `| 'temperature'` to the union and touching nothing else left
 * typecheck clean and 233 tests green, with the list silently stale, so a
 * pairing UI iterating it would never have offered the new capability.
 *
 * `Record<MeasurementCapability, number>` checks the other direction: it cannot
 * be satisfied unless every member of the union has a key. Deriving the array
 * from those keys means there is one source of truth and the two cannot drift.
 * The explicit ordinals fix the order a rider reads them in, rather than relying
 * on key-insertion order.
 */
export const MEASUREMENT_CAPABILITIES: readonly MeasurementCapability[] = (
  Object.keys(MEASUREMENT_CAPABILITY_ORDER) as MeasurementCapability[]
)
  .slice()
  .sort((a, b) => MEASUREMENT_CAPABILITY_ORDER[a] - MEASUREMENT_CAPABILITY_ORDER[b]);

const CONTROL_CAPABILITY_ORDER = {
  'trainer-control': 0,
} as const satisfies Record<ControlCapability, number>;

/** Every capability, measurement and control alike, in a stable order. */
export const SENSOR_CAPABILITIES: readonly SensorCapability[] = [
  ...MEASUREMENT_CAPABILITIES,
  ...(Object.keys(CONTROL_CAPABILITY_ORDER) as ControlCapability[])
    .slice()
    .sort((a, b) => CONTROL_CAPABILITY_ORDER[a] - CONTROL_CAPABILITY_ORDER[b]),
];

/**
 * Whether a capability carries a measurement stream.
 *
 * A type guard rather than a comparison, so a caller that filters a mixed list
 * gets `MeasurementCapability[]` back and can hand it to `subscribe` without a
 * cast.
 */
export function isMeasurementCapability(
  capability: SensorCapability,
): capability is MeasurementCapability {
  // Membership, not `!== 'trainer-control'`. The negation was correct only while
  // ControlCapability had exactly one member: review of PR #108 showed that
  // adding `| 'trainer-firmware'` left typecheck clean, 233 tests green, and
  // `isMeasurementCapability('trainer-firmware')` returning TRUE — handing a
  // caller a control capability typed as a measurement, which is precisely what
  // this guard exists to prevent. Deriving it from the list cannot drift,
  // because the list is now exhaustive over the union by compile-time check.
  return capability in MEASUREMENT_CAPABILITY_ORDER;
}
