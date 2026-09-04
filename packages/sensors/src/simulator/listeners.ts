// SPDX-License-Identifier: Apache-2.0

/**
 * A listener list that survives a listener unsubscribing itself mid-notify.
 *
 * The same shape `../session.ts` keeps privately, for the same reason: a
 * subscriber that unsubscribes from inside its own callback mutates the array
 * being iterated, and without the copy in `emit` the next listener is skipped.
 * Kept here rather than exported from `session.ts` because #44 touches nothing
 * #39 shipped — the simulator is the second implementation of that interface,
 * and a second implementation that had to change the first is the finding this
 * issue exists to surface, not something to do quietly in passing.
 */

import type { Listener, Unsubscribe } from '../subscription';

export interface ListenerList<T> {
  add(listener: Listener<T>): Unsubscribe;
  emit(value: T): void;
}

export function listenerList<T>(): ListenerList<T> {
  const listeners: Listener<T>[] = [];
  return {
    add(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(value) {
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
  };
}
