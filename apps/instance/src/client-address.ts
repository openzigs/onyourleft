// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which address a request came from, when the instance sits behind a proxy
 * (#775's carried point).
 *
 * The project's instance is reached through a Cloudflare Tunnel (ADR 0036
 * D-7): every request arrives from `cloudflared`, on the same machine or the
 * same container network, so the socket's peer is the SAME address for every
 * rider. A per-address rate limit counted on it is one shared bucket, and one
 * busy client blocks sign-in and registration for everybody. The rider's own
 * address is in a header the proxy sets — `CF-Connecting-IP` for Cloudflare.
 *
 * ## When the header is believed
 *
 * Only when the operator named the header (`OYL_INSTANCE_CLIENT_ADDRESS_HEADER`)
 * **and** the socket's peer is a proxy the operator trusts: a loopback
 * address, or one of the exact addresses in `OYL_INSTANCE_TRUSTED_PROXIES`.
 * Anything else carries whatever header its sender typed, so from any other
 * peer the header is ignored and the peer is the address.
 *
 * ⚠️ **Until #891's review any PRIVATE peer was believed**, and a reviewer who
 * remembers that is reading the old file. A port Docker publishes with `-p`
 * reaches the container from the bridge gateway (`172.17.0.1`), and on Docker
 * Desktop every published connection does — so any client on the internet
 * arrived "from a private address" and chose its own rate-limit bucket. An
 * operator whose proxy is on another address names it; publishing the port
 * on `127.0.0.1` only (`docs/moderation.md`) is what keeps that address the
 * proxy's alone.
 *
 * Pure, and naming nothing of Node, so the Durable Object adapter (#781) can
 * use it with `CF-Connecting-IP` too — it MUST pass a real address, or every
 * rider there shares one bucket as well.
 */

/** Whether `address` is loopback: IPv4 127/8 (also IPv4-mapped), or IPv6 `::1`. */
export function isLoopbackAddress(address: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.exec(address);
  if (v4 !== null) return Number(v4[1]) === 127;
  return address.toLowerCase() === '::1';
}

/** An address as it is compared: lower case, an IPv4-mapped IPv6 address as its IPv4. */
export function normalisedAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  return mapped?.[1] ?? lower;
}

/** Whether `text` looks like one IP address, for configuration. */
export function isAddress(text: string): boolean {
  return /^[0-9A-Fa-f:.]{2,45}$/.test(text) && (text.includes('.') || text.includes(':'));
}

/** A header value that is one IP address, or `undefined`. */
function oneAddress(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return /^[0-9A-Fa-f:.]{2,45}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * The client's address: the named header's, when the peer is a trusted proxy
 * — loopback, or one of `trustedProxies` — and the header holds one address;
 * otherwise the peer's. `null` when neither is known.
 */
export function clientAddress(
  peer: string | null,
  headers: Headers,
  trustedHeader: string | null,
  trustedProxies: readonly string[] = [],
): string | null {
  if (
    trustedHeader !== null &&
    peer !== null &&
    (isLoopbackAddress(peer) || trustedProxies.includes(normalisedAddress(peer)))
  ) {
    const forwarded = oneAddress(headers.get(trustedHeader));
    if (forwarded !== undefined) return forwarded;
  }
  return peer;
}
