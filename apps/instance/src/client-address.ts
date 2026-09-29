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
 * **and** the socket's peer is a loopback or private address — where a
 * proxy the operator runs would be. A request straight from the internet
 * carries whatever header its sender typed, so from a public peer the header
 * is ignored and the peer is the address. ⚠️ A client on the operator's own
 * private network can set the header and be believed; that network is the
 * operator's to trust or not.
 *
 * Pure, and naming nothing of Node, so the Durable Object adapter (#781) can
 * use it with `CF-Connecting-IP` too — it MUST pass a real address, or every
 * rider there shares one bucket as well.
 */

/** Whether `address` is loopback or private: IPv4 10/8, 172.16/12, 192.168/16, 127/8; IPv6 ::1, fc00::/7, fe80::/10. */
export function isLocalAddress(address: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i.exec(address);
  if (v4 !== null) {
    const first = Number(v4[1]);
    const second = Number(v4[2]);
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  const v6 = address.toLowerCase();
  return v6 === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
}

/** A header value that is one IP address, or `undefined`. */
function oneAddress(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return /^[0-9A-Fa-f:.]{2,45}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * The client's address: the named header's, when the peer is local and the
 * header holds one address; otherwise the peer's. `null` when neither is known.
 */
export function clientAddress(
  peer: string | null,
  headers: Headers,
  trustedHeader: string | null,
): string | null {
  if (trustedHeader !== null && peer !== null && isLocalAddress(peer)) {
    const forwarded = oneAddress(headers.get(trustedHeader));
    if (forwarded !== undefined) return forwarded;
  }
  return peer;
}
