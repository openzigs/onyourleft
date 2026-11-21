// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The write-up agent's scored set** — #2840, #1105's V1–V3.
 *
 * Twelve fixed rides and one fixed history for them to be compared with, and
 * the arithmetic that scores what the agent made of each. The command that
 * runs them against a real model is `write-up-measure.ts`; this file holds
 * nothing that talks to a model, so `write-up-set.test.ts` checks every
 * score with no model.
 *
 * ⚠️ **No ride here is real.** Every figure is chosen, so a results file can
 * be committed and two runs compared: the same rides, the same history, only
 * the prompt, the model or its settings moved. The rides cover what moves
 * the conversation's length: no sections to eight, every channel or none, a
 * rider's weight and threshold set or not, and a side-camera summary or none.
 */

import {
  MAXIMUM_SECTIONS,
  type MetricSummary,
  type RideAnalysisInput,
  type SectionKind,
  type SectionSummary,
} from '@onyourleft/analysis';

import type { AnalysisReads, ReadItem, ToolReadKind } from '../src/analysis/tools/reads.ts';

/** One ride of the set, by a name a results file may carry. */
export interface SetRide {
  readonly name: string;
  readonly input: RideAnalysisInput;
}

const KINDS: readonly SectionKind[] = ['flat', 'climb', 'descent', 'flat', 'climb', 'lap', 'time'];

/** Every channel, from one power figure: the rest follow from it, so a ride reads as one effort. */
function metricsFor(power: number, mass: number | null, channels: 'all' | 'power' | 'none') {
  if (channels === 'none') return {} satisfies MetricSummary;
  const metrics: MetricSummary = {
    power: { coverage: 1, mean: power, max: Math.round(power * 2.1) },
    ...(channels === 'all'
      ? {
          heartRate: { coverage: 0.98, mean: Math.round(110 + power / 5), max: 181 },
          cadence: { coverage: 0.97, mean: 88, max: 112 },
        }
      : {}),
    ...(mass === null
      ? {}
      : {
          wattsPerKilogram: {
            mean: Math.round((power / mass) * 100) / 100,
            max: Math.round(((power * 2.1) / mass) * 100) / 100,
          },
        }),
  };
  return metrics;
}

interface RideShape {
  readonly name: string;
  readonly minutes: number;
  readonly kilometres: number;
  readonly mass: number | null;
  readonly threshold: number | null;
  readonly power: number;
  readonly sections: number;
  readonly channels: 'all' | 'power' | 'none';
  readonly pose: boolean;
}

/** One ride, built from its shape. */
function ride(shape: RideShape): SetRide {
  const sections: SectionSummary[] = Array.from({ length: shape.sections }, (_, position) => {
    const kind = KINDS[position % KINDS.length] as SectionKind;
    const minutes = Math.round((shape.minutes / shape.sections) * 10) / 10;
    const power = shape.power + (kind === 'climb' ? 40 : kind === 'descent' ? -60 : 0);
    return {
      index: position + 1,
      kind,
      minutes,
      distanceKilometres: Math.round((shape.kilometres / shape.sections) * 10) / 10,
      ...(kind === 'climb' ? { meanGradientPercent: 5.5, elevationGainMetres: 180 } : {}),
      ...(kind === 'descent' ? { meanGradientPercent: -4.2, elevationGainMetres: 0 } : {}),
      ...(kind === 'flat' ? { meanGradientPercent: 0.4, elevationGainMetres: 12 } : {}),
      ...(kind === 'lap' ? { laps: { first: 1, last: 3 } } : {}),
      metrics: metricsFor(power, shape.mass, shape.channels),
    };
  });
  return {
    name: shape.name,
    input: {
      templateVersion: '1',
      ride: { movingMinutes: shape.minutes, distanceKilometres: shape.kilometres },
      rider: { massKilograms: shape.mass, thresholdPower: shape.threshold },
      whole: metricsFor(shape.power, shape.mass, shape.channels),
      sections,
      ...(shape.pose
        ? {
            pose: {
              source: 'tablet' as const,
              posed: 2_400,
              noRider: 30,
              unreadable: 12,
              differences: { torso: -3.2, knee: 1.4, elbow: -2.1, head: 0.04, saddle: -0.02 },
            },
          }
        : {}),
    },
  };
}

/**
 * The set. The first three are the issue's "3 fixed rides" (short, ordinary,
 * longest); the rest widen it to twelve.
 */
export const WRITE_UP_SET: readonly SetRide[] = [
  ride({
    name: 'short-easy',
    minutes: 22,
    kilometres: 9.1,
    mass: 72,
    threshold: 240,
    power: 140,
    sections: 1,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'ordinary-rolling',
    minutes: 75,
    kilometres: 31.4,
    mass: 72,
    threshold: 240,
    power: 175,
    sections: 4,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'longest-everything',
    minutes: 210,
    kilometres: 92.7,
    mass: 72,
    threshold: 240,
    power: 160,
    sections: MAXIMUM_SECTIONS,
    channels: 'all',
    pose: true,
  }),
  ride({
    name: 'nothing-recorded',
    minutes: 30,
    kilometres: 11,
    mass: null,
    threshold: null,
    power: 0,
    sections: 0,
    channels: 'none',
    pose: false,
  }),
  ride({
    name: 'power-only',
    minutes: 60,
    kilometres: 28.2,
    mass: null,
    threshold: 260,
    power: 190,
    sections: 3,
    channels: 'power',
    pose: false,
  }),
  ride({
    name: 'no-weight',
    minutes: 48,
    kilometres: 19.6,
    mass: null,
    threshold: null,
    power: 150,
    sections: 2,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'hilly-pose',
    minutes: 95,
    kilometres: 36.0,
    mass: 64,
    threshold: 230,
    power: 185,
    sections: 5,
    channels: 'all',
    pose: true,
  }),
  ride({
    name: 'laps',
    minutes: 55,
    kilometres: 30.5,
    mass: 80,
    threshold: 300,
    power: 230,
    sections: 6,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'long-steady',
    minutes: 150,
    kilometres: 70.3,
    mass: 68,
    threshold: 250,
    power: 165,
    sections: 7,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'hard-short',
    minutes: 35,
    kilometres: 17.8,
    mass: 75,
    threshold: 280,
    power: 255,
    sections: 2,
    channels: 'all',
    pose: true,
  }),
  ride({
    name: 'recovery',
    minutes: 40,
    kilometres: 14.2,
    mass: 70,
    threshold: 245,
    power: 110,
    sections: 2,
    channels: 'all',
    pose: false,
  }),
  ride({
    name: 'heavy-rider',
    minutes: 80,
    kilometres: 29.9,
    mass: 104,
    threshold: 270,
    power: 200,
    sections: 4,
    channels: 'all',
    pose: false,
  }),
];

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A ride summary as the device writes one: passages of prose, about 800 characters. */
function summaryOf(day: number, minutes: number, power: number): string {
  return JSON.stringify({
    passages: [
      `A ride of ${String(minutes)} minutes and ${String(Math.round(minutes / 2.4))} kilometres, mostly on rolling roads.`,
      `Average power was ${String(power)} watts, with the hardest ten minutes at ${String(power + 55)} watts on the second climb.`,
      `Heart rate averaged ${String(120 + (day % 20))} beats per minute and rose steadily over the last half hour.`,
      `Cadence held near ${String(84 + (day % 9))} revolutions per minute on the flat and fell to ${String(70 + (day % 7))} on the climbs.`,
      `The first section was ridden easily, the middle sections close to threshold, and the last section was a steady ride home with a short stop.`,
      `Coverage of every sensor was above 95 percent for the whole ride.`,
    ],
  });
}

/** The history every ride of the set is compared with: eight ride summaries and three goals. */
const HISTORY: Readonly<Record<ToolReadKind, readonly ReadItem[]>> = {
  'ride-summary': Array.from({ length: 8 }, (_, index) => ({
    key: `summary-${String(index)}`,
    body: encode(summaryOf(index, 45 + index * 15, 150 + index * 8)),
  })),
  goal: [
    'Ride a 100 kilometre sportive in June without stopping on the climbs.',
    'Hold a steadier cadence on climbs, nearer 80 than 70.',
    'Two indoor sessions a week through the winter, one of them long and easy.',
  ].map((text, index) => ({
    key: `goal-${String(index)}`,
    body: encode(JSON.stringify({ text })),
  })),
  workout: [],
  'workout-goal': [],
};

/** The tools' reads over {@link HISTORY}, whoever asks: the set has one rider. */
export const SET_READS: AnalysisReads = {
  listLiveSyncItems: (_athleteId, kind, limit) => Promise.resolve(HISTORY[kind].slice(0, limit)),
};

// --- Scoring ------------------------------------------------------------------

/** What one model turn of a run came to, as the server reported it. */
export interface TurnMeasure {
  /** Tokens read, `usage.prompt_tokens`: Ollama's `prompt_eval_count`. */
  readonly promptTokens: number | undefined;
  /** Tokens written. */
  readonly outputTokens: number | undefined;
  /** The most the turn was allowed to write. */
  readonly maxOutputTokens: number;
  readonly milliseconds: number;
}

/** What one ride's run came to. Numbers and closed names only: never the model's text. */
export interface RideScore {
  readonly ride: string;
  /** `written`, `withheld`, `cancelled`, or `failed:<why>`. */
  readonly outcome: string;
  readonly turns: number;
  /** How many times each tool was called, by name. */
  readonly tools: Readonly<Record<string, number>>;
  /** Each turn's tokens read, in order: Ollama's `prompt_eval_count`, nought where it gave none. */
  readonly promptTokensByTurn: readonly number[];
  readonly promptTokensMost: number;
  readonly promptTokensTotal: number;
  readonly outputTokensTotal: number;
  /** The turns whose prompt and allowance together passed the loaded context: the turns Ollama cut. */
  readonly turnsOverContext: number;
  readonly milliseconds: number;
  /** The write-up's words; nought when nothing was written. */
  readonly words: number;
  /** Figures in the write-up that nothing the model was given supports. */
  readonly unsupportedFigures: number;
}

/** Every figure in `text`, as written: `1,234.5` is 1234.5, `-4.2` is -4.2. */
export function figuresIn(text: string): readonly number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((match) =>
    Number(match[0].replace(/,/g, '')),
  );
}

/** Decimal places a figure was written to. */
function placesOf(figure: number): number {
  const text = String(figure);
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.length - point - 1;
}

/**
 * Whether `figure` is one of `given`, as a writer might round or restate it:
 * to the places it was written to, as a percentage of a share, or a whole
 * number up to ten (a section's number, "two climbs").
 */
export function supported(figure: number, given: readonly number[]): boolean {
  const absolute = Math.abs(figure);
  if (Number.isInteger(absolute) && absolute <= 10) return true;
  const places = placesOf(absolute);
  const scale = 10 ** places;
  const same = (value: number): boolean =>
    Math.abs(Math.round(Math.abs(value) * scale) / scale - absolute) < 1e-9 ||
    // Rounded to tens or hundreds, as "about 200 watts".
    (places === 0 && absolute >= 50 && Math.abs(Math.abs(value) - absolute) <= absolute * 0.05);
  return given.some((value) => same(value) || same(value * 100));
}

/** How many figures of `writeUp` none of `given` supports. */
export function unsupportedCount(writeUp: string, given: readonly number[]): number {
  return figuresIn(writeUp).filter((figure) => !supported(figure, given)).length;
}

/** Whether a turn's prompt and allowance together passed what the model can read at once. */
export function overContext(turn: TurnMeasure, contextTokens: number | undefined): boolean {
  if (contextTokens === undefined || turn.promptTokens === undefined) return false;
  return turn.promptTokens + turn.maxOutputTokens > contextTokens;
}

/** The score of one ride's run. */
export function scoreRide(run: {
  readonly ride: string;
  readonly outcome: string;
  readonly turns: readonly TurnMeasure[];
  readonly tools: Readonly<Record<string, number>>;
  readonly milliseconds: number;
  readonly writeUp: string | undefined;
  /** Every figure the model was given: the first message and every tool result. */
  readonly given: readonly number[];
  readonly contextTokens: number | undefined;
}): RideScore {
  const prompts = run.turns.map((turn) => turn.promptTokens ?? 0);
  return {
    ride: run.ride,
    outcome: run.outcome,
    turns: run.turns.length,
    tools: run.tools,
    promptTokensByTurn: prompts,
    promptTokensMost: Math.max(0, ...prompts),
    promptTokensTotal: prompts.reduce((sum, value) => sum + value, 0),
    outputTokensTotal: run.turns.reduce((sum, turn) => sum + (turn.outputTokens ?? 0), 0),
    turnsOverContext: run.turns.filter((turn) => overContext(turn, run.contextTokens)).length,
    milliseconds: run.milliseconds,
    words: run.writeUp === undefined ? 0 : run.writeUp.split(/\s+/).filter(Boolean).length,
    unsupportedFigures: run.writeUp === undefined ? 0 : unsupportedCount(run.writeUp, run.given),
  };
}

/**
 * The set's pass mark, and why each part of it is there:
 *
 * - **No turn over the context**: a turn past it is one Ollama cut without
 *   saying so (measured on 2026-11-19: a 4 220-token prompt at a 1 024-token
 *   context was read as 1 027 tokens and lost its system prompt).
 * - **At least 10 of 12 written**: a write-up the rider never gets is the
 *   failure that matters most; two allow for one withheld rewrite and one
 *   model slip in a set this size.
 * - **At most one unsupported figure a write-up, on average**: the
 *   arithmetic above is a proxy (a model may sum or subtract), so a
 *   figure it cannot place is not always wrong; more than one a write-up is.
 */
export const SET_PASS_MARK = {
  turnsOverContext: 0,
  writtenAtLeast: 10,
  unsupportedPerWriteUpAtMost: 1,
} as const;

/** What a set's scores fall short of the pass mark by, in words; empty when it passes. */
export function setShortfalls(scores: readonly RideScore[]): readonly string[] {
  const shortfalls: string[] = [];
  const over = scores.reduce((sum, score) => sum + score.turnsOverContext, 0);
  if (over > SET_PASS_MARK.turnsOverContext) {
    shortfalls.push(`${String(over)} turns passed the loaded context`);
  }
  const written = scores.filter((score) => score.outcome === 'written');
  const wanted = Math.ceil((SET_PASS_MARK.writtenAtLeast / WRITE_UP_SET.length) * scores.length);
  if (written.length < wanted) {
    shortfalls.push(`${String(written.length)} of ${String(scores.length)} written`);
  }
  const unsupported = written.reduce((sum, score) => sum + score.unsupportedFigures, 0);
  if (
    written.length > 0 &&
    unsupported / written.length > SET_PASS_MARK.unsupportedPerWriteUpAtMost
  ) {
    shortfalls.push(
      `${String(unsupported)} unsupported figures in ${String(written.length)} write-ups`,
    );
  }
  return shortfalls;
}
