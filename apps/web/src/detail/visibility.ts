// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of a ride's charts the rider has scrolled to — #2068.
 *
 * The activity page draws one chart per recorded channel, stacked, and each
 * chart's stream is decoded only once its slot comes into view. That keeps
 * `detail/load.ts`'s read budget: a four-hour ride inflates the channels the
 * rider looks at, not every channel it stored, because `getStreamChannel`
 * is one inflate and decode of a whole blob.
 *
 * ## Seen once is seen
 *
 * A slot is reported the first time it intersects and is then unobserved. A
 * decoded trace is kept by the view, so scrolling a chart out of view and
 * back again costs no second read: the read this module exists to put off is
 * the one it must also not repeat.
 *
 * ## With no `IntersectionObserver`
 *
 * Every slot is reported at once. A browser that cannot say what is in view
 * would otherwise never draw a chart, and drawing every chart is what this page
 * did for every channel switched on before #2068. jsdom has no observer, so a
 * test that wants the budget installs a fake (`detail/testing.ts`
 * §`installFakeIntersectionObserver`).
 */

/**
 * How far outside the viewport a slot counts as in view: one short chart's
 * height above and below, so the next chart is read just before the rider
 * reaches it rather than as it arrives.
 */
export const SLOT_ROOT_MARGIN = '160px 0px';

/**
 * Report each key of `targets` once, the first time its element is in view.
 *
 * Returns the function that stops watching. `onSeen` is called with every key
 * that came into view in one observer callback, so a page that opens with
 * three charts on screen asks for all three in one update.
 */
export function watchUntilSeen<K>(
  targets: ReadonlyMap<K, Element>,
  onSeen: (keys: readonly K[]) => void,
): () => void {
  if (targets.size === 0) {
    return () => undefined;
  }
  if (typeof globalThis.IntersectionObserver !== 'function') {
    onSeen([...targets.keys()]);
    return () => undefined;
  }
  const keyOf = new Map<Element, K>();
  for (const [key, element] of targets) {
    keyOf.set(element, key);
  }
  const observer = new globalThis.IntersectionObserver(
    (entries) => {
      const seen: K[] = [];
      for (const entry of entries) {
        const key = keyOf.get(entry.target);
        if (!entry.isIntersecting || key === undefined) {
          continue;
        }
        observer.unobserve(entry.target);
        keyOf.delete(entry.target);
        seen.push(key);
      }
      if (seen.length > 0) {
        onSeen(seen);
      }
    },
    { rootMargin: SLOT_ROOT_MARGIN },
  );
  for (const element of keyOf.keys()) {
    observer.observe(element);
  }
  return () => {
    observer.disconnect();
  };
}
