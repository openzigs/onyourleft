// SPDX-License-Identifier: Apache-2.0

/**
 * **Version 1 of the ride write-up template** (#810). ⚠️ **Frozen once
 * shipped**: a saved write-up names `ride-write-up` version `1`, and
 * `template.test.ts` holds a digest of every prompt this file builds. A change
 * to any word here is a NEW version in a new file, appended to
 * `template.ts` §`ANALYSIS_TEMPLATES` — this file is kept as it is.
 *
 * That is also why this file imports no value from its neighbours: a constant
 * shared with a later version could move this version's words without this
 * file changing.
 *
 * ## What every prompt says, and does not say
 *
 * - The numbers are from ONE ride.
 * - Metrics are named by this project's own names (docs/agents/scope-and-ip.md §6), which are
 *   the input's keys. No registered load-metric name appears, and nothing asks
 *   the model for one (ADR 0035 D-8).
 * - Gradients are percentages. No joint angle and no unit of angle is asked
 *   for or allowed, and nothing about the body moving across the bicycle,
 *   toward one side or the other — so the runtime screen (#798, ADR 0035 D-4)
 *   rarely has anything to withhold. ⚠️ These instructions are worded without
 *   the words the screen and `no-absolute-angles.test.ts` forbid, because that
 *   scan reads every string in `apps/web/src`, prompts included.
 * - No diagnosis, no injury, no equipment change (ADR 0035 D-1 item 5). A
 *   request, not a guarantee: only the screen is enforced.
 * - Plain text: no links, no markdown.
 * - **Nothing is presupposed about the rider.** #761's first cause was a
 *   prompt that told the model a rider was in the picture; these prompts tell
 *   the model what the numbers ARE and ask it not to guess beyond them.
 * - No vendor, service or model is named (ADR 0031 D-4).
 */

import type {
  AnalysisTemplate,
  EarlierNotes,
  ReplySchema,
  ScreenRule,
  StepPrompt,
} from './template';
import type { ChannelSummary, MetricSummary, RideAnalysisInput, SectionSummary } from './input';

/** The longest a note may be, as this version's prompts state it. */
const NOTE_CHARACTERS = 600;

// --- Bounds -------------------------------------------------------------------
//
// Every bound below is set against ONE constraint the epic's research found
// (#795 §Research): a popular local server's default context window is 4 096
// tokens, set on the server and not per request, and it truncates silently. So
// each step's prompt at its bound, at a pessimistic three characters a token
// (JSON digits tokenise worse than prose), plus its `max_tokens`, fits 4 096.
// `template.test.ts` holds each step to that arithmetic.
//
// Every deadline is at most 120 seconds, because inside the Android shell a
// request to the rider's own computer goes through native HTTP whose read
// timeout is 120 s (`apps/mobile/src/http/analysis-http.ts`
// §`ANALYSIS_READ_TIMEOUT_MILLISECONDS`) and cannot be aborted from the web
// side: a longer deadline here would never be reached there.

/**
 * A section step: the instructions, the whole-ride figures and one section's.
 * The largest such prompt is 2 906 characters (`template.test.ts` builds it,
 * 2026-09-29); 3 300 leaves about an eighth of headroom. `max_tokens` 400: a 600-character note in
 * its JSON is under 250 tokens. 60 s: the reply is short, and eight of these
 * run in turn, so a slow model is given up on well inside a rider's patience.
 */
const SECTION_BOUNDS = {
  maximumInputCharacters: 3_300,
  maximumTokens: 400,
  deadlineMilliseconds: 60_000,
} as const;

/**
 * The position step: the instructions and the pose summary — 2 091 characters
 * at its largest (2026-09-29) — with the same reply shape as a section's and
 * so the same `max_tokens` and deadline.
 */
const POSITION_BOUNDS = {
  maximumInputCharacters: 2_400,
  maximumTokens: 400,
  deadlineMilliseconds: 60_000,
} as const;

/**
 * The summary step: the instructions, the whole-ride figures and up to nine
 * 600-character notes — 8 203 characters at its largest (2026-09-29), and
 * that largest holds whatever the notes are made of, because a note is shown
 * one character for one (§`oneLine`).
 * `max_tokens` 1 024 is room for the 500 words the prompt asks for at most,
 * and 8 600 / 3 + 1 024 = 3 891 tokens, inside 4 096. 120 s: the longest
 * reply of the run, and the native ceiling above.
 */
const SUMMARY_BOUNDS = {
  maximumInputCharacters: 8_600,
  maximumTokens: 1_024,
  deadlineMilliseconds: 120_000,
} as const;

/**
 * The rewrite step: the summary's prompt and the rules that were broken —
 * 8 511 characters at its largest (2026-09-29).
 * 9 000 / 3 + 1 024 = 4 024 tokens, inside 4 096 — the tightest of the four,
 * and the reason its bound is not rounded up further.
 */
const REWRITE_BOUNDS = {
  maximumInputCharacters: 9_000,
  maximumTokens: 1_024,
  deadlineMilliseconds: 120_000,
} as const;

// --- The words ----------------------------------------------------------------

/** What every step is told first. */
const COMMON = [
  'You are helping a cyclist understand one ride they recorded.',
  'Every number you are given comes from that one ride and nothing else. Use only these numbers.',
  'Do not guess anything about the cyclist that the numbers do not show: not their fitness, age, health, mood, experience or goals.',
  'Write in plain text only: no links, no markdown, no headings, no bullet symbols, no tables.',
  'Give any gradient as a percentage.',
  'Never state a joint angle, and never give any figure in a unit of angle.',
  'Say nothing about the body moving or leaning toward the left or the right, or across the bicycle.',
  'Do not name any illness, injury or medical condition, and do not recommend changing any part of the bicycle or its fit.',
].join(' ');

/** What the figures mean, in this project's own names. */
const FIGURES = [
  'The figures are JSON. Their names mean:',
  'movingMinutes is the time spent riding; distanceKilometres is the distance ridden; whole holds the figures over the whole ride.',
  'massKilograms is the cyclist’s own weight in kilograms and thresholdPower their own threshold power in watts; either is null when the cyclist has not set it, and then it is unknown, not zero.',
  'power is in watts, heartRate in beats per minute, cadence in pedal revolutions per minute, and wattsPerKilogram is power divided by the cyclist’s weight.',
  'For each of those, coverage is the share of the time the sensor reported, from 0 to 1, and mean and max are over the time it reported. A figure that is missing was not recorded: do not treat it as zero.',
  'A section is one stretch of the ride, numbered in the order ridden. Its kind is climb, flat or descent (from the gradient), lap (from the laps the cyclist marked) or time (an equal share of the ride); meanGradientPercent is its average gradient, elevationGainMetres how much it climbed, and laps which of the marked laps it covers.',
].join(' ');

// --- What of the input is sent ------------------------------------------------
//
// Every figure is picked by name rather than serialising #809's objects whole,
// so a field added to those types later cannot change what this version sends
// for a real ride while the digest over fixed fixtures stays green (#820's
// review). A key absent from the input is absent here too: `JSON.stringify`
// leaves out a property whose value is `undefined`.

function channel(summary: ChannelSummary | undefined): object | undefined {
  return summary === undefined
    ? undefined
    : { coverage: summary.coverage, mean: summary.mean, max: summary.max };
}

function metrics(summary: MetricSummary): object {
  const perKilogram = summary.wattsPerKilogram;
  return {
    power: channel(summary.power),
    heartRate: channel(summary.heartRate),
    cadence: channel(summary.cadence),
    wattsPerKilogram:
      perKilogram === undefined ? undefined : { mean: perKilogram.mean, max: perKilogram.max },
  };
}

function sectionFigures(section: SectionSummary): object {
  const laps = section.laps;
  return {
    index: section.index,
    kind: section.kind,
    minutes: section.minutes,
    distanceKilometres: section.distanceKilometres,
    meanGradientPercent: section.meanGradientPercent,
    elevationGainMetres: section.elevationGainMetres,
    laps: laps === undefined ? undefined : { first: laps.first, last: laps.last },
    metrics: metrics(section.metrics),
  };
}

/** The whole-ride figures: everything the input carries but the sections and the pose. */
function wholeRide(input: RideAnalysisInput): string {
  const { ride, rider } = input;
  return JSON.stringify({
    ride: { movingMinutes: ride.movingMinutes, distanceKilometres: ride.distanceKilometres },
    rider: { massKilograms: rider.massKilograms, thresholdPower: rider.thresholdPower },
    whole: metrics(input.whole),
  });
}

/** Every section, briefly, so a section can be read against the rest of the ride. */
function outline(input: RideAnalysisInput): string {
  return input.sections
    .map((section) => `${String(section.index)} ${section.kind} ${String(section.minutes)} min`)
    .join('; ');
}

/** `{ "section": <n>, "notes": "…" }`, as a hint. */
function sectionSchema(section: number): ReplySchema {
  return {
    name: 'section_notes',
    schema: {
      type: 'object',
      properties: {
        section: { type: 'integer', enum: [section] },
        notes: { type: 'string', maxLength: NOTE_CHARACTERS },
      },
      required: ['section', 'notes'],
      additionalProperties: false,
    },
  };
}

const POSITION_SCHEMA: ReplySchema = {
  name: 'position_notes',
  schema: {
    type: 'object',
    properties: { notes: { type: 'string', maxLength: NOTE_CHARACTERS } },
    required: ['notes'],
    additionalProperties: false,
  },
};

function sectionPrompt(input: RideAnalysisInput, index: number): StepPrompt {
  const section = input.sections.find((candidate) => candidate.index === index);
  if (section === undefined) {
    throw new RangeError('section: the input has no section with this index');
  }
  return {
    system: `${COMMON} ${FIGURES}`,
    user: [
      `The whole ride: ${wholeRide(input)}`,
      `Its sections: ${outline(input)}.`,
      `Section ${String(index)}: ${JSON.stringify(sectionFigures(section))}`,
      `Describe how section ${String(index)} went, compared with the whole ride: effort, heart rate, cadence and pacing, as far as the figures show them.`,
      `Reply with JSON only, in exactly this form: {"section":${String(index)},"notes":"…"} where notes is plain text of at most ${String(NOTE_CHARACTERS)} characters.`,
    ].join('\n'),
    replySchema: sectionSchema(index),
  };
}

/** What the pose figures mean. Units of angle are named without being named in a unit. */
const POSE_FIGURES = [
  'These figures compare the first third of the ride’s side-camera session with its last third, as one camera filming from the side saw them. They cover the whole session, not any one section.',
  'Each is the last third minus the first third. torso, knee and elbow are changes of angle; head is a share of the length of the torso; saddle is a share of the length of the thigh.',
  'A positive torso means more upright; a positive knee, straighter at the bottom of the pedal stroke; a positive elbow, straighter; a positive head, further forward of the shoulders; a positive saddle, sitting further forward on the saddle. Negative is the other way.',
  'A part that is missing could not be compared. posed is how many pictures showed a rider the comparison could use, noRider and unreadable how many did not, and source whether the pictures were read on the tablet or on the cyclist’s own computer. These are rough estimates from one camera, and a small change may be noise.',
  'Do not quote these figures. Describe only which way a part changed, and whether the change was small or large.',
].join(' ');

function positionPrompt(input: RideAnalysisInput): StepPrompt | undefined {
  const pose = input.pose;
  if (pose === undefined) {
    return undefined;
  }
  const { differences } = pose;
  const figures = {
    source: pose.source,
    posed: pose.posed,
    noRider: pose.noRider,
    unreadable: pose.unreadable,
    differences: {
      torso: differences.torso,
      knee: differences.knee,
      elbow: differences.elbow,
      head: differences.head,
      saddle: differences.saddle,
    },
  };
  return {
    system: `${COMMON} ${POSE_FIGURES}`,
    user: [
      `The side-camera comparison: ${JSON.stringify(figures)}`,
      'Describe what, if anything, changed in the cyclist’s position between the start and the end of the session.',
      `Reply with JSON only, in exactly this form: {"notes":"…"} where notes is plain text of at most ${String(NOTE_CHARACTERS)} characters.`,
    ].join('\n'),
    replySchema: POSITION_SCHEMA,
  };
}

/**
 * A note as the summary is shown it: on one line, and otherwise exactly as it
 * was accepted. ⚠️ **Not `JSON.stringify`**, which is what this used to be: a
 * JSON string spells a quote, a backslash or a newline in two characters, so
 * nine accepted notes of those came to 13 621 characters against the summary's
 * 8 600 (#820's review) — and the server truncates silently, from the front,
 * where the instructions are. Replacing a line break with a space is one
 * character for one, so a note takes exactly its own length here and the
 * acceptor's bound is the prompt's. One line each also keeps a note from
 * starting a line of its own that reads like another section's.
 */
function oneLine(notes: string): string {
  return notes.replace(/[\n\u2028\u2029]/g, ' ');
}

/** The notes the earlier steps' replies came to, as the summary is shown them. */
function notesOf(earlier: EarlierNotes): string {
  const sections = [...earlier.sections]
    .sort((a, b) => a.section - b.section)
    .map((note) => `Section ${String(note.section)}: ${oneLine(note.notes)}`);
  const failed =
    earlier.failedSections.length === 0
      ? []
      : [
          `No notes could be written for section ${[...earlier.failedSections]
            .sort((a, b) => a - b)
            .map(String)
            .join(', ')}. Do not describe ${earlier.failedSections.length === 1 ? 'it' : 'them'}.`,
        ];
  const position =
    earlier.position === undefined
      ? []
      : [`Position, over the whole side-camera session: ${oneLine(earlier.position.notes)}`];
  return [...sections, ...failed, ...position].join('\n');
}

const SUMMARY_ASK = [
  'Write a write-up of this ride for the cyclist, in plain text of at most 500 words, in a few short paragraphs.',
  'Start with how the ride went as a whole, then go through the sections in order, then position if there are notes about it.',
  'Use the notes above and the whole-ride figures. Do not add anything the notes and figures do not support.',
].join(' ');

function summaryPrompt(input: RideAnalysisInput, earlier: EarlierNotes): StepPrompt {
  return {
    system: `${COMMON} ${FIGURES}`,
    user: [
      `The whole ride: ${wholeRide(input)}`,
      `Its sections: ${outline(input)}.`,
      'Notes already written about parts of the ride:',
      notesOf(earlier),
      SUMMARY_ASK,
    ].join('\n'),
  };
}

/**
 * What the model is told about each rule its first write-up broke. Worded
 * without the words the rules forbid.
 */
const BROKEN: Readonly<Record<ScreenRule, string>> = {
  'angle-sign': 'it gave a figure with the symbol for a unit of angle',
  'angle-word': 'it named a unit of angle',
  'angle-format': 'it gave a figure in a unit of angle',
  'body-across': 'it described the body moving or leaning toward one side, across the bicycle',
};

function rewritePrompt(
  input: RideAnalysisInput,
  earlier: EarlierNotes,
  broken: readonly ScreenRule[],
): StepPrompt {
  const reasons = [...new Set(broken)].sort().map((rule) => BROKEN[rule]);
  const summary = summaryPrompt(input, earlier);
  return {
    system: summary.system,
    user: [
      summary.user,
      `A first write-up of this ride could not be shown, because ${reasons.length === 0 ? 'it broke the rules above' : reasons.join('; and ')}.`,
      'Write it again, following every rule above.',
    ].join('\n'),
  };
}

/** Version 1: a note per section, a note on position when there is a pose summary, a summary, and one rewrite. */
export const ANALYSIS_TEMPLATE_V1: AnalysisTemplate = {
  id: 'ride-write-up',
  version: '1',
  steps: [
    { kind: 'section', runs: 'per-section', bounds: SECTION_BOUNDS, prompt: sectionPrompt },
    { kind: 'position', runs: 'with-pose', bounds: POSITION_BOUNDS, prompt: positionPrompt },
    { kind: 'summary', runs: 'once', bounds: SUMMARY_BOUNDS, prompt: summaryPrompt },
    { kind: 'rewrite', runs: 'if-screen-fails', bounds: REWRITE_BOUNDS, prompt: rewritePrompt },
  ],
};
