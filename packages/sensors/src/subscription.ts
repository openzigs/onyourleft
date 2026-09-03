// SPDX-License-Identifier: Apache-2.0

/**
 * How a caller stops listening.
 *
 * A returned function rather than a `removeListener(fn)` pair. The pair form
 * requires the caller to keep the exact function reference alive, and the
 * commonest bug it produces — passing a fresh arrow to the remover — silently
 * removes nothing and leaks the subscription for the life of the page. In a
 * program that subscribes to a 1 Hz notification stream from three devices, a
 * leaked listener is not a tidiness problem.
 */

/** Stop a subscription. Calling it more than once is safe and does nothing. */
export type Unsubscribe = () => void;

/** Receives each value a stream produces. */
export type Listener<T> = (value: T) => void;
