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

/**
 * JSON written inside a string — a prompt that carries the input as text — is
 * walked as well, so an array flattened into a message's text is not hidden
 * from the length rule by being quoted.
 */
function embeddedJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Why `body` could be carrying a picture, as sentences naming where; empty when
 * it is text and numbers only.
 *
 * Three rules, each with a red fixture in `no-picture-reachable.test.ts`:
 *
 * 1. **No picture part** — no key `image_url`, and no part whose `type` is
 *    one a model server reads as a picture.
 * 2. **No data URL** in any string.
 * 3. **No array longer than the input's own largest array**
 *    (`largestAllowed`), because a flattened pixel buffer is an array of
 *    numbers and neither rule above would see it.
 */
export function pictureBodyFaults(body: unknown, largestAllowed: number): string[] {
  const faults: string[] = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      if (DATA_URL.test(value)) {
        faults.push(`${at} is a data URL`);
      }
      const inner = embeddedJson(value);
      if (inner !== undefined) {
        visit(inner, `${at}(json)`);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > largestAllowed) {
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
