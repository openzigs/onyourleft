// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The published basemap archive, read through R2's S3 API — #2275.
 *
 * `tiles.openzigs.com` answers a GitHub-hosted runner's range request with
 * HTTP 403 (run 42269980561): the zone's Bot Fight Mode challenges the
 * runners' network, and on the Free plan it is zone-wide and cannot be skipped
 * for one path. The owner's ruling of 2026-11-07 on #2275: a runner reads the
 * same object from the bucket behind that host, through R2's S3 endpoint, with
 * a **read-only** token scoped to the basemap bucket. The zone keeps Bot Fight
 * Mode.
 *
 * So `bake-route.ts` §`archiveOf` reads the published archive through
 * {@link r2ArchiveSource} when all four {@link R2_ARCHIVE_VARIABLES} are set,
 * and through the public URL otherwise — a local run, which sets none, is
 * unchanged. Only CI sets them: the `basemap-archive` environment's secrets,
 * in the demo release's bake step and the nightly's archive check
 * (`docs/agents/ci.md` §4c §"The basemap archive's read token — #2275").
 *
 * - **The object is the published URL's**: its key is that URL's path, so a
 *   bake through R2 reads the bytes a rider's request does, and the record
 *   keeps naming the public URL (`archiveUrl`) rather than the transport.
 * - **The response is held as `world-data/corridor-source.ts`
 *   §`archiveSource` holds it**: no range over a tile's bound, a 206 or a
 *   small whole-file 200 and nothing longer, a strong etag that must not move.
 *   A copy of those checks rather than a call into them: that module is the
 *   rider app's one archive fetch, and ADR 0054 D-6.1 says its requests carry
 *   no credential. This one is a build-time tool's and carries one.
 * - **The signature is `apps/instance/src/blob/s3-signature.ts`'s**, the
 *   SigV4 the instance's own S3 blob store sends, which reproduces AWS's worked
 *   example for a ranged GET. Its scope is R2's: region `auto`, service `s3`.
 *
 * ⚠️ **No secret reaches a message.** A failure names a variable, never its
 * value, and a read's failure is a `CorridorFailure` (a status or a kind),
 * which carries no URL: the account id is in the endpoint's host. `getKey` is
 * the public URL for the same reason.
 */

import { MAX_TILE_BYTES } from '@onyourleft/map-features';
import type { Source } from 'pmtiles';

import { signS3Request } from '../../../instance/src/blob/s3-signature';
import { corridorError } from '../../src/game/world-data/corridor';

/** The environment variables a runner's R2 read takes, which are the secrets' names too. */
export const R2_ARCHIVE_VARIABLES = {
  accountId: 'OYL_BASEMAP_R2_ACCOUNT_ID',
  bucket: 'OYL_BASEMAP_R2_BUCKET',
  accessKeyId: 'OYL_BASEMAP_R2_ACCESS_KEY_ID',
  secretAccessKey: 'OYL_BASEMAP_R2_SECRET_ACCESS_KEY',
} as const;

export interface R2ArchiveAccess {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/** A Cloudflare account id: 32 lower-case hexadecimal digits, the host's first label. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** An R2 bucket name: 3 to 63 lower-case letters, digits and hyphens, not starting or ending with one. */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** The keys this reader signs: path segments of characters SigV4 does not encode. */
const OBJECT_KEY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
/** SHA-256 of an empty body: a GET sends none. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * The R2 access `env` names, or `undefined` when it names none.
 *
 * An empty value is unset: a workflow passes `''` for a secret that does not
 * exist. Some set and some not is refused, naming the unset ones, rather than
 * falling back to the public URL and a 403 that says nothing about why.
 */
export function r2ArchiveAccess(env: Environment): R2ArchiveAccess | undefined {
  const fields = Object.entries(R2_ARCHIVE_VARIABLES) as [keyof R2ArchiveAccess, string][];
  const values = fields.map(([field, name]) => [field, name, (env[name] ?? '').trim()] as const);
  const unset = values.filter(([, , value]) => value === '').map(([, name]) => name);
  if (unset.length === values.length) return undefined;
  if (unset.length > 0) {
    throw new Error(
      `demo:bake: reading the archive through R2 needs all of ${Object.values(R2_ARCHIVE_VARIABLES).join(', ')}; ` +
        `${unset.join(', ')} ${unset.length === 1 ? 'is' : 'are'} unset`,
    );
  }
  const access = Object.fromEntries(
    values.map(([field, , value]) => [field, value]),
  ) as unknown as R2ArchiveAccess;
  if (!ACCOUNT_ID.test(access.accountId)) {
    throw new Error(
      `demo:bake: ${R2_ARCHIVE_VARIABLES.accountId} is not a Cloudflare account id (32 hexadecimal digits)`,
    );
  }
  if (!BUCKET.test(access.bucket)) {
    throw new Error(`demo:bake: ${R2_ARCHIVE_VARIABLES.bucket} is not an R2 bucket name`);
  }
  return access;
}

/**
 * A `pmtiles` source over R2's S3 API for the object behind `archiveUrl`: a
 * signed, ranged `GetObject` of `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`,
 * where the key is `archiveUrl`'s path. `now` is the signing clock.
 */
export function r2ArchiveSource(
  archiveUrl: string,
  access: R2ArchiveAccess,
  now: () => Date = () => new Date(),
): Source {
  const key = new URL(archiveUrl).pathname.slice(1);
  if (!OBJECT_KEY.test(key)) {
    throw new Error("demo:bake: the archive URL's path is not an object key this reader signs");
  }
  const object = new URL(
    `https://${access.accountId}.r2.cloudflarestorage.com/${access.bucket}/${key}`,
  );
  const credentials = {
    accessKeyId: access.accessKeyId,
    secretAccessKey: access.secretAccessKey,
    region: 'auto',
  };
  return {
    getKey: () => archiveUrl,
    getBytes: async (offset, length, signal, etag) => {
      // `archiveSource`'s bound: the length is the archive's own directory's.
      if (length > MAX_TILE_BYTES) throw corridorError({ kind: 'not-a-range' });
      const headers = await signS3Request(
        {
          method: 'GET',
          url: object,
          headers: { range: `bytes=${String(offset)}-${String(offset + length - 1)}` },
          payloadSha256: EMPTY_SHA256,
        },
        credentials,
        now(),
      );
      let response: Response;
      try {
        response = await fetch(object, {
          headers,
          credentials: 'omit',
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (signal?.aborted === true) throw corridorError({ kind: 'aborted' });
        void error;
        throw corridorError({ kind: 'network' });
      }
      if (response.status !== 206 && response.status !== 200) {
        await response.body?.cancel();
        throw corridorError({ kind: 'http', status: response.status });
      }
      const declared = Number(response.headers.get('content-length') ?? Number.NaN);
      if (response.status === 200 && !(declared <= length)) {
        await response.body?.cancel();
        throw corridorError({ kind: 'not-a-range' });
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > length) throw corridorError({ kind: 'not-a-range' });
      const raw = response.headers.get('etag');
      const tag = raw === null || raw.startsWith('W/') ? undefined : raw;
      if (etag !== undefined && tag !== undefined && tag !== etag) {
        throw corridorError({ kind: 'changed' });
      }
      return tag === undefined ? { data } : { data, etag: tag };
    },
  };
}
