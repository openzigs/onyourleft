// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AWS Signature Version 4 for the S3 API (#770), over Web Crypto — so it runs
 * wherever `fetch` does, a Durable Object included, and needs no SDK.
 *
 * It signs what `s3-blob-store.ts` sends and nothing more: a path-style URL
 * with no query string, the headers given, and the payload's SHA-256 in
 * `x-amz-content-sha256`. `s3-signature.test.ts` reproduces the worked
 * example in AWS's own documentation for the scheme (GET Object with a Range
 * header), so a wrong byte here is a red test without any bucket.
 */

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

export interface UnsignedRequest {
  readonly method: string;
  readonly url: URL;
  /** Every header to sign, `host` excepted (it is taken from the URL). */
  readonly headers: Readonly<Record<string, string>>;
  /** SHA-256 of the body, lowercase hex. */
  readonly payloadSha256: string;
}

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmac(
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  text: string,
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}

/** RFC 3986 encoding of one path segment, as SigV4 wants it. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `20130524T000000Z` for an instant. */
export function amzDate(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * The headers to send: the caller's, plus `x-amz-date`,
 * `x-amz-content-sha256` and `authorization`.
 */
export async function signS3Request(
  request: UnsignedRequest,
  credentials: S3Credentials,
  instant: Date,
): Promise<Record<string, string>> {
  const date = amzDate(instant);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers['x-amz-date'] = date;
  headers['x-amz-content-sha256'] = request.payloadSha256;

  const signed: Record<string, string> = { ...headers, host: request.url.host };
  const names = Object.keys(signed).sort();
  const canonicalRequest = [
    request.method,
    request.url.pathname
      .split('/')
      .map((segment) => encodeSegment(decodeURIComponent(segment)))
      .join('/'),
    '',
    names.map((name) => `${name}:${signed[name]}\n`).join(''),
    names.join(';'),
    request.payloadSha256,
  ].join('\n');

  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256(canonicalRequest)].join('\n');

  let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), day);
  for (const part of [credentials.region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
