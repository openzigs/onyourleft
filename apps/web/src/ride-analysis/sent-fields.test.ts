// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every figure a ride analysis sends is named by what the rider is told is
 * sent** — #845.
 *
 * #843's review found `template-v1.ts` sending `distanceKilometres`,
 * `meanGradientPercent` and `elevationGainMetres` under wordings (ADR 0035
 * D-9 B and C) that named none of them. So this builds every prompt every
 * template in `template.ts` §`ANALYSIS_TEMPLATES` makes, from an input with
 * every optional figure present, collects every key of the JSON those prompts
 * carry, and requires each key to be named — by the phrase {@link NAMED_BY}
 * gives it — in BOTH the own-computer words (`detail/write-up.ts`
 * §`COMPUTER_SENDS`) and the hosted consent (`camera/hosted-model.ts`
 * §`HOSTED_CONSENT`). A key this table does not know is a red build: a figure
 * added to a template without a change of wording cannot ship quietly.
 */

import { describe, expect, it } from 'vitest';

import { HOSTED_CONSENT } from '../camera/hosted-model';
import { COMPUTER_SENDS } from '../detail/write-up';

import { MAXIMUM_SECTIONS, type RideAnalysisInput, type SectionSummary } from './input';
import {
  acceptPositionNote,
  acceptSectionNote,
  ANALYSIS_TEMPLATES,
  type AnalysisTemplate,
  type EarlierNotes,
} from './template';

/**
 * Which words of the disclosure name each key a prompt's JSON carries. A key
 * that only groups other keys names the grouping's meaning, which the rider
 * is told as the list's framing.
 *
 * ⚠️ Every phrase is more than one word (#847, from #848's review): a single
 * common word such as *power* is found somewhere in any long disclosure, so it
 * would name its figure whether or not the list did. `the table names nothing
 * by a single word` holds that.
 */
const NAMED_BY: Readonly<Record<string, string>> = {
  // The whole ride.
  ride: "that ride's numbers",
  movingMinutes: 'how long the ride lasted',
  distanceKilometres: 'its distance',
  whole: "that ride's numbers",
  // The rider.
  rider: 'your weight',
  massKilograms: 'your weight',
  thresholdPower: 'your threshold power, if you set one',
  // A stretch's metrics.
  metrics: 'heart rate, cadence and power',
  power: 'cadence and power',
  heartRate: 'heart rate, cadence',
  cadence: 'heart rate, cadence and power',
  coverage: 'heart rate, cadence and power',
  mean: 'heart rate, cadence and power',
  max: 'heart rate, cadence and power',
  wattsPerKilogram: 'watts per kilogram',
  // A section.
  index: 'section by section',
  kind: 'section by section',
  minutes: 'section by section',
  meanGradientPercent: "each section's gradient",
  elevationGainMetres: 'total climb',
  laps: 'section by section',
  first: 'section by section',
  last: 'section by section',
  // The side-camera comparison.
  source: 'how a few measurements of your riding position changed',
  posed: 'how a few measurements of your riding position changed',
  noRider: 'how a few measurements of your riding position changed',
  unreadable: 'how a few measurements of your riding position changed',
  differences: 'how a few measurements of your riding position changed',
  torso: 'how a few measurements of your riding position changed',
  knee: 'how a few measurements of your riding position changed',
  elbow: 'how a few measurements of your riding position changed',
  head: 'how a few measurements of your riding position changed',
  saddle: 'how a few measurements of your riding position changed',
};

/** A section with every optional figure present. */
function fullSection(index: number): SectionSummary {
  return {
    index,
    kind: 'lap',
    minutes: 12.5,
    distanceKilometres: 6.2,
    meanGradientPercent: 3.1,
    elevationGainMetres: 190,
    laps: { first: index, last: index },
    metrics: {
      power: { coverage: 1, mean: 210, max: 480 },
      heartRate: { coverage: 1, mean: 150, max: 178 },
      cadence: { coverage: 1, mean: 88, max: 110 },
      wattsPerKilogram: { mean: 3, max: 6.9 },
    },
  };
}

/** Every figure the input type can carry, present. */
const FULL: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 100, distanceKilometres: 49.6 },
  rider: { massKilograms: 70, thresholdPower: 250 },
  whole: fullSection(0).metrics,
  sections: Array.from({ length: MAXIMUM_SECTIONS }, (_, position) => fullSection(position + 1)),
  pose: {
    source: 'computer',
    posed: 300,
    noRider: 2,
    unreadable: 1,
    differences: { torso: 1.2, knee: -0.8, elbow: 2.5, head: 0.02, saddle: -0.01 },
  },
};

/** One accepted note of each kind, through the real acceptors. */
function earlierNotes(): EarlierNotes {
  const section = acceptSectionNote(JSON.stringify({ section: 1, notes: 'Steady.' }), 1);
  const position = acceptPositionNote(JSON.stringify({ notes: 'Little changed.' }));
  if (section === undefined || position === undefined) {
    throw new Error('the notes should be accepted');
  }
  return { sections: [section], position, failedSections: [2] };
}

const EARLIER = earlierNotes();

/** Every key, at any depth, of every JSON object a line of `text` carries after its first `{`. */
function sentKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    for (const [key, inner] of Object.entries(value)) {
      if (!Array.isArray(value)) {
        keys.add(key);
      }
      walk(inner);
    }
  };
  for (const line of text.split('\n')) {
    const brace = line.indexOf('{');
    if (brace < 0) {
      continue;
    }
    try {
      walk(JSON.parse(line.slice(brace)));
    } catch {
      // Not a figure line: the reply-format hint has prose after its object.
    }
  }
  return keys;
}

/**
 * Both halves — system and user — of every prompt a template builds from
 * {@link FULL}. The system half is walked too (#847, from #848's review): a
 * figure moved into it is sent all the same.
 */
function promptsOf(template: AnalysisTemplate): string[] {
  const [section, position, summary, rewrite] = template.steps;
  const prompts = [
    ...FULL.sections.map((s) => section.prompt(FULL, s.index)),
    position.prompt(FULL),
    summary.prompt(FULL, EARLIER),
    rewrite.prompt(FULL, EARLIER, ['angle-sign']),
  ];
  return prompts.flatMap((prompt) => (prompt === undefined ? [] : [prompt.system, prompt.user]));
}

const DISCLOSURES = {
  'own computer (ADR 0035 D-9 B)': COMPUTER_SENDS,
  'hosted (ADR 0035 D-9 C)': HOSTED_CONSENT.paragraphs[0] ?? '',
} as const;

describe.each(
  ANALYSIS_TEMPLATES.map((template) => [`${template.id} v${template.version}`, template]),
)('what %s sends is what the rider is told is sent (#845)', (_label, template) => {
  const keys = sentKeys(promptsOf(template).join('\n'));

  it('reads the figures at all', () => {
    // The vacuous pass: no keys would be a table that names every one of them.
    expect(keys.size).toBeGreaterThan(20);
    expect(keys).toContain('distanceKilometres');
    expect(keys).toContain('meanGradientPercent');
    expect(keys).toContain('elevationGainMetres');
  });

  it('sends no figure the disclosure table does not name', () => {
    const unnamed = [...keys].filter((key) => !(key in NAMED_BY));
    expect(
      unnamed,
      'a template sends a figure no wording names: add it to ADR 0035 D-9 B and C by amendment, then here',
    ).toStrictEqual([]);
  });

  it.each(Object.entries(DISCLOSURES))(
    'is named, figure by figure, in the %s words',
    (_which, words) => {
      expect(words.length).toBeGreaterThan(300);
      const missing = [...keys].filter((key) => {
        const phrase = NAMED_BY[key];
        return phrase === undefined || !words.includes(phrase);
      });
      expect(missing, 'a figure is sent that these words do not name').toStrictEqual([]);
    },
  );
});

describe('the check can fail (#845)', () => {
  it('the table names nothing by a single word — #847', () => {
    const single = Object.entries(NAMED_BY).filter(([, phrase]) => !/\s/.test(phrase.trim()));
    expect(single, 'a one-word phrase is found in any long text').toStrictEqual([]);
  });

  it('walks the system half of every prompt as well as the user half — #847', () => {
    for (const template of ANALYSIS_TEMPLATES) {
      const walked = promptsOf(template);
      const system = template.steps[0].prompt(FULL, 1)?.system;
      expect(system?.length).toBeGreaterThan(0);
      expect(walked, `${template.id} v${template.version}`).toContain(system);
    }
    // And a figure there is read like one in the user half.
    expect(sentKeys('Rules.\nFigures: {"hiddenFigure":1}')).toStrictEqual(
      new Set(['hiddenFigure']),
    );
  });

  it('finds a figure the table does not name', () => {
    expect(
      sentKeys('Section 1: {"index":1,"newFigure":2}\nReply: {"notes":"…"} as text'),
    ).toStrictEqual(new Set(['index', 'newFigure']));
  });

  it('would have failed the wording #843 shipped, which named no distance, gradient or climb', () => {
    const shipped = COMPUTER_SENDS.replace(
      "its distance, and each section's gradient and total climb, ",
      '',
    );
    expect(shipped).not.toBe(COMPUTER_SENDS);
    for (const key of ['distanceKilometres', 'meanGradientPercent', 'elevationGainMetres']) {
      expect(shipped).not.toContain(NAMED_BY[key]);
    }
  });
});
