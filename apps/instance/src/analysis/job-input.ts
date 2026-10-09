// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a device may ask its instance to write up** — #1095, ADR 0046 D-6,
 * #809's exclusions, #799's no-picture rule on the server path.
 *
 * `POST /v1/analysis/jobs` carries `{ input, templateVersion, source }`. The
 * device built `input` with `@onyourleft/analysis` §`rideAnalysisInput`, and
 * the instance trusts none of it: the body is checked here, in two passes, and
 * refused whole on the first fault.
 *
 * 1. **No picture**, before anything else is read ({@link pictureFaults}) —
 *    #799's body check, restated for a JSON body the instance receives: no
 *    `image_url` key and no part whose `type` a model server reads as a
 *    picture, no data URL, and no long run of base64 in any string. A picture
 *    is refused for being one, not merely for being the wrong shape, so the
 *    refusal says so.
 * 2. **The input's exact shape** ({@link readRideInput}): every key
 *    `RideAnalysisInput` declares and no other, every number finite, every
 *    string one of its own enumerations (the template version is the one
 *    free string, and it is held to a short token), at most
 *    {@link MAXIMUM_SECTIONS} sections, and the serialised whole inside
 *    {@link INPUT_BYTE_BUDGET}. A coordinate, a date, a name or an id has no
 *    key to arrive under (#809).
 *
 * Every refusal names the field and the rule, never the value (ADR 0004 D).
 */

import {
  INPUT_BYTE_BUDGET,
  MAXIMUM_SECTIONS,
  SECTION_KINDS,
  SIDE_OBSERVATION_KINDS,
  SIDE_POSE_SOURCES,
  type RideAnalysisInput,
} from '@onyourleft/analysis';

import type { FieldProblem } from '../errors.ts';

/** A part `type` a model server reads as a picture (#799). */
const PICTURE_PART_TYPES: ReadonlySet<string> = new Set([
  'image',
  'image_url',
  'input_image',
  'image_file',
]);

/** A data URL, of any media type. */
const DATA_URL = /\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i;

/** The shortest run of base64 alphabet that is read as an encoded blob (#822's bound). */
const BASE64_RUN = /[A-Za-z0-9+/_-]{100,}={0,2}/;

/**
 * Why `body` could be carrying a picture, naming where — empty when it is
 * text and numbers only. Walks every string, key and part type, at any depth.
 */
export function pictureFaults(body: unknown): string[] {
  const faults: string[] = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      if (DATA_URL.test(value)) faults.push(`${at} is a data URL`);
      if (BASE64_RUN.test(value)) faults.push(`${at} holds a long run of base64`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${at}[${String(index)}]`);
      });
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'image_url') faults.push(`${at}.${key} is a picture part`);
        if (key === 'type' && typeof entry === 'string' && PICTURE_PART_TYPES.has(entry)) {
          faults.push(`${at} is a part of type ${entry}`);
        }
        visit(entry, `${at}.${key}`);
      }
    }
  };
  visit(body, 'body');
  return faults;
}

/** A refusal: the fields at fault, by path and rule. */
export type InputRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fields: readonly FieldProblem[] };

/** Thrown inside the reader and caught at its edge: one field, one rule. */
class Refused extends Error {
  readonly field: string;
  readonly problem: string;
  constructor(field: string, problem: string) {
    super(problem);
    this.field = field;
    this.problem = problem;
  }
}

type Json = Readonly<Record<string, unknown>>;

function object(value: unknown, at: string, allowed: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refused(at, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Refused(`${at}.${key}`, 'is not a field of a ride input');
  }
  return value as Json;
}

function number(value: unknown, at: string, minimum = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Refused(at, minimum === 0 ? 'must be a number of at least 0' : 'must be a number');
  }
  return value;
}

function whole(value: unknown, at: string, minimum: number): number {
  const read = number(value, at, minimum);
  if (!Number.isInteger(read)) throw new Refused(at, 'must be a whole number');
  return read;
}

function optional<T>(json: Json, key: string, read: (value: unknown) => T): T | undefined {
  return json[key] === undefined ? undefined : read(json[key]);
}

function oneOf<T extends string>(value: unknown, at: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Refused(at, 'is not one of the values this instance knows');
  }
  return value as T;
}

function channel(value: unknown, at: string) {
  const json = object(value, at, ['coverage', 'mean', 'max']);
  const coverage = number(json.coverage, `${at}.coverage`, 0);
  if (coverage > 1) throw new Refused(`${at}.coverage`, 'must be from 0 to 1');
  const mean = optional(json, 'mean', (each) => number(each, `${at}.mean`));
  const max = optional(json, 'max', (each) => number(each, `${at}.max`));
  return {
    coverage,
    ...(mean === undefined ? {} : { mean }),
    ...(max === undefined ? {} : { max }),
  };
}

function metrics(value: unknown, at: string) {
  const json = object(value, at, ['power', 'heartRate', 'cadence', 'wattsPerKilogram']);
  const power = optional(json, 'power', (each) => channel(each, `${at}.power`));
  const heartRate = optional(json, 'heartRate', (each) => channel(each, `${at}.heartRate`));
  const cadence = optional(json, 'cadence', (each) => channel(each, `${at}.cadence`));
  const wattsPerKilogram = optional(json, 'wattsPerKilogram', (each) => {
    const pair = object(each, `${at}.wattsPerKilogram`, ['mean', 'max']);
    return {
      mean: number(pair.mean, `${at}.wattsPerKilogram.mean`),
      max: number(pair.max, `${at}.wattsPerKilogram.max`),
    };
  });
  return {
    ...(power === undefined ? {} : { power }),
    ...(heartRate === undefined ? {} : { heartRate }),
    ...(cadence === undefined ? {} : { cadence }),
    ...(wattsPerKilogram === undefined ? {} : { wattsPerKilogram }),
  };
}

function section(value: unknown, at: string) {
  const json = object(value, at, [
    'index',
    'kind',
    'minutes',
    'distanceKilometres',
    'meanGradientPercent',
    'elevationGainMetres',
    'laps',
    'metrics',
  ]);
  const distanceKilometres = optional(json, 'distanceKilometres', (each) =>
    number(each, `${at}.distanceKilometres`, 0),
  );
  const meanGradientPercent = optional(json, 'meanGradientPercent', (each) =>
    number(each, `${at}.meanGradientPercent`),
  );
  const elevationGainMetres = optional(json, 'elevationGainMetres', (each) =>
    number(each, `${at}.elevationGainMetres`, 0),
  );
  const laps = optional(json, 'laps', (each) => {
    const pair = object(each, `${at}.laps`, ['first', 'last']);
    return {
      first: whole(pair.first, `${at}.laps.first`, 1),
      last: whole(pair.last, `${at}.laps.last`, 1),
    };
  });
  return {
    index: whole(json.index, `${at}.index`, 1),
    kind: oneOf(json.kind, `${at}.kind`, SECTION_KINDS),
    minutes: number(json.minutes, `${at}.minutes`, 0),
    ...(distanceKilometres === undefined ? {} : { distanceKilometres }),
    ...(meanGradientPercent === undefined ? {} : { meanGradientPercent }),
    ...(elevationGainMetres === undefined ? {} : { elevationGainMetres }),
    ...(laps === undefined ? {} : { laps }),
    metrics: metrics(json.metrics, `${at}.metrics`),
  };
}

function pose(value: unknown, at: string) {
  const json = object(value, at, ['source', 'differences', 'posed', 'noRider', 'unreadable']);
  const differences = object(json.differences, `${at}.differences`, SIDE_OBSERVATION_KINDS);
  return {
    source: oneOf(json.source, `${at}.source`, SIDE_POSE_SOURCES),
    differences: Object.fromEntries(
      Object.entries(differences).map(([key, each]) => [
        key,
        number(each, `${at}.differences.${key}`),
      ]),
    ),
    posed: whole(json.posed, `${at}.posed`, 0),
    noRider: whole(json.noRider, `${at}.noRider`, 0),
    unreadable: whole(json.unreadable, `${at}.unreadable`, 0),
  };
}

/** A template version: a short token, and nothing a sentence could hide in. */
const TEMPLATE_VERSION = /^[A-Za-z0-9._/-]{1,32}$/;

/** `value` as a {@link RideAnalysisInput}, or the field at fault. */
export function readRideInput(value: unknown, at = 'input'): InputRead<RideAnalysisInput> {
  try {
    const json = object(value, at, [
      'templateVersion',
      'ride',
      'rider',
      'whole',
      'sections',
      'pose',
    ]);
    if (typeof json.templateVersion !== 'string' || !TEMPLATE_VERSION.test(json.templateVersion)) {
      throw new Refused(`${at}.templateVersion`, 'must be a template version');
    }
    const ride = object(json.ride, `${at}.ride`, ['movingMinutes', 'distanceKilometres']);
    const rider = object(json.rider, `${at}.rider`, ['massKilograms', 'thresholdPower']);
    const nullable = (each: unknown, field: string): number | null =>
      each === null ? null : number(each, field, 0);
    if (!Array.isArray(json.sections)) throw new Refused(`${at}.sections`, 'must be a list');
    if (json.sections.length > MAXIMUM_SECTIONS) {
      throw new Refused(`${at}.sections`, `must hold at most ${String(MAXIMUM_SECTIONS)} sections`);
    }
    const read: RideAnalysisInput = {
      templateVersion: json.templateVersion,
      ride: {
        movingMinutes: number(ride.movingMinutes, `${at}.ride.movingMinutes`, 0),
        distanceKilometres: number(ride.distanceKilometres, `${at}.ride.distanceKilometres`, 0),
      },
      rider: {
        massKilograms: nullable(rider.massKilograms, `${at}.rider.massKilograms`),
        thresholdPower: nullable(rider.thresholdPower, `${at}.rider.thresholdPower`),
      },
      whole: metrics(json.whole, `${at}.whole`),
      sections: json.sections.map((each, index) =>
        section(each, `${at}.sections[${String(index)}]`),
      ),
      ...(json.pose === undefined ? {} : { pose: pose(json.pose, `${at}.pose`) }),
    };
    if (new TextEncoder().encode(JSON.stringify(read)).byteLength > INPUT_BYTE_BUDGET) {
      throw new Refused(at, `must be at most ${String(INPUT_BYTE_BUDGET)} bytes`);
    }
    return { ok: true, value: read };
  } catch (error) {
    if (error instanceof Refused) {
      return { ok: false, fields: [{ field: error.field, problem: error.problem }] };
    }
    throw error;
  }
}
