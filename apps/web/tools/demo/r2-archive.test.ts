// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The published archive through R2's S3 API — #2275.
 *
 * No bucket is reached: `fetch` is stubbed, and every case reads back what
 * the stub was sent or what the source returned. The signature's own bytes are
 * `apps/instance/src/blob/s3-blob-store.test.ts`'s, which reproduces AWS's
 * worked example; what is held here is what this source asks it to sign — the
 * R2 endpoint, the bucket and key, the range, an empty payload and R2's
 * `auto` region — and that the response is held as `archiveSource` holds it.
 */

import { MAX_TILE_BYTES } from '@onyourleft/map-features';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signS3Request } from '../../../instance/src/blob/s3-signature';
import { PUBLISHED_BASEMAP_URL } from '../../src/map/basemap';
import { failureOf } from '../../src/game/world-data/corridor';

import { archiveOf } from './bake-route';
import { R2_ARCHIVE_VARIABLES, r2ArchiveAccess, r2ArchiveSource } from './r2-archive';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const ACCESS = {
  accountId: ACCOUNT,
  bucket: 'oyl-basemap',
  accessKeyId: 'example-key-id',
  secretAccessKey: 'example-secret-access-key',
} as const;
const ENV = {
  OYL_BASEMAP_R2_ACCOUNT_ID: ACCESS.accountId,
  OYL_BASEMAP_R2_BUCKET: ACCESS.bucket,
  OYL_BASEMAP_R2_ACCESS_KEY_ID: ACCESS.accessKeyId,
  OYL_BASEMAP_R2_SECRET_ACCESS_KEY: ACCESS.secretAccessKey,
};
const OBJECT = `https://${ACCOUNT}.r2.cloudflarestorage.com/oyl-basemap/basemap-us-oyl-20261031.pmtiles`;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const INSTANT = new Date(Date.UTC(2026, 10, 7, 12, 0, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function respond(status: number, body: Uint8Array, headers: Record<string, string> = {}): Sent[] {
  const calls: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(body as BodyInit, { status, headers }));
    }),
  );
  return calls;
}

const source = () => r2ArchiveSource(PUBLISHED_BASEMAP_URL, ACCESS, () => INSTANT);

/** Every string a refusal carries, so a case can say none of them is a secret. */
const wordsOf = (error: unknown): string =>
  error instanceof Error ? `${error.message} ${JSON.stringify(error.cause)}` : String(error);

describe('r2ArchiveAccess: the four variables, all or none — #2275', () => {
  it('names the secrets the workflows pass', () => {
    expect(Object.values(R2_ARCHIVE_VARIABLES)).toStrictEqual(Object.keys(ENV));
  });

  it('is none when none is set, or each is empty — a workflow passes "" for a missing secret', () => {
    expect(r2ArchiveAccess({})).toBeUndefined();
    expect(
      r2ArchiveAccess(Object.fromEntries(Object.keys(ENV).map((name) => [name, '']))),
    ).toBeUndefined();
  });

  it('reads all four, trimmed of a pasted newline', () => {
    expect(r2ArchiveAccess(ENV)).toStrictEqual(ACCESS);
    expect(
      r2ArchiveAccess({ ...ENV, OYL_BASEMAP_R2_SECRET_ACCESS_KEY: `${ACCESS.secretAccessKey}\n` }),
    ).toStrictEqual(ACCESS);
  });

  it('refuses some set and some not, naming the unset ones and no value', () => {
    const refused = (() => {
      try {
        r2ArchiveAccess({ ...ENV, OYL_BASEMAP_R2_BUCKET: '', OYL_BASEMAP_R2_ACCESS_KEY_ID: '' });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refused).toBeInstanceOf(Error);
    const message = (refused as Error).message;
    expect(message).toMatch(/OYL_BASEMAP_R2_BUCKET, OYL_BASEMAP_R2_ACCESS_KEY_ID are unset$/);
    expect(message).not.toContain(ACCESS.secretAccessKey);
    expect(message).not.toContain(ACCOUNT);
  });

  it('refuses an account id or a bucket that is not one, naming the variable and not the value', () => {
    const notAnId = 'https://evil.example/';
    expect(() => r2ArchiveAccess({ ...ENV, OYL_BASEMAP_R2_ACCOUNT_ID: notAnId })).toThrow(
      /^demo:bake: OYL_BASEMAP_R2_ACCOUNT_ID is not a Cloudflare account id/,
    );
    expect(() => r2ArchiveAccess({ ...ENV, OYL_BASEMAP_R2_ACCOUNT_ID: notAnId })).not.toThrow(
      notAnId,
    );
    expect(() => r2ArchiveAccess({ ...ENV, OYL_BASEMAP_R2_BUCKET: '../other' })).toThrow(
      /^demo:bake: OYL_BASEMAP_R2_BUCKET is not an R2 bucket name$/,
    );
  });
});

describe('r2ArchiveSource: a signed, ranged GetObject of the published object — #2275', () => {
  it('asks R2 for the published URL’s object, by range, signed for R2 and nothing else', async () => {
    const calls = respond(206, new Uint8Array(10), { etag: '"e-164"' });
    const answer = await source().getBytes(100, 10);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OBJECT);
    expect(calls[0]?.init.credentials).toBe('omit');
    // Every input to the signature at once: the endpoint and key, the range,
    // the empty payload, R2's region and the clock.
    expect(calls[0]?.init.headers).toStrictEqual(
      await signS3Request(
        {
          method: 'GET',
          url: new URL(OBJECT),
          headers: { range: 'bytes=100-109' },
          payloadSha256: EMPTY_SHA256,
        },
        {
          accessKeyId: ACCESS.accessKeyId,
          secretAccessKey: ACCESS.secretAccessKey,
          region: 'auto',
        },
        INSTANT,
      ),
    );
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('range')).toBe('bytes=100-109');
    expect(headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=example-key-id\/20261107\/auto\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    // The secret itself is never sent, only what it signed.
    expect(JSON.stringify(calls[0]?.init.headers)).not.toContain(ACCESS.secretAccessKey);
    expect(new Uint8Array(answer.data)).toHaveLength(10);
    expect(answer.etag).toBe('"e-164"');
  });

  it('keys the source by the public URL, which names no account', () => {
    expect(source().getKey()).toBe(PUBLISHED_BASEMAP_URL);
  });

  it('refuses a URL whose path is not a key it signs', () => {
    expect(() => r2ArchiveSource('https://tiles.openzigs.com/a%20b.pmtiles', ACCESS)).toThrow(
      /not an object key/,
    );
    expect(() => r2ArchiveSource('https://tiles.openzigs.com/', ACCESS)).toThrow(
      /not an object key/,
    );
  });

  it('asks for no range longer than a tile may be', async () => {
    const calls = respond(206, new Uint8Array(10));
    const refused = await source()
      .getBytes(0, MAX_TILE_BYTES + 1)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
    expect(calls).toHaveLength(0);
  });

  it('says a refusal by its status alone — no URL, so no account id, and no key', async () => {
    respond(403, new TextEncoder().encode('<Error><Code>AccessDenied</Code></Error>'));
    const refused = await source()
      .getBytes(0, 10)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'http', status: 403 });
    for (const secret of Object.values(ACCESS)) expect(wordsOf(refused)).not.toContain(secret);
  });

  it('refuses a whole-file 200 larger than the range, and a range answered with more bytes', async () => {
    respond(200, new Uint8Array(50), { 'content-length': '50' });
    expect(
      failureOf(
        await source()
          .getBytes(0, 10)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({ kind: 'not-a-range' });
    respond(206, new Uint8Array(20));
    expect(
      failureOf(
        await source()
          .getBytes(0, 10)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({ kind: 'not-a-range' });
    respond(200, new Uint8Array(8), { 'content-length': '8' });
    expect((await source().getBytes(0, 16)).data.byteLength).toBe(8);
  });

  it('does not read the body of a whole-file 200 — the archive an endpoint ignoring Range would send', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 200) controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(endless, { status: 200, headers: { 'content-length': '19155814749' } }),
        ),
      ),
    );
    const refused = await source()
      .getBytes(0, 16_384)
      .catch((e: unknown) => e);
    expect(failureOf(refused)).toStrictEqual({ kind: 'not-a-range' });
    expect(pulled).toBeLessThan(5);
  });

  it('refuses an object that changed under the read, and passes no weak etag on', async () => {
    respond(206, new Uint8Array(10), { etag: '"new"' });
    expect(
      failureOf(
        await source()
          .getBytes(0, 10, undefined, '"old"')
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({ kind: 'changed' });
    respond(206, new Uint8Array(10), { etag: 'W/"weak"' });
    expect((await source().getBytes(0, 10)).etag).toBeUndefined();
  });

  it('says a refused network as network, and an abort as aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError(`fetch failed: ${OBJECT}`))),
    );
    const network = await source()
      .getBytes(0, 10)
      .catch((e: unknown) => e);
    expect(failureOf(network)).toStrictEqual({ kind: 'network' });
    expect(wordsOf(network)).not.toContain(ACCOUNT);
    const controller = new AbortController();
    controller.abort();
    expect(
      failureOf(
        await source()
          .getBytes(0, 10, controller.signal)
          .catch((e: unknown) => e),
      ),
    ).toStrictEqual({ kind: 'aborted' });
  });
});

describe('archiveOf reads the published archive through R2 only when told to — #2275', () => {
  /** The hosts the archive's header read went to, read back through the archive a bake opens. */
  async function hostsOpened(value: string, env: Record<string, string>): Promise<string[]> {
    const calls = respond(403, new Uint8Array(0));
    const { archive } = archiveOf(value, env);
    await archive.open(new AbortController().signal).catch(() => undefined);
    return [...new Set(calls.map((call) => new URL(call.url).host))];
  }

  it('reads through R2 where the variables are set, recording the public URL', async () => {
    const opened = archiveOf(PUBLISHED_BASEMAP_URL, ENV);
    expect(opened.via).toBe('r2');
    expect(opened.archiveUrl).toBe(PUBLISHED_BASEMAP_URL);
    expect(await hostsOpened(PUBLISHED_BASEMAP_URL, ENV)).toStrictEqual([
      `${ACCOUNT}.r2.cloudflarestorage.com`,
    ]);
  });

  it('reads the public URL where they are not — a local run is unchanged', async () => {
    expect(archiveOf(PUBLISHED_BASEMAP_URL, {}).via).toBe('https');
    expect(await hostsOpened(PUBLISHED_BASEMAP_URL, {})).toStrictEqual(['tiles.openzigs.com']);
  });

  it('never sends the credential to another host’s archive', async () => {
    const elsewhere = 'https://tiles.example.org/basemap.pmtiles';
    expect(archiveOf(elsewhere, ENV).via).toBe('https');
    expect(await hostsOpened(elsewhere, ENV)).toStrictEqual(['tiles.example.org']);
  });

  it('refuses half the variables before a byte is read', () => {
    const calls = respond(206, new Uint8Array(0));
    expect(() => archiveOf(PUBLISHED_BASEMAP_URL, { OYL_BASEMAP_R2_ACCOUNT_ID: ACCOUNT })).toThrow(
      /are unset$/,
    );
    expect(calls).toHaveLength(0);
  });
});
