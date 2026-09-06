// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ambient declaration for `fit-file-parser`, which ships no types.
 *
 * A second copy of the one in `packages/fit/tools/fit-file-parser.d.ts`, and
 * deliberately so: TypeScript resolves an ambient module declaration inside the
 * program that includes the file, and `apps/web`'s program does not include
 * `packages/fit/tools`. Pulling that file into this `tsconfig`'s `include`
 * would make the client's typecheck depend on the layout of another package's
 * authoring-time directory. Two independent declarations of a devDependency's
 * surface is the smaller cost, and neither can drift into the shipped bundle:
 * this library is imported from **one test file** and never from anything
 * `vite build` reaches.
 *
 * Why it is here at all: #51's fourth acceptance criterion is that an exported
 * file *"is accepted by a third-party reader, per #31"*. #31's revision block
 * rules on which reader — an independent non-Garmin decoder, as a test-time
 * devDependency that is never shipped, with `fit-file-parser` (MIT) named — and
 * ADR 0006 R1 rules out Garmin's own checker. Self-consistency between this
 * project's exporter and this project's decoder proves only that they share
 * assumptions.
 *
 * **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`,
 * `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or read
 * in the course of this work** (ADR 0006 R1, R4).
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
