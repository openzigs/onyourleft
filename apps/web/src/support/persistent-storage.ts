// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ask the browser not to evict this rider's history (#409).
 *
 * ## Why this is in an offline epic at all
 *
 * Measured against the shipped build on 2026-09-19:
 * **`navigator.storage.persisted()` returns `false`**, with a quota of
 * 5,368,782,848 bytes. Every ride this app has ever stored is on the browser's
 * **best-effort** tier, and under storage pressure a browser evicts the
 * least-recently-used origin's data — IndexedDB and Cache Storage together,
 * all-or-nothing per origin
 * ([web.dev](https://web.dev/articles/persistent-storage), read 2026-09-19).
 *
 * A rider losing their entire history to eviction is the worst possible outcome
 * of a local-first design, and the link runs through *this* epic specifically:
 * Chrome grants persistence silently on a heuristic that includes **the site
 * having been installed or bookmarked**, so the manifest (#405) and the worker
 * (#406) are what make the request likely to be granted. ⚠️ That heuristic was
 * read from 2026 secondary sources rather than from Chromium source; treat the
 * mechanism as documented and the thresholds as reported.
 *
 * ## ⚠️ ADR 0011 does not forbid this, and the reason is worth not re-deriving
 *
 * [ADR 0011](../../../../docs/adr/0011-stream-storage.md) lines 54 and 236
 * record that `navigator.storage.estimate()` is deliberately **not** used, for
 * two reasons — it is *"unavailable in the test environment"*, and it *"reports
 * a browser-quota figure that includes the origin's other storage rather than
 * this ride's cost"*. Both are statements about **measuring** storage.
 * `persist()` is a different API answering a different question: it **requests
 * durability** and returns a boolean about eviction policy. Neither reason
 * transfers, ADR 0024 D-5 says so, and this paragraph is here so the next
 * reader does not read ADR 0011 as forbidding it.
 *
 * ## What it is not
 *
 * Persistence protects against **automatic** eviction and against nothing else.
 * It does not survive a rider clearing site data, and in a private window
 * `persist()` always resolves `false`. `AboutView` already tells riders the
 * honest consequence and the account export (#35) is the real backstop; the
 * copy in `PersistenceNotice.tsx` says both halves and its test asserts each by
 * string, so the reassuring one cannot ship without the honest one.
 */

/** The half of `StorageManager` this module uses. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

/** What the browser says about this origin's storage. */
export type PersistenceState =
  /** Exempt from automatic eviction. */
  | 'persistent'
  /** The browser may evict this origin's data under pressure. */
  | 'best-effort'
  /** No Storage API here at all, so there is nothing to ask and nothing to say. */
  | 'unsupported';

/**
 * Whether this origin is already persistent, asking nothing.
 *
 * `readAvailability`'s posture, and its reason: a probe that **throws** is
 * treated as unsupported rather than as a failure, because a browser that
 * exposes the object and refuses the call is telling us it does not have the
 * feature, in the only way it can.
 */
export async function readPersistence(
  storage: StorageManagerLike | undefined,
): Promise<PersistenceState> {
  if (typeof storage?.persisted !== 'function') {
    return 'unsupported';
  }
  try {
    return (await storage.persisted()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

/**
 * Ask for persistence, once.
 *
 * ⚠️ **Once per session, and that is a decision rather than an accident.** The
 * documented way to be re-evaluated by Chrome's heuristic is to ask again
 * *later* — after the rider has engaged with the site, installed it, or
 * bookmarked it — and a caller that asked in a loop would be a caller that
 * never stops being denied. `requestOnce` below is where "once" lives;
 * `requestPersistence` itself is the single honest attempt.
 */
export async function requestPersistence(
  storage: StorageManagerLike | undefined,
): Promise<PersistenceState> {
  const already = await readPersistence(storage);
  if (already !== 'best-effort' || typeof storage?.persist !== 'function') {
    // Already persistent, or there is nothing to ask. Asking again when the
    // answer is already yes is a prompt some browsers will show a rider for no
    // reason.
    return already;
  }
  try {
    return (await storage.persist()) ? 'persistent' : 'best-effort';
  } catch {
    // A refusal is an ordinary answer and the app is fully usable after one.
    return 'best-effort';
  }
}

/**
 * The one request this tab makes.
 *
 * Memoised on the promise rather than on the result, so two callers racing at
 * start-up share one request instead of making two.
 */
let inFlight: Promise<PersistenceState> | undefined;

export function requestPersistenceOnce(
  storage: StorageManagerLike | undefined,
): Promise<PersistenceState> {
  inFlight ??= requestPersistence(storage);
  return inFlight;
}

/**
 * Forget that this tab asked.
 *
 * @unwired Test support in production clothing, and it stays here rather than
 * in `testing.ts` because the state it clears is this module's own: a `let` in
 * module scope outlives a test, so without this the second test in a file would
 * read the first one's answer. Nothing in the client calls it and nothing
 * should — asking twice in one session is the loop the memo exists to prevent.
 */
export function forgetPersistenceRequest(): void {
  inFlight = undefined;
}

/** Reads the real global. The one impure function here. */
export function platformStorage(): StorageManagerLike | undefined {
  return (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage;
}
