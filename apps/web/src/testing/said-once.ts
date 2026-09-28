// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many times a screen says something, and in how many live regions —
 * #670's review.
 *
 * `textContent.toContain` cannot see a message rendered twice: #670's first
 * cut of the Routes screen said every refusal and every save twice, in two
 * live regions, so a screen reader announced each of them twice, and every
 * test on the screen was green. These count instead.
 *
 * Test support: imported only by tests.
 */

/**
 * What makes an element a live region: `aria-live` itself, or a role whose
 * implicit `aria-live` is not `off` (WAI-ARIA 1.2 §6.3.14). `StatusMessage`'s
 * `live` writes `role="status"`.
 */
export const LIVE_REGION_SELECTOR = '[aria-live], [role="status"], [role="alert"], [role="log"]';

/** How many times `text` occurs in `root`'s text. */
export function timesSaid(root: Element, text: string): number {
  if (text === '') {
    throw new Error('timesSaid: an empty string occurs everywhere');
  }
  return (root.textContent ?? '').split(text).length - 1;
}

/** How many live regions under `root` carry `text`, outermost only. */
export function liveRegionsSaying(root: Element, text: string): number {
  return [...root.querySelectorAll(LIVE_REGION_SELECTOR)].filter(
    (region) =>
      (region.textContent ?? '').includes(text) &&
      (region.parentElement?.closest(LIVE_REGION_SELECTOR) ?? null) === null,
  ).length;
}
