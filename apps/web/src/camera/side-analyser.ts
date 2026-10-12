// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which device looks at the side camera's pictures: this tablet, the
 * rider's own computer, or their instance** — [#553](https://github.com/openzigs/onyourleft/issues/553),
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-11, and
 * [#1106](https://github.com/openzigs/onyourleft/issues/1106) for the instance.
 *
 * ## The instance — #1106
 *
 * The owner's ruling (#1092 ruling 1) moves this path to the rider's
 * instance: `instance-pose.ts` holds its two switches, both off by default,
 * and its estimator. ⚠️ **The computer path below is still here**: #1103
 * removes it, and waits for this to land. Until then the two cannot both be
 * on — the Camera page switches one off when the other goes on — and if a
 * device somehow holds both, {@link chooseSideAnalyser} takes the instance:
 * it is the one whose pictures are sealed on the way.
 *
 * ## Its own switch, off by default
 *
 * D-11: *"choosing the computer here is its own switch, off by default, with
 * its own consent sentence"*. #387's switch says a picture may go to the
 * computer **when the rider presses a button**. This one says every
 * side-camera picture goes there as it arrives — about five a second — which
 * is a different promise, so it is a different stored answer under a
 * different key, and it is `false` on every device until the rider ticks it
 * beside {@link SIDE_ANALYSER_CONSENT}.
 *
 * ⚠️ **It sends nothing on its own.** The computer is used only when this is
 * on AND #387's computer is saved AND switched on — {@link chooseSideAnalyser}
 * is handed `riderAnalysisPort`'s answer, which is `undefined` otherwise. Off,
 * or with no computer, every picture is looked at on the tablet as before.
 *
 * ## Chosen once per pairing, stopped at once
 *
 * `main.tsx` asks when a pairing's analysis is built. Switching ON mid-session
 * does not move pictures to the computer halfway through a ride; the next
 * pairing reads it again. Switching OFF — this switch or #387's, or
 * forgetting the computer — stops the very next picture being sent.
 */

import type { AnalysisPort } from './analysis-port';
import { computerPoseEstimator } from './computer-pose';
import type { EndpointStorage } from './analysis-endpoint';
import { deviceEndpointStorage } from './analysis-endpoint';
import type { SidePoseEstimator } from './side-analysis-port';

/** The one key this lives under, versioned for the reason `announce-preference.ts` gives. */
export const SIDE_ANALYSER_STORAGE_KEY = 'oyl.side-analyser-computer.v1';

/**
 * The consent sentence shown beside the switch, verbatim.
 *
 * ⚠️ **ADR 0033 D-11's draft, word for word**, which the author wrote for the
 * owner to rule on. The owner's ruling on #553 did not reword it, so it ships
 * as drafted; a rewording is an edit here and in `docs/privacy-policy.md` in
 * the same change.
 */
export const SIDE_ANALYSER_CONSENT =
  'While the side camera is filming, every picture it takes — about five a second — goes to your ' +
  'computer, instead of being looked at on this tablet. What your computer does with them is up ' +
  'to your computer.';

/** Whether the rider has switched the side camera over to their computer. `false` unless exactly so. */
export function readSideAnalyserOnComputer(
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): boolean {
  try {
    return storage?.getItem(SIDE_ANALYSER_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Stores the rider's answer. Switching off REMOVES the row rather than writing
 * `off`, so a device that switched it off holds nothing about it. `false` when
 * this device would not keep the answer, which leaves it off.
 */
export function writeSideAnalyserOnComputer(
  on: boolean,
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    if (on) {
      storage.setItem(SIDE_ANALYSER_STORAGE_KEY, 'on');
    } else {
      storage.removeItem(SIDE_ANALYSER_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/** Where the pictures are looked at, which the side-camera screen says in words. */
export type SideAnalyserPlace = 'tablet' | 'computer' | 'instance';

/** The choice: where, and how to make the estimator when the first picture arrives. */
export interface SideAnalyserChoice {
  readonly place: SideAnalyserPlace;
  readonly estimator: () => SidePoseEstimator;
}

/**
 * The computer when the rider switched this on and a computer is there to use;
 * the tablet otherwise.
 *
 * Both are read now, to choose — and, for the computer, read AGAIN for every
 * picture, so switching either off, or forgetting the computer, stops the
 * next picture being sent (`computer-pose.ts` §`computerPoseEstimator`). A
 * pairing that started on the computer then looks at nothing more; it does
 * not quietly move to the tablet mid-session, which would make the screen's
 * account of where pictures go false.
 *
 * The instance (#1106) is chosen the same way: when the rider switched it on
 * ({@link input.onInstance} answers `true`) and there is an instance to send
 * to ({@link input.instance} is given). Its estimator reads the switch again
 * for every picture too (`instance-pose.ts` §`instancePoseEstimator`).
 *
 * @param computer `riderAnalysisPort(readAnalysisEndpoint(), …)` — `undefined`
 * when no computer is saved, or it is saved and switched off.
 * @param instance how the instance's estimator is made — `undefined` on a
 * device with no instance to send to.
 */
export function chooseSideAnalyser(input: {
  readonly onComputer: () => boolean;
  readonly computer: () => AnalysisPort | undefined;
  readonly tablet: () => SidePoseEstimator;
  /**
   * ⚠️ **Required keys, though `instance` may be `undefined`**, so that a
   * caller which stops passing them does not compile: `check:wiring` cannot
   * see an optional option left out (`main.tsx` says so of two others).
   */
  readonly onInstance: () => boolean;
  readonly instance: (() => SidePoseEstimator) | undefined;
}): SideAnalyserChoice {
  if (input.instance !== undefined && input.onInstance()) {
    return { place: 'instance', estimator: input.instance };
  }
  const current = (): AnalysisPort | undefined =>
    input.onComputer() ? input.computer() : undefined;
  if (current() !== undefined) {
    return { place: 'computer', estimator: () => computerPoseEstimator(current) };
  }
  return { place: 'tablet', estimator: input.tablet };
}
