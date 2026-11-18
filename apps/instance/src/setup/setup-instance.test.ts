// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The first-run setup wizard as the RUNNING instance serves it** (#2784,
 * ADR 0080 D-1, D-2, D-3, D-6, D-7): the production `startInstance`, its two
 * Node listeners over real TCP, a real SQLite file and a real secrets folder,
 * restarted on the same file as Docker restarts it. Every claim here is read
 * back through the path a real consumer uses: the owner's browser on the
 * loopback listener, the tablet's sealed claim route, an unauthenticated
 * registration, the backup service's own loop and the off-box folder it
 * writes, and the log lines the container prints.
 */

import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import { backupLoop, ownerClaimReset, registrationMode, setupCode } from '../operator/commands.ts';
import { readServerConfig } from '../server-config.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';
import type { SecretFromFile } from './secrets.ts';
import { SETUP_CODE_FILE } from './setup-code.ts';
import { SETUP_ROUTES } from './setup-routes.ts';
import { SETUP_COOKIE } from './setup.ts';

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

/** A secret the kit holds, as `resolveSecrets` read it from its file: a marker, so a leak is found. */
const KIT_SECRET: SecretFromFile = {
  variable: 'OYL_INSTANCE_SECRET_KEY',
  file: 'instance-secret-key',
  text: 'MARKER-secret-2784-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  generated: true,
};

interface World {
  readonly path: string;
  readonly secrets: string;
  readonly port: number;
  readonly lines: string[];
  /** Every page body any browser was answered with. */
  readonly pages: string[];
  instance: StartedInstance;
  /** Unix ms, moved by a test that needs a code to run out. */
  clock: number | undefined;
}

async function world(): Promise<World> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-setup-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const secrets = join(directory, 'secrets');
  await mkdir(secrets, { mode: 0o700 });
  const made: World = {
    path,
    secrets,
    port: await freeLoopbackPort(),
    lines: [],
    pages: [],
    instance: undefined as unknown as StartedInstance,
    clock: undefined,
  };
  made.instance = await start(made);
  return made;
}

/** Start (or start again) the instance on the world's file, as `serve.ts` does on a fresh install. */
async function start(
  at: World,
  options: { readonly ownerKey?: string; readonly adminPages?: boolean } = {},
): Promise<StartedInstance> {
  const read = readServerConfig(
    {
      database: at.path,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      adminPages: options.adminPages === true ? 'on' : 'off',
      adminLoopbackPort: String(at.port),
    },
    1,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      // `.env`'s mode on a fresh install, which a mode set in the wizard wins over.
      registration: 'approval',
      moderators: options.ownerKey === undefined ? {} : { owner: options.ownerKey },
    }),
    server: {
      ...read.config,
      blobsPath: join(at.path, '..', 'blobs'),
      secretKey: new Uint8Array(32).fill(9),
    },
    version: '9.8.7',
    notices: 'notices',
    log: (line) => at.lines.push(line),
    migrationPollMs: 50,
    kitSecrets: [KIT_SECRET],
    secretsDirectory: at.secrets,
    ...(at.clock === undefined ? {} : { now: () => at.clock ?? Date.now() }),
  });
  await running.opened;
  await running.keysMaintained;
  return running;
}

async function restart(at: World, options?: Parameters<typeof start>[1]): Promise<void> {
  await running?.stop();
  running = undefined;
  at.instance = await start(at, options);
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** One request over real TCP to `127.0.0.1:<port>`. */
function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => (text += chunk));
      incoming.on('end', () => {
        resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const portOf = (instance: StartedInstance): number => Number(new URL(instance.url).port);

/** The owner's browser on the server machine: its cookie, and the token its last page carried. */
class Browser {
  cookie: string | undefined;
  csrf: string | undefined;
  private readonly at: World;
  constructor(at: World) {
    this.at = at;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      host: `localhost:${String(this.at.port)}`,
      ...(this.cookie === undefined ? {} : { cookie: `${SETUP_COOKIE}=${this.cookie}` }),
      ...extra,
    };
  }

  private keep(answer: Answer): Answer {
    this.at.pages.push(answer.body);
    const set = answer.headers['set-cookie']?.[0];
    if (set !== undefined) {
      const value = /^oyl-setup=([^;]*)/.exec(set)?.[1];
      this.cookie = value === undefined || value === '' ? undefined : value;
    }
    const token = /name="csrf" value="([0-9a-f]{64})"/.exec(answer.body)?.[1];
    if (token !== undefined) this.csrf = token;
    return answer;
  }

  async get(path: string): Promise<Answer> {
    return this.keep(await send(this.at.port, 'GET', path, this.headers()));
  }

  async post(path: string, fields: Record<string, string> = {}): Promise<Answer> {
    const form = new URLSearchParams({
      ...(this.csrf === undefined ? {} : { csrf: this.csrf }),
      ...fields,
    });
    return this.keep(
      await send(
        this.at.port,
        'POST',
        path,
        this.headers({
          origin: `http://localhost:${String(this.at.port)}`,
          'content-type': 'application/x-www-form-urlencoded',
        }),
        form.toString(),
      ),
    );
  }

  /** Type the code from the file, as the owner does, and land where the setup sends them. */
  async signIn(code: string): Promise<Answer> {
    const answer = await this.post('/setup/sign-in', { code });
    expect(answer.status, answer.body).toBe(303);
    return this.get('/setup');
  }
}

/** The code the instance wrote to the secrets folder, as the owner reads it. */
async function codeInFile(at: World): Promise<string> {
  const text = await readFile(join(at.secrets, SETUP_CODE_FILE), 'utf8');
  const code = text.split('\n')[0] ?? '';
  expect(code).toMatch(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/);
  return code;
}

const fileThere = async (at: World): Promise<boolean> =>
  (await readdir(at.secrets)).includes(SETUP_CODE_FILE);

/** What a path with no route answers on `port`: the bytes a `/setup` path must match. */
async function noRoute(port: number, method: string): Promise<Answer> {
  return send(port, method, '/no-such-route-2784', { host: `localhost:${String(port)}` });
}

/** Every setup route, every method it takes and one it does not, answered as a path with no route. */
async function expectAllNotFound(port: number): Promise<void> {
  const expected = await noRoute(port, 'GET');
  expect(expected.status).toBe(404);
  for (const route of SETUP_ROUTES) {
    for (const method of [...route.methods, 'DELETE']) {
      const answer = await send(port, method, route.path, {
        host: `localhost:${String(port)}`,
        origin: `http://localhost:${String(port)}`,
      });
      expect(answer.status, `${method} ${route.path}`).toBe(404);
      expect(answer.body, `${method} ${route.path}`).toBe(expected.body);
      expect(answer.headers['set-cookie'], `${method} ${route.path}`).toBeUndefined();
    }
  }
}

/** The tablet: pins nothing here, but redeems the claim on the REAL sealed route. */
async function tabletRedeems(at: World, device: TestDevice, claimCode: string) {
  return sealedAt(at.instance.url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/auth/owner-claim',
    body: { publicKey: device.publicKey, claimCode },
    signer: device.signingKey,
  });
}

/** A device registering over the sealed session route, unauthenticated: what a stranger meets. */
async function register(at: World, device: TestDevice) {
  const challenge = (await (
    await fetch(`${at.instance.url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: device.publicKey }),
    })
  ).json()) as { nonce: string };
  return sealedAt(at.instance.url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/auth/session',
    body: await device.statement(challenge.nonce, { issuedAt: Math.floor(Date.now() / 1000) }),
    signer: device.signingKey,
  });
}

const CARD_LINE = /oyl-instance:[^ <]+ ([a-z2-9]{4}(?:-[a-z2-9]{4}){3})/;

describe('the first-run setup on a fresh install (#2784, ADR 0080)', () => {
  it('opens on the loopback listener with the admin pages off, writes the code to the secrets folder, and logs where it is, never the code', async () => {
    const at = await world();
    expect(at.instance.adminLoopback).toBeDefined();
    const code = await codeInFile(at);
    const said = at.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(said.find((line) => line.event === 'first-run-setup')).toEqual({
      event: 'first-run-setup',
      open: `http://localhost:${String(at.port)}/setup`,
      codeIn: 'secrets/setup-code',
      validUntil: expect.stringMatching(/Z$/) as unknown,
    });
    expect(at.lines.join('\n')).not.toContain(code);
    const locked = await new Browser(at).get('/setup');
    expect(locked.status).toBe(200);
    expect(locked.body).toContain('setup-code');
    expect(locked.body).not.toContain(code);
    // The start's own secret, logged by the start (#2781's deferred entry), never its value.
    const store = await openSqlStore(at.path);
    try {
      const log = await store.listOperatorLogPage(undefined, 50);
      expect(
        log
          .filter((entry) => entry.source === 'start')
          .map((entry) => [entry.action, entry.detail]),
      ).toEqual([
        ['setup_code_minted', null],
        ['secret_generated', 'instance_secret_key'],
      ]);
    } finally {
      await store.close();
    }
  });

  it('answers every /setup route not_found through the tunnel, before the claim and after it', async () => {
    const at = await world();
    await expectAllNotFound(portOf(at.instance));
    // Claimed, and the setup still open on the loopback listener.
    const store = await openSqlStore(at.path);
    try {
      await store.registerAthlete(registrationFixture('setup-owner'));
    } finally {
      await store.close();
    }
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const shown = await browser.post('/setup/claim/code');
    expect(shown.status, shown.body).toBe(200);
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    const tablet = await testDevice();
    const redeemed = await tabletRedeems(at, tablet, claim);
    expect(redeemed.status, redeemed.text).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect((await browser.post('/setup/claim/confirm', { comparison })).status).toBe(303);
    expect((await browser.get('/setup/passkey')).status).toBe(200);
    await expectAllNotFound(portOf(at.instance));
  });

  it('gives a wrong, a used and an expired code one undifferentiated sentence, and refuses the Nth attempt even with the right code', async () => {
    const at = await world();
    const good = await codeInFile(at);
    const answers: Answer[] = [];
    answers.push(await new Browser(at).post('/setup/sign-in', { code: 'aaaa-bbbb-cccc-dddd' }));
    const first = new Browser(at);
    expect((await first.post('/setup/sign-in', { code: good })).status).toBe(303);
    answers.push(await new Browser(at).post('/setup/sign-in', { code: good }));
    // Expired: a new code, the clock moved past its ten minutes, and a restart reads that clock.
    at.clock = Date.now();
    await restart(at);
    const late = await codeInFile(at);
    at.clock += 11 * 60 * 1000;
    await restart(at);
    answers.push(await new Browser(at).post('/setup/sign-in', { code: late }));
    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400]);
    expect(new Set(answers.map((answer) => answer.body)).size).toBe(1);
    for (const typed of ['aaaa-bbbb-cccc-dddd', good, late]) {
      expect(answers[0]?.body).not.toContain(typed);
    }
    // The limit: ten a minute from one address, counted before any code is read.
    const right = await codeInFile(at);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await new Browser(at).post('/setup/sign-in', { code: 'aaaa-bbbb-cccc-dddd' });
    }
    const refused = await new Browser(at).post('/setup/sign-in', { code: right });
    expect(refused.status).toBe(429);
    expect(refused.headers['set-cookie']).toBeUndefined();
    // The code was never redeemed: it is still in its file, unused.
    expect(await codeInFile(at)).toBe(right);
    // The refusals, coalesced into one entry per kind as the instance stops (ADR 0069 D-8).
    await running?.stop();
    running = undefined;
    const store = await openSqlStore(at.path);
    try {
      const refusals = (await store.listOperatorLogPage(undefined, 100))
        .filter((entry) => entry.action === 'setup_refused')
        .map((entry) => [entry.source, entry.actorAthleteId, entry.outcome, entry.detail]);
      // Newest first: this start's (the expired code and nine wrong ones), then the first start's
      // (a wrong code and a used one), flushed when the test restarted it.
      expect(refusals).toEqual([
        ['setup', null, 'refused', 'rate_limited,refused=1'],
        ['setup', null, 'refused', 'code,refused=10'],
        ['setup', null, 'refused', 'code,refused=2'],
      ]);
    } finally {
      await store.close();
    }
  });

  it('walks every step to done through two restarts: claim, kit, backups into the off-box folder, the mode a stranger meets, an invite, and gone for good', async () => {
    const at = await world();
    const codes = [await codeInFile(at)];
    const browser = new Browser(at);
    const landed = await browser.signIn(codes[0] as string);
    expect(landed.status).toBe(303);
    expect(landed.headers.location).toBe('/setup/claim');
    // The code is used: its file is gone.
    expect(await fileThere(at)).toBe(false);

    // Unclaimed, holding no athlete: a stranger's registration is refused whatever the mode (D-3).
    const stranger = await testDevice();
    const early = await register(at, stranger);
    expect(early.status, early.text).toBe(403);
    expect(early.text).toContain('registration_closed');

    // Claim: the QR's line, redeemed by the tablet on the sealed route, confirmed here.
    expect((await browser.get('/setup/claim')).body).toContain('Show the claim code');
    const shown = await browser.post('/setup/claim/code');
    expect(shown.status).toBe(200);
    expect(shown.body).toContain('data-oyl-qr="true"');
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect(comparison).toMatch(/^[0-9]{6}$/);
    const confirmed = await browser.post('/setup/claim/confirm', { comparison });
    expect(confirmed.headers.location).toBe('/setup/passkey');
    // The tablet registers as the owner: active in `approval`, the moderator.
    const owner = await register(at, tablet);
    expect(owner.status, owner.text).toBe(200);
    expect(JSON.parse(owner.text)).toMatchObject({ registrationState: 'active' });

    // Passkey: optional, explained.
    expect((await browser.get('/setup/passkey')).body).toContain('admin-passkeys confirm');
    expect((await browser.post('/setup/next', { from: 'passkey' })).headers.location).toBe(
      '/setup/secrets',
    );

    // The emergency kit, once in this session.
    expect((await browser.get('/setup/secrets')).body).toContain('Download the emergency kit');
    const kit = await browser.post('/setup/secrets/kit');
    expect(kit.status).toBe(200);
    expect(kit.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(kit.headers['cache-control']).toBe('no-store');
    expect(kit.body).toContain(`OYL_INSTANCE_SECRET_KEY=${KIT_SECRET.text}`);
    expect(kit.body).toContain(`OYL_INSTANCE_ORIGIN=${TEST_ORIGIN}`);
    expect(kit.body).not.toContain(codes[0]);
    at.pages.splice(at.pages.indexOf(kit.body), 1);
    const again = await browser.post('/setup/secrets/kit');
    expect(again.status).toBe(303);
    expect(again.body).not.toContain(KIT_SECRET.text);
    expect((await browser.get('/setup/secrets')).body).toContain('was downloaded in this session');
    await browser.post('/setup/next', { from: 'secrets' });

    // Backups: "Back up now" here, served by the backup service's own loop,
    // and the snapshot in the OFF-BOX folder the service was given.
    const backups = join(at.path, '..', 'backups-dir');
    const offBox = join(at.path, '..', 'MARKER-offbox-2784');
    expect((await browser.get('/setup/backups')).body).toContain('No backup has run yet');
    const asked = await browser.post('/setup/backups/now');
    expect(asked.headers.location).toBe('/setup/backups?asked');
    expect((await browser.get('/setup/backups?asked')).body).toContain(
      'Waiting for the backup service',
    );
    const stop = new AbortController();
    await backupLoop({ database: at.path, blobs: join(at.path, '..', 'blobs') }, backups, {
      intervalSeconds: 21_600,
      copyTo: offBox,
      signal: stop.signal,
      wait: () => {
        stop.abort();
        return Promise.resolve();
      },
      report: () => undefined,
    });
    const copied = await readdir(offBox);
    expect(copied.filter((name) => name.startsWith('snapshot-'))).toHaveLength(1);
    const read = await browser.get('/setup/backups');
    expect(read.body).toContain('copied to the off-box folder: both folders work');
    expect(read.body).not.toContain('MARKER-offbox-2784');
    {
      const store = await openSqlStore(at.path);
      try {
        expect((await store.listBackupRecords(1))[0]).toMatchObject({
          requested: true,
          offBox: 'copied',
        });
      } finally {
        await store.close();
      }
    }
    await browser.post('/setup/next', { from: 'backups' });

    // Registration: closed, chosen here, over `.env`'s approval.
    const mode = await browser.post('/setup/registration/mode', { mode: 'closed' });
    expect(mode.headers.location).toBe('/setup/registration?saved');

    // Leave, restart: a new code, and the setup resumes at the step it was on.
    await restart(at);
    codes.push(await codeInFile(at));
    const back = new Browser(at);
    const resumed = await back.signIn(codes[1] as string);
    expect(resumed.headers.location).toBe('/setup/registration');
    expect((await back.get('/setup/registration')).body).toContain('closed: nobody new may join');
    // The mode is what an unauthenticated registration meets after the restart.
    const turnedAway = await register(at, await testDevice());
    expect(turnedAway.status, turnedAway.text).toBe(403);
    expect(turnedAway.text).toContain('registration_closed');
    await back.post('/setup/next', { from: 'registration' });

    // One rider invite, as a QR with the card.
    const invite = await back.post('/setup/invite/code');
    expect(invite.status).toBe(200);
    expect(CARD_LINE.exec(invite.body)?.[1]).toMatch(/^[a-z2-9]{4}/);
    expect((await back.post('/setup/invite/code')).status).toBe(303);
    expect((await back.get('/setup/invite')).body).toContain('made its one invite');
    await back.post('/setup/next', { from: 'invite' });

    // Finish: a summary of this session's changes, then gone.
    // The whole setup's changes, the first session's (before the restart) among them.
    const summary = await back.get('/setup/finish');
    const listed = [...summary.body.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1]);
    expect(listed).toEqual(
      expect.arrayContaining([
        'Owner claim code made',
        'Owner claim confirmed',
        'Emergency kit downloaded',
        'Backup asked for',
        'Registration mode set: closed',
        'Rider invite made',
      ]),
    );
    const done = await back.post('/setup/finish/done');
    expect(done.status).toBe(200);
    expect(done.body).toContain('Setup is finished');
    expect(done.headers['set-cookie']?.[0]).toMatch(/Max-Age=0/);
    expect(await fileThere(at)).toBe(false);
    await expectAllNotFound(at.port);

    // Done is the database's: a restart neither reopens it nor writes a code.
    at.lines.length = 0;
    await restart(at);
    expect(await fileThere(at)).toBe(false);
    expect(at.lines.join('\n')).not.toContain('first-run-setup');
    await expectAllNotFound(at.port);
    await expect(
      setupCode({ database: at.path, blobs: `${at.path}.blobs` }, { secretsDirectory: at.secrets }),
    ).rejects.toThrow(/setup is done/);

    // ADR 0004 D, ADR 0069 D-4: no page and no log line holds a setup code or the secret.
    const everything = [...at.pages, ...at.lines].join('\n');
    for (const code of codes) expect(everything).not.toContain(code);
    expect(everything).not.toContain(KIT_SECRET.text);
    expect(at.lines.join('\n')).not.toContain(claim);
  });

  it('is done from the first start when OYL_INSTANCE_OWNER_KEY is set: no code, no listener with the admin pages off, nothing served', async () => {
    const at = await world();
    // The fresh start above minted one; an existing install names its owner and starts again.
    await rm(join(at.secrets, SETUP_CODE_FILE));
    at.lines.length = 0;
    const owner = await testDevice();
    await restart(at, { ownerKey: owner.publicKey });
    expect(at.instance.adminLoopback).toBeUndefined();
    expect(await fileThere(at)).toBe(false);
    expect(at.lines.join('\n')).not.toContain('first-run-setup');
    // With the admin pages on, the listener runs, and still answers no /setup.
    await restart(at, { ownerKey: owner.publicKey, adminPages: true });
    expect(at.instance.adminLoopback).toBeDefined();
    await expectAllNotFound(at.port);
  });

  it('holds every POST to the loopback origin and the session’s token, and every page to a session; another host is told the address', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    for (const route of SETUP_ROUTES) {
      if (route.methods.includes('POST')) {
        const foreign = await send(
          at.port,
          'POST',
          route.path,
          {
            host: `localhost:${String(at.port)}`,
            origin: 'https://ride.example',
            cookie: `${SETUP_COOKIE}=${browser.cookie ?? ''}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          `csrf=${browser.csrf ?? ''}`,
        );
        expect(foreign.status, `origin ${route.path}`).toBe(403);
        if (route.kind === 'action') {
          const tokenless = await send(
            at.port,
            'POST',
            route.path,
            {
              host: `localhost:${String(at.port)}`,
              origin: `http://localhost:${String(at.port)}`,
              cookie: `${SETUP_COOKIE}=${browser.cookie ?? ''}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            `csrf=${'0'.repeat(64)}`,
          );
          expect(tokenless.status, `csrf ${route.path}`).toBe(403);
          const sessionless = await send(
            at.port,
            'POST',
            route.path,
            {
              host: `localhost:${String(at.port)}`,
              origin: `http://localhost:${String(at.port)}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            `csrf=${browser.csrf ?? ''}`,
          );
          expect(sessionless.status, `session ${route.path}`).toBe(303);
          expect(sessionless.headers.location).toBe('/setup');
        }
      }
      if (route.kind === 'page') {
        const anonymous = await send(at.port, 'GET', route.path, {
          host: `localhost:${String(at.port)}`,
        });
        expect(anonymous.status, route.path).toBe(303);
        expect(anonymous.headers.location).toBe('/setup');
      }
      const rebound = await send(at.port, 'GET', route.path, {
        host: `127.0.0.1:${String(at.port)}`,
      });
      expect(rebound.status, route.path).toBe(421);
      expect(rebound.body).toContain(`http://localhost:${String(at.port)}/setup`);
    }
    // Nothing those refusals sent changed the setup: still at the claim, nothing claimed.
    const store = await openSqlStore(at.path);
    try {
      expect(await store.claimedOwnerKey()).toBeUndefined();
      expect(await store.registrationSetting()).toBeUndefined();
    } finally {
      await store.close();
    }
  });
});

describe('the setup’s commands on the host (#2784, ADR 0080 D-2, D-6)', () => {
  it('owner-claim reset reopens the setup at its claim step and ends its sessions (ADR 0080 D-3)', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await browser.post('/setup/claim/code')).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    for (const from of ['passkey', 'secrets', 'backups', 'registration', 'invite']) {
      await browser.post('/setup/next', { from });
    }
    expect((await browser.get('/setup/finish')).status).toBe(200);
    // A second browser's session, still open while the first finishes the setup.
    const printedBefore = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    const second = new Browser(at);
    await second.signIn(printedBefore.code);
    expect((await browser.post('/setup/finish/done')).status).toBe(200);
    await expectAllNotFound(at.port);

    // The claim taken by the wrong device after the setup was done: reset on the host.
    const paths = { database: at.path, blobs: `${at.path}.blobs` };
    expect(await ownerClaimReset(paths)).toMatchObject({ cleared: true, adminSessionsEnded: 0 });
    // The setup is open again, at its claim, and no session from before the reset is one now.
    const ended = await second.get('/setup/finish');
    expect(ended.status).toBe(303);
    expect(ended.headers.location).toBe('/setup');
    const printed = await setupCode(paths, { secretsDirectory: at.secrets, port: String(at.port) });
    const again = new Browser(at);
    expect((await again.signIn(printed.code)).headers.location).toBe('/setup/claim');
    expect((await again.get('/setup/secrets')).headers.location).toBe('/setup/claim');
    // Claimed again, and walked to the finish: the summary is this setup's, not the one before the reset.
    await again.get('/setup/claim');
    const reclaim = CARD_LINE.exec((await again.post('/setup/claim/code')).body)?.[1] ?? '';
    expect((await tabletRedeems(at, tablet, reclaim)).status).toBe(200);
    const twice = await again.get('/setup/claim');
    const digits = /name="comparison" value="([0-9]{6})"/.exec(twice.body)?.[1] ?? '';
    expect((await again.post('/setup/claim/confirm', { comparison: digits })).status).toBe(303);
    for (const from of ['passkey', 'secrets', 'backups', 'registration', 'invite']) {
      await again.post('/setup/next', { from });
    }
    const summary = await again.get('/setup/finish');
    expect([...summary.body.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1])).toEqual([
      'Owner claim code made',
      'Owner claim confirmed',
    ]);
    // A reset ends a setup session too, as it ends an admin one.
    expect(await ownerClaimReset(paths)).toMatchObject({ cleared: true, adminSessionsEnded: 1 });
    expect((await again.get('/setup/claim')).headers.location).toBe('/setup');
  });

  it('setup-code prints a code that opens the setup, rewrites the file, and voids the code the start made', async () => {
    const at = await world();
    const started = await codeInFile(at);
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    expect(printed).toMatchObject({ command: 'setup-code', writtenToFile: true });
    expect(await codeInFile(at)).toBe(printed.code);
    expect((await new Browser(at).post('/setup/sign-in', { code: started })).status).toBe(400);
    expect((await new Browser(at).signIn(printed.code)).headers.location).toBe('/setup/claim');
    await expect(
      setupCode({ database: at.path, blobs: `${at.path}.blobs` }, { ownerKey: 'a'.repeat(64) }),
    ).rejects.toThrow(/OYL_INSTANCE_OWNER_KEY is set/);
  });

  it('registration set and clear: the mode a new rider meets, with no restart, and back to .env', async () => {
    const at = await world();
    const store = await openSqlStore(at.path);
    try {
      // Not unclaimed-and-empty: an athlete is here, so the mode alone decides.
      await store.registerAthlete(registrationFixture('setup-someone'));
    } finally {
      await store.close();
    }
    const paths = { database: at.path, blobs: `${at.path}.blobs` };
    expect(await registrationMode(paths, 'closed')).toEqual({
      command: 'registration set',
      mode: 'closed',
    });
    const closed = await register(at, await testDevice());
    expect(closed.text).toContain('registration_closed');
    expect(await registrationMode(paths, null)).toMatchObject({ command: 'registration clear' });
    const pending = await register(at, await testDevice());
    expect(pending.status, pending.text).toBe(200);
    expect(JSON.parse(pending.text)).toMatchObject({ registrationState: 'pending' });
  });
});
