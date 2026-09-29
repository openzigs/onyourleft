// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The analysis template (#810): its shape, the digest that stops a version
 * changing silently, its bounds, and the contracts each step's reply must meet.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MAXIMUM_WRITE_UP_CHARACTERS } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import type { CapturedFrame } from '../camera/camera-port';
import { angleClaimsIn } from '../camera/no-absolute-angles';

import {
  INPUT_BYTE_BUDGET,
  MAXIMUM_SECTIONS,
  type RideAnalysisInput,
  type SectionSummary,
} from './input';
import {
  acceptPositionNote,
  acceptSectionNote,
  acceptWriteUp,
  ANALYSIS_TEMPLATES,
  analysisTemplate,
  CURRENT_ANALYSIS_TEMPLATE,
  MAXIMUM_NOTE_CHARACTERS,
  SCREEN_RULES,
  type AnalysisTemplate,
  type EarlierNotes,
  type PositionNote,
  type ScreenRule,
  type SectionNote,
  type StepPrompt,
} from './template';

// --- Fixtures -----------------------------------------------------------------

/** One section at its widest: every optional field present, every figure at its longest plausible spelling. */
function widestSection(index: number): SectionSummary {
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
const LARGEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 2880.0, distanceKilometres: 1234.56 },
  rider: { massKilograms: 123.4, thresholdPower: 456 },
  whole: widestSection(0).metrics,
  sections: Array.from({ length: MAXIMUM_SECTIONS }, (_, position) => widestSection(position + 1)),
  pose: {
    source: 'computer',
    posesCompared: 54_000,
    differences: { torso: -12.34, knee: 8.76, elbow: -10.11, head: 0.12, saddle: -0.09 },
  },
};

/** The smallest: nothing recorded, nothing set, no pose. */
const SMALLEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 0, distanceKilometres: 0 },
  rider: { massKilograms: null, thresholdPower: null },
  whole: {},
  sections: [],
};

/** One short section and a partial pose. */
const ORDINARY: RideAnalysisInput = {
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
  pose: { source: 'tablet', posesCompared: 300, differences: { torso: 2.1 } },
};

/**
 * The worst note the acceptors admit for the prompts' size: exactly the
 * longest a note may be, made only of the characters a JSON string escapes
 * into two — a backslash, a newline and a double quote — so a builder that
 * serialised a note would double it (#820's review). Starts and ends on a
 * character `trim` keeps.
 */
const WORST_NOTE = '\\\n"'.repeat(MAXIMUM_NOTE_CHARACTERS / 3);

/** A note of exactly the longest a note may be, through the real acceptor. */
function longestSectionNote(section: number): SectionNote {
  const note = acceptSectionNote(JSON.stringify({ section, notes: WORST_NOTE }), section);
  if (note === undefined) {
    throw new Error('the longest note should be accepted');
  }
  return note;
}

function positionNote(notes: string): PositionNote {
  const note = acceptPositionNote(JSON.stringify({ notes }));
  if (note === undefined) {
    throw new Error('the note should be accepted');
  }
  return note;
}

const LONGEST_EARLIER: EarlierNotes = {
  sections: LARGEST.sections.map((section) => longestSectionNote(section.index)),
  position: positionNote(WORST_NOTE),
  failedSections: [],
};

const SOME_FAILED: EarlierNotes = {
  sections: [longestSectionNote(3), longestSectionNote(1)],
  failedSections: [4, 2],
};

const NOTHING_EARLIER: EarlierNotes = { sections: [], failedSections: [] };

/** Every rule, out of order, so the prompt's own ordering is what is recorded. */
const EVERY_RULE: readonly ScreenRule[] = [...SCREEN_RULES].reverse();

/** Every prompt a template builds over the fixtures, labelled. */
function everyPrompt(template: AnalysisTemplate): readonly (readonly [string, StepPrompt])[] {
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
  return prompts.flatMap(([label, prompt]) =>
    prompt === undefined ? [] : [[label, prompt] as const],
  );
}

function textOf(prompt: StepPrompt): string {
  return `${prompt.system}\n${prompt.user}\n${JSON.stringify(prompt.replySchema ?? null)}`;
}

// --- The shape ----------------------------------------------------------------

describe('a template is { id, version, steps }', () => {
  it('runs a section step per section, position with a pose, the summary once, and the rewrite only on a failed screen', () => {
    const { steps } = CURRENT_ANALYSIS_TEMPLATE;
    expect(steps.map((step) => [step.kind, step.runs])).toStrictEqual([
      ['section', 'per-section'],
      ['position', 'with-pose'],
      ['summary', 'once'],
      ['rewrite', 'if-screen-fails'],
    ]);
  });

  it('keeps an id and version the store will keep (#800)', () => {
    for (const template of ANALYSIS_TEMPLATES) {
      for (const field of [template.id, template.version]) {
        expect(field).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
      }
    }
  });

  it('never ships two templates under one name, and the current one is the newest', () => {
    const names = ANALYSIS_TEMPLATES.map(({ id, version }) => `${id}@${version}`);
    expect(new Set(names).size).toBe(names.length);
    expect(ANALYSIS_TEMPLATES[ANALYSIS_TEMPLATES.length - 1]).toBe(CURRENT_ANALYSIS_TEMPLATE);
  });

  it('finds the template a saved write-up names, and nothing for a name never shipped', () => {
    expect(analysisTemplate('ride-write-up', '1')).toBe(ANALYSIS_TEMPLATES[0]);
    expect(analysisTemplate('ride-write-up', '0')).toBeUndefined();
    expect(analysisTemplate('other', '1')).toBeUndefined();
  });
});

// --- A version cannot change silently -----------------------------------------

/**
 * The digest of every version ever shipped. ⚠️ **A red case here means a
 * prompt, a bound or the step list of a SHIPPED version changed.** Do not
 * update the digest: put the version's file back, write the change as a new
 * version, append it to `ANALYSIS_TEMPLATES`, and add its digest below. A
 * saved write-up names the version that wrote it, and that name has to keep
 * meaning the same words.
 */
const RECORDED_DIGESTS: Readonly<Record<string, string>> = {
  'ride-write-up@1': 'ae8c5988484ba26385041325933ba4a0ab32d4101f9f685c0f1b2b59d8c97da2',
};

function digestOf(template: AnalysisTemplate): string {
  const steps = template.steps.map((step) => ({
    kind: step.kind,
    runs: step.runs,
    bounds: step.bounds,
  }));
  const prompts = everyPrompt(template).map(([label, prompt]) => [label, prompt]);
  return createHash('sha256')
    .update(JSON.stringify({ id: template.id, version: template.version, steps, prompts }))
    .digest('hex');
}

describe('a version cannot change silently', () => {
  it.each(ANALYSIS_TEMPLATES.map((template) => [`${template.id}@${template.version}`, template]))(
    '%s builds exactly the prompts it was recorded with',
    (name, template) => {
      expect(digestOf(template), name).toBe(RECORDED_DIGESTS[name]);
    },
  );

  it('keeps every version that was ever recorded', () => {
    for (const name of Object.keys(RECORDED_DIGESTS)) {
      const [id, version] = name.split('@') as [string, string];
      expect(analysisTemplate(id, version), name).toBeDefined();
    }
  });

  it('turns red when one word of a prompt changes (the control)', () => {
    const template = CURRENT_ANALYSIS_TEMPLATE;
    const [section, position, summary, rewrite] = template.steps;
    const changed: AnalysisTemplate = {
      ...template,
      steps: [
        section,
        position,
        {
          ...summary,
          prompt: (input, earlier) => {
            const prompt = summary.prompt(input, earlier);
            return { ...prompt, user: `${prompt.user}.` };
          },
        },
        rewrite,
      ],
    };
    expect(digestOf(changed)).not.toBe(digestOf(template));
  });

  it('turns red when a bound changes (the control)', () => {
    const template = CURRENT_ANALYSIS_TEMPLATE;
    const [section, position, summary, rewrite] = template.steps;
    const changed: AnalysisTemplate = {
      ...template,
      steps: [
        { ...section, bounds: { ...section.bounds, maximumTokens: 401 } },
        position,
        summary,
        rewrite,
      ],
    };
    expect(digestOf(changed)).not.toBe(digestOf(template));
  });
});

// --- Bounds -------------------------------------------------------------------

/** The context window the bounds are set against (template-v1.ts §Bounds). */
const ASSUMED_CONTEXT_TOKENS = 4096;
const PESSIMISTIC_CHARACTERS_PER_TOKEN = 3;

describe('each step declares its bounds', () => {
  it.each(
    ANALYSIS_TEMPLATES.flatMap((template) =>
      template.steps.map((step) => [step.kind, step] as const),
    ),
  )(
    'the %s step fits its largest prompt and its reply inside a 4 096-token context',
    (_kind, step) => {
      const { maximumInputCharacters, maximumTokens, deadlineMilliseconds } = step.bounds;
      expect(maximumInputCharacters).toBeGreaterThan(0);
      expect(maximumTokens).toBeGreaterThan(0);
      expect(
        Math.ceil(maximumInputCharacters / PESSIMISTIC_CHARACTERS_PER_TOKEN) + maximumTokens,
      ).toBeLessThanOrEqual(ASSUMED_CONTEXT_TOKENS);
      expect(deadlineMilliseconds).toBeGreaterThan(0);
      expect(deadlineMilliseconds).toBeLessThanOrEqual(120_000);
    },
  );

  it('sets no deadline the Android shell’s native read timeout would cut short', () => {
    const native = readFileSync(
      fileURLToPath(new URL('../../../mobile/src/http/analysis-http.ts', import.meta.url)),
      'utf8',
    );
    expect(native).toMatch(/ANALYSIS_READ_TIMEOUT_MILLISECONDS = 120_000;/);
  });
});

describe('the largest allowed input', () => {
  it('takes the longest notes in the characters a serialised note would double (#820)', () => {
    expect(WORST_NOTE).toHaveLength(MAXIMUM_NOTE_CHARACTERS);
    for (const note of LONGEST_EARLIER.sections) {
      expect(note.notes).toBe(WORST_NOTE);
    }
    expect(LONGEST_EARLIER.position?.notes).toBe(WORST_NOTE);
  });

  it('is at least as large as the largest ride the input builder has been measured to produce', () => {
    // #809 measured 3 205 bytes for a 48-hour ride with 30 laps, every
    // channel, a mass and a pose summary; its budget is INPUT_BYTE_BUDGET.
    const bytes = new TextEncoder().encode(JSON.stringify(LARGEST)).length;
    expect(bytes).toBeGreaterThan(3_205);
    expect(bytes).toBeLessThan(INPUT_BYTE_BUDGET);
  });

  it.each(ANALYSIS_TEMPLATES.map((template) => [template.version, template]))(
    'builds every prompt of version %s under its step’s input bound',
    (_version, template) => {
      const [section, position, summary, rewrite] = template.steps;
      const measured: [string, number, number][] = [
        ...LARGEST.sections.map((s): [string, number, number] => {
          const prompt = section.prompt(LARGEST, s.index);
          return [
            `section ${String(s.index)}`,
            prompt.system.length + prompt.user.length,
            section.bounds.maximumInputCharacters,
          ];
        }),
      ];
      const pose = position.prompt(LARGEST);
      expect(pose).toBeDefined();
      if (pose !== undefined) {
        measured.push([
          'position',
          pose.system.length + pose.user.length,
          position.bounds.maximumInputCharacters,
        ]);
      }
      const whole = summary.prompt(LARGEST, LONGEST_EARLIER);
      measured.push([
        'summary',
        whole.system.length + whole.user.length,
        summary.bounds.maximumInputCharacters,
      ]);
      const again = rewrite.prompt(LARGEST, LONGEST_EARLIER, EVERY_RULE);
      measured.push([
        'rewrite',
        again.system.length + again.user.length,
        rewrite.bounds.maximumInputCharacters,
      ]);
      for (const [label, characters, bound] of measured) {
        expect(characters, label).toBeLessThanOrEqual(bound);
      }
    },
  );
});

// --- What the prompts say -----------------------------------------------------

/**
 * Vendors, services and model families. ADR 0031 D-4: the app names none,
 * and the words a model is sent are the app's words.
 */
const VENDOR_NAMES = [
  'openai',
  'chatgpt',
  'gpt',
  'anthropic',
  'claude',
  'google',
  'gemini',
  'gemma',
  'meta',
  'llama',
  'ollama',
  'llamafile',
  'lm studio',
  'lmstudio',
  'mistral',
  'mixtral',
  'qwen',
  'deepseek',
  'phi',
  'cohere',
  'hugging ?face',
  'vllm',
  'microsoft',
  'copilot',
];

/** CLAUDE.md §6: the registered load-metric names, and FTP, which could not be cleared. */
const REGISTERED_METRIC_NAMES_ANY_CASE = [
  'normali[sz]ed power',
  'training stress score',
  'training stress balance',
  'intensity factor',
  'chronic training load',
  'acute training load',
  'functional threshold power',
];
const REGISTERED_METRIC_ABBREVIATIONS = ['NP', 'TSS', 'TSB', 'IF', 'CTL', 'ATL', 'FTP'];

describe('what every prompt says', () => {
  const prompts = ANALYSIS_TEMPLATES.flatMap((template) => everyPrompt(template));

  it('covers every step', () => {
    const labels = prompts.map(([label]) => label.split(' ')[0]);
    expect(new Set(labels)).toStrictEqual(new Set(['section', 'position', 'summary', 'rewrite']));
  });

  it.each(prompts)('%s names no vendor, service or model (ADR 0031 D-4)', (_label, prompt) => {
    const text = textOf(prompt);
    for (const name of VENDOR_NAMES) {
      expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
    }
  });

  it.each(prompts)(
    '%s uses none of the registered metric names (CLAUDE.md §6)',
    (_label, prompt) => {
      const text = textOf(prompt);
      for (const name of REGISTERED_METRIC_NAMES_ANY_CASE) {
        expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
      }
      for (const name of REGISTERED_METRIC_ABBREVIATIONS) {
        expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    },
  );

  it('the vendor check can fire (the control)', () => {
    const planted = { system: 'Ask Ollama.', user: '' };
    expect(
      VENDOR_NAMES.some((name) => new RegExp(`\\b${name}\\b`, 'i').test(textOf(planted))),
    ).toBe(true);
  });

  it.each(prompts)('%s carries nothing the write-up screen would withhold', (label, prompt) => {
    const source = `export const prompt = ${JSON.stringify(textOf(prompt))};\n`;
    expect(angleClaimsIn(`${label}.ts`, source)).toStrictEqual([]);
  });

  it.each(prompts)(
    '%s asks for plain text, percentages, no angle and no side-to-side word',
    (_label, prompt) => {
      expect(prompt.system).toContain('one ride');
      expect(prompt.system).toContain('plain text only: no links, no markdown');
      expect(prompt.system).toContain('gradient as a percentage');
      expect(prompt.system).toContain('Never state a joint angle');
      expect(prompt.system).toContain('toward the left or the right');
      expect(prompt.system).toContain('Do not guess anything about the cyclist');
    },
  );

  it('builds the same prompt for the same input, and changes nothing it is given', () => {
    const frozen = structuredClone(LARGEST);
    const [section, position, summary, rewrite] = CURRENT_ANALYSIS_TEMPLATE.steps;
    expect(section.prompt(LARGEST, 3)).toStrictEqual(section.prompt(LARGEST, 3));
    expect(position.prompt(LARGEST)).toStrictEqual(position.prompt(LARGEST));
    expect(summary.prompt(LARGEST, LONGEST_EARLIER)).toStrictEqual(
      summary.prompt(LARGEST, LONGEST_EARLIER),
    );
    expect(rewrite.prompt(LARGEST, SOME_FAILED, EVERY_RULE)).toStrictEqual(
      rewrite.prompt(LARGEST, SOME_FAILED, EVERY_RULE),
    );
    expect(LARGEST).toStrictEqual(frozen);
  });
});

describe('each step’s prompt', () => {
  const [section, position, summary, rewrite] = CURRENT_ANALYSIS_TEMPLATE.steps;

  it('sends a section step the whole ride and its own section, and no other section’s figures or the pose', () => {
    const prompt = section.prompt(LARGEST, 2);
    expect(prompt.user).toContain(JSON.stringify(LARGEST.sections[1]));
    expect(prompt.user).not.toContain(JSON.stringify(LARGEST.sections[0]));
    expect(prompt.user).not.toContain('posesCompared');
    expect(prompt.user).toContain('{"section":2,"notes":"…"}');
    expect(prompt.replySchema?.schema).toMatchObject({
      properties: { section: { enum: [2] }, notes: { maxLength: MAXIMUM_NOTE_CHARACTERS } },
      additionalProperties: false,
    });
  });

  it('refuses a section the input does not have', () => {
    expect(() => section.prompt(ORDINARY, 2)).toThrow(RangeError);
  });

  it('runs no position step without a pose summary, and never pairs the pose with a section (ADR 0033 D-3)', () => {
    expect(position.prompt(SMALLEST)).toBeUndefined();
    const prompt = position.prompt(LARGEST);
    expect(prompt?.user).toContain(JSON.stringify(LARGEST.pose));
    expect(prompt?.user).not.toContain('"index"');
    expect(prompt?.system).toContain('Do not quote these figures');
    expect(prompt?.replySchema?.name).toBe('position_notes');
  });

  it('sends the summary every accepted note in order, which sections failed, and no section’s figures', () => {
    const prompt = summary.prompt(ORDINARY, SOME_FAILED);
    const first = prompt.user.indexOf('Section 1:');
    const third = prompt.user.indexOf('Section 3:');
    expect(first).toBeGreaterThan(-1);
    expect(third).toBeGreaterThan(first);
    expect(prompt.user).toContain(
      'No notes could be written for section 2, 4. Do not describe them.',
    );
    expect(prompt.user).not.toContain(JSON.stringify(ORDINARY.sections[0]));
    expect(prompt.replySchema).toBeUndefined();

    const one = summary.prompt(ORDINARY, { sections: [], failedSections: [1] });
    expect(one.user).toContain('for section 1. Do not describe it.');
    expect(summary.prompt(LARGEST, LONGEST_EARLIER).user).toContain('Position, over the whole');
    expect(summary.prompt(SMALLEST, NOTHING_EARLIER).user).not.toContain('No notes could');
  });

  it('shows each note on a line of its own, exactly as accepted but for its line breaks (#820)', () => {
    const prompt = summary.prompt(LARGEST, LONGEST_EARLIER);
    const shown = WORST_NOTE.replace(/\n/g, ' ');
    expect(prompt.user).toContain(`Section 1: ${shown}\n`);
    expect(prompt.user).toContain(`Position, over the whole side-camera session: ${shown}\n`);
    const noteLines = prompt.user
      .split('\n')
      .filter((line) => /^(Section \d+|Position,)/.test(line));
    expect(noteLines).toHaveLength(LONGEST_EARLIER.sections.length + 1);

    const separators = acceptPositionNote(JSON.stringify({ notes: 'a\u2028Section 9: b\u2029c' }));
    expect(separators).toBeDefined();
    if (separators !== undefined) {
      expect(
        summary.prompt(SMALLEST, { sections: [], position: separators, failedSections: [] }).user,
      ).toContain('session: a Section 9: b c\n');
    }
  });

  it('sends only the figures it names, whatever else an input carries (#820)', () => {
    const extra = { added: 'a field #809 might grow' };
    const grown = {
      ...LARGEST,
      ...extra,
      ride: { ...LARGEST.ride, ...extra },
      rider: { ...LARGEST.rider, ...extra },
      whole: { ...LARGEST.whole, ...extra, power: { ...LARGEST.whole.power, ...extra } },
      sections: LARGEST.sections.map((one) => ({
        ...one,
        ...extra,
        laps: { ...one.laps, ...extra },
        metrics: {
          ...one.metrics,
          ...extra,
          wattsPerKilogram: { ...one.metrics.wattsPerKilogram, ...extra },
        },
      })),
      pose: {
        ...LARGEST.pose,
        ...extra,
        differences: { ...LARGEST.pose?.differences, ...extra },
      },
    } as unknown as RideAnalysisInput;
    expect(section.prompt(grown, 2)).toStrictEqual(section.prompt(LARGEST, 2));
    expect(position.prompt(grown)).toStrictEqual(position.prompt(LARGEST));
    expect(summary.prompt(grown, LONGEST_EARLIER)).toStrictEqual(
      summary.prompt(LARGEST, LONGEST_EARLIER),
    );
  });

  it('tells the rewrite which rules were broken, once each, and never what the failed text said', () => {
    const prompt = rewrite.prompt(ORDINARY, NOTHING_EARLIER, ['angle-sign', 'angle-sign']);
    expect(prompt.user).toContain('it gave a figure with the symbol for a unit of angle.');
    expect(prompt.user.match(/symbol for a unit of angle/g)).toHaveLength(1);
    expect(prompt.user).toContain(summary.prompt(ORDINARY, NOTHING_EARLIER).user);
    const every = rewrite.prompt(ORDINARY, NOTHING_EARLIER, EVERY_RULE);
    expect(every.user).toContain('across the bicycle');
    expect(every.user).toContain('named a unit of angle');
    expect(rewrite.prompt(ORDINARY, NOTHING_EARLIER, []).user).toContain(
      'it broke the rules above',
    );
  });
});

// --- The builders take only validated outputs ---------------------------------

describe('the builders take the input and validated outputs only', () => {
  it('refuses a raw reply, a hand-made note and a picture at compile time', () => {
    const [section, position, summary, rewrite] = CURRENT_ANALYSIS_TEMPLATE.steps;
    const frame: CapturedFrame = {
      bytes: new Uint8Array([1]),
      mediaType: 'image/jpeg',
      width: 1,
      height: 1,
    };
    const raw = '{"section":1,"notes":"fine"}';
    // The compile-time refusal is the assertion; what each call does at run
    // time with the wrong argument is not, so it is only attempted.
    const attempt = (build: () => unknown): void => {
      try {
        build();
      } catch {
        // Refused at run time too, which is fine.
      }
    };

    // @ts-expect-error — a picture is not a ride-analysis input.
    attempt(() => section.prompt(frame, 1));
    // @ts-expect-error — nor is it a section number.
    attempt(() => section.prompt(ORDINARY, frame));
    // @ts-expect-error — nor a pose-summary input.
    attempt(() => position.prompt(frame));

    attempt(() =>
      // @ts-expect-error — a raw reply is not an accepted section note.
      summary.prompt(ORDINARY, { sections: [raw], failedSections: [] }),
    );
    attempt(() =>
      summary.prompt(ORDINARY, {
        // @ts-expect-error — nor is a hand-made object shaped like one.
        sections: [{ section: 1, notes: 'fine' }],
        failedSections: [],
      }),
    );
    attempt(() =>
      summary.prompt(ORDINARY, {
        sections: [],
        // @ts-expect-error — only acceptPositionNote makes a PositionNote.
        position: { notes: 'fine' },
        failedSections: [],
      }),
    );
    attempt(() =>
      rewrite.prompt(
        ORDINARY,
        NOTHING_EARLIER,
        // @ts-expect-error — the rewrite takes rule names, never the failed text.
        ['Your knee reached 142°'],
      ),
    );
  });
});

// --- The output contracts -----------------------------------------------------

describe('a section step’s reply', () => {
  it('is accepted when it is exactly { section, notes } for the section asked about', () => {
    expect(
      acceptSectionNote(' {"section":2,"notes":"  Steady.\\nThen harder. "} ', 2),
    ).toStrictEqual({ section: 2, notes: 'Steady.\nThen harder.' });
    expect(
      acceptSectionNote(
        JSON.stringify({ notes: 'x'.repeat(MAXIMUM_NOTE_CHARACTERS), section: 1 }),
        1,
      )?.notes,
    ).toHaveLength(MAXIMUM_NOTE_CHARACTERS);
  });

  it.each([
    ['another section', '{"section":3,"notes":"x"}'],
    ['the section as a string', '{"section":"2","notes":"x"}'],
    ['a key it did not ask for', '{"section":2,"notes":"x","angle":1}'],
    ['no notes', '{"section":2}'],
    ['notes that are not text', '{"section":2,"notes":5}'],
    ['empty notes', '{"section":2,"notes":"   "}'],
    ['notes one character too long', JSON.stringify({ section: 2, notes: 'x'.repeat(601) })],
    ['a control character', '{"section":2,"notes":"a\\u0007b"}'],
    ['a tab', '{"section":2,"notes":"a\\tb"}'],
    ['a lone high surrogate', '{"section":2,"notes":"a\\ud83db"}'],
    ['a lone low surrogate', '{"section":2,"notes":"a\\ude00b"}'],
    ['an array', '[{"section":2,"notes":"x"}]'],
    ['null', 'null'],
    ['prose around the JSON', 'Sure! {"section":2,"notes":"x"}'],
    ['nothing', ''],
  ])('is refused for %s', (_case, reply) => {
    expect(acceptSectionNote(reply, 2)).toBeUndefined();
  });
});

describe('the position step’s reply', () => {
  it('is accepted when it is exactly { notes }', () => {
    expect(acceptPositionNote('{"notes":" Lower late on. "}')).toStrictEqual({
      notes: 'Lower late on.',
    });
  });

  it.each([
    ['a section key', '{"section":1,"notes":"x"}'],
    ['too long', JSON.stringify({ notes: 'x'.repeat(601) })],
    ['not JSON', 'Lower late on.'],
    ['empty', '{"notes":""}'],
  ])('is refused for %s', (_case, reply) => {
    expect(acceptPositionNote(reply)).toBeUndefined();
  });
});

describe('the summary’s and the rewrite’s reply', () => {
  it('is accepted as plain text, newlines kept and the ends trimmed', () => {
    expect(acceptWriteUp('\n A good ride.\n\nSteady. \n')).toBe('A good ride.\n\nSteady.');
    expect(acceptWriteUp('x'.repeat(MAXIMUM_WRITE_UP_CHARACTERS))).toHaveLength(
      MAXIMUM_WRITE_UP_CHARACTERS,
    );
  });

  it('keeps a character outside the basic plane, whose surrogates come as a pair', () => {
    expect(acceptWriteUp('A ride \u{1F6B2}.')).toBe('A ride \u{1F6B2}.');
    expect(acceptSectionNote('{"section":1,"notes":"\\ud83d\\udeb2"}', 1)?.notes).toBe('\u{1F6B2}');
  });

  it.each([
    ['empty', '  \n '],
    ['half of a surrogate pair', 'a\uD83Db'],
    ['one character too long', 'x'.repeat(MAXIMUM_WRITE_UP_CHARACTERS + 1)],
    ['a carriage return', 'a\r\nb'],
    ['a C1 control', 'a\u0085b'],
  ])('is refused when %s', (_case, reply) => {
    expect(acceptWriteUp(reply)).toBeUndefined();
  });
});
