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

/**
 * A run of base64 long enough to be a picture with no `data:` prefix on it:
 * the standard and URL-safe alphabets, padding, and the line breaks MIME
 * wraps it at, but no space — so prose never makes one. 100 characters is 75
 * bytes, under the smallest image a camera frame could be (#822).
 */
const BASE64_RUN = /[A-Za-z0-9+/_-](?:[A-Za-z0-9+/_=-]|\r?\n){99,}/;

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
 * 4. **No long run of base64** in any string ({@link BASE64_RUN}), because a
 *    picture sent as base64 text with no `data:` prefix passes the other three
 *    (#822).
 */
export function pictureBodyFaults(body: unknown, largestAllowed: number): string[] {
  const faults: string[] = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      if (DATA_URL.test(value)) {
        faults.push(`${at} is a data URL`);
      }
      if (BASE64_RUN.test(value)) {
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
