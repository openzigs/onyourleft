// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Finding the end-of-ride question's answers in a test — #2349.
 *
 * Since #2349 *End ride* asks (`ride/EndRideQuestion.tsx`) rather than ends,
 * so every test that ended a game ride with one press now answers the
 * question too. ⚠️ **Throws when the answer is not there**, unlike the
 * `clickThrough(undefined)` the game's tests tolerate for an optional control:
 * an answer that silently did nothing would leave the ride running and the
 * test reading a picker that never came back.
 */

/** What the question's buttons say. */
export type EndRideAnswer = 'Save ride' | 'Discard ride' | 'Keep riding' | 'End ride';

/** The answer named `answer` in the open question under `root`. */
export function endRideAnswer(root: ParentNode, answer: EndRideAnswer): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('[data-oyl-end-ride] button')].find(
    (button) => (button.textContent ?? '').trim() === answer,
  );
  if (found === undefined) {
    const offered = [...root.querySelectorAll('[data-oyl-end-ride] button')].map((button) =>
      (button.textContent ?? '').trim(),
    );
    throw new Error(`no “${answer}” in the end-of-ride question; it offers: ${offered.join(', ')}`);
  }
  return found;
}
