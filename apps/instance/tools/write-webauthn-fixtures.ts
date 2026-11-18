// SPDX-License-Identifier: AGPL-3.0-or-later

import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

/**
 * Write `src/admin/fixtures/webauthn.json` (#2642): the admin passkey
 * verifier's synthetic fixtures, made by the tests' own software
 * authenticator (`src/admin/webauthn-testing.ts`) — no real device's output,
 * nothing from one machine.
 *
 * Run it only to change the fixtures:
 * `node apps/instance/tools/write-webauthn-fixtures.ts`. The keys are drawn
 * afresh each run, so a rerun rewrites every byte; `webauthn.test.ts` reads
 * the committed file and names every fixture in it.
 */
registerHooks({ resolve: resolveExtensionless });

const { softwareAuthenticator } = await import('../src/admin/webauthn-testing.ts');
const { toBase64Url } = await import('../src/admin/webauthn.ts');

const rpId = 'ride.example';
const origin = 'https://ride.example';
const challenge = (label: string): string =>
  toBase64Url(new TextEncoder().encode(`oyl-fixture-challenge:${label}`.padEnd(32, '.')));

const fixtures: unknown[] = [];

for (const algorithm of ['es256', 'ed25519'] as const) {
  const authenticator = await softwareAuthenticator(algorithm);
  const enrol = challenge(`enrol-${algorithm}`);
  fixtures.push({
    name: `good ${algorithm} registration`,
    kind: 'registration',
    challenge: enrol,
    response: await authenticator.register({ rpId, origin, challenge: enrol }),
    outcome: 'accepted',
    credential: { algorithm, publicKey: authenticator.publicKey, signCount: 0 },
  });
  const credential = { algorithm, publicKey: authenticator.publicKey, signCount: 0 };
  const good = challenge(`sign-in-${algorithm}`);
  fixtures.push({
    name: `good ${algorithm} assertion`,
    kind: 'assertion',
    challenge: good,
    credential,
    response: await authenticator.assert({ rpId, origin, challenge: good }),
    outcome: 'accepted',
  });
}

const es256 = await softwareAuthenticator('es256');
const stored = { algorithm: 'es256', publicKey: es256.publicKey, signCount: 0 };
const bad = async (
  name: string,
  outcome: string,
  build: (ceremony: { rpId: string; origin: string; challenge: string }) => Promise<unknown>,
  credential: unknown = stored,
  expectedChallenge?: string,
): Promise<void> => {
  const issued = challenge(name);
  fixtures.push({
    name,
    kind: 'assertion',
    challenge: expectedChallenge ?? issued,
    credential,
    response: await build({ rpId, origin, challenge: issued }),
    outcome,
  });
};

await bad('flipped signature byte', 'signature', async (ceremony) => {
  const made = await es256.assert(ceremony);
  const bytes = Uint8Array.from(atob(made.signature.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  // The last byte of `s`: still well-formed DER, no longer the signature.
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 0x01;
  return { ...made, signature: toBase64Url(bytes) };
});
await bad('wrong rpIdHash', 'rp_id', (ceremony) =>
  es256.assert(ceremony, { rpIdHashed: 'evil.example' }),
);
await bad('user verification unset', 'user_verified', (ceremony) =>
  es256.assert(ceremony, { flags: 0x01 }),
);
await bad(
  'sign count went backwards',
  'counter',
  (ceremony) => es256.assert(ceremony, { signCount: 5 }),
  { ...stored, signCount: 10 },
);
// Issued for "back up now"; the response is held to "end room"'s challenge.
await bad(
  'challenge from another action',
  'challenge',
  (ceremony) => es256.assert({ ...ceremony, challenge: challenge('step-up backup_now') }),
  stored,
  challenge('step-up end_room'),
);

const target = new URL('../src/admin/fixtures/webauthn.json', import.meta.url);
writeFileSync(target, `${JSON.stringify({ rpId, origin, fixtures }, null, 2)}\n`);
process.stdout.write(`wrote ${target.pathname}\n`);
