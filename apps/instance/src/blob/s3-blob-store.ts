// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An S3-compatible {@link BlobStore} (#770) — optional; R2, B2, MinIO or S3
 * itself, for an operator who would rather not keep blobs on the box.
 * ADR 0002 A: an instance must not REQUIRE one, so the disk store is the
 * default and this is chosen, never assumed.
 *
 * Path-style URLs (`<endpoint>/<bucket>/<key>`), signed with SigV4
 * (`s3-signature.ts`) over `fetch` and Web Crypto, and no SDK: four requests
 * need no dependency. The object's SHA-256 is its key AND the
 * `x-amz-content-sha256` the request is signed with, so the service itself
 * refuses a body that does not match.
 *
 * ⚠️ **What a failure says.** A status the store does not expect is
 * {@link S3BlobStoreError} carrying the method and the status — never the
 * response body, which is the service's and may echo the request.
 */

import { keyFor, requireBlobKey, type BlobStore } from './blob-store.ts';
import { signS3Request, type S3Credentials } from './s3-signature.ts';

/** SHA-256 of nothing: the payload hash of a request with no body. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface S3BlobStoreOptions extends S3Credentials {
  /** `https://<account>.r2.cloudflarestorage.com`, `http://127.0.0.1:9000` and the like. */
  readonly endpoint: string;
  readonly bucket: string;
  /** Test support: the `fetch` to use. The platform's by default. */
  readonly fetch?: typeof fetch;
  /** Test support: the clock requests are signed at. */
  readonly now?: () => Date;
}

/** The service answered something the store did not expect. */
export class S3BlobStoreError extends Error {
  override readonly name = 'S3BlobStoreError';
  readonly method: string;
  readonly status: number;
  constructor(method: string, status: number) {
    super(`The object store answered ${method} with ${status}.`);
    this.method = method;
    this.status = status;
  }
}

export function createS3BlobStore(options: S3BlobStoreOptions): BlobStore {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = options.endpoint.replace(/\/+$/, '');

  async function request(method: string, key: string, body?: Uint8Array): Promise<Response> {
    const url = new URL(`${base}/${encodeURIComponent(options.bucket)}/${key}`);
    const headers = await signS3Request(
      {
        method,
        url,
        headers: body === undefined ? {} : { 'content-type': 'application/octet-stream' },
        payloadSha256: body === undefined ? EMPTY_SHA256 : key,
      },
      options,
      now(),
    );
    return send(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: body.slice() }),
    });
  }

  async function exists(key: string): Promise<boolean> {
    const response = await request('HEAD', key);
    if (response.status === 404) return false;
    if (!response.ok) throw new S3BlobStoreError('HEAD', response.status);
    return true;
  }

  return {
    put: async (bytes, expectedSha256) => {
      const key = await keyFor(bytes, expectedSha256);
      const response = await request('PUT', key, bytes);
      if (!response.ok) throw new S3BlobStoreError('PUT', response.status);
      await response.body?.cancel();
      return key;
    },
    get: async (sha256) => {
      const key = requireBlobKey(sha256);
      const response = await request('GET', key);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new S3BlobStoreError('GET', response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
    has: async (sha256) => exists(requireBlobKey(sha256)),
    delete: async (sha256) => {
      const key = requireBlobKey(sha256);
      const response = await request('DELETE', key);
      if (!response.ok && response.status !== 404) {
        throw new S3BlobStoreError('DELETE', response.status);
      }
      await response.body?.cancel();
    },
  };
}
