// SPDX-License-Identifier: Apache-2.0

/**
 * Deciding which devices to connect to, under a budget that is smaller than it
 * looks.
 *
 * ## The constraint
 *
 * There is no specified limit on simultaneous BLE connections. WebBluetoothCG
 * issue #342 has been open since 2016 without one, reported evidence ranges from
 * three to seven, **and the budget is OS-wide rather than per-application** — it
 * is shared with the athlete's earbuds, their watch and anything else paired.
 * CLAUDE.md §8 settles it for this program: *"Plan for ~3 concurrent
 * connections, not 7."*
 *
 * Three is exactly the number a naive pairing flow spends: trainer, heart-rate
 * strap, power meter. It leaves nothing for a cadence sensor and nothing for the
 * earbuds.
 *
 * ## The design rule this function encodes
 *
 * **Prefer taking power and cadence from the trainer's own FTMS Indoor Bike Data
 * stream over opening separate sensor connections.** A modern trainer already
 * reports power, cadence and speed, so connecting a separate power meter as well
 * buys a second opinion and costs a third of the budget.
 *
 * #39 asks for that to be *"the natural expression, not the awkward one"*, so it
 * is a function rather than a paragraph. A caller asks for the capabilities it
 * needs and gets the smallest set of devices that supplies them; the trainer
 * wins because it covers three capabilities in one connection, and no caller has
 * to know that is why.
 *
 * ## The algorithm, and its honest limits
 *
 * Greedy set cover: repeatedly take the device that supplies the most
 * still-unsatisfied capabilities, until everything is satisfied or the budget is
 * spent. Ties go to the earlier device in the input, so the result is
 * deterministic and a caller can order the input by preference — most recently
 * used, say — and have that respected.
 *
 * Greedy set cover is not optimal in general. It is optimal often enough at this
 * size (a handful of devices, five capabilities) and, more to the point, it is
 * *explicable*: an athlete can be shown "using your trainer for power and
 * cadence" and it will be true. An exact solver would occasionally save one
 * connection and would never be explicable.
 *
 * What this deliberately does **not** do:
 *
 * - It does not rank two devices that cover the same set by signal strength,
 *   battery or accuracy. Ranking needs data this layer does not have.
 * - It does not know which devices are already connected. Preferring an existing
 *   connection is real, and it belongs to whichever issue builds the pairing UI,
 *   which is the layer that knows.
 */

import type { SensorCapability } from './capability';
import { deviceProvides, type SensorDevice } from './device';

/**
 * How many devices to plan for at once.
 *
 * CLAUDE.md §8. Not a limit this program enforces on the platform — the platform
 * enforces its own, and refuses a connection when it is out — but the number to
 * design against, because a UI that lets an athlete pair five sensors and then
 * fails on the fourth has already failed.
 */
export const MAX_RECOMMENDED_CONCURRENT_CONNECTIONS = 3;

/** What the caller needs. */
export interface CapabilityPlanRequest {
  /**
   * The capabilities to satisfy, in priority order.
   *
   * Priority matters only when the budget runs out: what cannot be satisfied is
   * reported rather than silently dropped, and the later entries are the ones
   * that go unsatisfied first.
   */
  readonly required: readonly SensorCapability[];
  /**
   * How many connections may be opened. Defaults to
   * `MAX_RECOMMENDED_CONCURRENT_CONNECTIONS`.
   */
  readonly budget?: number;
}

/** One capability, and the device chosen to supply it. */
export interface CapabilityAssignment {
  readonly capability: SensorCapability;
  readonly device: SensorDevice;
}

/** Which devices to connect to, and what each is for. */
export interface CapabilityPlan {
  /**
   * The devices to connect to, in the order they were chosen — which is
   * most-covering first, so the trainer comes before the strap.
   */
  readonly connections: readonly SensorDevice[];
  /** Every satisfied capability and the device supplying it. */
  readonly assignments: readonly CapabilityAssignment[];
  /**
   * Capabilities nothing available can supply, or that the budget could not
   * afford.
   *
   * Reported rather than thrown. Riding with a trainer and no heart-rate strap
   * is a normal ride, and a caller that treats an unsatisfied capability as
   * fatal has decided that for the athlete.
   */
  readonly unsatisfied: readonly SensorCapability[];
}

/**
 * Choose the fewest devices that supply the requested capabilities.
 *
 * A budget below one yields no connections and reports everything as
 * unsatisfied rather than throwing: "how much of this can I have with nothing
 * connected" is a question a caller may reasonably ask, and the answer is
 * "none of it".
 */
export function planCapabilitySources(
  devices: readonly SensorDevice[],
  request: CapabilityPlanRequest,
): CapabilityPlan {
  const budget = request.budget ?? MAX_RECOMMENDED_CONCURRENT_CONNECTIONS;
  // De-duplicated, because asking twice for power must not make it unsatisfiable
  // twice, and order-preserving, because `required` is in priority order.
  const outstanding = [...new Set(request.required)];

  const connections: SensorDevice[] = [];
  const assignments: CapabilityAssignment[] = [];

  while (outstanding.length > 0 && connections.length < budget) {
    let best: SensorDevice | undefined;
    let bestCoverage: readonly SensorCapability[] = [];

    for (const device of devices) {
      // No `connections.includes(device)` skip here. It read as a guard but could
      // never change the outcome, and deleting it left all 233 tests green
      // (PR #108 review): a device already chosen has had every capability it
      // covers spliced out of `outstanding`, so its coverage is empty, and
      // `0 > bestCoverage.length` is false from the first iteration because
      // `bestCoverage` starts empty. It executed on every pass — which is why
      // branch coverage still read 100% — while deciding nothing. A line that
      // cannot fail a test is not a guard, it is decoration that reads like one.
      const coverage = outstanding.filter((capability) => deviceProvides(device, capability));
      // Strictly greater, so a tie goes to the earlier device and the result is
      // deterministic for a given input order.
      if (coverage.length > bestCoverage.length) {
        best = device;
        bestCoverage = coverage;
      }
    }

    if (best === undefined) {
      // Nothing left covers anything still outstanding. Another connection
      // cannot help, so stop rather than spending the budget on it.
      break;
    }

    connections.push(best);
    for (const capability of bestCoverage) {
      assignments.push({ capability, device: best });
      outstanding.splice(outstanding.indexOf(capability), 1);
    }
  }

  return { connections, assignments, unsatisfied: outstanding };
}
