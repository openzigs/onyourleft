// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: a model's answer is read against the schema, and anything else is
 * no decision: above all, any field that is not a bot, a move or a target,
 * so a power the model writes never reaches a bot.
 */

import { describe, expect, it } from 'vitest';

import { BOT_TACTICS } from '@onyourleft/domain';

import {
  MODEL_ANSWER_MOST_CHARACTERS,
  modelAnswerFormat,
  modelDecisionSchema,
  parseModelDecision,
} from './decision';

const read = (value: unknown, bots = 7): ReturnType<typeof parseModelDecision> =>
  parseModelDecision(typeof value === 'string' ? value : JSON.stringify(value), bots);

describe('a model decision (#2616)', () => {
  it('reads every move it names, its target kept, a bot it does not name left out', () => {
    expect(
      read({
        bots: [
          { bot: 0, move: 'attack' },
          { bot: 3, move: 'chase', target: 2 },
          { bot: 6, move: 'follow', target: 'rider' },
        ],
      }),
    ).toEqual({
      ok: true,
      moves: [
        { bot: 0, move: 'attack' },
        { bot: 3, move: 'chase', target: 2 },
        { bot: 6, move: 'follow', target: 'rider' },
      ],
    });
  });

  it('reads each of the seven moves, and a null target as none', () => {
    for (const move of BOT_TACTICS) {
      expect(read({ bots: [{ bot: 1, move, target: null }] })).toEqual({
        ok: true,
        moves: [{ bot: 1, move }],
      });
    }
  });

  it('is no decision at all for a watts field, or any key the schema does not have', () => {
    expect(read({ bots: [{ bot: 0, move: 'attack', watts: 900 }] })).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(read({ bots: [{ bot: 0, move: 'attack' }], watts: 900 })).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(read({ bots: [{ bot: 0, move: 'attack', power: 'max' }] }).ok).toBe(false);
  });

  it('is no decision for a move that is not one of the seven, a seat out of the field, or a seat twice', () => {
    expect(read({ bots: [{ bot: 0, move: 'erg' }] })).toEqual({ ok: false, reason: 'bad-move' });
    expect(read({ bots: [{ bot: 0, move: 7 }] })).toEqual({ ok: false, reason: 'bad-move' });
    expect(read({ bots: [{ bot: 7, move: 'attack' }] })).toEqual({ ok: false, reason: 'bad-bot' });
    expect(read({ bots: [{ bot: -1, move: 'attack' }] })).toEqual({ ok: false, reason: 'bad-bot' });
    expect(read({ bots: [{ bot: 1.5, move: 'attack' }] })).toEqual({
      ok: false,
      reason: 'bad-bot',
    });
    expect(read({ bots: [{ bot: '1', move: 'attack' }] })).toEqual({
      ok: false,
      reason: 'bad-bot',
    });
    expect(
      read({
        bots: [
          { bot: 2, move: 'attack' },
          { bot: 2, move: 'sit-in' },
        ],
      }),
    ).toEqual({ ok: false, reason: 'duplicate-bot' });
    expect(read({ bots: [{ bot: 0, move: 'chase', target: 9 }] })).toEqual({
      ok: false,
      reason: 'bad-target',
    });
    expect(read({ bots: [{ bot: 0, move: 'chase', target: 'leader' }] })).toEqual({
      ok: false,
      reason: 'bad-target',
    });
  });

  it('is no decision for text that is not the shape: not JSON, not an object, no list, too long', () => {
    expect(read('attack!')).toEqual({ ok: false, reason: 'not-json' });
    expect(read('[1, 2]')).toEqual({ ok: false, reason: 'not-an-object' });
    expect(read({ bots: 'all attack' })).toEqual({ ok: false, reason: 'not-a-list' });
    expect(read({ bots: [null] })).toEqual({ ok: false, reason: 'not-an-object' });
    const long = JSON.stringify({ bots: [{ bot: 0, move: 'sit-in' }] }).padEnd(
      MODEL_ANSWER_MOST_CHARACTERS + 1,
      ' ',
    );
    expect(read(long)).toEqual({ ok: false, reason: 'too-long' });
    // At the bound exactly, it is read.
    expect(read(long.slice(0, MODEL_ANSWER_MOST_CHARACTERS)).ok).toBe(true);
  });

  it('gives Ollama a schema with the seven moves, the field’s seats, and no other field', () => {
    const schema = modelDecisionSchema(7);
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/watt|power|resistance|grade|erg/iu);
    const items = (schema['properties'] as { bots: { items: Record<string, unknown> } }).bots.items;
    expect(Object.keys(items['properties'] as object)).toEqual(['bot', 'move', 'target']);
    expect(items['additionalProperties']).toBe(false);
    expect(schema['additionalProperties']).toBe(false);
    expect((items['properties'] as { move: { enum: string[] } }).move.enum).toEqual([
      ...BOT_TACTICS,
    ]);
    expect((items['properties'] as { bot: { maximum: number } }).bot.maximum).toBe(6);
  });

  it('holds the model to the same shape with no target, and still reads a target that arrives (#2708)', () => {
    const format = modelAnswerFormat(7);
    const items = (format['properties'] as { bots: { items: Record<string, unknown> } }).bots.items;
    expect(Object.keys(items['properties'] as object)).toEqual(['bot', 'move']);
    expect(items['additionalProperties']).toBe(false);
    expect(format['additionalProperties']).toBe(false);
    const schemaItems = (
      modelDecisionSchema(7)['properties'] as { bots: { items: Record<string, unknown> } }
    ).bots.items;
    const properties = schemaItems['properties'] as Record<string, unknown>;
    expect(items['properties']).toEqual({ bot: properties['bot'], move: properties['move'] });
    expect(read({ bots: [{ bot: 3, move: 'chase', target: 2 }] })).toEqual({
      ok: true,
      moves: [{ bot: 3, move: 'chase', target: 2 }],
    });
  });
});
