// SPDX-License-Identifier: Apache-2.0

/**
 * The template tests' fixtures: the largest, an ordinary and the smallest
 * input, the widest earlier notes and history passages, and every prompt a
 * template builds over them. Test support, never shipped (the `-testing.ts`
 * suffix). Moved out of `template.test.ts` by #1094, unchanged, so the one
 * prompt check that needs `apps/web`'s source scan
 * (`apps/web/src/ride-analysis/template-app.test.ts`) builds the same prompts.
 */

import { acceptHistoryAnswer, type HistoryPassage } from '../history';
import { MAXIMUM_SECTIONS, type RideAnalysisInput, type SectionSummary } from '../input';
import {
  acceptHistoryNote,
  acceptPositionNote,
  acceptSectionNote,
  MAXIMUM_HISTORY_NOTE_CHARACTERS,
  MAXIMUM_NOTE_CHARACTERS,
  SCREEN_RULES,
  type AnalysisTemplate,
  type EarlierNotes,
  type HistoryNote,
  type PositionNote,
  type ScreenRule,
  type SectionNote,
  type StepPrompt,
} from './template';

// --- Fixtures -----------------------------------------------------------------

/** One section at its widest: every optional field present, every figure at its longest plausible spelling. */
export function widestSection(index: number): SectionSummary {
  return {
    index,
    kind: 'descent',
    minutes: 1234.5,
    distanceKilometres: 123.45,
    meanGradientPercent: -12.3,
    elevationGainMetres: 1234,
    laps: { first: 10 + index, last: 20 + index },
    metrics: {
      power: { coverage: 0.99, mean: 1234, max: 1999 },
      heartRate: { coverage: 0.99, mean: 188, max: 199 },
      cadence: { coverage: 0.99, mean: 101, max: 199 },
      wattsPerKilogram: { mean: 17.53, max: 28.39 },
    },
  };
}

/**
 * The largest input the template is asked to take: eight widest sections, a
 * rider with both figures set and a pose summary with every kind.
 */
export const LARGEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 2880.0, distanceKilometres: 1234.56 },
  rider: { massKilograms: 123.4, thresholdPower: 456 },
  whole: widestSection(0).metrics,
  sections: Array.from({ length: MAXIMUM_SECTIONS }, (_, position) => widestSection(position + 1)),
  pose: {
    source: 'computer',
    posed: 54_000,
    noRider: 54_000,
    unreadable: 54_000,
    differences: { torso: -12.34, knee: 8.76, elbow: -10.11, head: 0.12, saddle: -0.09 },
  },
};

/** The smallest: nothing recorded, nothing set, no pose. */
export const SMALLEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 0, distanceKilometres: 0 },
  rider: { massKilograms: null, thresholdPower: null },
  whole: {},
  sections: [],
};

/** One short section and a partial pose. */
export const ORDINARY: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 42.5, distanceKilometres: 18.2 },
  rider: { massKilograms: 70.4, thresholdPower: null },
  whole: { power: { coverage: 1, mean: 180, max: 420 } },
  sections: [
    {
      index: 1,
      kind: 'time',
      minutes: 42.5,
      metrics: { power: { coverage: 1, mean: 180, max: 420 }, cadence: { coverage: 0.3 } },
    },
  ],
  pose: { source: 'tablet', posed: 300, noRider: 0, unreadable: 0, differences: { torso: 2.1 } },
};

/**
 * The worst note the acceptors admit for the prompts' size: exactly the
 * longest a note may be, made only of the characters a JSON string escapes
 * into two — a backslash, a newline and a double quote — so a builder that
 * serialised a note would double it (#820's review). Starts and ends on a
 * character `trim` keeps.
 */
export const WORST_NOTE = '\\\n"'.repeat(MAXIMUM_NOTE_CHARACTERS / 3);

/** A note of exactly the longest a note may be, through the real acceptor. */
export function longestSectionNote(section: number): SectionNote {
  const note = acceptSectionNote(JSON.stringify({ section, notes: WORST_NOTE }), section);
  if (note === undefined) {
    throw new Error('the longest note should be accepted');
  }
  return note;
}

export function positionNote(notes: string): PositionNote {
  const note = acceptPositionNote(JSON.stringify({ notes }));
  if (note === undefined) {
    throw new Error('the note should be accepted');
  }
  return note;
}

export const LONGEST_EARLIER: EarlierNotes = {
  sections: LARGEST.sections.map((section) => longestSectionNote(section.index)),
  position: positionNote(WORST_NOTE),
  failedSections: [],
};

export const SOME_FAILED: EarlierNotes = {
  sections: [longestSectionNote(3), longestSectionNote(1)],
  failedSections: [4, 2],
};

export const NOTHING_EARLIER: EarlierNotes = { sections: [], failedSections: [] };

/**
 * The widest passages the history step can be handed (#835): six of the
 * instance's 900 characters, filling the template's budget exactly, each made
 * of what the fence rewrites (square brackets) and what it folds (newlines),
 * under the longest label the acceptor admits.
 */
export function passagesOf(
  count: number,
  text: (index: number) => string,
): readonly HistoryPassage[] {
  const accepted = acceptHistoryAnswer(
    {
      passages: Array.from({ length: count }, (_, index) => ({
        kind: 'note',
        label: 'L'.repeat(40),
        text: text(index),
      })),
    },
    { limit: 6, characters: 5_400 },
  );
  if (accepted === undefined) {
    throw new Error('the fixture passages should be accepted');
  }
  return accepted;
}

export const WIDEST_PASSAGES = passagesOf(6, (index) =>
  `${String(index)}[\n]`.padEnd(900, '[\n]').slice(0, 900),
);
export const ORDINARY_PASSAGES = passagesOf(2, (index) =>
  index === 0
    ? 'Three weeks ago the same hill took two minutes longer.'
    : 'Goal: a century in June.',
);

/** The longest history note the acceptor admits, of the characters a serialised note would double. */
export const WORST_HISTORY_NOTE: HistoryNote = (() => {
  const note = acceptHistoryNote(
    JSON.stringify({ notes: '\\\n"'.repeat(MAXIMUM_HISTORY_NOTE_CHARACTERS / 3) }),
  );
  if (note === undefined) {
    throw new Error('the longest history note should be accepted');
  }
  return note;
})();

export const LONGEST_WITH_HISTORY: EarlierNotes = {
  ...LONGEST_EARLIER,
  history: WORST_HISTORY_NOTE,
};

/** Every rule, out of order, so the prompt's own ordering is what is recorded. */
export const EVERY_RULE: readonly ScreenRule[] = [...SCREEN_RULES].reverse();

/** Every prompt a template builds over the fixtures, labelled. */
export function everyPrompt(
  template: AnalysisTemplate,
): readonly (readonly [string, StepPrompt])[] {
  const [section, position, summary, rewrite] = template.steps;
  const prompts: [string, StepPrompt | undefined][] = [
    ...LARGEST.sections.map((s): [string, StepPrompt] => [
      `section ${String(s.index)}`,
      section.prompt(LARGEST, s.index),
    ]),
    ['section ordinary', section.prompt(ORDINARY, 1)],
    ['position largest', position.prompt(LARGEST)],
    ['position ordinary', position.prompt(ORDINARY)],
    ['summary largest', summary.prompt(LARGEST, LONGEST_EARLIER)],
    ['summary failed', summary.prompt(ORDINARY, SOME_FAILED)],
    ['summary smallest', summary.prompt(SMALLEST, NOTHING_EARLIER)],
    ['rewrite largest', rewrite.prompt(LARGEST, LONGEST_EARLIER, EVERY_RULE)],
    ['rewrite one', rewrite.prompt(ORDINARY, SOME_FAILED, ['angle-sign'])],
    ['rewrite none', rewrite.prompt(SMALLEST, NOTHING_EARLIER, [])],
  ];
  // The history step, and what it changes, for a template that has one (#835).
  // A template without one records exactly what it recorded before.
  const history = template.history;
  if (history !== undefined) {
    prompts.push(
      ['history largest', history.prompt(LARGEST, WIDEST_PASSAGES)],
      ['history ordinary', history.prompt(ORDINARY, ORDINARY_PASSAGES)],
      ['history none', history.prompt(ORDINARY, [])],
      ['summary with history', summary.prompt(LARGEST, LONGEST_WITH_HISTORY)],
      ['rewrite with history', rewrite.prompt(LARGEST, LONGEST_WITH_HISTORY, EVERY_RULE)],
    );
  }
  return prompts.flatMap(([label, prompt]) =>
    prompt === undefined ? [] : [[label, prompt] as const],
  );
}

/** Every step a template has, the history step included. */
export function stepsOf(template: AnalysisTemplate) {
  return template.history === undefined
    ? [...template.steps]
    : [...template.steps, template.history];
}

export function textOf(prompt: StepPrompt): string {
  return `${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.replySchema ?? null)}`;
}
