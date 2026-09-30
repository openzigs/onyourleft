// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One operation at a time per file (#37, #35).
 *
 * A blob is shared by every athlete who sent the same bytes, so the two
 * decisions that touch one — "store it and index it" and "nobody holds it any
 * more, remove it" — must not interleave. Without this, athlete A's failed
 * ingestion could find no row holding a file, and delete it, in the moment
 * between athlete B storing the same file and B's row committing: B's row
 * would then name a file that is gone.
 *
 * In-process, which is what one instance process is (ADR 0037 D-2). A second
 * process on the same database would need the database to arbitrate; that is
 * named as a limit in the pull request rather than handled here.
 */

export interface ContentLock {
  /** Run `operation` once every earlier operation on `key` has settled. */
  hold<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export function createContentLock(): ContentLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    hold: (key, operation) => {
      const before = tails.get(key) ?? Promise.resolve();
      const next = before.then(operation, operation);
      const tail = next.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return next;
    },
  };
}
