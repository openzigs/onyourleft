// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT activity file decoder — #30.
 *
 * `decodeFitActivity` takes bytes and returns a domain object. It opens
 * nothing, fetches nothing and touches no browser API, which is the last of
 * #30's acceptance criteria and what lets #15 use it unchanged on a phone, in
 * a browser and (in Phase 3) on an instance. `tsconfig.platform-free.json`
 * enforces it: `src/` compiles with `lib: ["ES2024"]` and `types: []`, so
 * `node:fs`, `fetch` and even `TextDecoder` are compile errors here rather
 * than review findings.
 *
 * Everything obeys [ADR 0006](../../../../docs/adr/0006-fit-codec-licensing.md):
 * the container and the profile subset are implemented from the public FIT
 * protocol documentation and from the #29 fixture corpus, and
 * `packages/fit/README.md` records the provenance of every number as R2
 * requires. **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact,
 * `FitCSVTool`, `Fitgen` or `ActivityRepairTool` was consulted, downloaded,
 * installed or read** (R1, R4).
 */

import { decodeActivity } from './activity';
import type { FitDecodeResult } from './activity';
import { readFitContainer } from './container';

export type {
  FitActivity,
  FitActivitySummary,
  FitDateTime,
  FitDecodeResult,
  FitDeveloperApplication,
  FitDeveloperField,
  FitDeveloperFieldDescription,
  FitDeviceInfo,
  FitEvent,
  FitFileId,
  FitHeartRateEvent,
  FitLap,
  FitRecord,
  FitSession,
} from './activity';

export type { FitFieldValue } from './base-types';
export {
  BASE_TYPE_ENDIAN_FLAG,
  BASE_TYPE_NUMBER,
  BASE_TYPE_NUMBER_MASK,
  baseTypeElementSize,
  baseTypeName,
  baseTypeNumberOf,
  isInvalidByteArray,
  readFieldValue,
} from './base-types';

export type {
  FitContainer,
  FitDeveloperFieldDefinition,
  FitDeveloperFieldValue,
  FitFieldDefinition,
  FitFileHeader,
  FitMessage,
  FitMessageDefinition,
} from './container';
export {
  COMPRESSED_TIME_OFFSET_MASK,
  COMPRESSED_TIME_OFFSET_PERIOD,
  expandCompressedTimestamp,
  FIELD_TIMESTAMP,
  FIT_HEADER_SIZE,
  FIT_LEGACY_HEADER_SIZE,
  readFitContainer,
} from './container';

export { FIT_CRC_INITIAL_VALUE, FIT_CRC_REFLECTED_POLYNOMIAL, FIT_CRC_SIZE, fitCrc16 } from './crc';

export type { FitFaultCode } from './errors';
export { FitDecodeError } from './errors';

export {
  EVENT_TIMER,
  EVENT_TYPE_START,
  EVENT_TYPE_STOP,
  FIELD,
  FILE_TYPE_ACTIVITY,
  GLOBAL_MESSAGE,
  SCALE,
  SPORT_CYCLING,
} from './profile';

export { decodeActivity } from './activity';
export { decodeFitString, decodeUtf8, REPLACEMENT_CHARACTER } from './utf8';

/**
 * Decode a FIT activity file.
 *
 * @param bytes the whole file. Nothing is read from anywhere else.
 * @returns the activity, and every recoverable fault found on the way — each
 * carrying the byte offset it was found at. A truncated file returns the
 * records that were readable **and** a `truncated-record` fault, because
 * #30 requires that it *"must not discard the whole ride, and it must not
 * silently return an empty activity"*.
 * @throws {FitDecodeError} when nothing about the bytes can be believed: they
 * are too short for a header, they are not a FIT file, or a checksum says they
 * are not the bytes that were written.
 */
export function decodeFitActivity(bytes: Uint8Array): FitDecodeResult {
  return decodeActivity(readFitContainer(bytes));
}
