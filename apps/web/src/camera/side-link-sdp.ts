// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The few fields of a session description the side-camera link needs, read
 * out of one and written back into one** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1 and D-4.
 *
 * D-1 permits *"a compact encoding of those fields … instead of the SDP
 * text"*, and this module is why the link takes that option rather than
 * putting the browser's SDP in the QR code verbatim:
 *
 * - **Nothing the peer wrote reaches `setRemoteDescription`.** The remote
 *   description is BUILT here from fields `side-link-code.ts` has already
 *   bounded and checked, so a hostile code cannot smuggle a line — a TURN
 *   candidate, a second media section, an `a=` attribute nobody has read —
 *   into the browser's own parser.
 * - **The code is small enough to scan.** A Chrome data-channel offer is about
 *   600 characters; the fields are about 200.
 *
 * ## What is read, and what is refused
 *
 * One `m=application … webrtc-datachannel` section with `a=mid:0` and SCTP on
 * port 5000, which is what Chromium writes for a data-channel-only connection;
 * the ICE username fragment and password; a SHA-256 DTLS fingerprint; the DTLS
 * role; and every `a=candidate` line. Anything else in the SDP is ignored on
 * the way out, because it is the browser's own and never crosses — and a
 * description without one of the required fields is refused with
 * {@link SideSdpError}, because a code built from it could not connect.
 *
 * ## What happens to the candidates
 *
 * All of them are returned, with their transport and type, so that the
 * decision about which may cross is made in exactly one place:
 * `side-link-code.ts` §`candidateAccepted`. ⚠️ **The SDP written back declares
 * every candidate `udp` and `host`**, because that is the only kind a code can
 * carry at all — there is no field in the code for a type, so a relay or a
 * server-reflexive candidate is not something a scanned code can describe.
 */

/** The DTLS role a description takes, RFC 8842 §5. */
export type SideSetup = 'actpass' | 'active' | 'passive';

/** One ICE candidate, as far as the link cares. */
export interface SideCandidate {
  /** An IPv4 address, an IPv6 address WITHOUT brackets, or an mDNS name. */
  readonly address: string;
  readonly port: number;
  /** `udp` or `tcp`, lower-cased. */
  readonly transport: string;
  /** `host`, `srflx`, `prflx` or `relay`. */
  readonly type: string;
}

/** What one end has to tell the other to be connected to. */
export interface SidePeerParameters {
  readonly ufrag: string;
  readonly password: string;
  /** The 32 bytes of a SHA-256 certificate fingerprint. */
  readonly fingerprint: Uint8Array;
  readonly setup: SideSetup;
  readonly candidates: readonly SideCandidate[];
}

/** The one media section the link negotiates, as Chromium writes it. */
const MEDIA_ID = '0';
/** Chromium's SCTP port for a data channel, which the rebuilt description repeats. */
const SCTP_PORT = 5000;
/**
 * The largest message the rebuilt description says this end accepts: 256 KiB,
 * which is Chromium's own figure for a data channel. #529 sends commands of a
 * few dozen bytes; #530's pictures are ~20 KB (spike 0012 §1).
 */
const MAXIMUM_MESSAGE_BYTES = 262_144;
const FINGERPRINT_BYTES = 32;

/** A description the link cannot be built from. The message names the field, never a value. */
export class SideSdpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SideSdpError';
  }
}

/**
 * The link's fields, read out of a description this browser produced.
 *
 * @throws {SideSdpError} when a required field is missing or is not the shape
 * the link negotiates.
 */
export function sidePeerParametersFrom(sdp: string): SidePeerParameters {
  const lines = sdp.split(/\r?\n/).filter((line) => line !== '');
  const media = lines.filter((line) => line.startsWith('m='));
  if (
    media.length !== 1 ||
    !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(media[0] ?? '')
  ) {
    throw new SideSdpError('the description is not one data-channel section');
  }
  const attribute = (name: string): string | undefined => {
    const prefix = `a=${name}:`;
    return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
  };
  if (attribute('mid') !== MEDIA_ID) {
    throw new SideSdpError('the data-channel section is not the one the link negotiates');
  }
  if (attribute('sctp-port') !== String(SCTP_PORT)) {
    throw new SideSdpError('the data channel is not on the SCTP port the link negotiates');
  }
  const ufrag = attribute('ice-ufrag');
  const password = attribute('ice-pwd');
  if (ufrag === undefined || password === undefined) {
    throw new SideSdpError('the description carries no ICE credentials');
  }
  const fingerprint = fingerprintBytes(attribute('fingerprint'));
  const setup = attribute('setup');
  if (setup !== 'actpass' && setup !== 'active' && setup !== 'passive') {
    throw new SideSdpError('the description carries no DTLS role');
  }
  const candidates: SideCandidate[] = [];
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) {
      continue;
    }
    const candidate = candidateFrom(line.slice('a=candidate:'.length));
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  return { ufrag, password, fingerprint, setup, candidates };
}

function fingerprintBytes(value: string | undefined): Uint8Array {
  const match = /^sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})$/.exec(value ?? '');
  if (match?.[1] === undefined) {
    throw new SideSdpError('the description carries no SHA-256 fingerprint');
  }
  const bytes = new Uint8Array(FINGERPRINT_BYTES);
  for (const [index, pair] of match[1].split(':').entries()) {
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}

/**
 * One `a=candidate:` value, RFC 8839 §5.1, or `undefined` for a line that is
 * not an RTP component-1 candidate. The link has one component, so a
 * component-2 line — which a data channel never gathers — is not the link's.
 */
function candidateFrom(value: string): SideCandidate | undefined {
  const parts = value.split(' ');
  const [, component, transport, , address, port, typ, type] = parts;
  if (component !== '1' || typ !== 'typ' || transport === undefined || address === undefined) {
    return undefined;
  }
  const portNumber = Number(port);
  if (
    !Number.isInteger(portNumber) ||
    portNumber < 0 ||
    portNumber > 65_535 ||
    type === undefined
  ) {
    return undefined;
  }
  return { address, port: portNumber, transport: transport.toLowerCase(), type };
}

/**
 * The other end's description, built from checked fields only. The tablet
 * applies the phone's as an `answer`; the phone applies the tablet's as an
 * `offer`, and {@link SidePeerParameters.setup} is what differs between them.
 */
export function sdpFromSidePeerParameters(parameters: SidePeerParameters): string {
  const lines = [
    'v=0',
    'o=- 0 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${MEDIA_ID}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...parameters.candidates.map(
      (candidate, index) =>
        // Every candidate is a UDP host candidate: the code has no field that
        // could say otherwise. The priority is RFC 8445 §5.1.2.1's for a host
        // candidate, local preference descending in the order the code gave.
        `a=candidate:${String(index + 1)} 1 udp ${String(hostPriority(index))} ${candidate.address} ${String(candidate.port)} typ host`,
    ),
    'a=end-of-candidates',
    `a=ice-ufrag:${parameters.ufrag}`,
    `a=ice-pwd:${parameters.password}`,
    `a=fingerprint:sha-256 ${fingerprintText(parameters.fingerprint)}`,
    `a=setup:${parameters.setup}`,
    `a=mid:${MEDIA_ID}`,
    `a=sctp-port:${String(SCTP_PORT)}`,
    `a=max-message-size:${String(MAXIMUM_MESSAGE_BYTES)}`,
  ];
  return `${lines.join('\r\n')}\r\n`;
}

function hostPriority(index: number): number {
  // (2^24)·126 + (2^8)·(65535 − index) + (256 − 1): type preference 126 for a
  // host candidate, a local preference that falls with the code's order.
  return 126 * 2 ** 24 + (65_535 - index) * 2 ** 8 + 255;
}

function fingerprintText(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(':');
}
