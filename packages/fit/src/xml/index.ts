// SPDX-License-Identifier: Apache-2.0

/**
 * GPX 1.1 and TCX v2 import and export — #32.
 *
 * `decodeGpx` / `decodeTcx` take text and return a {@link TrackActivity} in
 * `@onyourleft/domain` quantities; `encodeGpx` / `encodeTcx` go the other way.
 * Nothing here opens a file, resolves a URI or reaches the network, and
 * `tsconfig.platform-free.json` makes that a compile-time property rather than
 * a claim.
 *
 * ## The security posture, in one paragraph
 *
 * `SECURITY.md` puts activity file parsing in scope and names **XXE in GPX and
 * TCX specifically**. The parser under this directory is this package's own
 * (`parse.ts`), and it refuses a `<!DOCTYPE` outright rather than configuring a
 * general-purpose parser to be safe. A DTD is the only place an XML document
 * can declare an entity, so refusing the declaration closes external entity
 * resolution and billion-laughs entity expansion at the same point and by the
 * same rule. Behind it, the only entity references resolved at all are the five
 * XML predefines and numeric character references — so `&xxe;` in a document
 * with no DOCTYPE is an error rather than a passthrough. Both layers are
 * asserted against the committed hostile fixtures, and both were watched to
 * fail.
 */

export type { ActivityXmlFaultCode } from './errors';
export { ActivityXmlError } from './errors';

export type { XmlAttribute, XmlHandler, XmlName, XmlStartElement } from './parse';
export { MAXIMUM_DEPTH, parseXml, XML_NAMESPACE } from './parse';

export type { TrackActivity, TrackDecodeResult, TrackLap, TrackPoint } from './track';
export { trackPointsOf } from './track';

export type { ExtensionChannel } from './extensions';
export {
  extensionChannelOf,
  GPX_POWER_EXTENSION_V1,
  GPX_TRACK_POINT_EXTENSION_V1,
  GPX_TRACK_POINT_EXTENSION_V2,
  TCX_ACTIVITY_EXTENSION_V2,
} from './extensions';

export { formatIsoInstant, parseIsoInstant } from './iso-time';

export {
  decodeGpx,
  encodeGpx,
  GPX_1_0_NAMESPACE,
  GPX_CREATOR,
  GPX_LOSSY_CHANNELS,
  GPX_NAMESPACE,
  withoutGpxLossyChannels,
} from './gpx';

export {
  decodeTcx,
  encodeTcx,
  TCX_CREATOR,
  TCX_LOSSY_CHANNELS,
  TCX_NAMESPACE,
  withoutTcxLossyChannels,
} from './tcx';

export { decimal, degrees, escapeXmlAttribute, escapeXmlText, integer, XmlWriter } from './write';
