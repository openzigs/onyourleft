// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every figure a ride analysis sends is named by what the rider is told is
 * sent** — #845, and since #1103 for the instance's job alone.
 *
 * #843's review found a template sending `distanceKilometres`,
 * `meanGradientPercent` and `elevationGainMetres` under wordings that named
 * none of them. So this builds a write-up job's input from a ride with every
 * optional figure present, collects every key of the JSON it carries, and
 * requires each key to be named — by the phrase {@link NAMED_BY} gives it — in
 * the instance paragraph (`detail/write-up.ts` §`INSTANCE_SENDS`) and the
 * hosted consent (`hosted-consent.ts`). A key this table does not know is a
 * red build: a figure added without a change of wording cannot ship quietly.
 *
 * ⚠️ Until #1103 this also walked every prompt the device's own runner built,
 * against ADR 0035 D-9 B and C. #1103 removed that runner and those wordings
 * (ADR 0046 D-1); a reviewer who remembers that half is reading the old file.
 */

import { describe, expect, it } from 'vitest';

import { INSTANCE_SENDS } from '../detail/write-up';
import { hostedInstanceConsent } from './hosted-consent';
import { analysisJobRequest } from './instance-job';

import {
  MAXIMUM_SECTIONS,
  type RideAnalysisInput,
  type SectionSummary,
} from '@onyourleft/analysis';

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

describe('what a write-up job sends to the instance is what the rider is told is sent (#1102)', () => {
  /**
   * The input's own keys, which a job sends as they are (ADR 0046 D-6) — but
   * three that are not figures: the template's version; `sections`, the list
   * each section is in, which "section by section" names; and `pose`, the
   * side camera's comparison, which its own phrase names.
   */
  const keys = sentKeys(JSON.stringify(analysisJobRequest(FULL, '1', 'instance-local').input));
  const STRUCTURE: Readonly<Record<string, string>> = {
    templateVersion: 'not a figure: which template the instance runs',
    sections: 'section by section',
    pose: 'how a few measurements of your riding position changed',
  };

  it('reads the figures at all', () => {
    expect(keys.size).toBeGreaterThan(20);
    expect(keys).toContain('meanGradientPercent');
  });

  it('is named, figure by figure, in the instance paragraph (#1104 B3)', () => {
    expect(INSTANCE_SENDS.length).toBeGreaterThan(300);
    const missing = [...keys].filter((key) => {
      if (key === 'templateVersion') return false;
      const phrase = NAMED_BY[key] ?? STRUCTURE[key];
      return phrase === undefined || !INSTANCE_SENDS.includes(phrase);
    });
    expect(missing, 'a job sends a figure the instance paragraph does not name').toStrictEqual([]);
  });

  // #1251: the same job, sent on by the instance to a hosted service the
  // rider agreed to — every figure of it named in that consent (#1104 B1).
  it('is named, figure by figure, in the hosted consent (#1104 B1)', () => {
    const sends = hostedInstanceConsent('https://models.example').paragraphs[0] ?? '';
    expect(sends.length).toBeGreaterThan(300);
    const hosted = sentKeys(JSON.stringify(analysisJobRequest(FULL, '1', 'instance-hosted').input));
    expect(hosted.size).toBeGreaterThan(20);
    const missing = [...hosted].filter((key) => {
      if (key === 'templateVersion') return false;
      const phrase = NAMED_BY[key] ?? STRUCTURE[key];
      return phrase === undefined || !sends.includes(phrase);
    });
    expect(missing, 'a hosted job sends a figure the hosted consent does not name').toStrictEqual(
      [],
    );
    // The control: a consent that drops the gradient is caught.
    expect(sends.replace("each section's gradient", '')).not.toContain(
      NAMED_BY.meanGradientPercent,
    );
  });
});

describe('the check can fail (#845)', () => {
  it('the table names nothing by a single word — #847', () => {
    const single = Object.entries(NAMED_BY).filter(([, phrase]) => !/\s/.test(phrase.trim()));
    expect(single, 'a one-word phrase is found in any long text').toStrictEqual([]);
  });

  it('reads a figure after prose on the same line — #847', () => {
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
    const shipped = INSTANCE_SENDS.replace(
      "its distance, and each section's gradient and total climb, ",
      '',
    );
    expect(shipped).not.toBe(INSTANCE_SENDS);
    for (const key of ['distanceKilometres', 'meanGradientPercent', 'elevationGainMetres']) {
      expect(shipped).not.toContain(NAMED_BY[key]);
    }
  });
});
