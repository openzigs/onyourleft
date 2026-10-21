// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of this client's own FIT splits are laps of a course — #1320, the FIT
 * half of #1321's mark.
 *
 * Since #1316 a FIT file this client writes for a lapped ride has more splits
 * than the ride has laps: the time before the first line, between two laps
 * that do not meet, and after the last each get a split of their own. TCX says
 * which is which with `Intensity` and `TriggerMethod`. FIT's own lap fields for
 * that wait on #1471 (ADR 0006 R2), so this client says it with a **developer
 * field of its own**: one `uint8` on every lap message, declared by a
 * `developer_data_id` carrying {@link FIT_APPLICATION_ID} and a
 * `field_description` naming {@link FIT_LAP_KIND_NAME}.
 *
 * ⚠️ **No number here is from Garmin's profile.** A developer field's number,
 * its name and its values are the application's own to choose, which is what
 * developer data is for; the messages that declare one, `developer_data_id`
 * and `field_description`, are already in `packages/fit`'s subset on the #29
 * corpus's evidence (`packages/fit/README.md` §Sources). A reader that does not
 * know this application ignores the field, as the protocol says it may.
 *
 * | value | the split |
 * |---:|---|
 * | 0 | outside every lap: a lead-in, a gap or a tail |
 * | 1 | a whole lap, ended at the line |
 * | 2 | a part lap, ended by the rider |
 *
 * A ride with no laps is written with no mark and no declaration, as it always
 * was, to the byte (`export-activity.test.ts`, the digests of #1316).
 *
 * The format is permanent: [ADR 0053](../../../../docs/adr/0053-the-fit-lap-mark-a-developer-field-of-our-own.md)
 * records the owner's ruling of 2026-10-21, and a file carrying the mark stays
 * readable for good.
 */

import {
  BASE_TYPE_NUMBER,
  type FitActivity,
  type FitDeveloperApplication,
  type FitDeveloperField,
  type FitDeveloperFieldDescription,
} from '@onyourleft/fit';

/** A split as the mark says it. */
export type FitLapKind = 'outside' | 'lap' | 'part';

/**
 * This client's FIT application, a version 4 UUID drawn once for #1320. It
 * names the application and nothing else: it is the same in every file, so it
 * says nothing about the rider or the device.
 */
export const FIT_APPLICATION_ID: Uint8Array = Uint8Array.of(
  0x05,
  0xca,
  0xf2,
  0x69,
  0xea,
  0xf0,
  0x4c,
  0x85,
  0xbf,
  0xae,
  0x12,
  0xfe,
  0x9e,
  0x66,
  0xd9,
  0x73,
);

/** The developer data index this client's export declares its application at. */
const DEVELOPER_DATA_INDEX = 0;
/** The mark's field definition number within this client's application. */
export const FIT_LAP_KIND_FIELD = 0;
/** The mark's name in its `field_description`, for a reader that lists fields. */
export const FIT_LAP_KIND_NAME = 'oyl_lap_kind';

const VALUE_OF: Readonly<Record<FitLapKind, number>> = { outside: 0, lap: 1, part: 2 };
const KIND_OF: readonly FitLapKind[] = ['outside', 'lap', 'part'];

/** What an export declares once, before the laps that carry the mark. */
export function fitLapMarkDeclarations(): {
  readonly developerApplications: readonly FitDeveloperApplication[];
  readonly developerFieldDescriptions: readonly FitDeveloperFieldDescription[];
} {
  return {
    developerApplications: [
      {
        developerDataIndex: DEVELOPER_DATA_INDEX,
        applicationId: FIT_APPLICATION_ID,
        manufacturerId: undefined,
        applicationVersion: undefined,
      },
    ],
    developerFieldDescriptions: [
      {
        developerDataIndex: DEVELOPER_DATA_INDEX,
        fieldDefinitionNumber: FIT_LAP_KIND_FIELD,
        fitBaseTypeId: BASE_TYPE_NUMBER.uint8,
        name: FIT_LAP_KIND_NAME,
        units: undefined,
      },
    ],
  };
}

/** The mark one lap message carries. */
export function fitLapMarkOf(kind: FitLapKind): FitDeveloperField {
  return {
    developerDataIndex: DEVELOPER_DATA_INDEX,
    fieldDefinitionNumber: FIT_LAP_KIND_FIELD,
    name: FIT_LAP_KIND_NAME,
    units: undefined,
    numeric: VALUE_OF[kind],
    text: undefined,
    bytes: Uint8Array.of(VALUE_OF[kind]),
  };
}

/**
 * What a decoded file's marks say of its laps.
 *
 * - `unmarked`: the file declares no application of this client's — every
 *   file from elsewhere, and every FIT this client wrote before #1320.
 * - `broken`: it declares this client's application and a lap's mark is
 *   missing or is not a value above. A file is untrusted input, so its laps are
 *   then not listed, rather than a guess listing a lead-in as a lap.
 * - otherwise one kind per lap, in the file's order.
 *
 * Matched by the application's id rather than its index, which the file
 * chooses; the first declaration of the id is the one read.
 */
export function fitLapKindsOf(
  activity: Pick<FitActivity, 'developerApplications' | 'laps'>,
): readonly FitLapKind[] | 'unmarked' | 'broken' {
  const application = activity.developerApplications.find((candidate) =>
    sameBytes(candidate.applicationId, FIT_APPLICATION_ID),
  );
  if (application === undefined) return 'unmarked';
  const index = application.developerDataIndex;
  if (index === undefined) return 'broken';
  const kinds: FitLapKind[] = [];
  for (const lap of activity.laps) {
    const mark = lap.developerFields.find(
      (field) =>
        field.developerDataIndex === index && field.fieldDefinitionNumber === FIT_LAP_KIND_FIELD,
    );
    const kind = mark?.bytes.length === 1 ? KIND_OF[mark.bytes[0] ?? -1] : undefined;
    if (kind === undefined) return 'broken';
    kinds.push(kind);
  }
  return kinds;
}

function sameBytes(found: Uint8Array | undefined, expected: Uint8Array): boolean {
  return (
    found !== undefined &&
    found.length === expected.length &&
    found.every((byte, index) => byte === expected[index])
  );
}
