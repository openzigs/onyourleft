// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which network APIs a Swift source names** (#1756; the fuller gate is #3244).
 *
 * `apps/web/src/privacy/no-network.test.ts` keeps the web client's traffic to
 * the modules it admits (CLAUDE.md §1, ADR 0036 D-3 (a)), and it reads only
 * TypeScript. Once `apps/mobile/ios/` exists, a Swift file could open a
 * connection no gate sees, so `swift-network.test.ts` runs this over every
 * Swift source in that tree, with an allowed list that starts EMPTY.
 *
 * ⚠️ A text scan, and deliberately a wide one: it names the type or call, in
 * code with its comments removed, and does not try to decide
 * whether a use would really reach the network. A false alarm is a reviewed
 * line in the allowed list; a miss is a silent connection.
 *
 * ⚠️ What it cannot see: a binary framework (Capacitor's own xcframework, or a
 * plugin shipped as one) and Swift outside `apps/mobile/ios/` — the plugins
 * under `node_modules`, which the web side reaches only through their own
 * TypeScript wrappers and `no-network.test.ts`.
 */

/**
 * The network APIs, each a pattern over code. Foundation's URL loading, the
 * Network framework, CFNetwork's streams and sockets, BSD sockets, and the
 * `contentsOf:` initialisers, which fetch a remote URL as readily as a file.
 */
export const NETWORK_APIS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['URLSession', /\bURLSession\w*\b/],
  ['NSURLConnection', /\bNSURLConnection\b/],
  ['URLRequest', /\b(?:NS)?(?:Mutable)?URLRequest\b/],
  ['import Network', /^\s*(?:@\w+\s+)*import\s+(?:\w+\s+)?Network\b/],
  [
    'Network framework',
    /\bNW(?:Connection|Listener|Browser|Endpoint|Parameters|ConnectionGroup)\b/,
  ],
  ['CFNetwork', /\bCF(?:Stream|Socket|Host|HTTP|ReadStream|WriteStream|NetService)\w*\b/],
  ['Stream to a host', /\bgetStreamsToHost\b|\bgetBoundStreams\b/],
  ['NetService', /\bNetService(?:Browser)?\b/],
  ['BSD socket', /\b(?:socket|connect|getaddrinfo|gethostbyname|sendto|recvfrom)\s*\(/],
  [
    'contentsOf:',
    /\b(?:Data|String|NSData|NSString|NSArray|NSDictionary|XMLParser)\s*\(\s*contentsOf\s*:/,
  ],
];

/**
 * Swift with its comments blanked, so that a sentence about `URLSession` is
 * not a use of it. Line breaks are kept, so a finding's line number is the
 * source's. A string literal is copied as it is, not blanked: an interpolation
 * (`"\(URLSession.shared)"`) is code, and a `//` inside a URL literal must not
 * hide the rest of its line as a comment would.
 */
export function swiftCode(source: string): string {
  let out = '';
  let at = 0;
  let depth = 0;
  while (at < source.length) {
    const rest = source.slice(at, at + 3);
    if (depth > 0) {
      if (rest.startsWith('*/')) {
        depth -= 1;
        at += 2;
      } else if (rest.startsWith('/*')) {
        depth += 1;
        at += 2;
      } else {
        out += source[at] === '\n' ? '\n' : ' ';
        at += 1;
      }
      continue;
    }
    if (rest.startsWith('/*')) {
      // Swift's block comments nest.
      depth = 1;
      at += 2;
      out += '  ';
    } else if (rest.startsWith('//')) {
      const end = source.indexOf('\n', at);
      at = end === -1 ? source.length : end;
    } else if (rest === '"""' || source[at] === '"') {
      const quote = rest === '"""' ? '"""' : '"';
      let end = at + quote.length;
      while (end < source.length && !source.startsWith(quote, end)) {
        end += source[end] === '\\' ? 2 : 1;
      }
      out += source.slice(at, Math.min(end + quote.length, source.length));
      at = end + quote.length;
    } else {
      out += source[at];
      at += 1;
    }
  }
  return out;
}

/** One network API named in a file: which, and on which line. */
export interface NetworkUse {
  readonly api: string;
  readonly line: number;
}

/** Every network API a Swift source names in code, in line order. */
export function networkUses(source: string): NetworkUse[] {
  const lines = swiftCode(source).split('\n');
  const uses: NetworkUse[] = [];
  lines.forEach((text, index) => {
    for (const [api, pattern] of NETWORK_APIS) {
      if (pattern.test(text)) uses.push({ api, line: index + 1 });
    }
  });
  return uses;
}
