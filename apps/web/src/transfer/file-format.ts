// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of the three formats a file is, decided from the bytes rather than
 * from what the file is called.
 *
 * A bulk export from another platform is a directory of files somebody else
 * named. The extension is a hint and nothing more: a `.fit` that is really a
 * gzip, a `.gpx` that is really an HTML error page saved by a browser, and a
 * `.tcx` with a `.xml` extension are all things that turn up in a real archive.
 * So the extension picks the *candidate* and the leading bytes decide, and a
 * disagreement resolves in favour of the bytes.
 *
 * ⚠️ **Sniffing never reads more than {@link SNIFF_BYTES}.** The whole point of
 * a batch importer is that it is handed hundreds of files at once, and a
 * detector that decoded each one to find out what it was would decode every
 * file twice.
 */

/** The formats this client can read. `.fit.gz` is not one of them — see below. */
export type ActivityFileFormat = 'fit' | 'gpx' | 'tcx';

/**
 * How far into a file the sniffer looks.
 *
 * Twelve bytes is what FIT needs — its `.FIT` signature sits at offset 8 — and
 * an XML document's root element can be a long way past that behind a
 * declaration, a byte-order mark and comments, so the XML arm gets a larger
 * window. 512 bytes is enough for every file in the #29 corpus and small enough
 * that decoding it as text costs nothing.
 */
export const SNIFF_BYTES = 512;

/** The `.FIT` signature, at offset 8 of every FIT file. See `packages/fit`. */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];
const FIT_SIGNATURE_OFFSET = 8;

/** The extension, lowercased, with no dot. `''` for a file that has none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Whether the bytes carry the FIT signature.
 *
 * Exported because "is this a FIT file at all" is a different question from
 * "which format is this", and the import report answers both: a `.fit` that is
 * not one is worth naming as such rather than as a generic decode failure.
 */
export function hasFitSignature(bytes: Uint8Array): boolean {
  return FIT_SIGNATURE.every((byte, index) => bytes[FIT_SIGNATURE_OFFSET + index] === byte);
}

/**
 * The first {@link SNIFF_BYTES} of a file as text, for the XML arm.
 *
 * Lenient rather than `fatal: true`: a FIT file decoded as UTF-8 is mostly
 * replacement characters, and that is a perfectly good answer here — it simply
 * does not match any of the XML patterns below. A fatal decoder would throw on
 * the common case of "this is binary", which is not an error at this layer.
 */
function sniffText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(0, SNIFF_BYTES));
}

/**
 * The format of a file, or `undefined` for one this client cannot read.
 *
 * `undefined` is an ordinary outcome, not a failure of this function: a real
 * bulk export contains `activities.csv`, `media/`, a `.fit.gz` per ride and
 * whatever else the exporting platform felt like including, and the batch
 * importer's contract is that each of those is reported by name and the rest of
 * the archive still imports.
 */
export function detectActivityFileFormat(
  fileName: string,
  bytes: Uint8Array,
): ActivityFileFormat | undefined {
  if (hasFitSignature(bytes)) {
    return 'fit';
  }
  const text = sniffText(bytes);
  // The root element decides between the two XML formats. Matched with the
  // namespace prefix optional, because both formats are written in the wild
  // with one — `<gpx:gpx>` is rare and real.
  if (/<(?:[\w.-]+:)?gpx[\s>]/.test(text)) {
    return 'gpx';
  }
  if (/<(?:[\w.-]+:)?TrainingCenterDatabase[\s>]/.test(text)) {
    return 'tcx';
  }
  // Only now does the extension get a say, and only for a file whose bytes said
  // nothing. It matters for the *empty* and the *truncated* cases: a
  // zero-length `.fit` carries no signature and an XML document whose root
  // element is past the sniff window carries no root, and for both of those the
  // decoder's own diagnostic — "too short for a header", "ended mid-element" —
  // is the one the rider can act on. Reporting them as "unsupported format"
  // would replace a precise answer with a wrong one.
  const extension = extensionOf(fileName);
  if (extension === 'fit' || extension === 'gpx' || extension === 'tcx') {
    return extension;
  }
  return undefined;
}
