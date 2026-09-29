// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a picture looks like to a gate**, in source and in a request body.
 * Test support, never shipped (the `-testing.ts` suffix). #799.
 *
 * `no-picture-reachable.test.ts` is the gate; this file is here so the issues
 * that build the ride-analysis requests (#802 on the rider's own computer,
 * #803 on a hosted model) hold their own step bodies to the same rule by
 * calling {@link pictureBodyFaults}, rather than writing a second one.
 */

/**
 * The names a module holding a picture uses: the browser's image types, this
 * repository's frame type, the OpenAI-compatible picture part, and a picture
 * written as a data URL. A module whose code (comments removed) says any of
 * them is treated as a picture module.
 */
export const PICTURE_NAME =
  /\b(?:ImageBitmap|ImageData|Blob|HTMLCanvasElement|OffscreenCanvas|CapturedFrame|image_url)\b|data:image/;

/** A data URL: `data:` then an optional media type and parameters, then a comma. */
const DATA_URL = /\bdata:[^\s,]*,/i;

/** Every part type an OpenAI-compatible server reads as a picture. */
const PICTURE_PART_TYPES: ReadonlySet<string> = new Set(['image_url', 'input_image', 'image']);

/** The longest array anywhere in `value`, nested ones included. */
export function largestArrayIn(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.map(largestArrayIn));
  }
  if (typeof value === 'object' && value !== null) {
    return Math.max(0, ...Object.values(value).map(largestArrayIn));
  }
  return 0;
}

/** The bracket that closes each one that opens. */
const CLOSES: Readonly<Record<string, string>> = { '{': '}', '[': ']' };

/**
 * Where the JSON value opening at `from` would end — the index just past its
 * matching bracket, skipping brackets inside strings — or `undefined` when it
 * never closes.
 */
function closingIndex(text: string, from: number): number | undefined {
  const stack: string[] = [];
  let inString = false;
  for (let index = from; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (inString) {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{' || character === '[') {
      stack.push(CLOSES[character] ?? '');
    } else if (character === '}' || character === ']') {
      if (stack.pop() !== character) {
        return undefined;
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
  }
  return undefined;
}

/**
 * Every JSON object or array written inside a string, with prose around it or
 * not — a prompt that carries the input as text is walked as well, so an array
 * flattened into a message's text is not hidden from the length rule by being
 * quoted, nor by a sentence before or after it (#822). A bracket that opens no
 * JSON (`[sic]`, a list in prose) is passed over and the scan moves on.
 */
export function embeddedJson(text: string): unknown[] {
  const found: unknown[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character !== '{' && character !== '[') {
      index += 1;
      continue;
    }
    const end = closingIndex(text, index);
    if (end !== undefined) {
      try {
        found.push(JSON.parse(text.slice(index, end)) as unknown);
        index = end;
        continue;
      } catch {
        // Not JSON; try the next bracket.
      }
    }
    index += 1;
  }
  return found;
}

/** The shortest wrapped line a run is followed across: under PEM's 64 and MIME's 76. */
const WRAPPED_LINE_MINIMUM = 60;

/**
 * A candidate run of base64: the standard and URL-safe alphabets and padding,
 * with no space — so prose never makes one — either on one line or wrapped
 * the way MIME (76) and PEM (64) wrap it. A wrapped line is only taken as
 * part of a run when it is at least {@link WRAPPED_LINE_MINIMUM} long, so a
 * list of words one per line is not one run (#823).
 */
const BASE64_CANDIDATE = new RegExp(
  `(?:[A-Za-z0-9+/_-]{${String(WRAPPED_LINE_MINIMUM)},}={0,2}\\r?\\n)*[A-Za-z0-9+/_=-]+`,
  'g',
);

/**
 * 100 characters is 75 bytes, under the smallest image a camera frame could
 * be (#822).
 */
const BASE64_RUN_MINIMUM = 100;

/**
 * The least share of a run that is letters and digits. Base64 of any bytes is
 * about 62/64 of them, with room for the padding.
 */
const BASE64_ALPHANUMERIC_SHARE = 0.9;

/**
 * Whether `text` holds a run of base64 long enough to be a picture with no
 * `data:` prefix on it. Base64 is letters and digits but for two symbols in
 * 64 and its padding, so a run that is mostly punctuation — a rule of dashes,
 * underscores or `=`, with a word before or after it — is not base64 (#823).
 */
function hasBase64Run(text: string): boolean {
  for (const [match] of text.matchAll(BASE64_CANDIDATE)) {
    const run = match.replace(/\r?\n/g, '');
    const alphanumeric = run.replace(/[^A-Za-z0-9]/g, '').length;
    if (
      run.length >= BASE64_RUN_MINIMUM &&
      alphanumeric >= BASE64_ALPHANUMERIC_SHARE * run.length
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Arrays that are the transport's own envelope rather than the ride's input:
 * `messages`, and a message's list of `content` parts. Each is exempt from the
 * length rule only while every entry is an object — a message or a part —
 * because a pixel buffer is an array of numbers (#822).
 */
function isEnvelopeArray(at: string, value: readonly unknown[]): boolean {
  return (
    (at === 'body.messages' || /^body\.messages\[\d+\]\.content$/.test(at)) &&
    value.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
  );
}

/**
 * Why `body` could be carrying a picture, as sentences naming where; empty when
 * it is text and numbers only.
 *
 * Four rules, each with a red fixture in `no-picture-reachable.test.ts`:
 *
 * 1. **No picture part** — no key `image_url`, and no part whose `type` is
 *    one a model server reads as a picture.
 * 2. **No data URL** in any string.
 * 3. **No array longer than the input's own largest array**
 *    (`largestAllowed`), because a flattened pixel buffer is an array of
 *    numbers and neither rule above would see it. JSON inside a string is
 *    found wherever it sits in the string, prose around it or not; and the
 *    transport's own `messages` and `content` lists are not held to it
 *    ({@link isEnvelopeArray}), so a ride with no sections is not a fault.
 * 4. **No long run of base64** in any string ({@link hasBase64Run}), because a
 *    picture sent as base64 text with no `data:` prefix passes the other three
 *    (#822).
 *
 * ## What it cannot see
 *
 * The rules are aimed at an ACCIDENTAL picture, not a disguised one. Pixels
 * written as numbers separated by commas with no brackets round them are not
 * JSON and not base64, so no rule reads them; base64 cut into pieces shorter
 * than 100 characters across several strings, or wrapped at lines shorter
 * than 60, is never one run; and any encoding other than base64 is not
 * looked for (#823).
 */
export function pictureBodyFaults(body: unknown, largestAllowed: number): string[] {
  const faults: string[] = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      if (DATA_URL.test(value)) {
        faults.push(`${at} is a data URL`);
      }
      if (hasBase64Run(value)) {
        faults.push(`${at} holds a long run of base64`);
      }
      embeddedJson(value).forEach((inner, index) => {
        visit(inner, `${at}(json ${index})`);
      });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > largestAllowed && !isEnvelopeArray(at, value)) {
        faults.push(`${at} has ${value.length} entries, more than ${largestAllowed}`);
      }
      value.forEach((entry, index) => {
        visit(entry, `${at}[${index}]`);
      });
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'image_url') {
          faults.push(`${at}.${key} is a picture part`);
        }
        if (key === 'type' && typeof entry === 'string' && PICTURE_PART_TYPES.has(entry)) {
          faults.push(`${at} is a part of type ${entry}`);
        }
        visit(entry, `${at}.${key}`);
      }
    }
  };
  visit(body, 'body');
  return faults;
}
