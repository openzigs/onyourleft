// SPDX-License-Identifier: Apache-2.0

/**
 * The seam a GATT profile fills: a service UUID, a characteristic UUID, the
 * capabilities it can supply, and a decoder.
 *
 * Declared by #40 inside `web-bluetooth/src/profile.ts`, and moved here by #41
 * and #42 for the reason `uuid.ts` records at length: the decoders are shared
 * between the browser adapter and the native stacks (#15), so the type they are
 * written against cannot live inside one of them. `web-bluetooth/` re-exports
 * every name below, so `@onyourleft/sensors/web-bluetooth` is unchanged.
 *
 * Nothing here names a platform API. `DataView` is an ECMAScript built-in, not
 * a DOM type — `tsconfig.platform-free.json` compiles this directory with
 * `lib: ["ES2024"]` and `types: []` and it holds.
 *
 * ## Why the decoder pushes into a sink rather than returning measurements
 *
 * A decoder that returned `SensorMeasurement[]` would allocate an array on
 * every notification, and one notification per second from each of three
 * sensors is ten thousand arrays an hour that exist only to be iterated once
 * and thrown away. #40's fifth acceptance criterion is that notification
 * handling allocates nothing per notification, so the decoder is handed a sink
 * the adapter created **once per characteristic per link** and calls a method
 * on it per field present.
 *
 * The sink also removes two whole classes of decoder bug, because the decoder
 * never sees them:
 *
 * - **It cannot misattribute a measurement.** The device identity is the
 *   adapter's, stamped on the envelope the sink builds.
 * - **It cannot misdate one.** The receive instant is read once per
 *   notification by the adapter, before the decoder runs.
 *
 * ## The sink is keyed by capability, and the key set is checked
 *
 * `MeasurementSink` is a **mapped type over `MeasurementCapability`**, not a
 * hand-written interface with four methods. Review of PR #108 established the
 * difference in this repository: a hand-written list checks only that every
 * entry is in the union, and stays silently stale when the union grows. A
 * mapped type cannot — adding a fifth capability makes every sink in the
 * program a compile error until it grows a fifth method, which is the outcome
 * that gets the decoder written.
 */

import type {
  BeatsPerMinute,
  MetresPerSecond,
  RevolutionsPerMinute,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';

import type { ControlCapability, MeasurementCapability } from '../../src/capability';

import type { GattUuid } from './uuid';

/**
 * The quantity each capability carries.
 *
 * `satisfies Record<MeasurementCapability, unknown>` in
 * `web-bluetooth/src/type-safety.test.ts` is what stops this drifting from the
 * union; the mapped type below is what stops it drifting from the sink.
 */
export interface MeasurementValueFor {
  readonly power: Watts;
  readonly cadence: RevolutionsPerMinute;
  readonly 'heart-rate': BeatsPerMinute;
  readonly speed: MetresPerSecond;
}

/**
 * Where a decoder puts what it found.
 *
 * Every method is safe to call at any time: a value for a capability the device
 * did not declare, or one that arrives after the link dropped, is discarded by
 * the adapter rather than raised. A decoder is parsing untrusted bytes from a
 * device that may not be what it claims (SECURITY.md), and giving it an error
 * path to get wrong would be the larger risk.
 */
export type MeasurementSink = {
  readonly [Capability in MeasurementCapability]: (value: MeasurementValueFor[Capability]) => void;
};

/**
 * One GATT characteristic this program knows how to read.
 *
 * Registered with the adapter at construction. #41 supplies Heart Rate and
 * Cycling Speed and Cadence, #42 Cycling Power, #43 FTMS; #40 supplies none,
 * because a profile that lands in the adapter rather than in its own issue
 * arrives without the specification reading that makes it correct.
 */
export interface GattProfile {
  /**
   * The primary service, as a canonical lowercase 128-bit UUID.
   *
   * The browser normalises `0x180d` and `'heart_rate'` to
   * `'0000180d-0000-1000-8000-00805f9b34fb'` before it compares anything, so
   * the adapter keeps the canonical form and never compares two spellings of
   * the same service — see `canonicalUuid`.
   */
  readonly service: GattUuid;
  readonly characteristic: GattUuid;
  /**
   * What a notification from this characteristic can carry.
   *
   * Declared rather than inferred from what `decode` happens to call, because
   * the adapter has to choose a source for each capability **before** the first
   * notification arrives: subscribing to power must start notifications on the
   * characteristic that will carry it, not on whichever one turns out to.
   */
  readonly capabilities: readonly MeasurementCapability[];
  /**
   * What this service lets the program **do**, as opposed to report.
   *
   * Kept separate from `capabilities` rather than merged into it, because a
   * `MeasurementCapability` is a quantity with a `MeasurementSink` method and a
   * `MeasurementValueFor` entry, and `trainer-control` has neither — merging
   * them would make `MeasurementSink`, a mapped type over that union, demand a
   * method for something that carries no value.
   *
   * It exists so a request naming **only** a control capability still resolves
   * to a service (#156). Until then it could not: a request was mapped onto
   * services through `capabilities` alone, so
   * `discover({ capabilities: ['trainer-control'] })` threw
   * `capability-unsupported` against a trainer whose control point was right
   * there, and trainer control reached the grant only because `apps/web`'s
   * trainer role incidentally asked for power. A safety-relevant grant that
   * depends on a *measurement* being wanted is an accident — narrowing the role
   * would have removed the ability to control the trainer with no diagnosis
   * beyond `capability-unsupported` on a device the athlete deliberately paired
   * as a trainer.
   *
   * ⚠️ **Declaring it does not make control reachable.** It widens what a
   * *request* may name, and therefore which service lands in `optionalServices`
   * and in the grant. Whether the device is actually controllable is still
   * observed on the link, from the Fitness Machine Control Point answering
   * (`Link.controllable` in `web-bluetooth/src/transport.ts`), and the control
   * point is still refused outside the grant (#152).
   */
  readonly controls?: readonly ControlCapability[] | undefined;
  /**
   * A characteristic read **once when the link comes up**, whose value narrows
   * {@link capabilities} to what this particular device says it can report.
   *
   * ## Why the static list is not enough — #134, and #42's sixth criterion
   *
   * {@link capabilities} is a property of the *profile*: every Cycling Power
   * meter can in principle report cadence, so the profile declares it. Whether
   * *this* meter can is a property of the device, and until #134 nothing asked
   * it — a single-sided crank meter with no wheel magnet had `cadence` and
   * `speed` claimed on its behalf because the Measurement characteristic
   * existed.
   *
   * The consequence is the one #134 names: with only per-frame flags to go on,
   * **"this trainer has no cadence" and "cadence dropped out" are the same
   * observation.** A device that reports crank revolutions only while the crank
   * turns looks identical to one that cannot report them at all, so a screen
   * either shows a control that will never produce a number or hides one that
   * would.
   *
   * ⚠️ **Optional, and absent is not "declares nothing".** A profile without a
   * `describe` keeps its full {@link capabilities}, because that is what the
   * three profiles predating this did and narrowing them on the strength of a
   * characteristic they do not serve would remove capabilities that work today.
   * Heart Rate has no equivalent characteristic to read; FTMS has one and
   * reaches it another way (`transport.openFitnessMachine`).
   *
   * ⚠️ **A failed read is not an empty declaration either.** The adapter keeps
   * the full list when the characteristic is missing or unreadable — a device
   * that serves Measurement and not Feature is out of spec but common, and
   * refusing it every capability would be worse than trusting the profile.
   */
  readonly describe?:
    | {
        readonly characteristic: GattUuid;
        /**
         * What this device declares it can report.
         *
         * @param value the characteristic's own `DataView`, read once.
         * @returns a subset of {@link capabilities}. The adapter intersects the
         * two rather than trusting this outright, so a decoder cannot widen a
         * profile past what it declared it could decode.
         * @throws anything. The adapter treats a throw as "unreadable" and
         * keeps the full list, for the reason above.
         */
        declared(value: DataView): readonly MeasurementCapability[];
      }
    | undefined;

  /**
   * Turn one notification into zero or more measurements.
   *
   * @param value the characteristic's own `DataView`. **Not a copy** — copying
   * it would be an allocation per notification. A decoder must not retain it:
   * the browser reuses the underlying buffer for the next notification, so a
   * retained view reads the wrong payload a second later.
   * @param sink reused across notifications, and **distinct per characteristic
   * per link** — `web-bluetooth/src/transport.ts` builds one in `buildLive` and
   * never again, and a new link builds a new one. A decoder must not retain a
   * strong reference to it. `derivation.ts` uses that identity, weakly, as the
   * key under which a stateful profile keeps its previous reading; see the
   * header there for why nothing else in the seam can serve.
   * @param at when the transport received this notification, from the
   * transport's own clock — the same instant the sink will stamp on every
   * measurement out of this frame.
   *
   * **Added by #41.** #40 stamped the instant on the envelope and did not pass
   * it down, because no profile existed yet that needed it. Every profile #41
   * and #42 deliver does: a cadence or a speed is a difference against a
   * `uint16` event counter that laps every 32 or 64 seconds, and
   * `eventTimeIntervalIsAmbiguous` needs the **wall-clock** gap to tell one lap
   * from none. Without it a decoder would have to read a clock of its own,
   * which would put a `Date` inside the one directory that has no platform
   * surface and would step around the injectable `now` that makes the adapter's
   * own timing testable. A decoder that does not need it declares two
   * parameters and stays assignable.
   *
   * @throws anything. A hostile or malformed payload is expected, and the
   * adapter treats a throw as "this notification is unreadable", drops it and
   * carries on — a decoder is not required to be defensive as well as correct.
   */
  decode(value: DataView, sink: MeasurementSink, at: UnixSeconds): void;
}
