// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The analysis template: an app-defined, **versioned** outline of the steps a
 * ride write-up is made of, the fixed prompt for each, and the contract each
 * step's reply must meet
 * ([#810](https://github.com/openzigs/onyourleft/issues/810), epic #795,
 * ADR 0035 D-7).
 *
 * Data and prompt builders only. What runs them — budgets, retries,
 * cancellation, what a failure says — is the runner's (#811).
 *
 * ## The app decides every step; the model never does
 *
 * Owner ruling 6 on #795 asks for *"a multi-step agent, running several model
 * calls from an app-defined, versioned template and outline"*. The outline is a
 * **fixed chain of prompts, not a tool loop**: tool calling is unreliable on
 * small local models, one popular local server's OpenAI-compatible endpoint
 * does not accept `tool_choice`, and a model that chose what data to fetch
 * would widen what leaves the device (epic #795 §Research). So a template is
 * `{ id, version, steps }`, and `steps` is a tuple whose order IS the outline.
 *
 * ## A version cannot change silently
 *
 * A saved write-up names the template and version that produced it (#800's
 * `RideWriteUpRecord.templateId` / `templateVersion`). That name is only worth
 * something if the words it names cannot move under it, so:
 *
 * - every version's prompts live in a file of their own (`template-v1.ts`),
 *   which nothing later edits;
 * - {@link ANALYSIS_TEMPLATES} keeps every version ever shipped, so a saved
 *   write-up names a template that still exists;
 * - `template.test.ts` records a digest of each version's step list and of
 *   every prompt it builds over a fixed set of inputs, and a changed prompt
 *   without a new version turns it red.
 *
 * ## The builders take nothing a model wrote until it has been validated
 *
 * A builder is pure and takes only the {@link RideAnalysisInput} (#809), a
 * section's number, and earlier steps' outputs **as validated here** —
 * {@link SectionNote} and {@link PositionNote} can only be made by
 * {@link acceptSectionNote} and {@link acceptPositionNote}. A raw reply is a
 * `string`; a picture is a `CapturedFrame`; neither fits a builder's
 * parameters, and `template.test.ts` pins that with `@ts-expect-error`.
 *
 * ⚠️ **The rewrite step is not sent the failed write-up.** It is sent what the
 * summary step was sent, plus WHICH rules the screen (#798) found broken —
 * {@link ScreenRule} names, never the matched text. The failed text is untrusted and
 * unvalidated by definition, and ADR 0035 D-4 says it is neither saved nor
 * shown; handing it back to a builder would be the one place it survived.
 */

import { MAXIMUM_WRITE_UP_CHARACTERS } from '@onyourleft/store';

import type { RideAnalysisInput } from './input';
import { ANALYSIS_TEMPLATE_V1 } from './template-v1';

/** What each step of the outline is. */
export type AnalysisStepKind = 'section' | 'position' | 'summary' | 'rewrite';

/**
 * When the runner runs a step.
 *
 * - `per-section`: once for each of the input's sections, in order.
 * - `with-pose`: once, and only when the input carries a pose summary.
 * - `once`: once.
 * - `if-screen-fails`: once, and only when the summary fails the screen (#798,
 *   ADR 0035 D-4's *"one rewrite, then withheld"*).
 */
export type AnalysisStepRuns = 'per-section' | 'with-pose' | 'once' | 'if-screen-fails';

/**
 * A step's bounds, declared on the step so the runner (#811) reads them rather
 * than choosing its own. Each value's reason is at its declaration in the
 * version's file.
 */
export interface AnalysisStepBounds {
  /** The most characters the step's prompt — system and user together — may take. */
  readonly maximumInputCharacters: number;
  /** Sent as `max_tokens`. A reply that ends for `length` is a failure (#811). */
  readonly maximumTokens: number;
  /** How long the runner waits for this step's reply before giving up on it. */
  readonly deadlineMilliseconds: number;
}

/**
 * A JSON schema for a structured reply, sent as a `response_format` HINT. It
 * is a hint and nothing more: whether a server enforces it is disputed (epic
 * #795 §Research), so the reply is always validated here.
 */
export interface ReplySchema {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

/** One step's prompt, as it is sent. */
export interface StepPrompt {
  readonly system: string;
  readonly user: string;
  /** Present only on a step whose reply is JSON. */
  readonly replySchema?: ReplySchema;
}

declare const validated: unique symbol;

/** A section step's reply, once {@link acceptSectionNote} has accepted it. */
export interface SectionNote {
  /** The section's 1-based index, as the input numbers it. */
  readonly section: number;
  readonly notes: string;
  readonly [validated]: 'section';
}

/** The position step's reply, once {@link acceptPositionNote} has accepted it. */
export interface PositionNote {
  readonly notes: string;
  readonly [validated]: 'position';
}

/** What the summary and rewrite steps are given from the steps before them. */
export interface EarlierNotes {
  /** Every section note that was accepted, in any order. */
  readonly sections: readonly SectionNote[];
  /** The position note, when the step ran and its reply was accepted. */
  readonly position?: PositionNote;
  /** The 1-based indexes of the sections whose step failed. */
  readonly failedSections: readonly number[];
}

/**
 * Which of the screen's rules a failed write-up broke — the RULE, never the
 * matched text.
 *
 * The screen (#798) shares `no-absolute-angles.ts`' matchers (ADR 0035 D-4),
 * whose findings are named by `AngleClaimFinding['rule']`; #798 maps each of
 * those onto one of these. ⚠️ **They are this file's own names on purpose,
 * not those**: `no-absolute-angles.test.ts` reads every string in
 * `apps/web/src`, and the matcher's rule names are made of the very words it
 * forbids, so a template keyed by them fails the scan. They are also a
 * frozen version's vocabulary, which a rename in the scanner must not move.
 */
export type ScreenRule =
  /** A figure with a sign for a unit of angle. */
  | 'angle-sign'
  /** A unit of angle, named or abbreviated after a number. */
  | 'angle-word'
  /** A figure formatted in a unit of angle. */
  | 'angle-format'
  /** The body moving or leaning toward one side, across the bicycle. */
  | 'body-across';

/** Every screen rule, in a fixed order. */
export const SCREEN_RULES: readonly ScreenRule[] = [
  'angle-sign',
  'angle-word',
  'angle-format',
  'body-across',
];

export interface SectionStep {
  readonly kind: 'section';
  readonly runs: 'per-section';
  readonly bounds: AnalysisStepBounds;
  /** The prompt for the section the input numbers `section` (1-based). */
  readonly prompt: (input: RideAnalysisInput, section: number) => StepPrompt;
}

export interface PositionStep {
  readonly kind: 'position';
  readonly runs: 'with-pose';
  readonly bounds: AnalysisStepBounds;
  /** `undefined` when the input carries no pose summary: the step does not run. */
  readonly prompt: (input: RideAnalysisInput) => StepPrompt | undefined;
}

export interface SummaryStep {
  readonly kind: 'summary';
  readonly runs: 'once';
  readonly bounds: AnalysisStepBounds;
  readonly prompt: (input: RideAnalysisInput, earlier: EarlierNotes) => StepPrompt;
}

export interface RewriteStep {
  readonly kind: 'rewrite';
  readonly runs: 'if-screen-fails';
  readonly bounds: AnalysisStepBounds;
  readonly prompt: (
    input: RideAnalysisInput,
    earlier: EarlierNotes,
    broken: readonly ScreenRule[],
  ) => StepPrompt;
}

/** A template: an id, a version, and the outline in the order it runs. */
export interface AnalysisTemplate {
  /** Kept with every saved write-up (#800). Letters, digits, `.`, `_`, `-`. */
  readonly id: string;
  /** Kept with every saved write-up (#800). Never reused for different words. */
  readonly version: string;
  readonly steps: readonly [SectionStep, PositionStep, SummaryStep, RewriteStep];
}

/**
 * Every template version ever shipped, oldest first. **Append only**: a saved
 * write-up names one of these, and removing it would leave that name pointing
 * at nothing.
 */
export const ANALYSIS_TEMPLATES: readonly AnalysisTemplate[] = [ANALYSIS_TEMPLATE_V1];

/** The template a new write-up is made with: the newest. */
export const CURRENT_ANALYSIS_TEMPLATE: AnalysisTemplate = ANALYSIS_TEMPLATE_V1;

/** The template a saved write-up names, or `undefined` when no such template was ever shipped. */
export function analysisTemplate(id: string, version: string): AnalysisTemplate | undefined {
  return ANALYSIS_TEMPLATES.find((template) => template.id === id && template.version === version);
}

// --- The output contracts -----------------------------------------------------

/**
 * The longest a section's or the position's notes may be: 600 characters
 * (#810's outline). Long enough for a few sentences about one stretch of a
 * ride, and short enough that eight of them and a position note fit the
 * summary step's input bound with the whole-ride figures beside them.
 */
export const MAXIMUM_NOTE_CHARACTERS = 600;

/**
 * Every control character but a newline — the store's own rule for a
 * write-up's text (`packages/store` §`rideWriteUpProblem`), applied to notes
 * as well, because a note is folded into the summary's prompt.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

/**
 * Half of a surrogate pair with no other half: not well-formed text, and what
 * `JSON.stringify` spells in six characters (`\\udxxx`). A model that wrote
 * one wrote a broken character, not words, so the reply is refused (#820's
 * review).
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Plain text of at most `limit` characters, trimmed; `undefined` when it is not. */
function plainText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  if (
    text.length === 0 ||
    text.length > limit ||
    CONTROL_BUT_NEWLINE.test(text) ||
    LONE_SURROGATE.test(text)
  ) {
    return undefined;
  }
  return text;
}

/**
 * A reply that is one JSON object with exactly `keys`, or `undefined`. An
 * unknown key is refused rather than ignored (ADR 0017 D-4's rule, and
 * `computer-pose.ts`' for the same reason: a field this file does not know is
 * a reply it did not ask for).
 */
function jsonObject(
  reply: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.trim());
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  const present = Object.keys(record);
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    return undefined;
  }
  return record;
}

/**
 * A section step's reply, accepted — or `undefined` when it does not meet the
 * contract: JSON `{ "section": <the section asked about>, "notes": "<plain
 * text, at most {@link MAXIMUM_NOTE_CHARACTERS}>" }` and nothing else.
 */
export function acceptSectionNote(reply: string, section: number): SectionNote | undefined {
  const record = jsonObject(reply, ['section', 'notes']);
  if (record === undefined || record.section !== section) {
    return undefined;
  }
  const notes = plainText(record.notes, MAXIMUM_NOTE_CHARACTERS);
  return notes === undefined ? undefined : ({ section, notes } as SectionNote);
}

/** The position step's reply, accepted: JSON `{ "notes": "<…>" }` and nothing else. */
export function acceptPositionNote(reply: string): PositionNote | undefined {
  const record = jsonObject(reply, ['notes']);
  const notes = record === undefined ? undefined : plainText(record.notes, MAXIMUM_NOTE_CHARACTERS);
  return notes === undefined ? undefined : ({ notes } as PositionNote);
}

/**
 * The summary's or the rewrite's reply as a write-up, or `undefined` when it
 * is not plain text of at most `MAXIMUM_WRITE_UP_CHARACTERS` (the store's
 * bound). ⚠️ This is the SHAPE only: whether it may be shown is the screen's
 * (#798), which runs after this.
 */
export function acceptWriteUp(reply: string): string | undefined {
  return plainText(reply, MAXIMUM_WRITE_UP_CHARACTERS);
}
