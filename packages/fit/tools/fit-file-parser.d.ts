// SPDX-License-Identifier: Apache-2.0

/**
 * A minimal ambient declaration for `fit-file-parser`, which ships no types.
 *
 * Only the surface `tools/fixture-corpus/third-party-acceptance.test.ts` uses is
 * declared. It is deliberately not a re-description of the library: a fuller
 * shim would be a maintenance burden for a devDependency whose only job is to
 * disagree with us, and a wrong one would turn a real disagreement into a type
 * error.
 *
 * The library itself is a **test-time devDependency of `packages/fit`, never
 * shipped**, adopted under the ruling in
 * [#31](https://github.com/openzigs/onyourleft/issues/31)'s revision block. See
 * `packages/fit/README.md` §1 for why that is consistent with ADR 0006 rather
 * than an exception to it.
 */
declare module 'fit-file-parser' {
  interface FitParserOptions {
    readonly force?: boolean;
    readonly speedUnit?: 'm/s' | 'km/h' | 'mph';
    readonly lengthUnit?: 'm' | 'km' | 'mi';
    readonly temperatureUnit?: 'celsius' | 'kelvin' | 'fahrenheit';
    readonly elapsedRecordField?: boolean;
    readonly mode?: 'cascade' | 'list' | 'both';
  }

  /** One decoded `record` message, in whatever units the options asked for. */
  interface ParsedRecord {
    readonly timestamp?: Date;
    readonly position_lat?: number;
    readonly position_long?: number;
    readonly altitude?: number;
    readonly distance?: number;
    readonly speed?: number;
    readonly heart_rate?: number;
    readonly cadence?: number;
    readonly power?: number;
    readonly temperature?: number;
  }

  interface ParsedFit {
    readonly protocolVersion?: number;
    readonly profileVersion?: number;
    readonly records?: readonly ParsedRecord[];
    readonly sessions?: readonly Record<string, unknown>[];
    readonly laps?: readonly Record<string, unknown>[];
    readonly events?: readonly Record<string, unknown>[];
    readonly activity?: Record<string, unknown>;
    readonly file_ids?: readonly Record<string, unknown>[];
    readonly device_infos?: readonly Record<string, unknown>[];
  }

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(
      content: ArrayBuffer,
      callback: (error: string | undefined, data: ParsedFit) => void,
    ): void;
  }
}
