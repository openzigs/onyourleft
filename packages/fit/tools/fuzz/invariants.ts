// SPDX-License-Identifier: Apache-2.0

/**
 * What must hold for **every** input, valid or not — #128.
 *
 * These are not `expect` calls, for the reason `@onyourleft/store/testing`
 * gives: an assertion that throws its own failure can be run against a
 * deliberately broken implementation and required to go red, which is the only
 * honest proof that a harness catches anything. `harness.test.ts` in this
 * directory does exactly that.
 *
 * ## The floor, and why it is not the whole ceiling
 *
 * #128 names the floor: *"every input must produce either a correct decode or a
 * `FitDecodeError` … a `RangeError`, a `TypeError`, an out-of-bounds `DataView`
 * read, a hang, or an unbounded allocation is a failure"*. That is
 * {@link assertTypedFailure} and it is necessary.
 *
 * It is **not sufficient**, and the mutation #128 names proves it. Removing the
 * developer-field term from `container.ts`'s record-length check — #125's M16
 * defect — does not throw anything. `Uint8Array.prototype.subarray` clamps its
 * arguments rather than raising, so an over-long record reads fewer bytes than
 * it declared and reports them as a message; the error type is unchanged and a
 * fuzz test that only watched the error type would stay green while the bounds
 * check was gone. So there are two more invariants:
 *
 * - {@link assertMessagesInsideTheDataSection} — no message may report bytes
 *   from outside the data section the header declared. This is what the record
 *   length check is *for*, stated as a property of the output.
 * - {@link assertOutputBoundedByInput} — the decoder may not report more
 *   messages, records or faults than the input could encode. This is the
 *   unbounded-allocation half of the criterion, which no error type can show.
 */

import type { FitContainer, FitDecodeResult } from '../../src/decode';
import { FitDecodeError } from '../../src/decode';

/** A fuzz invariant that did not hold, with the case that broke it. */
export class FuzzFailure extends Error {
  override readonly name = 'FuzzFailure';

  constructor(what: string, reproduction: string, cause?: unknown) {
    super(`${what}\n  reproduce with: ${reproduction}`, cause === undefined ? {} : { cause });
  }
}

/**
 * The floor: a decoder handed rubbish either returns, or throws the one error
 * type it documents.
 *
 * Anything else — a `RangeError` off a `DataView`, a `TypeError` off an
 * undefined read, a bare `Error` — is a decoder that has left its own contract,
 * and is what `SECURITY.md` means by *"malformed input must produce an error"*.
 */
export function assertTypedFailure(error: unknown, reproduction: string): void {
  if (error instanceof FitDecodeError) return;
  const described =
    error instanceof Error ? `${error.name}: ${error.message}` : `a non-Error ${typeof error}`;
  throw new FuzzFailure(
    `decoding threw ${described}, which is not a FitDecodeError`,
    reproduction,
    error,
  );
}

/**
 * No message may report bytes the data section does not contain.
 *
 * The data section runs from the end of the header to the end the header
 * declares, clamped to the bytes that are actually present. Every field and
 * every developer field carries the offset it was read from and the bytes it
 * was given; both have to fall inside.
 *
 * This is the invariant `readDataMessage`'s length check exists to maintain,
 * and it is stated here as a property of the *output* precisely so that
 * deleting the check is visible. Note it has to consider developer fields
 * explicitly: they are the half M16 dropped, and a check written over native
 * fields alone would have passed over the defect that motivated this file.
 */
export function assertMessagesInsideTheDataSection(
  container: FitContainer,
  input: Uint8Array,
  reproduction: string,
): void {
  const { headerSize, dataSize } = container.header;
  const end = Math.min(headerSize + dataSize, input.length);
  for (const message of container.messages) {
    if (message.byteOffset < headerSize || message.byteOffset >= end) {
      throw new FuzzFailure(
        `a message is reported at byte ${String(message.byteOffset)}, outside the data section ` +
          `[${String(headerSize)}, ${String(end)})`,
        reproduction,
      );
    }
    for (const field of message.fields) {
      if (field.byteOffset + field.bytes.length > end) {
        throw new FuzzFailure(
          `field ${String(field.number)} of global message ` +
            `${String(message.globalMessageNumber)} reports ${String(field.bytes.length)} bytes ` +
            `from byte ${String(field.byteOffset)}, which runs past the end of the data at byte ` +
            String(end),
          reproduction,
        );
      }
    }
    for (const field of message.developerFields) {
      if (field.byteOffset + field.bytes.length > end) {
        throw new FuzzFailure(
          `developer field ${String(field.fieldDefinitionNumber)} of global message ` +
            `${String(message.globalMessageNumber)} reports ${String(field.bytes.length)} bytes ` +
            `from byte ${String(field.byteOffset)}, which runs past the end of the data at byte ` +
            String(end),
          reproduction,
        );
      }
    }
  }
}

/**
 * The decoder may not produce more than the input could encode.
 *
 * Every record in a FIT file costs at least its one-byte record header, so the
 * message count can never exceed the byte count; the decoded collections are
 * each drawn from those messages, and every fault names a message or a field.
 * A decoder that looped without consuming input, or that expanded a declared
 * count into an allocation, breaks this long before it exhausts memory — which
 * matters because a test process that runs out of memory reports nothing
 * useful, and `SECURITY.md` puts resource exhaustion on a parsed file in scope.
 */
export function assertOutputBoundedByInput(
  container: FitContainer,
  result: FitDecodeResult,
  input: Uint8Array,
  reproduction: string,
): void {
  const ceiling = input.length;
  const counts: readonly (readonly [string, number])[] = [
    ['messages', container.messages.length],
    ['records', result.activity.records.length],
    ['laps', result.activity.laps.length],
    ['sessions', result.activity.sessions.length],
    ['events', result.activity.events.length],
    ['heart rate events', result.activity.heartRateEvents.length],
    ['developer field descriptions', result.activity.developerFieldDescriptions.length],
    ['faults', result.faults.length],
  ];
  for (const [what, count] of counts) {
    if (count > ceiling) {
      throw new FuzzFailure(
        `${String(count)} ${what} decoded from ${String(ceiling)} bytes; every one of them ` +
          'costs at least a byte of input',
        reproduction,
      );
    }
  }
}
