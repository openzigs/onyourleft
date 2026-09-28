// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a route SAYS, as sentences — #666's first criterion.
 *
 * #666 moves each screen's longer explanation into a `<details>` beneath its
 * controls and deletes nothing. "Nothing" is only checkable against a record
 * of what was there, so this reads every sentence a route renders — tucked or
 * not: jsdom lays nothing out, and a closed `<details>` still holds its text —
 * and `a11y/route-sentences.a11y.test.tsx` holds every route to the record it
 * committed, taken on `main` before any screen was changed.
 *
 * ## How text becomes sentences
 *
 * Text is grouped by the nearest BLOCK that holds it — a paragraph, a list
 * item, a cell, a label — so that a sentence split across two inline
 * elements is still one sentence, and two paragraphs are never run together.
 * A block's text is then cut after a full stop, a question mark or an
 * exclamation mark that is followed by a space and a capital or an opening
 * quote. A sentence moved from one paragraph into another is still found; a
 * sentence reworded or deleted is not, which is the point.
 */

/** The elements whose text is one run of prose. Anything else is inline. */
const BLOCKS = new Set([
  'P',
  'LI',
  'DT',
  'DD',
  'TD',
  'TH',
  'CAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LEGEND',
  'SUMMARY',
  'FIGCAPTION',
  'BUTTON',
  'OPTION',
  'PRE',
  'BLOCKQUOTE',
  'DIV',
  'SECTION',
  'FORM',
  'FIELDSET',
  'MAIN',
  'UL',
  'OL',
  'DL',
  'TABLE',
  'TR',
  'DETAILS',
]);

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every block of text inside `root`, in document order, each normalised. */
export function textBlocks(root: Element): string[] {
  const runs = new Map<Element, string>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    let block: Element | null = node.parentElement;
    while (block !== null && block !== root && !BLOCKS.has(block.tagName)) {
      block = block.parentElement;
    }
    const owner = block ?? root;
    runs.set(owner, (runs.get(owner) ?? '') + (node.textContent ?? ''));
  }
  return [...runs.values()].map(normalise).filter((text) => text !== '');
}

/** A block cut into sentences. */
export function sentencesOf(block: string): string[] {
  return block
    .split(/(?<=[.!?…])\s+(?=[A-Z“"‘(])/u)
    .map(normalise)
    .filter((sentence) => sentence !== '');
}

/** Every distinct sentence under `root`, in first-seen order. */
export function sentencesIn(root: Element): string[] {
  const seen = new Set<string>();
  for (const block of textBlocks(root)) {
    for (const sentence of sentencesOf(block)) {
      seen.add(sentence);
    }
  }
  return [...seen];
}
