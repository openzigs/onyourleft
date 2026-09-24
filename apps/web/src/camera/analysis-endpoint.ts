// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The rider's own computer, as an address they typed — and nothing, until
 * they do** ([#387](https://github.com/openzigs/onyourleft/issues/387)).
 *
 * The owner's amended promise, ADR 0029's 2026-09-23 entry, Q1:
 *
 * > **No network except a local endpoint the rider configured and switched on.**
 *
 * Each word of that is a rule in this file:
 *
 * - **configured** — there is no default address, no suggested one, no
 *   placeholder that could be promoted to one, and no model name either.
 *   {@link readAnalysisEndpoint} over an empty device answers `undefined`, and
 *   `analysis-transport.ts` then builds no port at all. A default endpoint is
 *   what would turn a privacy feature into a silent one, which is the failure
 *   #387's own criterion names.
 * - **switched on** — a separate stored answer, `false` until the rider ticks
 *   it. An address typed and left switched off sends nothing.
 * - **local** — {@link endpointDecision} refuses any address that is not on the
 *   rider's own network. ⚠️ **This is what keeps the hosted path out**, and it
 *   is the finding ADR 0029's amendment records rather than a caution: the
 *   owner's sentence says *"a local endpoint"*, a hosted model is not one, and
 *   whether the published policy may gain a second named exception for it *"is
 *   a question for the owner and it is not answered here"*. So the hosted path
 *   (D-7) is **not built**, and a rider cannot reach one through this file by
 *   typing its URL — the address is refused before anything is stored.
 *
 * ## What "local" means here, and why it is the address and not the answer
 *
 * The rule is read off what the rider TYPED, before any name is resolved,
 * because that is the only thing this client can know: a page is told nothing
 * about where a name resolved to. So a hostname is accepted only in a form that
 * is local by construction —
 *
 * | Accepted | Why it is local |
 * |---|---|
 * | `localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]` | loopback, RFC 6761 §6.3 |
 * | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC 1918 private addresses |
 * | `169.254.0.0/16`, `[fe80::/10]` | link-local |
 * | `100.64.0.0/10` | RFC 6598 shared address space, which is where a WireGuard-class overlay (ADR 0029 D-6's remote case) numbers its peers |
 * | `[fc00::/7]` | IPv6 unique local addresses, RFC 4193 |
 * | `*.local` | multicast DNS, RFC 6762 — answered only on the local link |
 * | `*.home.arpa`, `*.internal` | names reserved for a home or private network, RFC 8375 and ICANN's 2024 reservation |
 *
 * — and every other name is refused, however local the rider knows it to be.
 * That is a real cost for a rider whose machine is `my-pc` on a home router,
 * and it is taken on purpose: a single-label name is completed by a search
 * domain this client cannot see, and a public name that happens to point at a
 * home address today is one DNS change away from not doing so.
 *
 * ⚠️ **What it cannot stop**: a name under `.internal` or `.home.arpa` is
 * resolved by whatever DNS the device uses, and a hostile resolver can answer
 * with anything. The rider chose that resolver and typed that name; the rule
 * does not pretend to be more than a rule about the address.
 *
 * ⚠️ **And it names no vendor.** No model server, no model and no hosting
 * service is written in this file or suggested by it — ADR 0031 D-4's
 * conditions 2 and 3. The rider-facing document
 * (`docs/analysis-on-your-own-computer.md`) is where software is named, as
 * something the rider installs, and nothing here reads it.
 *
 * ## Why `http:` is allowed
 *
 * A model server on a home network does not usually hold a certificate, and
 * ADR 0029 D-6 adopts the **plain LAN** as the default. Chromium's Local
 * Network Access rules relax mixed-content blocking for exactly the addresses
 * this file accepts — a private IP literal or a `.local` name — once the rider
 * grants the permission it asks for; `analysis-transport.ts` also annotates the
 * request with the address space so a `.home.arpa` or `.internal` name is
 * treated the same way. ⚠️ **Unverified inside the Android shell**, whose
 * WebView sets `allowMixedContent: false` (`apps/mobile/capacitor.config.ts`);
 * the rider-facing document says so.
 */

/** Where the rider's answer is kept: this device's `localStorage`, and nothing else. */
export type EndpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * This device's storage, or `undefined` where the browser refuses it.
 *
 * ⚠️ **`localStorage` holds the ADDRESS and never a picture.** ADR 0029 D-10
 * forbids a frame, or anything derived from one, in `localStorage`; an address
 * and a model name are neither.
 */
export function deviceEndpointStorage(): EndpointStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The one key this lives under, versioned for the reason `announce-preference.ts` gives. */
export const ANALYSIS_ENDPOINT_STORAGE_KEY = 'oyl.analysis-endpoint.v1';

/**
 * The OpenAI-compatible chat path, appended to the address the rider typed.
 *
 * ⚠️ **The request shape is vendor-neutral by construction** — ADR 0031 D-4
 * condition 3. It is the shape the common local model servers already serve,
 * which is what lets this client name none of them.
 */
export const COMPLETIONS_PATH = '/v1/chat/completions';

/** The longest model name accepted. A model tag is tens of characters. */
export const MAXIMUM_MODEL_NAME_LENGTH = 200;

/** Which network the address is on, for the request's address-space annotation. */
export type AddressSpace = 'loopback' | 'local';

/** The rider's configured computer. */
export interface AnalysisEndpoint {
  /** The origin only — scheme, host and port. Normalised by the URL parser. */
  readonly address: string;
  /** The model name the rider typed. No default exists. */
  readonly model: string;
  /** Whether the rider has switched sending on. `false` until they do. */
  readonly switchedOn: boolean;
}

/** Why an address or a model name was refused. */
export type EndpointRefusal =
  | 'no-address'
  | 'not-an-address'
  | 'not-http'
  | 'has-credentials'
  | 'has-query'
  | 'unexpected-path'
  | 'not-local'
  | 'no-model'
  | 'model-too-long';

/** One sentence per refusal. None of them repeats what was typed. */
export const ENDPOINT_REFUSAL_TEXT: Readonly<Record<EndpointRefusal, string>> = {
  'no-address':
    'Enter the address of your computer and the port its model server listens on, starting with http://.',
  'not-an-address': 'That is not an address. It should start with http:// or https://.',
  'not-http': 'The address has to start with http:// or https://.',
  'has-credentials':
    'The address has a name or password in it. This app does not send one — remove it.',
  'has-query': 'The address has a ? or # part. Enter only the computer’s address and port.',
  'unexpected-path': 'Enter only the computer’s address and port, without a path after it.',
  'not-local':
    'That address is not on your own network. This app only sends pictures to a computer at a ' +
    'private address (such as 192.168.…, 10.… or a name ending in .local), and never to a ' +
    'service on the internet.',
  'no-model': 'Enter the name of the model your computer should use. There is no default.',
  'model-too-long': 'That model name is too long.',
};

/** The result of reading what the rider typed. */
export interface EndpointDecision {
  readonly endpoint: AnalysisEndpoint | undefined;
  readonly refusal: EndpointRefusal | undefined;
}

/** What the rider typed, and whether they switched it on. */
export interface EndpointAnswers {
  readonly address: string;
  readonly model: string;
  readonly switchedOn: boolean;
}

function refuse(refusal: EndpointRefusal): EndpointDecision {
  return { endpoint: undefined, refusal };
}

/**
 * Whether what the rider typed is an address this client may send to.
 *
 * The only constructor of an {@link AnalysisEndpoint}, and
 * {@link readAnalysisEndpoint} runs every stored row back through it — so a
 * hand-edited `localStorage` row naming a public address is refused exactly as
 * a typed one is. One rule instead of two that can drift, which is
 * `validateWorkout`'s argument in `packages/domain`.
 */
export function endpointDecision(answers: EndpointAnswers): EndpointDecision {
  const typed = answers.address.trim();
  if (typed === '') {
    return refuse('no-address');
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return refuse('not-an-address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refuse('not-http');
  }
  // ⚠️ Before the locality check, so a URL that smuggles a secret in its
  // userinfo is refused for that reason and the words say so.
  if (url.username !== '' || url.password !== '') {
    return refuse('has-credentials');
  }
  if (url.search !== '' || url.hash !== '' || typed.includes('?') || typed.includes('#')) {
    return refuse('has-query');
  }
  if (!ACCEPTED_PATHS.has(url.pathname.replace(/\/+$/, ''))) {
    return refuse('unexpected-path');
  }
  if (addressSpaceOf(url.hostname) === undefined) {
    return refuse('not-local');
  }
  const model = answers.model.trim();
  if (model === '') {
    return refuse('no-model');
  }
  if (model.length > MAXIMUM_MODEL_NAME_LENGTH) {
    return refuse('model-too-long');
  }
  return {
    endpoint: { address: url.origin, model, switchedOn: answers.switchedOn },
    refusal: undefined,
  };
}

/**
 * The paths a rider might paste after the port, all meaning "this server".
 *
 * `''` is the bare origin; the other two are what a server's own
 * documentation tends to print, and refusing them would be pedantry. Anything
 * else is refused rather than kept, because a path of the rider's is a place
 * this client would then be sending a picture to that nobody chose.
 */
const ACCEPTED_PATHS: ReadonlySet<string> = new Set(['', '/v1', COMPLETIONS_PATH]);

/**
 * Which network `hostname` is on, read from its spelling alone, or `undefined`
 * when it is not provably the rider's own.
 *
 * `hostname` is as the URL parser leaves it: lower-cased, an IPv4 address in
 * dotted-decimal whatever it was typed as, an IPv6 one in brackets.
 */
export function addressSpaceOf(hostname: string): AddressSpace | undefined {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'loopback';
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return ipv6Space(hostname.slice(1, -1));
  }
  const octets = ipv4Octets(hostname);
  if (octets !== undefined) {
    return ipv4Space(octets);
  }
  if (LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix) && hostname !== suffix.slice(1))) {
    return 'local';
  }
  return undefined;
}

/** Name suffixes that are local by reservation. @see addressSpaceOf */
const LOCAL_SUFFIXES: readonly string[] = ['.local', '.home.arpa', '.internal'];

function ipv4Octets(hostname: string): readonly number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) {
    return undefined;
  }
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function ipv4Space(octets: readonly number[]): AddressSpace | undefined {
  const [a = -1, b = -1] = octets;
  if (a === 127) {
    return 'loopback';
  }
  if (a === 10) {
    return 'local';
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return 'local';
  }
  if (a === 192 && b === 168) {
    return 'local';
  }
  if (a === 169 && b === 254) {
    return 'local';
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return 'local';
  }
  return undefined;
}

function ipv6Space(address: string): AddressSpace | undefined {
  if (address === '::1') {
    return 'loopback';
  }
  const first = address.split(':')[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(first)) {
    return undefined;
  }
  const hextet = Number.parseInt(first, 16);
  // fc00::/7, unique local; fe80::/10, link-local. An IPv4-mapped address
  // (`::ffff:…`) starts with an empty hextet and is refused here rather than
  // unpacked: a rider typing one has an IPv4 address to type instead.
  if ((hextet & 0xfe00) === 0xfc00 || (hextet & 0xffc0) === 0xfe80) {
    return 'local';
  }
  return undefined;
}

/** The URL a request goes to. */
export function completionsUrl(endpoint: AnalysisEndpoint): string {
  return `${endpoint.address}${COMPLETIONS_PATH}`;
}

/**
 * The rider's configured computer, or `undefined` — which is what an empty
 * device answers, what a malformed row answers, and what a row naming an
 * address that is no longer accepted answers.
 */
export function readAnalysisEndpoint(
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): AnalysisEndpoint | undefined {
  let raw: unknown;
  try {
    const text = storage?.getItem(ANALYSIS_ENDPOINT_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  const { address, model, switchedOn } = row;
  if (typeof address !== 'string' || typeof model !== 'string') {
    return undefined;
  }
  // Re-decided, not trusted. `switchedOn` is `true` only when it is exactly
  // `true`, so a row written by anything else reads as switched off.
  return endpointDecision({ address, model, switchedOn: switchedOn === true }).endpoint;
}

/** Stores the rider's computer. `false` when this device would not keep it. */
export function writeAnalysisEndpoint(
  endpoint: AnalysisEndpoint,
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    storage.setItem(ANALYSIS_ENDPOINT_STORAGE_KEY, JSON.stringify(endpoint));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the rider's computer. Nothing is sent anywhere afterwards. */
export function forgetAnalysisEndpoint(
  storage: EndpointStorage | undefined = deviceEndpointStorage(),
): void {
  try {
    storage?.removeItem(ANALYSIS_ENDPOINT_STORAGE_KEY);
  } catch {
    // A device that will not forget cannot be made to; the row it holds is
    // still re-decided on every read.
  }
}
