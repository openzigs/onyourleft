// SPDX-License-Identifier: Apache-2.0

/**
 * Reading and writing a workout as a file — #202,
 * [ADR 0017](../../../../docs/adr/0017-workout-file-format.md).
 *
 * ## This format is ours, and that is the whole point
 *
 * #14 proposed adopting the de facto format. ADR 0017 declines, and the reason
 * is not preference: ADR 0009 R1 permits taking facts and forbids taking
 * somebody's compilation of them as a table, an element set **is** such a
 * compilation, there is no published specification to re-derive one from, and
 * every open implementation is GPL-2.0, GPL-3.0 or AGPL-3.0 — which
 * `CLAUDE.md` §3 makes fatal anywhere under `packages/`, with no exemption.
 *
 * So nothing was consulted to write this file. **The field names below are the
 * field names of `workout.ts`**, which this repository authored under #201, and
 * that is what ADR 0006 R2's provenance column says for every one of them.
 *
 * ## Two layers of checking, and the line between them
 *
 * ⚠️ **This module checks the document's SHAPE. `validateWorkout` checks the
 * workout's MEANING.** Which keys exist and what JavaScript types they hold is
 * here; whether a duration is positive, whether a target is a share rather than
 * a percentage, and whether the whole thing expands to something rideable is
 * `validateWorkout`'s, and this module defers to it rather than repeating it.
 *
 * That is why the decoder **casts** a checked-finite number to `Seconds` or
 * `ThresholdShare` instead of calling `seconds()` or `thresholdShare()`. Those
 * constructors would throw first, with a message that names no block — where
 * `validateWorkout` says *"block 3's target must be a share of threshold …"*,
 * which is the sentence a rider can act on. `workout.ts`'s `assertShare`
 * documents this exact path: a workout that arrives as data never went through
 * the constructor, and the re-check is the brace that survives.
 *
 * ## What a hostile file may not do
 *
 * `CLAUDE.md` §6 puts file parsing in the untrusted-input class — *"malformed
 * input must produce an error, never memory corruption, a crash loop, resource
 * exhaustion or code execution"* — and a workout file is worse than an activity
 * file, because what it produces is written to a machine applying physical
 * resistance to somebody pedalling.
 *
 * Three bounds, and they are deliberately in three different places:
 *
 * - {@link MAXIMUM_WORKOUT_FILE_CHARACTERS} caps the text before `JSON.parse`
 *   ever sees it, so a hostile file cannot spend the memory before anything has
 *   had the chance to refuse it.
 * - {@link MAXIMUM_SEGMENTS} caps what a *valid* workout may expand into, and
 *   lives in `workout.ts` so that it covers a hand-edited store row as well as
 *   a file. ADR 0017 D-6 records why one rule beats two.
 * - The unknown-key refusal below caps what a file may *mean*.
 *
 * There is no XML here and so no `<!DOCTYPE` question: JSON has no entity
 * declarations, which is the whole class `packages/fit/README.md` §7 has to
 * work to close.
 */

import type { Seconds } from '../quantities';

import { WorkoutError } from './errors';
import type {
  FreeRideBlock,
  IntervalsBlock,
  RampBlock,
  SteadyBlock,
  ThresholdShare,
  Workout,
  WorkoutBlock,
} from './workout';
import { validateWorkout } from './workout';

/**
 * The one key that says both *this is ours* and *written to this version*.
 *
 * ⚠️ **One key rather than a `format` string beside a `version` number**, which
 * is ADR 0017 D-3: two keys can disagree, and a decoder that meets a
 * disagreement has to choose which half to believe. One key cannot.
 */
const VERSION_KEY = 'onYourLeftWorkout';

/** The version this build writes, and the only one it reads. */
export const WORKOUT_FILE_VERSION = 1;

/**
 * What an exported workout is called.
 *
 * Ours-and-JSON, in that order, so a rider looking at a download folder can see
 * both. ⚠️ **The decoder never looks at it** — ADR 0017 D-3 puts identity in
 * the content, because a name is the one part of a file anybody can change by
 * accident. A workout renamed `.txt` still opens; a `package.json` renamed
 * `.oylworkout.json` still does not.
 */
export const WORKOUT_FILE_EXTENSION = '.oylworkout.json';

/**
 * `application/json`, and deliberately not a `vnd.` type of our own.
 *
 * A `vnd.` media type is a claim to a registration nobody has applied for. The
 * file genuinely *is* JSON, and saying so is both true and more useful to
 * whatever a rider opens it with.
 */
export const WORKOUT_FILE_MEDIA_TYPE = 'application/json';

/**
 * The most text the decoder will parse.
 *
 * A megabyte of characters against a real workout of a few hundred bytes: four
 * orders of magnitude of headroom, so this can only ever fire on something
 * nobody wrote by hand. It is the bound that stops `JSON.parse` materialising a
 * ten-million-block array before {@link MAXIMUM_SEGMENTS} gets a chance to
 * refuse it — see this module's header for why the two are separate.
 */
export const MAXIMUM_WORKOUT_FILE_CHARACTERS = 1_000_000;

/** A workout file, as a document. Exported for readers rather than callers. */
export interface WorkoutFile {
  readonly onYourLeftWorkout: number;
  readonly name: string;
  readonly description?: string;
  readonly blocks: readonly Record<string, unknown>[];
}

/**
 * Which keys each kind of block may carry.
 *
 * ⚠️ **`satisfies` is doing real work on this line.** Adding a member to
 * `WorkoutBlock` without adding an entry here is a **compile error**, which is
 * the same guarantee `validateWorkout`'s `never` gives and for the same reason:
 * a block kind that reached a file with no key table would be refused by
 * `unknown-field` at best and, at worst, written out and read back with its
 * distinguishing fields silently dropped.
 *
 * `kind` itself is not listed — it is checked before this table is consulted,
 * and listing it four times would be four chances to forget it once.
 */
const BLOCK_FIELDS = {
  steady: { required: ['seconds', 'target'], optional: ['label'] },
  ramp: { required: ['seconds', 'from', 'to'], optional: ['label'] },
  intervals: {
    required: ['repeats', 'hardSeconds', 'hardTarget', 'easySeconds', 'easyTarget'],
    optional: ['label'],
  },
  'free-ride': { required: ['seconds'], optional: ['label'] },
} satisfies Record<
  WorkoutBlock['kind'],
  { readonly required: readonly string[]; readonly optional: readonly string[] }
>;

const TOP_LEVEL_REQUIRED: readonly string[] = [VERSION_KEY, 'name', 'blocks'];
const TOP_LEVEL_OPTIONAL: readonly string[] = ['description'];

/**
 * Write a workout out as a file's text.
 *
 * ⚠️ **Validates before it writes.** A workout this program would refuse to
 * read is one it must not write: the alternative is a file that leaves here and
 * cannot come back, which a rider discovers after they have relied on it.
 *
 * @throws {WorkoutError} for anything `validateWorkout` refuses.
 */
export function encodeWorkoutFile(workout: Workout): string {
  validateWorkout(workout);

  const document: WorkoutFile = {
    [VERSION_KEY]: WORKOUT_FILE_VERSION,
    name: workout.name,
    ...(workout.description === undefined ? {} : { description: workout.description }),
    blocks: workout.blocks.map(encodeBlock),
  };

  // Indented, because a workout file is short, is meant to be readable, and is
  // the kind of thing somebody will open in an editor to change one number.
  // Minifying it would save bytes nobody is counting and cost that.
  return `${JSON.stringify(document, null, 2)}\n`;
}

function encodeBlock(block: WorkoutBlock): Record<string, unknown> {
  const fields = BLOCK_FIELDS[block.kind];
  const out: Record<string, unknown> = { kind: block.kind };
  // Driven by the same table the decoder checks against, rather than by a
  // spread of the block — a spread would carry any extra property a caller had
  // hung on the object, and write a file this decoder then refuses.
  for (const key of [...fields.required, ...fields.optional]) {
    const value = (block as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read a workout out of a file's text.
 *
 * @throws {WorkoutError} always, for anything that is not a workout this
 * program will ride. Every message names what was wrong in terms of the file,
 * because the person reading it chose the file and can choose another.
 */
export function decodeWorkoutFile(text: string): Workout {
  if (text.length > MAXIMUM_WORKOUT_FILE_CHARACTERS) {
    throw new WorkoutError(
      'file-too-large',
      `this file is ${String(text.length)} characters and the most this program will read is ` +
        `${String(MAXIMUM_WORKOUT_FILE_CHARACTERS)}. A workout file is normally under a kilobyte.`,
    );
  }

  const document = asObject(parse(text), 'the file');
  readVersion(document);
  refuseUnknownKeys(document, TOP_LEVEL_REQUIRED, TOP_LEVEL_OPTIONAL, 'the file');

  const rawBlocks = document['blocks'];
  if (!Array.isArray(rawBlocks)) {
    throw new WorkoutError('not-a-workout-file', "the file's blocks must be a list");
  }

  const workout: Workout = {
    name: readString(document['name'], "the workout's name"),
    ...readOptionalDescription(document['description']),
    blocks: rawBlocks.map(decodeBlock),
  };

  // ⚠️ The load-bearing line. Everything above establishes that the document
  // has the right shape; this establishes that the workout is one a trainer may
  // be asked to ride, and it is the same call every other consumer makes, which
  // is what stops the file path being the one that is checked differently.
  return validateWorkout(workout);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // The parser's own message names a character offset, which tells a rider
    // who opened the wrong file nothing they can use. What they need to know is
    // that this was not one of ours.
    throw new WorkoutError(
      'not-a-workout-file',
      'this file is not an On Your Left workout: it is not valid JSON',
    );
  }
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  // Arrays are objects, and a bare list is exactly what somebody hands this
  // function when they save the blocks without the document around them.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkoutError(
      'not-a-workout-file',
      `${where} is not an On Your Left workout: it should be a JSON object`,
    );
  }
  return value as Record<string, unknown>;
}

function readVersion(document: Record<string, unknown>): void {
  const declared = document[VERSION_KEY];
  if (declared === undefined) {
    throw new WorkoutError(
      'not-a-workout-file',
      'this file is not an On Your Left workout: it does not carry the ' +
        `"${VERSION_KEY}" key that says what it is`,
    );
  }
  if (declared !== WORKOUT_FILE_VERSION) {
    throw new WorkoutError(
      'unsupported-version',
      `this workout file is version ${JSON.stringify(declared)} and this program reads version ` +
        `${String(WORKOUT_FILE_VERSION)}. A newer version of On Your Left will open it.`,
    );
  }
}

/**
 * Refuse any key the format does not define — ADR 0017 D-4.
 *
 * ⚠️ **The opposite of the usual convention, deliberately.** Ignoring unknown
 * keys buys forward compatibility, and the price is that a file carrying a
 * field which changes what the workout *does* — a cadence target, an
 * absolute-watts escape hatch — would load with that field silently dropped and
 * ride something other than what its author wrote. Against a machine applying
 * resistance to a person, riding a different workout while reporting success is
 * the failure `CLAUDE.md` §6 exists for. Forward compatibility comes from the
 * version key instead.
 *
 * A missing **required** key is the same refusal from the other side, and is
 * reported in the same sentence so a rider comparing their file against the
 * message sees both halves at once.
 */
function refuseUnknownKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  where: string,
): void {
  const known = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      throw new WorkoutError(
        'unknown-field',
        `${where} carries "${key}", which is not part of this format. This program refuses a ` +
          'field it does not understand rather than ignoring it, because a field it ignored ' +
          'might be the one that changes what the workout does.',
      );
    }
  }
  for (const key of required) {
    if (record[key] === undefined) {
      throw new WorkoutError('not-a-workout-file', `${where} is missing "${key}"`);
    }
  }
}

function decodeBlock(raw: unknown, index: number): WorkoutBlock {
  const where = `block ${String(index + 1)}`;
  const record = asObject(raw, where);

  const kind = record['kind'];
  if (!isKnownKind(kind)) {
    throw new WorkoutError(
      'unknown-block',
      `${where} is a "${String(kind)}" block, which this program does not know how to ride. ` +
        `The kinds it knows are ${Object.keys(BLOCK_FIELDS).join(', ')}.`,
    );
  }

  const fields = BLOCK_FIELDS[kind];
  refuseUnknownKeys(record, ['kind', ...fields.required], fields.optional, where);
  const label = readOptionalLabel(record['label'], where);

  switch (kind) {
    case 'steady':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        target: readShare(record['target'], `${where}'s target`),
        ...label,
      } satisfies SteadyBlock;
    case 'ramp':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        from: readShare(record['from'], `${where}'s starting target`),
        to: readShare(record['to'], `${where}'s ending target`),
        ...label,
      } satisfies RampBlock;
    case 'intervals':
      return {
        kind,
        repeats: readNumber(record['repeats'], `${where}'s repeat count`),
        hardSeconds: readSeconds(record['hardSeconds'], `${where}'s hard interval`),
        hardTarget: readShare(record['hardTarget'], `${where}'s hard target`),
        easySeconds: readSeconds(record['easySeconds'], `${where}'s easy interval`),
        easyTarget: readShare(record['easyTarget'], `${where}'s easy target`),
        ...label,
      } satisfies IntervalsBlock;
    case 'free-ride':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        ...label,
      } satisfies FreeRideBlock;
    default: {
      // Unreachable past `isKnownKind`, and written out so that adding a block
      // kind is a compile error here too rather than a case that falls through.
      const unhandled: never = kind;
      throw new WorkoutError('unknown-block', `${where}: ${JSON.stringify(unhandled)}`);
    }
  }
}

function isKnownKind(value: unknown): value is WorkoutBlock['kind'] {
  return typeof value === 'string' && Object.hasOwn(BLOCK_FIELDS, value);
}

function readString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkoutError(
      'not-a-workout-file',
      `${where} must be some text; this file has ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function readNumber(value: unknown, where: string): number {
  // `typeof` rather than `Number.isFinite`, which would accept nothing a JSON
  // document can hold that a number check would not — but would also accept a
  // numeric *string*, and "60" reaching a trainer's clock as sixty seconds by
  // coercion is the kind of quiet success this decoder exists to prevent.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkoutError(
      'not-a-workout-file',
      `${where} must be a number; this file has ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * A duration, checked as a number and branded without being range-checked.
 *
 * ⚠️ The range check is `validateWorkout`'s, and this is not an oversight —
 * see this module's header. `seconds()` would throw a `UnitError` naming no
 * block; `assertDuration` throws a `WorkoutError` naming block 3.
 */
function readSeconds(value: unknown, where: string): Seconds {
  return readNumber(value, where) as Seconds;
}

/** A share, on the same terms as {@link readSeconds}. */
function readShare(value: unknown, where: string): ThresholdShare {
  return readNumber(value, where) as ThresholdShare;
}

function readOptionalDescription(value: unknown): { description?: string } {
  if (value === undefined) {
    return {};
  }
  return { description: readString(value, "the workout's description") };
}

function readOptionalLabel(value: unknown, where: string): { label?: string } {
  if (value === undefined) {
    return {};
  }
  return { label: readString(value, `${where}'s label`) };
}
