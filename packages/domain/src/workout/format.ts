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

import type { BeatsPerMinute, RevolutionsPerMinute, Seconds } from '../quantities';

import { WorkoutError } from './errors';
import type {
  CadenceCue,
  FreeRideBlock,
  HeartRateHoldBlock,
  HeartRateRange,
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

/**
 * The newest version this build reads and writes: 3, since #2302 added the
 * advisory cadence cue (ADR 0017's 2026-11-07 amendment). Version 2 is the
 * heart-rate hold, since #1239 (ADR 0048 D-3, the 2026-10-09 amendment).
 *
 * ⚠️ **A workout is written at the LOWEST version that can carry it**, so a
 * workout with no hold and no cue is still a version-1 file, one with a hold
 * and no cue a version-2 file, and an older build still opens either. Only a
 * file that needs version 3 says 3 — {@link workoutFileVersionFor} is that
 * rule.
 */
export const WORKOUT_FILE_VERSION = 3;

/** The version a workout with no heart-rate hold and no cadence cue is written as. */
export const WORKOUT_FILE_FIRST_VERSION = 1;

/** A version this build reads. */
type FileVersion = 1 | 2 | 3;

/**
 * Which block kinds each version may carry. Version 1 is exactly the four it
 * always had, so a version-1 file carrying a hold is refused — it claims a
 * version that cannot hold one, and believing either half of that would be
 * guessing (ADR 0017 D-3). Version 3 adds no kind, only the cue below.
 */
const KINDS_IN_VERSION: Readonly<Record<FileVersion, ReadonlySet<string>>> = {
  1: new Set(['steady', 'ramp', 'intervals', 'free-ride']),
  2: new Set(['steady', 'ramp', 'intervals', 'free-ride', 'heart-rate-hold']),
  3: new Set(['steady', 'ramp', 'intervals', 'free-ride', 'heart-rate-hold']),
};

/**
 * The keys that hold a cadence cue (#2302), and the first version that may
 * carry one. A version-1 or version-2 file carrying a cue is refused, for the
 * hold's reason: the file contradicts itself.
 */
const CUE_FIELDS: ReadonlySet<string> = new Set(['cadence', 'hardCadence', 'easyCadence']);
const FIRST_VERSION_WITH_CUES = 3;

/** Whether a block names a cadence cue. */
function carriesCue(block: WorkoutBlock): boolean {
  switch (block.kind) {
    case 'steady':
    case 'ramp':
      return block.cadence !== undefined;
    case 'intervals':
      return block.hardCadence !== undefined || block.easyCadence !== undefined;
    case 'free-ride':
    case 'heart-rate-hold':
      return false;
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The lowest version that can carry this workout. */
export function workoutFileVersionFor(workout: Workout): FileVersion {
  if (workout.blocks.some(carriesCue)) {
    return FIRST_VERSION_WITH_CUES;
  }
  return workout.blocks.some((block) => block.kind === 'heart-rate-hold')
    ? 2
    : WORKOUT_FILE_FIRST_VERSION;
}

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
  steady: { required: ['seconds', 'target'], optional: ['label', 'cadence'] },
  ramp: { required: ['seconds', 'from', 'to'], optional: ['label', 'cadence'] },
  intervals: {
    required: ['repeats', 'hardSeconds', 'hardTarget', 'easySeconds', 'easyTarget'],
    optional: ['label', 'hardCadence', 'easyCadence'],
  },
  'free-ride': { required: ['seconds'], optional: ['label'] },
  'heart-rate-hold': {
    required: ['seconds', 'range', 'startShare', 'ceilingShare'],
    optional: ['label'],
  },
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
    [VERSION_KEY]: workoutFileVersionFor(workout),
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
    if (key === 'range' && block.kind === 'heart-rate-hold') {
      // The two numbers and nothing else, for the reason above.
      out[key] = { low: block.range.low, high: block.range.high };
    } else if (CUE_FIELDS.has(key) && value !== undefined) {
      // A cue likewise: its two numbers and nothing else.
      const cue = value as CadenceCue;
      out[key] = { low: cue.low, high: cue.high };
    } else if (value !== undefined) {
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
  const version = readVersion(document);
  refuseUnknownKeys(document, TOP_LEVEL_REQUIRED, TOP_LEVEL_OPTIONAL, 'the file');

  const rawBlocks = document['blocks'];
  if (!Array.isArray(rawBlocks)) {
    throw new WorkoutError('not-a-workout-file', "the file's blocks must be a list");
  }

  const workout: Workout = {
    name: readString(document['name'], "the workout's name"),
    ...readOptionalDescription(document['description']),
    blocks: rawBlocks.map((raw, index) => decodeBlock(raw, index, version)),
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

function readVersion(document: Record<string, unknown>): FileVersion {
  const declared = document[VERSION_KEY];
  if (declared === undefined) {
    throw new WorkoutError(
      'not-a-workout-file',
      'this file is not an On Your Left workout: it does not carry the ' +
        `"${VERSION_KEY}" key that says what it is`,
    );
  }
  if (declared !== 1 && declared !== 2 && declared !== 3) {
    throw new WorkoutError(
      'unsupported-version',
      `this workout file is version ${JSON.stringify(declared)} and this program reads versions ` +
        `${String(WORKOUT_FILE_FIRST_VERSION)} to ${String(WORKOUT_FILE_VERSION)}. A newer ` +
        'version of On Your Left will open it.',
    );
  }
  return declared;
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

function decodeBlock(raw: unknown, index: number, version: FileVersion): WorkoutBlock {
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
  if (!KINDS_IN_VERSION[version].has(kind)) {
    // ⚠️ #1239: a hold in a file that says version 1. The file contradicts
    // itself — version 1 has no such block — so it is refused whole rather
    // than read as whichever half looks more likely.
    throw new WorkoutError(
      'unknown-block',
      `${where} is a "${kind}" block, which a version-${String(version)} workout file cannot ` +
        `carry. The kinds version ${String(version)} knows are ` +
        `${[...KINDS_IN_VERSION[version]].join(', ')}.`,
    );
  }

  const fields = BLOCK_FIELDS[kind];
  if (version < FIRST_VERSION_WITH_CUES) {
    // ⚠️ #2302: a cue in a file that says version 1 or 2. Refused whole, for
    // the hold's reason above, and before the key table is consulted — the
    // table is version 3's, and would otherwise accept the key.
    const cue = Object.keys(record).find((key) => CUE_FIELDS.has(key));
    if (cue !== undefined) {
      throw new WorkoutError(
        'unknown-field',
        `${where} carries a cadence cue ("${cue}"), which a version-${String(version)} workout ` +
          `file cannot carry: cues are version ${String(FIRST_VERSION_WITH_CUES)}.`,
      );
    }
  }
  refuseUnknownKeys(record, ['kind', ...fields.required], fields.optional, where);
  const label = readOptionalLabel(record['label'], where);

  switch (kind) {
    case 'steady':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        target: readShare(record['target'], `${where}'s target`),
        ...label,
        ...readOptionalCue(record, 'cadence', where),
      } satisfies SteadyBlock;
    case 'ramp':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        from: readShare(record['from'], `${where}'s starting target`),
        to: readShare(record['to'], `${where}'s ending target`),
        ...label,
        ...readOptionalCue(record, 'cadence', where),
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
        ...readOptionalCue(record, 'hardCadence', where),
        ...readOptionalCue(record, 'easyCadence', where),
      } satisfies IntervalsBlock;
    case 'free-ride':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        ...label,
      } satisfies FreeRideBlock;
    case 'heart-rate-hold':
      return {
        kind,
        seconds: readSeconds(record['seconds'], `${where}'s length`),
        range: readRange(record['range'], `${where}'s heart-rate range`),
        startShare: readShare(record['startShare'], `${where}'s starting target`),
        ceilingShare: readShare(record['ceilingShare'], `${where}'s ceiling`),
        ...label,
      } satisfies HeartRateHoldBlock;
    default: {
      // Unreachable past `isKnownKind`, and written out so that adding a block
      // kind is a compile error here too rather than a case that falls through.
      const unhandled: never = kind;
      throw new WorkoutError('unknown-block', `${where}: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A hold's range: exactly `low` and `high`, both numbers; `validateWorkout` judges them. */
function readRange(value: unknown, where: string): HeartRateRange {
  const record = asObject(value, where);
  refuseUnknownKeys(record, ['low', 'high'], [], where);
  return {
    low: readNumber(record['low'], `${where}'s low`) as BeatsPerMinute,
    high: readNumber(record['high'], `${where}'s high`) as BeatsPerMinute,
  };
}

/**
 * A cadence cue, when the block has one: exactly `low` and `high`, both
 * numbers; `validateWorkout` judges them, for {@link readSeconds}'s reason.
 */
function readOptionalCue<Key extends 'cadence' | 'hardCadence' | 'easyCadence'>(
  record: Record<string, unknown>,
  key: Key,
  where: string,
): Partial<Record<Key, CadenceCue>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  const at = `${where}'s "${key}"`;
  const cue = asObject(value, at);
  refuseUnknownKeys(cue, ['low', 'high'], [], at);
  return {
    [key]: {
      low: readNumber(cue['low'], `${at} low`) as RevolutionsPerMinute,
      high: readNumber(cue['high'], `${at} high`) as RevolutionsPerMinute,
    },
  } as Partial<Record<Key, CadenceCue>>;
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
