// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the embedding model may be: local, or nowhere** — the owner's rule,
 * ADR 0040 D-6 (#835).
 *
 * Two checks, and the second is the one that makes the rule a promise:
 *
 * 1. **As configured** ({@link configuredHostProblem}): the host of the
 *    configured address is a loopback literal or `localhost`, an IPv4 or IPv6
 *    literal in a private, link-local, shared (`100.64.0.0/10`) or unique-local
 *    range, or a **single-label** name — which is what a Compose service name
 *    is. Anything else is refused: a public name, and `.local`, `.home.arpa`
 *    and `.internal` too (the owner's list names three forms and those are none
 *    of them; widening it is an amendment, not a review note).
 * 2. **As connected** ({@link localAddressesOnly}): a name is not an address. A
 *    single-label name can be completed by a resolver's search domain, and any
 *    name can resolve anywhere. So on EVERY connection the instance resolves
 *    the name itself, requires **every** address it resolves to to be in the
 *    same ranges, and connects to an address it checked — never resolving
 *    again between the check and the connection, which is the gap a rebinding
 *    answer uses.
 *
 * ⚠️ **This is not the device's rule** (`apps/web/src/camera/analysis-endpoint.ts`
 * §`addressSpaceOf`), and it inverts it in two places on purpose: the device
 * refuses a single-label name and accepts `.local`, because a page is never
 * told where a name resolved to. The instance is, and checks the answer
 * instead, which is stronger than either spelling rule (D-6's third bullet).
 * It cannot import that file either way: `apps/instance` may not import
 * `apps/web`.
 *
 * Pure, and naming nothing of Node: the resolver is a parameter.
 */

/** Resolves a name to every address it has: IPv4 dotted-decimal and IPv6 text. */
export type Resolver = (hostname: string) => Promise<readonly string[]>;

/** The octets of a dotted-decimal IPv4 address, or `undefined`. */
function ipv4Octets(text: string): readonly number[] | undefined {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** Whether an IPv4 address is loopback, private, link-local or shared. */
function ipv4IsLocal(octets: readonly number[]): boolean {
  const [a = -1, b = -1] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** An IPv6 address's eight groups as numbers, or `undefined`. */
function ipv6Groups(text: string): readonly number[] | undefined {
  let address = text.toLowerCase();
  // An embedded IPv4 tail (`::ffff:10.0.0.1`) becomes two groups.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (tail !== null) {
    const octets = ipv4Octets(tail[2] ?? '');
    if (octets === undefined) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    address = `${tail[1] ?? ''}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === undefined || rest === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - rest.length;
  return missing < 1 ? undefined : [...head, ...Array<number>(missing).fill(0), ...rest];
}

/** Whether an IPv6 address is loopback, unique-local, link-local, or an IPv4-mapped local one. */
function ipv6IsLocal(groups: readonly number[]): boolean {
  const [first = 0] = groups;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  // ::ffff:a.b.c.d — an IPv4 address written as IPv6.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return ipv4IsLocal([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return false;
}

/**
 * Whether `address` — an IP address as text, IPv6 with or without brackets —
 * is loopback, private, link-local, shared or unique-local. A name is not an
 * address and is `false`.
 */
export function isLocalAddress(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets !== undefined) return ipv4IsLocal(octets);
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const groups = bare.includes(':') ? ipv6Groups(bare) : undefined;
  return groups !== undefined && ipv6IsLocal(groups);
}

/** Whether `text` is an IP address literal rather than a name. */
export function isAddressLiteral(text: string): boolean {
  if (ipv4Octets(text) !== undefined) return true;
  const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return bare.includes(':') && ipv6Groups(bare) !== undefined;
}

/** A single DNS label: what a Compose service name is. */
const SINGLE_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Why the configured host is refused, or `undefined` when it is one of the
 * three forms the owner named. `hostname` is as the URL parser leaves it:
 * lower case, IPv6 in brackets.
 */
export function configuredHostProblem(hostname: string): string | undefined {
  if (hostname === 'localhost') return undefined;
  if (isAddressLiteral(hostname)) {
    return isLocalAddress(hostname)
      ? undefined
      : 'it is an address outside the loopback and private ranges';
  }
  if (SINGLE_LABEL.test(hostname)) return undefined;
  return 'it is a name with a dot in it, which is not a Compose service name, localhost or a private address';
}

/** The address a connection may go to, and every address the name had. */
export type CheckedAddress =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly why: 'not-local' | 'unresolved' };

/**
 * The address to connect to for `hostname`, checked — or why not. A literal
 * is checked as it stands; a name is resolved with `resolve`, and EVERY
 * address it resolves to must be local, or none is used. The first address is
 * the one to connect to, so the caller never resolves the name again.
 */
export async function localAddressesOnly(
  hostname: string,
  resolve: Resolver,
): Promise<CheckedAddress> {
  if (isAddressLiteral(hostname)) {
    return isLocalAddress(hostname)
      ? { ok: true, address: hostname.replace(/^\[|\]$/g, '') }
      : { ok: false, why: 'not-local' };
  }
  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return { ok: false, why: 'unresolved' };
  }
  const [first] = addresses;
  if (first === undefined) return { ok: false, why: 'unresolved' };
  if (!addresses.every((address) => isLocalAddress(address)))
    return { ok: false, why: 'not-local' };
  return { ok: true, address: first };
}
