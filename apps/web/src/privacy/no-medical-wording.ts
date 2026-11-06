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
 * - **An inflection or a compound no entry names.** Each entry lists its own
 *   forms (`BANNED_WORDS`): *therapist* and *therapeutic* are read and
 *   *physiotherapy*, *therapeutically*, *rehabbing* and *rehabbed* are not.
 *   Nor is a paraphrase of a phrase: *a safer heart rate*, *a safe maximum
 *   heart rate*, *protect the heart*. D-12 is a list of nine, and the scan is
 *   that list; a reviewer reads for the claim.
 * - **A look-alike letter.** A Cyrillic or fullwidth letter that draws as a
 *   Latin one makes a different word to this scan. Invisible characters are
 *   removed because an editor or a paste can leave one by accident; a
 *   look-alike letter takes intent, and review is what answers that.
 * - **What a model is told by `apps/instance`.** Its prompts are instructions
 *   to a model, not text a rider is shown, and are not scanned. Every
 *   `packages/*` tree IS walked, `@onyourleft/analysis` included, with the
 *   one line of its prompt that uses one of these words to forbid it excused
 *   by equality ({@link EXEMPT}).
 * - **Anything a rider reads that is not in the scanned trees**: the Play
 *   listing, the README and release notes. Those are the reviewer checklist's
 *   (`apps/mobile/RELEASE.md` §4), which spike 0008 §8 records as unscanned.
 *
 * A green scan is evidence these words are absent, and of nothing else.
 */

import { visibleText } from '@onyourleft/analysis';

import { renderedTextFindings } from '../camera/no-absolute-angles';

/**
 * What may part the words of a phrase: any white space (a line break and a
 * non-breaking space are both `\s`), a hyphen-minus, or one of the dashes
 * U+2010 to U+2014 — a hyphen, a non-breaking hyphen, a figure dash, an en
 * dash and an em dash. Each renders as a join between the same two words.
 */
const GAP = String.raw`[\s\-\u2010-\u2014]+`;

/**
 * ADR 0048 D-12's list, word for word, each with the pattern that finds it.
 * Adding or removing one is a change to that decision, not an edit here.
 *
 * Each pattern is matched against text with its invisible characters removed
 * and is case-insensitive. A phrase's words may be parted by {@link GAP}.
 */
export const BANNED_WORDS = [
  { word: 'cardiac', pattern: /\bcardiac\b/i },
  { word: 'heart condition', pattern: new RegExp(`\\bheart${GAP}conditions?\\b`, 'i') },
  // The noun, the verb, and the short form a rider would read as the same word.
  { word: 'rehabilitation', pattern: /\brehab(?:s|ilitat\w*)?\b/i },
  { word: 'patient', pattern: /\bpatients?\b/i },
  { word: 'therapy', pattern: /\btherap(?:y|ies|ist|ists|eutic|eutics)\b/i },
  { word: 'safe heart rate', pattern: new RegExp(`\\bsafe${GAP}heart${GAP}rates?\\b`, 'i') },
  {
    word: 'protects your heart',
    pattern: new RegExp(`\\bprotect(?:s|ed|ing)?${GAP}your${GAP}heart\\b`, 'i'),
  },
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

/** The one line of the write-up prompts that names a banned word, in order to forbid it. */
const PROMPT_FORBIDS_THE_WORD =
  'Do not name any illness, injury or medical condition, and do not recommend changing any part of the bicycle or its fit.';

/**
 * What is excused, where, and why — each entry names the file and **the whole
 * of the text** it excuses (equality, never containment), as
 * `no-absolute-angles.ts` §`EXEMPT` does and for its reason. An entry is a
 * decision a reviewer reads, and one that excuses nothing fails the gate. A
 * file outside `apps/web/src` is named relative to it, with `/`.
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
  {
    file: '../../../packages/analysis/src/template/agent-v1.ts',
    text: PROMPT_FORBIDS_THE_WORD,
    why: 'an instruction to a model, not text a rider is shown: the write-up prompt uses the word to forbid it. Excused as this one whole sentence in the one prompt template that carries it (the chain templates that also did went in #1797), so any other sentence in @onyourleft/analysis is still read',
  },
];

/** Whether a finding is one {@link EXEMPT} excuses: the same file and the same whole text. */
export function isExempt(finding: MedicalWordingFinding): boolean {
  return EXEMPT.some((entry) => entry.file === finding.file && finding.text === entry.text);
}
