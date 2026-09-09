// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #15's sixth criterion: **the same input stream gives the same FIT bytes on
 * every client.**
 *
 * > Activities recorded on mobile and on the web client are byte-identical in
 * > their FIT output for the same input stream, asserted by a shared fixture.
 *
 * ## Why this is not "encode it twice and compare"
 *
 * Because that compares a function with itself and passes for ever —
 * `CLAUDE.md` §5's *"the test asserted against the object it just
 * constructed"*, one level up. What makes byte-identity true today is
 * **structural**: ADR 0008 D-1 chose Capacitor for web UI reuse, and
 * `apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'`, so the
 * Android shell ships **this build**. There is one encoder because there is one
 * client.
 *
 * So this file asserts the bytes for the shared fixture — through the real
 * export path, not through the codec directly — *and* the three facts that make
 * them the same bytes inside the shell:
 *
 * 1. `webDir` still resolves to `apps/web`'s build output.
 * 2. `apps/mobile` declares no dependency that could encode a FIT file.
 * 3. Nothing under `apps/mobile/src` reaches for the codec.
 *
 * Any of those going false is how a second encoder arrives, and it would arrive
 * looking like a feature. Same posture as `packages/physics/src/pacer.ts` for
 * the bot and the rider sharing one physics tick: make it a fact about the call
 * graph rather than a comment.
 *
 * ⚠️ **The fixture is pinned by digest, and "encode it twice" is not enough to
 * do that.** Two encodes inside one test run finish inside the same second, so
 * a fixture whose start time came from `Date.now()` — or from the run order, or
 * from anything else about the machine — passes the repetition assertion and
 * still gives two clients different bytes, which is the whole failure a
 * *shared* fixture exists to rule out. Found by mutation: replacing
 * `CROSS_CLIENT_EPOCH` with the clock left the suite green. `FIXTURE_DIGEST`
 * below is the assertion that goes red. It hashes the **fixture**, never the
 * encoded bytes, so a deliberate improvement to the FIT encoder does not
 * disturb it — only a change to the input does, and then the digest is updated
 * in the same commit that changed it.
 *
 * ⚠️ **What this does NOT prove: that an iPhone produces these bytes.** There is
 * no iOS client — see [ADR 0018](../../../../docs/adr/0018-native-client-platform.md)
 * and `docs/spikes/0002-background-recording.md`. When one exists it is in scope
 * for this file, and assertions 1–3 are what will say whether it shares the
 * encoder or has grown its own.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CROSS_CLIENT_ACTIVITY,
  CROSS_CLIENT_SAMPLES,
  crossClientChannelCount,
  crossClientRide,
  crossClientStreams,
} from './cross-client-fixture';
import { exportActivity } from './export-activity';

const mobileRoot = new URL('../../../mobile/', import.meta.url);

function mobileFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, mobileRoot)), 'utf8');
}

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/** Export the shared fixture through the path the Files screen actually uses. */
async function exportedBytes(): Promise<Uint8Array> {
  await seedAthletes(harness);
  await harness.write(async (store) => {
    await store.putActivity(crossClientRide(ATHLETE_A));
    await store.putStreamSet(crossClientStreams(ATHLETE_A));
  });
  const exported = await harness.read(async (store) =>
    exportActivity({
      store,
      athleteId: ATHLETE_A,
      activityId: CROSS_CLIENT_ACTIVITY,
      format: 'fit',
    }),
  );
  return exported.file.bytes;
}

/**
 * A canonical JSON of the shared fixture, hashed with FNV-1a (32-bit).
 *
 * FNV rather than WebCrypto because this file imports no platform primitive
 * beyond `node:fs`, and `crypto.subtle` is asynchronous and needs a DOM this
 * assertion does not otherwise want. The hash is not security-relevant: it
 * detects an accidental change to the fixture, and nothing here defends against
 * somebody choosing a collision on purpose.
 *
 * `undefined` inside a channel serialises as `null`, which is what makes a gap
 * visible to the digest rather than silently absent.
 */
function fixtureDigest(): string {
  const canonical = JSON.stringify(
    [crossClientRide(ATHLETE_A), crossClientStreams(ATHLETE_A)],
    (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : value,
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Recorded from the fixture on 2026-09-09. Change it only in the commit that
 * deliberately changes the fixture, and say in that commit why the shared
 * reference moved.
 */
const FIXTURE_DIGEST = 'c37f9385';

describe('one input stream, one set of FIT bytes', () => {
  it('encodes the shared fixture to the same bytes every time', async () => {
    // The floor beneath cross-client identity: an encoder that varied run to
    // run could not be byte-identical anywhere, including with itself. This is
    // the assertion the structural ones below rest on.
    const first = await exportedBytes();
    await harness.destroy();
    harness = createStoreHarness();
    const second = await exportedBytes();

    expect(second.byteLength).toBe(first.byteLength);
    expect(Array.from(second)).toStrictEqual(Array.from(first));
    expect(first.byteLength).toBeGreaterThan(0);
  });

  it('is the same fixture on every machine and every run', () => {
    // Not "the same twice in a row" — see the ⚠️ at the top of this file. A
    // digest over the fixture itself is what makes it a constant rather than a
    // computation that happens to agree with itself within one second.
    expect(fixtureDigest()).toBe(FIXTURE_DIGEST);
  });

  it('is a fixture worth sharing rather than the simplest one that would pass', () => {
    // A one-channel stream of constant values would make "byte-identical" true
    // and prove nothing about it.
    expect(crossClientChannelCount(ATHLETE_A)).toBeGreaterThanOrEqual(6);
    expect(CROSS_CLIENT_SAMPLES).toBeGreaterThanOrEqual(600);
    // And it has holes, which is what two encoders most easily disagree about.
    const channels = crossClientStreams(ATHLETE_A).channels as unknown as Record<
      string,
      readonly unknown[]
    >;
    const withGaps = Object.values(channels).filter((samples) =>
      samples.some((sample) => sample === undefined),
    );
    expect(withGaps.length).toBeGreaterThanOrEqual(4);
  });
});

describe('the mobile shell ships this build, which is why the bytes match', () => {
  it('points webDir at apps/web’s build output', () => {
    // ⚠️ The load-bearing fact. `apps/mobile/README.md` §4 and CLAUDE.md §4h
    // both rest on it: an encoder under `apps/mobile/src` would typecheck, test
    // green, and never be copied into the APK.
    expect(mobileFile('capacitor.config.ts')).toMatch(/webDir:\s*['"]\.\.\/web\/dist['"]/);
  });

  it('declares no dependency that could encode a FIT file', () => {
    const manifest = JSON.parse(mobileFile('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(declared).not.toContain('@onyourleft/fit');
    expect(declared).not.toContain('fit-file-parser');
  });

  it('reaches for the codec nowhere in its own source', () => {
    // A grep rather than a type check, because what this catches is a NEW file
    // — and a new file under `apps/mobile/src` would compile against its own
    // dependency perfectly happily.
    const sources = typeScriptUnder(fileURLToPath(new URL('src/', mobileRoot)));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} names the codec`).not.toMatch(/@onyourleft\/fit/);
      expect(text, `${file} encodes an activity`).not.toMatch(/encodeFitActivity/);
    }
  });
});

/** Every `.ts` under a directory, recursively. `node:fs` only — no glob dependency. */
function typeScriptUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) out.push(path);
    }
  };
  walk(root);
  return out;
}
