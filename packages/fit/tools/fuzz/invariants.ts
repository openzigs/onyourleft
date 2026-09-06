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
 *
 * ## And the XML arm's three, which had none of this until #149
 *
 * The GPX/TCX arm watched the error type and nothing else, and #149 proved what
 * that is worth: **removing the element-nesting-depth guard from
 * `src/xml/parse.ts` left the fuzz suite at 8 passed of 8**. The reasoning above
 * transfers verbatim — a guard whose absence changes *what is reported* rather
 * than *whether something is thrown* is invisible to an error-type check — so
 * the XML arm now carries three more, each stated as a property of the output:
 *
 * - {@link assertDoctypeRefusedBeforeItsContents} — a document that carries a
 *   `<!DOCTYPE` and is refused must have been refused **at or before** the
 *   declaration, never after it. This is the one that turns
 *   `src/xml/parse.ts`'s whole security posture — *"a `<!DOCTYPE` is a fatal
 *   error before its contents are read"* — into something a fuzz case can
 *   contradict. Make the parser *skip* a DOCTYPE instead of refusing it and
 *   `billion-laughs.gpx` still throws, because the entity rule behind it
 *   catches `&lol6;` — but it throws at the reference rather than at the
 *   declaration, and this is what notices.
 * - {@link assertNestingWithinTheParsersLimit} — a document the reader
 *   *accepted* may not have nested deeper than `MAXIMUM_DEPTH`. Removing the
 *   depth check does not throw anything at all; it silently succeeds, which is
 *   precisely why the error type could not see it.
 * - {@link assertXmlOutputBoundedByInput} — the XML half of the
 *   unbounded-allocation criterion, and it takes three forms because an XML
 *   reader can inflate in three places: more track points, laps or faults than
 *   the document has characters to encode them in; more elements than
 *   characters; and **more character data out than there was text in**, which
 *   is entity expansion stated as arithmetic. A billion-laughs document is 753
 *   bytes and a million copies of `lol`; every escape this parser resolves
 *   shrinks (`&amp;` is five characters and yields one), so a reader that ever
 *   emits more characters than it was given has grown them from somewhere.
 *
 * The corpus had to grow for two of these to mean anything, which is the other
 * half of #149: `deep-nesting.gpx` and `deep-nesting.tcx` are committed
 * fixtures because no sequence of byte substitutions on a nominal file invents
 * three hundred levels of nesting.
 */

import type { FitContainer, FitDecodeResult } from '../../src/decode';
import { FitDecodeError } from '../../src/decode';
import type { ActivityXmlError, TrackDecodeResult } from '../../src/xml';
import { MAXIMUM_DEPTH, parseXml, trackPointsOf } from '../../src/xml';

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
export function assertTypedFailure(
  error: unknown,
  reproduction: string,
  expected: { new (...args: never[]): Error; readonly name: string } = FitDecodeError,
): void {
  // The expected type is a parameter, and defaults to `FitDecodeError`, because
  // the GPX/TCX arm needs `ActivityXmlError` and used to re-implement this
  // function inline to get it. That copy was never covered by `harness.test.ts`
  // -- so the XML arm could not go red, and the #146 review proved it: removing
  // the element-nesting-depth guard from `src/xml/parse.ts` left the fuzz suite
  // at 8 passed of 8. A harness with nothing proving it catches a failure is
  // the exact thing #128 exists to stop, and it had it in half its own body.
  if (error instanceof expected) return;
  const described =
    error instanceof Error ? `${error.name}: ${error.message}` : `a non-Error ${typeof error}`;
  throw new FuzzFailure(
    `decoding threw ${described}, which is not a ${expected.name}`,
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

// --- The GPX and TCX arm — #149 ---------------------------------------------

/** How a document is shaped, as the parser itself saw it. */
export interface XmlShape {
  /** The deepest the element stack ever got. */
  readonly maximumDepth: number;
  /** How many elements were opened. */
  readonly elements: number;
  /** How many characters of character data were handed to the consumer. */
  readonly textCharacters: number;
}

/**
 * Read a document once and record its shape.
 *
 * Called only after `decodeGpx` or `decodeTcx` has already accepted the text,
 * so this parse cannot fail — same parser, same input — and if it somehow does,
 * that disagreement is itself the finding. It is a second parse and that is the
 * price: the shape is a property of what the reader *did*, and
 * `TrackDecodeResult` deliberately carries no trace of it. The cost was
 * measured rather than assumed; see the budget note in `decode-fuzz.test.ts`.
 */
export function readXmlShape(text: string, reproduction: string): XmlShape {
  let depth = 0;
  let maximumDepth = 0;
  let elements = 0;
  let textCharacters = 0;
  try {
    parseXml(text, {
      startElement() {
        depth += 1;
        elements += 1;
        if (depth > maximumDepth) maximumDepth = depth;
      },
      endElement() {
        depth -= 1;
      },
      text(value) {
        textCharacters += value.length;
      },
    });
  } catch (cause) {
    throw new FuzzFailure(
      'the document was accepted by the importer and then refused by the parser underneath it, ' +
        'so one of the two is reading something the other is not',
      reproduction,
      cause,
    );
  }
  return { maximumDepth, elements, textCharacters };
}

/**
 * A `<!DOCTYPE` is refused **before** anything inside or after it is read.
 *
 * `src/xml/parse.ts`: *"a `<!DOCTYPE` is a fatal error before its contents are
 * read"*. That sentence is the whole XXE and billion-laughs defence, and until
 * #149 nothing in the fuzz could contradict it. Watching the error type cannot:
 * a parser that *skipped* the declaration instead of refusing it still throws on
 * `&xxe;` and `&lol6;`, because the second layer — only the five XML predefines
 * are resolved — catches the reference. It just throws **later**, and later is
 * the difference between a declaration that was never processed and one that
 * was.
 *
 * So the property is about *where* the refusal happened. Every fault carries a
 * character offset, the first `<!DOCTYPE` in the text has one too, and the first
 * must not be greater than the second.
 *
 * Only asserted on a failure. A document that was *accepted* while containing
 * the characters `<!DOCTYPE` has them somewhere the parser never treats as
 * markup — inside a comment, a CDATA section or an attribute value — and
 * refusing that would be wrong.
 */
export function assertDoctypeRefusedBeforeItsContents(
  text: string,
  error: unknown,
  reproduction: string,
): void {
  const declaration = firstDoctypeOffset(text);
  if (declaration === undefined) return;
  // A failure that is not an `ActivityXmlError` is `assertTypedFailure`'s to
  // report, and it has already reported it. Saying anything here would replace
  // that message with a worse one.
  if (!isActivityXmlError(error)) return;
  if (error.characterOffset <= declaration) return;
  throw new FuzzFailure(
    `the document declares a DOCTYPE at character ${String(declaration)} and was refused at ` +
      `character ${String(error.characterOffset)} with code "${error.code}" — after the ` +
      'declaration, so something inside it or beyond it was read first',
    reproduction,
  );
}

/**
 * A document the reader accepted did not nest deeper than it will go.
 *
 * The invariant `MAXIMUM_DEPTH` exists to maintain, stated as a property of the
 * output rather than as the presence of an `if`. Delete the check in
 * `src/xml/parse.ts` and nothing throws — the parser is iterative, so it
 * cheerfully accepts the document and builds a stack whose size the document
 * chose. That is the case #149 reproduced at 8 passed of 8, and this is what
 * turns it red.
 */
export function assertNestingWithinTheParsersLimit(shape: XmlShape, reproduction: string): void {
  if (shape.maximumDepth <= MAXIMUM_DEPTH) return;
  throw new FuzzFailure(
    `the document was accepted with elements nested ${String(shape.maximumDepth)} deep, past the ` +
      `${String(MAXIMUM_DEPTH)} this parser will go`,
    reproduction,
  );
}

/**
 * The reader may not produce more than the document could encode.
 *
 * The XML half of {@link assertOutputBoundedByInput}, and the same argument: a
 * track point costs characters to write, a lap costs characters, a fault names
 * a character offset, and an element costs at least its angle brackets. None of
 * those counts can exceed the document's own length.
 *
 * The last clause is the one that is not merely bookkeeping. **Character data
 * out may not exceed characters in.** Every escape this parser resolves is a
 * contraction — `&amp;` is five characters and yields one, `&#x1F600;` is nine
 * and yields two, a CDATA section costs twelve characters of delimiter — so the
 * text a well-behaved reader emits is bounded by the text it was handed. A
 * reader that resolved document-defined entities would break this by three
 * orders of magnitude on `billion-laughs.gpx`, and by whatever a file chose in
 * general. That is the unbounded allocation `SECURITY.md` puts in scope, and it
 * is the half no error type can show.
 */
export function assertXmlOutputBoundedByInput(
  shape: XmlShape,
  text: string,
  result: TrackDecodeResult,
  reproduction: string,
): void {
  const ceiling = text.length;
  const counts: readonly (readonly [string, number])[] = [
    ['track points', trackPointsOf(result.activity).length],
    ['laps', result.activity.laps.length],
    ['faults', result.faults.length],
    ['elements', shape.elements],
    ['characters of text', shape.textCharacters],
  ];
  for (const [what, count] of counts) {
    if (count > ceiling) {
      throw new FuzzFailure(
        `${String(count)} ${what} came out of a ${String(ceiling)} character document; every one ` +
          'of them costs at least a character of input',
        reproduction,
      );
    }
  }
}

/** Where the first `<!DOCTYPE` is, in either spelling, or `undefined`. */
function firstDoctypeOffset(text: string): number | undefined {
  // The two spellings `parse.ts` acts on, and not a case-insensitive search:
  // XML's own rule is that `DOCTYPE` is upper case and the parser admits the
  // all-lower-case form as a leniency. Matching more than the parser matches
  // would assert against a document it does not treat as declaring anything.
  const offsets = ['<!DOCTYPE', '<!doctype']
    .map((spelling) => text.indexOf(spelling))
    .filter((offset) => offset !== -1);
  return offsets.length === 0 ? undefined : Math.min(...offsets);
}

/**
 * Whether a thrown value carries the two fields this file reads off a fault.
 *
 * A structural test rather than `instanceof`, because by the time it runs
 * {@link assertTypedFailure} has already ruled on the class and the only
 * question left is whether the offset can be read. Keeping the class out of
 * this file keeps its failure messages about *where* rather than about *what*.
 */
function isActivityXmlError(error: unknown): error is ActivityXmlError {
  return (
    error instanceof Error &&
    typeof (error as ActivityXmlError).characterOffset === 'number' &&
    typeof (error as ActivityXmlError).code === 'string'
  );
}
