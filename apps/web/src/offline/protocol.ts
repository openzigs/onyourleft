// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one thing a page and the service worker say to each other (#407).
 *
 * ⚠️ **Its own module rather than a constant in `worker-core.ts`, and
 * `check:wiring` is what made that obvious.** The page imports this to send it
 * and the worker imports it to recognise it, so a copy in the worker's
 * internals would put `update.ts` — production code, reachable from
 * `main.tsx` — on the far side of the seam that separates the two programs,
 * dragging the whole worker into the client's module graph. It is also the
 * better shape on its own terms: this is a **protocol**, and a protocol with
 * two implementations belongs to neither of them.
 *
 * There is exactly one message, in one direction, and that is deliberate.
 * ADR 0024 §"What would make this ADR wrong" names an accumulating worker as
 * the signal that a library would have been the better choice; a second message
 * type here is the same signal one layer down.
 */

/**
 * "Stop waiting and take over."
 *
 * Sent only from {@link ./update.ts}'s `activate`, which is reached only from a
 * rider's click, and only when no ride is in progress — ADR 0024 D-3 rules 2
 * and 3. The worker's `message` handler is the only reader.
 */
export const SKIP_WAITING_MESSAGE = 'OYL_SKIP_WAITING';
