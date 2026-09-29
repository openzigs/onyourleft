// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The S3-compatible blob store (#770).
 *
 * Two halves, and only the first runs everywhere:
 *
 * 1. The signature reproduces AWS's own worked example, and the store's
 *    requests and answers are checked over a scripted `fetch` — no bucket.
 * 2. The conformance suite runs against a REAL bucket when every
 *    `OYL_INSTANCE_S3_*` variable is set, and SKIPS LOUDLY otherwise, naming
 *    the variables (#318's shape). ⚠️ **Not a CI gate**: CI sets none of them,
 *    because a gate that needs somebody's bucket fails on an aeroplane.
 */

import { describe, expect, it } from 'vitest';
import { createS3BlobStore, S3BlobIntegrityError, S3BlobStoreError } from './s3-blob-store.ts';
import { amzDate, signS3Request } from './s3-signature.ts';
import { ABC_SHA256, describeBlobStoreConformance } from './conformance-testing.ts';
import type { BlobStore } from './blob-store.ts';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('SigV4 (#770)', () => {
  it('reproduces AWS’s worked example: GET Object with a Range header', async () => {
    // docs.aws.amazon.com, "Signature Calculations for the Authorization
    // Header", Example: GET Object. The credentials are AWS's published
    // example credentials, not anybody's.
    const headers = await signS3Request(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { Range: 'bytes=0-9' },
        payloadSha256: EMPTY_SHA256,
      },
      {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      },
      new Date(Date.UTC(2013, 4, 24)),
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('writes the date as AWS does', () => {
    expect(amzDate(new Date(Date.UTC(2013, 4, 24, 1, 2, 3, 456)))).toBe('20130524T010203Z');
  });
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function scripted(status: number, body = ''): { store: BlobStore; sent: Sent[] } {
  const sent: Sent[] = [];
  const store = createS3BlobStore({
    endpoint: 'http://127.0.0.1:9000/',
    bucket: 'blobs',
    region: 'auto',
    accessKeyId: 'id',
    secretAccessKey: 'secret',
    now: () => new Date(Date.UTC(2026, 8, 29)),
    fetch: (input, init) => {
      sent.push({
        method: init?.method ?? 'GET',
        url: input instanceof URL ? input.href : (input as string),
        headers: init?.headers as Record<string, string>,
        body: init?.body,
      });
      return Promise.resolve(new Response(status === 204 ? null : body, { status }));
    },
  });
  return { store, sent };
}

describe('the S3 blob store, over a scripted fetch (#770)', () => {
  it('PUTs to <endpoint>/<bucket>/<sha256>, signed over the blob’s own digest', async () => {
    const { store, sent } = scripted(200);
    expect(await store.put(new TextEncoder().encode('abc'))).toBe(ABC_SHA256);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('PUT');
    expect(sent[0]!.url).toBe(`http://127.0.0.1:9000/blobs/${ABC_SHA256}`);
    expect(sent[0]!.headers['x-amz-content-sha256']).toBe(ABC_SHA256);
    expect(sent[0]!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=id\/20260929\/auto\/s3\/aws4_request, /,
    );
  });

  it('reads 404 as absent, and 200 as the bytes', async () => {
    expect(await scripted(404).store.get(ABC_SHA256)).toBeUndefined();
    expect(await scripted(404).store.has(ABC_SHA256)).toBe(false);
    expect(await scripted(200).store.has(ABC_SHA256)).toBe(true);
    expect(await scripted(200, 'abc').store.get(ABC_SHA256)).toEqual(
      new TextEncoder().encode('abc'),
    );
    await scripted(404).store.delete(ABC_SHA256);
    await scripted(204).store.delete(ABC_SHA256);
  });

  it('sends the bytes it hashed, whatever the caller does to its array during the put', async () => {
    const { store, sent } = scripted(200);
    const bytes = new TextEncoder().encode('abc');
    const pending = store.put(bytes);
    bytes.fill(0);
    expect(await pending).toBe(ABC_SHA256);
    expect(sent[0]!.body).toEqual(new TextEncoder().encode('abc'));
  });

  it('refuses bytes that do not hash to their key: the bucket is off the box', async () => {
    const failure = await scripted(200, 'not abc')
      .store.get(ABC_SHA256)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(S3BlobIntegrityError);
    expect((failure as Error).message).not.toContain('not abc');
  });

  it('turns any other status into an error naming the method and the status, never the body', async () => {
    for (const [call, method] of [
      [(store: BlobStore) => store.put(new Uint8Array()), 'PUT'],
      [(store: BlobStore) => store.get(ABC_SHA256), 'GET'],
      [(store: BlobStore) => store.has(ABC_SHA256), 'HEAD'],
      [(store: BlobStore) => store.delete(ABC_SHA256), 'DELETE'],
    ] as const) {
      const failure = await call(scripted(403, 'secret detail').store).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(S3BlobStoreError);
      expect((failure as S3BlobStoreError).status).toBe(403);
      expect((failure as S3BlobStoreError).message).toBe(
        `The object store answered ${method} with 403.`,
      );
    }
  });

  it('sends nothing for a malformed key', async () => {
    const { store, sent } = scripted(200);
    await expect(store.get('../secrets')).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});

// --- A real bucket, when there is one -----------------------------------------

const S3 = {
  endpoint: process.env.OYL_INSTANCE_S3_ENDPOINT,
  bucket: process.env.OYL_INSTANCE_S3_BUCKET,
  region: process.env.OYL_INSTANCE_S3_REGION,
  accessKeyId: process.env.OYL_INSTANCE_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.OYL_INSTANCE_S3_SECRET_ACCESS_KEY,
};

const MISSING = Object.entries({
  OYL_INSTANCE_S3_ENDPOINT: S3.endpoint,
  OYL_INSTANCE_S3_BUCKET: S3.bucket,
  OYL_INSTANCE_S3_REGION: S3.region,
  OYL_INSTANCE_S3_ACCESS_KEY_ID: S3.accessKeyId,
  OYL_INSTANCE_S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
})
  .filter(([, value]) => value === undefined || value === '')
  .map(([name]) => name);

const S3_SKIPPED =
  `SKIPPED: no S3-compatible bucket configured. Set ${MISSING.join(', ')} ` +
  '(see .env.example) to run the blob store conformance suite against one. Not a CI gate.';

if (MISSING.length > 0) {
  // stderr, not console.warn: under Vitest's default reporter only this prints
  // (measured for #318, `merged-manifest.test.ts`).
  process.stderr.write(`\n${S3_SKIPPED}\n\n`);
}

describeBlobStoreConformance(
  'S3-compatible',
  () => {
    const store = createS3BlobStore({
      endpoint: S3.endpoint ?? '',
      bucket: S3.bucket ?? '',
      region: S3.region ?? '',
      accessKeyId: S3.accessKeyId ?? '',
      secretAccessKey: S3.secretAccessKey ?? '',
    });
    // A bucket outlives the test, so every key the suite could have written is removed after it.
    const written = new Set<string>([ABC_SHA256, EMPTY_SHA256]);
    const recording: BlobStore = {
      ...store,
      put: async (bytes, expected) => {
        const key = await store.put(bytes, expected);
        written.add(key);
        return key;
      },
    };
    return Promise.all([...written].map((key) => store.delete(key))).then(() => ({
      open: () => Promise.resolve(recording),
      dispose: async () => {
        for (const key of written) await store.delete(key);
      },
    }));
  },
  MISSING.length > 0 ? { skip: S3_SKIPPED } : {},
);
