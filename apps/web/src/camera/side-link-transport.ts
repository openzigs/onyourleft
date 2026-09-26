// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one place this client names a WebRTC peer connection, and what it is
 * pointed at** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1 and D-9.
 *
 * `privacy/no-network.test.ts` §`PERMITTED_NETWORK_CALLS` permits exactly one
 * naming of `RTCPeerConnection`, in this file, and is red for a second here or
 * a first anywhere else (D-9 steps 1 and 2). That scan counts names and
 * cannot see a configuration, so {@link SIDE_LINK_CONFIGURATION} is asserted
 * by `side-link-transport.test.ts` instead (D-9 step 3): **no ICE server of
 * any kind** — no STUN, no TURN, no third-party ICE service — and no
 * relay-only policy.
 *
 * ## Why the rest of the link never sees the platform type
 *
 * {@link SidePeer} and {@link SideChannel} are the slice of the platform's
 * peer connection and data channel the link uses, written out here so that
 * `side-link.ts` can be driven end to end in jsdom — which implements no
 * WebRTC at all — by `testing.ts` §`pairedSidePeers`, and so that the one
 * cast from the platform's type to this one is in the file the gate is
 * pointed at. It is `browser-camera.ts`' `MediaStreamLike` move.
 *
 * ## Where this has run, and where it has not
 *
 * `browser/sidelink.browser.spec.ts` pairs two of these in the pinned
 * Chromium, through the real codes, and drives a start and a stop across.
 * Two Android WebViews on one LAN were measured by spike 0012 with the same
 * configuration — but NOT with this file, whose first run on a device is
 * [#529](https://github.com/openzigs/onyourleft/issues/529)'s own device
 * check, recorded in the pull request.
 */

/** A description, as the platform hands one over and takes one back. */
export interface SideDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp: string;
}

/** The slice of a data channel the link uses. */
export interface SideChannel {
  readonly label: string;
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

/** The slice of a peer connection the link uses. */
export interface SidePeer {
  createDataChannel(label: string, init: { readonly ordered: boolean }): SideChannel;
  createOffer(): Promise<SideDescription>;
  createAnswer(): Promise<SideDescription>;
  setLocalDescription(description: SideDescription): Promise<void>;
  setRemoteDescription(description: SideDescription): Promise<void>;
  readonly localDescription: SideDescription | null;
  readonly iceGatheringState: string;
  readonly connectionState: string;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  ondatachannel: ((event: { readonly channel: SideChannel }) => void) | null;
  close(): void;
}

/**
 * What every side-link peer connection is built with: **nothing but an empty
 * list of ICE servers.**
 *
 * With no server, a connection gathers host candidates and nothing else, so
 * there is no request to any STUN or TURN host to make. `iceTransportPolicy`
 * is left at its default, `all`: `relay` would demand a TURN server, which is
 * the one thing D-1 forbids, and with no server it could never connect.
 */
export const SIDE_LINK_CONFIGURATION: {
  readonly iceServers: readonly never[];
} = Object.freeze({ iceServers: Object.freeze([]) });

/** What the platform's constructor is called with. Structural, for the test. */
type PeerConstructor = new (configuration: typeof SIDE_LINK_CONFIGURATION) => unknown;

/**
 * The platform's constructor, or `undefined` where it has none.
 *
 * ⚠️ **The one naming** `no-network.test.ts` permits, and the only line in the
 * client that reaches the platform's peer connection. Reached through the
 * global rather than as a bare identifier so that a platform without it is
 * `undefined` here instead of a `ReferenceError`.
 */
function peerConstructor(platform: object): PeerConstructor | undefined {
  const Peer = (platform as { readonly RTCPeerConnection?: PeerConstructor }).RTCPeerConnection;
  return typeof Peer === 'function' ? Peer : undefined;
}

/**
 * Whether this platform can make a side-camera link at all — `main.tsx` builds
 * no pairing port where it cannot, and both screens then say so in words.
 */
export function sideLinkAvailable(platform: object = globalThis): boolean {
  return peerConstructor(platform) !== undefined;
}

/**
 * A new peer connection pointed at nothing but {@link SIDE_LINK_CONFIGURATION},
 * or `undefined` where this platform has no WebRTC.
 *
 * `platform` is the global object; a test hands it one whose constructor
 * records what it was given.
 */
export function createSidePeer(platform: object = globalThis): SidePeer | undefined {
  const Peer = peerConstructor(platform);
  // The platform boundary: above this line nothing names the platform's type.
  return Peer === undefined ? undefined : (new Peer(SIDE_LINK_CONFIGURATION) as SidePeer);
}
