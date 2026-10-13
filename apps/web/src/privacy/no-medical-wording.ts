// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The check behind ADR 0048 D-12's banned-word list** —
 * [#1245](https://github.com/openzigs/onyourleft/issues/1245), the owner's Q12
 * on #1233: *"The banned-word list, a source scan for it, and a reviewer
 * checklist."*
 *
 * ## Why these words
 *
 * The same function is a medical device when its intended purpose is medical,
 * and intended purpose is read from what a product says about itself (#1233
 * §8, spike 0008 §4.3). A heart-rate hold is for training: *"to help you ride
 * at the effort you chose"*. So no string a rider could be shown says any of
 * {@link BANNED_WORDS}, in any case, with the inflections each entry names.
 *
 * ## What it reads
 *
 * Exactly what `camera/no-absolute-angles.ts` reads, with its reader
 * (`renderedTextFindings`): every string literal, every template literal's
 * text and every piece of JSX text, and then every JSX element **whole**, so
 * a word split across elements (`<p>car<b>diac</b></p>`) is read as the word
 * it renders. Character references in JSX are decoded, and **invisible
 * characters are removed before anything is matched** (a sentence wrapped
 * across a `+` chain of literals is read whole, as Prettier wraps long ones;
 *`visibleText` of
 * `@onyourleft/analysis`): a soft hyphen or a zero-width space inside a word
 * renders as nothing and would otherwise split it. An identifier and a comment
 * are never in scope, which is why this file's prose can name the words.
 *
 * ## What it cannot see
 *
 * - **A heart-rate number called a limit for health or safety, and a claim to
 *   prevent, treat or reduce the risk of anything.** D-12 forbids both and
 *   neither is a word list: *limit* and *risk* are ordinary words elsewhere
 *   in this client. The modules that hold workout sentences test their own
 *   (`workout/hold-text.test.ts`, `workout-goals/form.test.ts`,
 *   `workout/replan-disclosure.test.ts`), and a reviewer reads the rest.
 * - **A word assembled at run time**, or split around an expression the scan
 *   cannot read (`<p>car{x}diac</p>`).
 * - **What a model is told.** The prompts in `@onyourleft/analysis` and in
 *   `apps/instance` are instructions to a model, not text a rider is shown,
 *   and they use one of these words to forbid it (*"Do not name any illness,
 *   injury or medical condition"*). They are not scanned.
 * - **Anything a rider reads that is not in the scanned trees**: the Play
 *   listing, the README and release notes. Those are the reviewer checklist's
 *   (`apps/mobile/RELEASE.md` §4), which spike 0008 §8 records as unscanned.
 *
 * A green scan is evidence these words are absent, and of nothing else.
 */

import { visibleText } from '@onyourleft/analysis';

import { renderedTextFindings } from '../camera/no-absolute-angles';

/**
 * ADR 0048 D-12's list, word for word, each with the pattern that finds it.
 * Adding or removing one is a change to that decision, not an edit here.
 *
 * Each pattern is matched against text with its invisible characters removed
 * and is case-insensitive. A phrase's words may be parted by any white space
 * or a hyphen, because that is how a line break or a non-breaking space
 * renders.
 */
export const BANNED_WORDS = [
  { word: 'cardiac', pattern: /\bcardiac\b/i },
  { word: 'heart condition', pattern: /\bheart[\s-]+conditions?\b/i },
  // The noun, the verb, and the short form a rider would read as the same word.
  { word: 'rehabilitation', pattern: /\brehab(?:s|ilitat\w*)?\b/i },
  { word: 'patient', pattern: /\bpatients?\b/i },
  { word: 'therapy', pattern: /\btherap(?:y|ies|ist|ists|eutic|eutics)\b/i },
  { word: 'safe heart rate', pattern: /\bsafe[\s-]+heart[\s-]+rates?\b/i },
  { word: 'protects your heart', pattern: /\bprotect(?:s|ed|ing)?[\s-]+your[\s-]+heart\b/i },
  { word: 'medical', pattern: /\bmedical(?:ly)?\b/i },
  { word: 'clinical', pattern: /\bclinical(?:ly)?\b/i },
] as const satisfies readonly { readonly word: string; readonly pattern: RegExp }[];

/** One of {@link BANNED_WORDS}' `word`s. */
export type BannedWord = (typeof BANNED_WORDS)[number]['word'];

/** One piece of rendered text that carries a banned word. */
export interface MedicalWordingFinding {
  readonly file: string;
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  readonly text: string;
  /** The first banned word the text carries, as D-12 spells it. */
  readonly word: BannedWord;
}

/** The first banned word `text` carries, invisible characters removed; `undefined` for none. */
export function bannedWordIn(text: string): BannedWord | undefined {
  const visible = visibleText(text);
  return BANNED_WORDS.find(({ pattern }) => pattern.test(visible))?.word;
}

/** Every piece of one file's rendered text that carries a banned word. */
export function medicalWordingIn(file: string, source: string): readonly MedicalWordingFinding[] {
  return renderedTextFindings(file, source, bannedWordIn).map(({ line, text, rule }) => ({
    file,
    line,
    text,
    word: rule,
  }));
}

/**
 * What is excused, where, and why — each entry names the file and **the whole
 * of the text** it excuses (equality, never containment), as
 * `no-absolute-angles.ts` §`EXEMPT` does and for its reason. An entry is a
 * decision a reviewer reads, and one that excuses nothing fails the gate.
 */
export const EXEMPT: readonly {
  readonly file: string;
  readonly text: string;
  readonly why: string;
}[] = [
  {
    file: 'detail/write-up.ts',
    text: 'This app did not write it and cannot check it. It can be wrong. It is not medical advice.',
    why: 'ADR 0035 D-9 A, the owner’s approved framing above every model-written write-up, word for word: it is about an analysis, not a workout, and it disclaims rather than claims (ADR 0035 D-9, "A says not medical advice")',
  },
];

/** Whether a finding is one {@link EXEMPT} excuses: the same file and the same whole text. */
export function isExempt(finding: MedicalWordingFinding): boolean {
  return EXEMPT.some((entry) => entry.file === finding.file && finding.text === entry.text);
}
