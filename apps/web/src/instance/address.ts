// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which instance addresses this app will talk to, decided before any request
 * is built (#777).
 *
 * ## `https://`, and `wss://` for a room — and why
 *
 * - **Inside the Android shell the app is served from `https://localhost`**
 *   (ADR 0002's 2026-09-19 amendment), so a plain `http://` instance is mixed
 *   content and the WebView refuses it. #553 had to route one LAN request
 *   natively for exactly that reason; instance traffic is not routed around
 *   the WebView, so an `http://` address would fail on Android whatever this
 *   module said.
 * - **A session token, a signed statement and, later, a ride travel on this
 *   path.** Unencrypted, anybody on the network between the rider and the
 *   instance could read or change them.
 *
 * So an address is `https:`, or `http:` to this machine's own loopback —
 * `localhost`, `127.0.0.1`, `[::1]` — which is what running an instance on
 * the computer in front of you for development needs, and which never leaves
 * that computer. Anything else is refused with a sentence that says why,
 * **before** the transport is built: `instance-transport.ts` checks the same
 * decision again, and a test counts the requests a refused address made.
 *
 * The socket a room will open (#782) follows the address: `wss:` for
 * `https:`, `ws:` for a loopback `http:` — {@link InstanceAddress.socketOrigin},
 * so no other module decides that.
 *
 * ## What an address is
 *
 * An ORIGIN: a scheme, a host and a port. A path, a query, a fragment or a
 * user name in what the rider typed is refused rather than dropped, because an
 * address that means something other than what was typed is worse than one
 * that is refused. A bare host (`ride.example`) is read as `https://`.
 */

/** An address this app may talk to. */
export interface InstanceAddress {
  readonly kind: 'accepted';
  /** `https://ride.example` — what a device statement names (ADR 0014 D-8). */
  readonly origin: string;
  /** `wss://ride.example` — where a room's socket goes (#782). */
  readonly socketOrigin: string;
}

/** Why an address was refused. */
export type AddressRefusal =
  'empty' | 'unreadable' | 'not-encrypted' | 'not-a-web-address' | 'not-just-an-address';

export type AddressDecision =
  InstanceAddress | { readonly kind: 'refused'; readonly why: AddressRefusal };

/**
 * What the rider is told for each refusal.
 *
 * ⚠️ **Draft wording awaiting the owner's approval** (#880): new in-app text.
 */
export const ADDRESS_REFUSAL_TEXT: Readonly<Record<AddressRefusal, string>> = {
  empty: 'Type the address of the instance you want to connect to.',
  unreadable: 'That is not an address this app can read. It looks like https://ride.example.',
  'not-encrypted':
    'That address starts with http://, which is not encrypted: anybody on the network between ' +
    'you and the instance could read your sign-in, and the Android app cannot reach it at all. ' +
    'Use the address that starts with https://. Only an instance on this computer — localhost — ' +
    'may use http://.',
  'not-a-web-address': 'An instance address starts with https://.',
  'not-just-an-address':
    'Type the instance’s address on its own — https://ride.example — with no path, query or ' +
    'name before it.',
};

/** The hosts that are this machine, where `http:` never crosses a network. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Whether `hostname` (as `URL` gives it) is this machine's own loopback. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname.toLowerCase());
}

/** Decide whether this app may talk to the address a rider typed. */
export function instanceAddress(typed: string): AddressDecision {
  const text = typed.trim();
  if (text === '') {
    return { kind: 'refused', why: 'empty' };
  }
  // A bare host is read as https — never as http.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { kind: 'refused', why: 'unreadable' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'refused', why: 'not-a-web-address' };
  }
  if (url.hostname === '') {
    return { kind: 'refused', why: 'unreadable' };
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return { kind: 'refused', why: 'not-encrypted' };
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== '' ||
    // `URL` drops an empty `?` or `#`; the text did not.
    /[?#]/.test(withScheme.slice(url.protocol.length + 2))
  ) {
    return { kind: 'refused', why: 'not-just-an-address' };
  }
  return {
    kind: 'accepted',
    origin: url.origin,
    socketOrigin: `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`,
  };
}
