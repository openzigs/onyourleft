// SPDX-License-Identifier: Apache-2.0

/**
 * A **proprietary** trainer control point, modelled only far enough to be
 * chosen against — #90 criterion 7.
 *
 * Several trainers made before the Fitness Machine Service existed carry a
 * vendor's own controllable characteristic, and some that carry FTMS carry the
 * old one alongside it for their manufacturer's own app. #90 asks for the rule
 * that follows: *where a device exposes both, FTMS is used*. That is a
 * **choice**, so something has to be able to observe it being made — a
 * simulated device serving both, and an assertion that the standard control
 * point is the one that got written to.
 *
 * ## What this deliberately is not
 *
 * - **Not an implementation of anybody's proprietary protocol.**
 *   `protocol/fitness-machine-control.ts` records why this program does not
 *   write to one: two independent open-source implementations disagree by a
 *   factor of ten on the rolling-resistance scaling, and writing an
 *   unverifiable scaling to a brake that a person is pushing against is the
 *   thing that file is careful about. So the requests here are a *shape*, and
 *   nothing in this program constructs one.
 * - **Not bytes, and not a UUID.** This directory bars both (`../../README.md`
 *   §"What lives here, and what does not"). The characteristic's identity is
 *   `protocol/`'s to know; here it is a service by name and a list of what was
 *   written to it, which is exactly what the assertion needs.
 *
 * The list staying **empty** through a whole simulated ride is the criterion.
 */

import type { GradePercent, Watts } from '@onyourleft/domain';

/**
 * A command written to a vendor control point.
 *
 * Modelled as the two a gradient simulator would need, so that a future client
 * that did drive one would have something to be tested against. Nothing in this
 * program produces one today.
 */
export type VendorControlRequest =
  | { readonly opCode: 'set-simulation-parameters'; readonly grade: GradePercent }
  | { readonly opCode: 'set-target-power'; readonly target: Watts };

export interface VendorControlPoint {
  /** The vendor's name, for a test's message. Never a UUID — see the header. */
  readonly vendor: string;
  write(request: VendorControlRequest): void;
  /** Everything written here. Empty on a device that also serves FTMS. */
  writes(): readonly VendorControlRequest[];
}

export function createVendorControlPoint(vendor: string): VendorControlPoint {
  const written: VendorControlRequest[] = [];
  return {
    vendor,
    write(request) {
      written.push(request);
    },
    writes: () => [...written],
  };
}
