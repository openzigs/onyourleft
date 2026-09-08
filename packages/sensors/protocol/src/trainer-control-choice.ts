// SPDX-License-Identifier: Apache-2.0

/**
 * Which control point a trainer is driven through, when it offers more than
 * one — #90 criterion 7.
 *
 * A smart trainer made in the last few years serves the Fitness Machine Service
 * (`0x1826`). One made before FTMS existed serves its manufacturer's own
 * controllable characteristic instead, and several serve **both** — the
 * standard one for everybody else's software, the proprietary one for the
 * manufacturer's own app. So a client meeting such a device has a choice to
 * make, and it must not make it by accident.
 *
 * **The rule is: a standard controllable service wins outright.**
 * `fitness-machine-control.ts` already adopted it in prose — *"prefer a
 * standard controllable service and fall back only when none was found"* — and
 * this is the function that makes it a decision something can test. It costs
 * nothing: it is also what stops a machine's control disappearing the day its
 * firmware gains FTMS.
 *
 * ## What happens when only the proprietary one is there
 *
 * It is reported, and it is **not driven**. This program implements no vendor
 * control protocol, and `fitness-machine-control.ts` §"What is deliberately not
 * implemented" says why in detail: two independent open-source implementations
 * of the Wahoo characteristic disagree by a factor of ten on the
 * rolling-resistance scaling, and CLAUDE.md §6 makes writing an unverifiable
 * scaling to a brake a safety question rather than a completeness one. So
 * {@link TrainerControlChoice} has a third arm that says *there is a control
 * point here and this program will not use it*, which a UI can turn into "this
 * trainer records fine but cannot be controlled" — a different and much more
 * useful sentence than "no trainer control found".
 *
 * ## ⚠️ The vendor UUID below is secondary-sourced, and that is safe here
 *
 * Wahoo publishes no specification for it. {@link WAHOO_TRAINER_CONTROL_POINT}
 * was corroborated from community documentation and open-source
 * implementations — **read, never copied**, per CLAUDE.md §6 — and it has not
 * been checked against hardware or against any primary source, unlike every
 * SIG-assigned number in this directory (`index.ts` records where those were
 * read from and when).
 *
 * That is acceptable **because of where the value is used**. It is only ever
 * *recognised*, never written to, so the whole failure mode of a wrong
 * transcription is that a proprietary control point goes unnoticed and this
 * function answers `none` instead of `vendor-not-implemented`. A rider gets a
 * less specific message. Nothing reaches a brake either way, which is the
 * property that decides whether an unverified byte may be used at all.
 */

import { FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_SERVICE } from './fitness-machine';
import { canonicalUuid, type GattUuid } from './uuid';

/**
 * Wahoo's proprietary trainer control characteristic.
 *
 * It lives **inside the standard Cycling Power Service (`0x1818`)** rather than
 * in a service of its own, which is why this is a characteristic UUID and why
 * "does the device serve `0x1818`" is not the question — a plain power meter
 * serves that too.
 *
 * ⚠️ Secondary-sourced. See the header for why that is tolerable for this one
 * value and for nothing else in this directory.
 */
export const WAHOO_TRAINER_CONTROL_POINT: GattUuid = canonicalUuid(
  'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
);

/** How this program will control a machine, if at all. */
export type TrainerControlChoice =
  | {
      readonly kind: 'fitness-machine';
      readonly service: GattUuid;
      readonly controlPoint: GattUuid;
      /**
       * The machine also carries a proprietary control point, and it is being
       * passed over.
       *
       * Reported rather than ignored: it is the observable half of the
       * precedence rule, and it is what a bug report about a trainer that
       * behaves differently under two apps would want to say.
       */
      readonly vendorAlsoPresent: boolean;
    }
  | {
      readonly kind: 'vendor-not-implemented';
      readonly controlPoint: GattUuid;
    }
  | { readonly kind: 'none' };

/**
 * Choose the control point, from everything the link resolved.
 *
 * `resolved` is a flat iterable of **service and characteristic UUIDs
 * together** — deliberately, because the two candidates are not the same kind
 * of thing: FTMS is a service that carries a control point, and the vendor's is
 * a characteristic inside a service that is mostly not about control. A caller
 * hands over what it found and does not have to sort them first. Either form of
 * a UUID is accepted; both are normalised, so a registry written `0x1826` and a
 * browser reporting the 128-bit form are the same entry rather than two.
 *
 * @throws {RangeError} from {@link canonicalUuid}, for a UUID that is neither a
 * 16-bit assigned number nor a 128-bit UUID. A silently ignored misspelling
 * would be a controllable trainer reported as uncontrollable.
 */
export function chooseTrainerControl(resolved: Iterable<GattUuid | number>): TrainerControlChoice {
  const uuids = new Set<GattUuid>();
  for (const value of resolved) {
    uuids.add(canonicalUuid(value));
  }
  const vendor = uuids.has(WAHOO_TRAINER_CONTROL_POINT);
  // The service alone is enough: FTMS makes the control point mandatory, and a
  // caller that resolved the service but not yet its characteristics has still
  // found a standard machine. Accepting the control point on its own as well
  // costs nothing and covers a caller that lists characteristics only.
  if (uuids.has(FITNESS_MACHINE_SERVICE) || uuids.has(FITNESS_MACHINE_CONTROL_POINT)) {
    return {
      kind: 'fitness-machine',
      service: FITNESS_MACHINE_SERVICE,
      controlPoint: FITNESS_MACHINE_CONTROL_POINT,
      vendorAlsoPresent: vendor,
    };
  }
  if (vendor) {
    return { kind: 'vendor-not-implemented', controlPoint: WAHOO_TRAINER_CONTROL_POINT };
  }
  return { kind: 'none' };
}
