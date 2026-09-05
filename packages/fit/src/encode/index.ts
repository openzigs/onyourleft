// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT activity file encoder — #31.
 *
 * `encodeFitActivity` takes the decoder's own shape and returns bytes. Like the
 * decoder it opens nothing, fetches nothing and touches no browser API;
 * `tsconfig.platform-free.json` makes that a compile-time property of `src/`
 * rather than a review finding.
 *
 * This is half of the interoperability story #19 chose: **a file the rider
 * exports and loads themselves needs no token, no paid tier, no partnership and
 * nobody's permission**, and it reaches Strava, Garmin Connect, TrainingPeaks
 * and a head unit equally. Which is also why the acceptance criterion for this
 * work is a *third party* reading the output — a file that only this project's
 * decoder accepts is a silo with extra steps.
 *
 * Everything obeys [ADR 0006](../../../../docs/adr/0006-fit-codec-licensing.md).
 * **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`,
 * `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or
 * read** (R1, R4). Every number used here comes from `decode/profile.ts`, whose
 * per-message provenance is in `packages/fit/README.md` §3.
 */

import type { FitEncodeInput, FitEncodeResult } from './activity';
import { encodeActivity } from './activity';

export type { FitEncodeInput, FitEncodeResult } from './activity';
export { encodeActivity } from './activity';

export type { FitEncodeFaultCode } from './errors';
export { FitEncodeError } from './errors';

export type {
  EncodeDeveloperFieldDefinition,
  EncodeFieldDefinition,
  EncodeMessageShape,
  EncodeValue,
} from './container';
export {
  BASE_TYPE,
  bytesValue,
  FIT_PROTOCOL_VERSION,
  FitContainerWriter,
  LOCAL_MESSAGE_TYPE_COUNT,
  numericValue,
  ONYOURLEFT_PROFILE_VERSION,
  textValue,
} from './container';

export { ByteSink } from './byte-sink';
export { encodeFitString, encodeUtf8, fitStringSize } from './utf8';
export { baseTypeRange, FieldSurvey, representable } from './fields';

/**
 * Encode a FIT activity file.
 *
 * @param activity the activity to write. `FitActivity` from
 * {@link decodeFitActivity} satisfies this structurally, so `encode(decode(x))`
 * needs no adapter — which is what makes the round-trip test in
 * `tools/fixture-corpus/encode-corpus.test.ts` a test of the encoder rather
 * than a test of a mapping written to make it pass.
 * @returns the bytes, and every field of the input that could not be carried
 * into them — each naming the message and field it came from. A caller that
 * ignores the faults still gets a valid file.
 * @throws {FitEncodeError} `too-many-message-types`, and only that: an
 * activity needing more than the sixteen local message types a FIT file can
 * bind at once has no file to write.
 */
export function encodeFitActivity(activity: FitEncodeInput): FitEncodeResult {
  return encodeActivity(activity);
}
