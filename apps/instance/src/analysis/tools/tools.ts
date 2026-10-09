// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The analysis agent's tools** — #1098, ADR 0046 D-7: `ride_sections`,
 * `recent_rides` and `goals`, and since #1099 `history_search`
 * (`history-search.ts`). Workouts are #1100.
 *
 * Every tool is:
 *
 * - **Read-only**: it holds an `AnalysisReads` (`reads.ts`), which has one
 *   method, and it reads.
 * - **Scoped to the job's athlete**, taken from the JOB ({@link ToolContext}),
 *   never from a model's argument. No tool's schema has an athlete, an id or a
 *   path for a model to set, and an argument a schema does not name is
 *   refused, not ignored.
 * - **Bounded** in what it returns ({@link RECENT_RIDES_LIMIT},
 *   {@link RIDE_SUMMARY_CHARACTERS}, {@link GOALS_CHARACTERS}).
 * - **Validated here**, against its own schema, before it runs: a model's
 *   arguments are untrusted input, and a wrong type is a tool error the model
 *   is shown, never a throw.
 *
 * What a tool returns is plain text; the agent fences it as data
 * (`@onyourleft/analysis` §`fenceData`) before the model sees it.
 *
 * ⚠️ **What no tool returns**: anything of a `side-camera-report` (the pose
 * summary, ADR 0046 D-6 — not a kind `reads.ts` can spell), an item's key, its
 * time or its athlete (a {@link ReadItem} carries its bytes and nothing else),
 * any item holding a `data:` URL (a picture, ADR 0040 D-2 item 1), and another
 * athlete's row (the read is by the job's athlete).
 */

import {
  agentSectionFigures,
  MAXIMUM_SECTIONS,
  type RideAnalysisInput,
} from '@onyourleft/analysis';

import { holdsDataUrl } from '../../history/passages.ts';
import type { ToolSpec } from '../model-turn.ts';
import type { AnalysisSource } from '../source.ts';
import { HISTORY_SEARCH } from './history-search.ts';
import type { AnalysisHistory, AnalysisReads, ReadItem } from './reads.ts';

/** What every tool runs against: the job's, never the model's. */
export interface ToolContext {
  /** The job's athlete: the device-key session that created the job. */
  readonly athleteId: string;
  /** The device-built input of the asked-about ride (ADR 0046 D-6). */
  readonly input: RideAnalysisInput;
  readonly reads: AnalysisReads;
  /**
   * The history index (#1099), or `undefined` when the instance has none —
   * no embedding model configured, or its address refused (ADR 0040 D-6).
   * `history_search` then answers that history is not available.
   */
  readonly history?: AnalysisHistory | undefined;
  /**
   * The synced activity id of the asked-about ride, when the job names one
   * (#1095): left out of its own history, and what each retrieved ride's
   * relative age is measured from (ADR 0040 D-2).
   */
  readonly rideId?: string | undefined;
}

/** A tool's checked arguments, or why they were refused. */
type Checked<T> =
  { readonly ok: true; readonly args: T } | { readonly ok: false; readonly error: string };

export interface AgentTool<T = unknown> {
  readonly spec: ToolSpec;
  /**
   * The most times one run may call this tool, when it has its own cap inside
   * the run's tool-call budget (`agent.ts` §`AgentBudgets`): a further call is refused, and
   * the model is shown why. `undefined` for no cap of its own.
   */
  readonly maximumCalls?: number;
  validate(input: unknown): Checked<T>;
  run(context: ToolContext, args: T): Promise<string>;
}

/** The most rides `recent_rides` returns (ADR 0046 D-7 allows ten; #1098 asks for eight). */
export const RECENT_RIDES_LIMIT = 8;

/** How many `recent_rides` returns when the model does not say. */
export const RECENT_RIDES_DEFAULT = 5;

/** The most of one ride's summary `recent_rides` returns. */
export const RIDE_SUMMARY_CHARACTERS = 1_000;

/** The most `goals` returns, all goals together (ADR 0046 D-7). */
export const GOALS_CHARACTERS = 4_000;

/** How many goal items are read, at most, to fill {@link GOALS_CHARACTERS}. */
const GOAL_ITEMS = 20;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Arguments with only the keys named, each an integer in its range when present. */
function integers(
  input: unknown,
  ranges: Readonly<Record<string, readonly [number, number]>>,
): Checked<Readonly<Record<string, number | undefined>>> {
  if (!isObject(input)) return { ok: false, error: 'The arguments must be a JSON object.' };
  const args: Record<string, number | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    const range = ranges[key];
    if (range === undefined) {
      return { ok: false, error: 'An argument this tool does not take was given.' };
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < range[0] ||
      value > range[1]
    ) {
      return {
        ok: false,
        error: `${key} must be a whole number from ${String(range[0])} to ${String(range[1])}.`,
      };
    }
    args[key] = value;
  }
  return { ok: true, args };
}

function integerSchema(minimum: number, maximum: number, description: string) {
  return { type: 'integer', minimum, maximum, description };
}

/** An item's text, decoded strictly: `undefined` for bytes that are not UTF-8. */
function textOf(item: ReadItem): string | undefined {
  if (item.body === null) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(item.body);
  } catch {
    return undefined;
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** At most `limit` characters, cut at a space when there is one near the end. */
function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // One character is the ellipsis, so the whole is at most `limit`.
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `ride_sections`: the asked-about ride's sections, from the device-built input only. */
export const RIDE_SECTIONS: AgentTool<Readonly<Record<string, number | undefined>>> = {
  spec: {
    name: 'ride_sections',
    description:
      'The sections of the ride being written about, as figures. Give a section number for one section, or nothing for all of them.',
    parameters: {
      type: 'object',
      properties: {
        section: integerSchema(1, MAXIMUM_SECTIONS, 'One section’s number, 1-based.'),
      },
      additionalProperties: false,
    },
  },
  validate: (input) => integers(input, { section: [1, MAXIMUM_SECTIONS] }),
  run: (context, args) => {
    const section = args.section;
    if (section !== undefined && !context.input.sections.some((each) => each.index === section)) {
      return Promise.resolve('This ride has no section with that number.');
    }
    return Promise.resolve(agentSectionFigures(context.input, section));
  },
};

/** The text a ride summary carries: its `passages`, which the device built from #809's input. */
function summaryText(item: ReadItem): string | undefined {
  const text = textOf(item);
  if (text === undefined || holdsDataUrl(text)) return undefined;
  const body = parsed(text);
  if (!isObject(body) || !Array.isArray(body.passages)) return undefined;
  const passages = body.passages.filter(
    (passage): passage is string => typeof passage === 'string',
  );
  if (passages.some(holdsDataUrl)) return undefined;
  const joined = passages.join(' ').trim();
  return joined === '' ? undefined : bounded(joined, RIDE_SUMMARY_CHARACTERS);
}

/** `recent_rides`: summaries of the athlete's recent synced rides, newest first. */
export const RECENT_RIDES: AgentTool<Readonly<Record<string, number | undefined>>> = {
  spec: {
    name: 'recent_rides',
    description: `Short summaries of the cyclist’s most recent rides, newest first. Ask for up to ${String(RECENT_RIDES_LIMIT)}.`,
    parameters: {
      type: 'object',
      properties: {
        count: integerSchema(1, RECENT_RIDES_LIMIT, 'How many rides.'),
      },
      additionalProperties: false,
    },
  },
  validate: (input) => integers(input, { count: [1, RECENT_RIDES_LIMIT] }),
  run: async (context, args) => {
    const count = args.count ?? RECENT_RIDES_DEFAULT;
    const items = await context.reads.listLiveSyncItems(context.athleteId, 'ride-summary', count);
    const summaries = items
      .slice(0, count)
      .map(summaryText)
      .filter((text): text is string => text !== undefined);
    if (summaries.length === 0) return 'No summaries of other rides are synced.';
    return summaries
      .map(
        (text, index) => `Ride ${String(index + 1)}${index === 0 ? ' (most recent)' : ''}: ${text}`,
      )
      .join('\n');
  },
};

/** A goal's text: a JSON body's `text`, or the body itself as plain text. */
function goalText(item: ReadItem): string | undefined {
  const text = textOf(item);
  if (text === undefined || holdsDataUrl(text)) return undefined;
  const body = parsed(text);
  const goal = isObject(body) ? body.text : body === undefined ? text : undefined;
  if (typeof goal !== 'string' || holdsDataUrl(goal)) return undefined;
  return goal.trim() === '' ? undefined : goal.trim();
}

/** `goals`: what the athlete wrote about their goals, newest first, at most 4 000 characters. */
export const GOALS: AgentTool<Readonly<Record<string, number | undefined>>> = {
  spec: {
    name: 'goals',
    description: 'What the cyclist has written about their goals, newest first.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  validate: (input) => integers(input, {}),
  run: async (context) => {
    const items = await context.reads.listLiveSyncItems(context.athleteId, 'goal', GOAL_ITEMS);
    const lines: string[] = [];
    let used = 0;
    for (const goal of items.map(goalText)) {
      if (goal === undefined) continue;
      const room = GOALS_CHARACTERS - used;
      if (room < 2) break;
      const line = bounded(`Goal: ${goal}`, room);
      lines.push(line);
      // The line, and the line break before the next.
      used += line.length + 1;
    }
    return lines.length === 0 ? 'The cyclist has written no goals.' : lines.join('\n');
  },
};

/** A tool of any argument shape, as the agent holds them. */
export type AnyAgentTool = AgentTool<Readonly<Record<string, unknown>>>;

/** Every tool the agent has, and no other. */
export const AGENT_TOOLS: readonly AnyAgentTool[] = [
  RIDE_SECTIONS,
  RECENT_RIDES,
  GOALS,
  HISTORY_SEARCH,
];

/**
 * The tools that read free text the rider wrote, and so are NOT offered on an
 * `instance-hosted` job until everything a hosted model is sent is masked
 * (#1101): history reaches a hosted model only through that masking.
 */
export const UNMASKED_ONLY_TOOLS: ReadonlySet<string> = new Set([HISTORY_SEARCH.spec.name]);

/** The tools a job on `source` is offered. */
export function toolsFor(source: AnalysisSource): readonly AnyAgentTool[] {
  return source === 'instance-hosted'
    ? AGENT_TOOLS.filter((tool) => !UNMASKED_ONLY_TOOLS.has(tool.spec.name))
    : AGENT_TOOLS;
}
