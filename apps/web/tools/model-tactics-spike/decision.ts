// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: what a language model may answer when it picks the lap-race
 * bots' tactics, and how that answer is read.
 *
 * **Spike code.** Nothing under `src/` imports this directory
 * (`spike-boundary.test.ts`), so none of it is in the bundle or on the ride
 * path. `docs/spikes/0039-model-chosen-lap-race-bot-tactics.md` is the
 * write-up.
 *
 * A decision names, for each bot it names, one of the seven moves
 * `@onyourleft/domain` §`BOT_TACTICS` already has, and optionally a target:
 * `"rider"` or another bot's seat. **There is no watts field, and no field for
 * anything else**: a decision with a key the schema does not have is invalid
 * as a whole, so a model that writes `"watts": 900` is read as having said
 * nothing, and the window falls back to the seeded tactics. The power a move
 * rides at is the existing tactics' own, capped by the bot's W′ and its fixed
 * capacity (`adapter.ts`).
 *
 * The model's text is untrusted input (CLAUDE.md §6: a hostile payload is in
 * scope): it is bounded in length before it is parsed, and every field is
 * checked against the schema rather than cast.
 */

import { BOT_TACTICS, type BotTactic } from '@onyourleft/domain';

/** Who a move is aimed at: the rider, or another bot by its seat from 0. */
export type ModelTarget = 'rider' | number;

/** One bot's move in a decision. */
export interface ModelMove {
  /** The bot's seat, from 0: its place in the ride's `bots`. */
  readonly bot: number;
  readonly move: BotTactic;
  readonly target?: ModelTarget | undefined;
}

/** Why a model's answer was read as no decision at all. */
export type InvalidReason =
  | 'too-long'
  | 'not-json'
  | 'not-an-object'
  | 'unknown-key'
  | 'not-a-list'
  | 'bad-bot'
  | 'duplicate-bot'
  | 'bad-move'
  | 'bad-target';

/** A model's answer, read. */
export type ParsedDecision =
  | { readonly ok: true; readonly moves: readonly ModelMove[] }
  | { readonly ok: false; readonly reason: InvalidReason };

/**
 * The longest answer read, characters: **8 192**. Seven bots' moves with
 * targets are under 600; anything near this is not a decision.
 */
export const MODEL_ANSWER_MOST_CHARACTERS = 8_192;

/**
 * The answer's JSON Schema, which Ollama's `format` field holds the model to
 * (structured outputs) and {@link parseModelDecision} checks again on arrival,
 * because a schema the server enforces is not one the client may trust.
 */
export function modelDecisionSchema(bots: number): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      bots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bot: { type: 'integer', minimum: 0, maximum: bots - 1 },
            move: { type: 'string', enum: [...BOT_TACTICS] },
            target: {
              anyOf: [
                { type: 'string', enum: ['rider'] },
                { type: 'integer', minimum: 0, maximum: bots - 1 },
              ],
            },
          },
          required: ['bot', 'move'],
          additionalProperties: false,
        },
      },
    },
    required: ['bots'],
    additionalProperties: false,
  };
}

const MOVE_KEYS = new Set(['bot', 'move', 'target']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown, bots: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < bots;
}

/**
 * Read a model's answer for a field of `bots` bots: every move it names, or
 * why it names none. A bot it does not name is left to the seeded tactics.
 */
export function parseModelDecision(text: string, bots: number): ParsedDecision {
  if (text.length > MODEL_ANSWER_MOST_CHARACTERS) return { ok: false, reason: 'too-long' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'not-an-object' };
  if (Object.keys(parsed).some((key) => key !== 'bots'))
    return { ok: false, reason: 'unknown-key' };
  const list = parsed['bots'];
  if (!Array.isArray(list)) return { ok: false, reason: 'not-a-list' };
  const moves: ModelMove[] = [];
  const seen = new Set<number>();
  for (const entry of list) {
    if (!isRecord(entry)) return { ok: false, reason: 'not-an-object' };
    if (Object.keys(entry).some((key) => !MOVE_KEYS.has(key))) {
      return { ok: false, reason: 'unknown-key' };
    }
    const { bot, move, target } = entry;
    if (!isSeat(bot, bots)) return { ok: false, reason: 'bad-bot' };
    if (seen.has(bot)) return { ok: false, reason: 'duplicate-bot' };
    seen.add(bot);
    if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
      return { ok: false, reason: 'bad-move' };
    }
    if (target !== undefined && target !== null && target !== 'rider' && !isSeat(target, bots)) {
      return { ok: false, reason: 'bad-target' };
    }
    moves.push({
      bot,
      move: move as BotTactic,
      ...(target === undefined || target === null ? {} : { target }),
    });
  }
  return { ok: true, moves };
}
