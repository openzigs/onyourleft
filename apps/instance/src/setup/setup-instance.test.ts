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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLAIM_REACH_TEXT,
  INVITE_REACH_TEXT,
  REACH_CHECKED_TEXT,
  SETUP_EXAMPLE_ADDRESS_TEXT,
} from '@onyourleft/operate-text';

import { jobBody, parseStream } from '../analysis/jobs-testing.ts';
import {
  CURRENT_SERVER,
  startOllamaStub,
  type OllamaStub,
  type OllamaStubOptions,
} from '../analysis/ollama-stub-testing.ts';
import { sha256Hex } from '../auth/crypto.ts';
import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import type { Caller } from '../auth/identity.ts';
import type { RemotePath } from '../config.ts';
import type { Resolver } from '../history/address.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import {
  backupLoop,
  instanceKey,
  ownerClaimReset,
  registrationMode,
  setupCode,
} from '../operator/commands.ts';
import { readServerConfig } from '../server-config.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';
import type { SecretFromFile } from './secrets.ts';
import { localTimeText, SETUP_CODE_FILE, setupCodeFileText } from './setup-code.ts';
import { SETUP_ROUTES } from './setup-routes.ts';
import { cardOrigin, isTailscaleName, SETUP_COOKIE } from './setup.ts';

let running: StartedInstance | undefined;
let directory: string | undefined;
let tunnel: Server | undefined;
const stubs: OllamaStub[] = [];
afterEach(async () => {
  await running?.stop();
  running = undefined;
  tunnel?.close();
  tunnel = undefined;
  for (const stub of stubs.splice(0)) await stub.close();
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

/** What `.env` says of the way in (#2855): unset, a test instance's own address and no path named. */
interface Settings {
  readonly origin?: string;
  readonly remotePath?: RemotePath;
  readonly tunnelReadyUrl?: string;
}

interface World {
  /** Read at each start, so a test can correct `.env` and start again. */
  settings: Settings;
  readonly path: string;
  readonly secrets: string;
  readonly port: number;
  readonly lines: string[];
  /** Every page body any browser was answered with. */
  readonly pages: string[];
  instance: StartedInstance;
  /** Unix ms, moved by a test that needs a code to run out. */
  clock: number | undefined;
  /**
   * Where the AI step looks for Ollama (#2792): nowhere, unless a test names
   * its stub. ⚠️ Never the real addresses: a developer's own Ollama must not
   * be found, asked or changed by a test.
   */
  readonly ollama: readonly string[];
  readonly resolve: Resolver | undefined;
  /** `OYL_INSTANCE_ORIGIN`, moved by a test that changes the address (#2817). */
  origin: string;
  /** `OYL_INSTANCE_REMOTE_PATH` (#2817): none unless a test names one. */
  remotePath: RemotePath | null;
}

async function world(
  options: Settings & { readonly ollama?: readonly string[]; readonly resolve?: Resolver } = {},
): Promise<World> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-setup-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const secrets = join(directory, 'secrets');
  await mkdir(secrets, { mode: 0o700 });
  const made: World = {
    settings: options,
    path,
    secrets,
    port: await freeLoopbackPort(),
    lines: [],
    pages: [],
    instance: undefined as unknown as StartedInstance,
    clock: undefined,
    ollama: options.ollama ?? [],
    resolve: options.resolve,
    origin: options.origin ?? TEST_ORIGIN,
    remotePath: options.remotePath ?? null,
  };
  made.instance = await start(made);
  return made;
}

/** Start (or start again) the instance on the world's file, as `serve.ts` does on a fresh install. */
async function start(
  at: World,
  options: {
    readonly ownerKey?: string;
    readonly adminPages?: boolean;
    /** Start with no `OYL_INSTANCE_SECRET_KEY`, so no keys are opened (#2817). */
    readonly noSecret?: boolean;
  } = {},
): Promise<StartedInstance> {
  const read = readServerConfig(
    {
      database: at.path,
      origin: at.origin,
      tunnelReadyUrl: at.settings.tunnelReadyUrl,
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
      remotePath: at.remotePath,
    }),
    server: {
      ...read.config,
      blobsPath: join(at.path, '..', 'blobs'),
      ...(options.noSecret === true ? {} : { secretKey: new Uint8Array(32).fill(9) }),
    },
    version: '9.8.7',
    notices: 'notices',
    log: (line) => at.lines.push(line),
    migrationPollMs: 50,
    kitSecrets: [KIT_SECRET],
    secretsDirectory: at.secrets,
    ollamaAddresses: at.ollama,
    ...(at.resolve === undefined ? {} : { resolve: at.resolve }),
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

/**
 * Every setup route, every method it takes and one it does not, answered as a
 * path with no route. With `finishedHere` — the loopback listener once the
 * setup is done (#2858) — `GET /setup` alone answers the small "Setup is
 * finished" page, still a 404 and setting no cookie.
 */
async function expectAllNotFound(
  port: number,
  options: { readonly finishedHere?: boolean } = {},
): Promise<void> {
  const expected = await noRoute(port, 'GET');
  expect(expected.status).toBe(404);
  for (const route of SETUP_ROUTES) {
    for (const method of [...route.methods, 'DELETE']) {
      const answer = await send(port, method, route.path, {
        host: `localhost:${String(port)}`,
        origin: `http://localhost:${String(port)}`,
      });
      if (options.finishedHere === true && method === 'GET' && route.path === '/setup') {
        expect(answer.status).toBe(404);
        expect(answer.body).toContain('<h1>Setup is finished</h1>');
        expect(answer.body).not.toContain('<form');
        expect(answer.headers['set-cookie']).toBeUndefined();
        continue;
      }
      expect(answer.status, `${method} ${route.path}`).toBe(404);
      expect(answer.body, `${method} ${route.path}`).toBe(expected.body);
      expect(answer.headers['set-cookie'], `${method} ${route.path}`).toBeUndefined();
    }
  }
  // Against DNS rebinding: a page on the loopback port under any other name gets the bare
  // `not_found`, never the finished page and the instance name its banner carries.
  for (const name of ['rebound.example', '127.0.0.1']) {
    const rebound = await send(port, 'GET', '/setup', { host: `${name}:${String(port)}` });
    expect(rebound.status, name).toBe(404);
    expect(rebound.body, name).toBe(expected.body);
  }
}

/** The tablet: pins nothing here, but redeems the claim on the REAL sealed route. */
async function tabletRedeems(at: World, device: TestDevice, claimCode: string) {
  return sealedAt(at.instance.url, at.origin, {
    method: 'POST',
    path: '/v1/auth/owner-claim',
    body: { publicKey: device.publicKey, claimCode },
    signer: device.signingKey,
  });
}

/** A device registering over the sealed session route, unauthenticated: what a stranger meets. */
async function register(at: World, device: TestDevice, inviteCode?: string) {
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
    body: {
      ...(await device.statement(challenge.nonce, { issuedAt: Math.floor(Date.now() / 1000) })),
      ...(inviteCode === undefined ? {} : { inviteCode }),
    },
    signer: device.signingKey,
  });
}

const CARD_LINE = /oyl-instance:[^ <]+ ([a-z2-9]{4}(?:-[a-z2-9]{4}){3})/;

/** "Show the claim code", and the claim step it lands on, showing the QR. */
async function showClaim(browser: Browser): Promise<Answer> {
  const shown = await browser.post('/setup/claim/code');
  expect(shown.headers.location).toBe('/setup/claim');
  return browser.get('/setup/claim');
}

/** The finish step's list, as its lines read. */
function summaryOf(body: string): string[] {
  const list = /<ul class="summary">([\s\S]*?)<\/ul>/.exec(body)?.[1] ?? '';
  return [...list.matchAll(/<li>([^<]*)<\/li>/g)].map((match) =>
    (match[1] ?? '').replaceAll('&#39;', "'"),
  );
}

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
      // #2858: the same moment by this machine's clock, its zone named.
      validUntilLocal: expect.stringMatching(
        /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} [A-Za-z0-9+:-]+$/,
      ) as unknown,
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
    const shown = await showClaim(browser);
    expect(shown.status, shown.body).toBe(200);
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    const tablet = await testDevice();
    const redeemed = await tabletRedeems(at, tablet, claim);
    expect(redeemed.status, redeemed.text).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect((await browser.post('/setup/claim/confirm', { comparison })).status).toBe(303);
    expect((await browser.get('/setup/tailnet')).status).toBe(200);
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
    // The stylesheet: the admin pages' sheet with the setup's own rules (the progress bar) after it.
    const sheet = await browser.get('/setup/setup.css');
    expect(sheet.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(sheet.body).toContain('.step-mark');

    // Unclaimed, holding no athlete: a stranger's registration is refused whatever the mode (D-3).
    const stranger = await testDevice();
    const early = await register(at, stranger);
    expect(early.status, early.text).toBe(403);
    expect(early.text).toContain('registration_closed');

    // Claim: the QR's line, redeemed by the tablet on the sealed route, confirmed here.
    expect((await browser.get('/setup/claim')).body).toContain('Show the claim code');
    const shown = await showClaim(browser);
    expect(shown.status).toBe(200);
    expect(shown.body).toContain('data-oyl-qr="true"');
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect(comparison).toMatch(/^[0-9]{6}$/);
    const confirmed = await browser.post('/setup/claim/confirm', { comparison });
    expect(confirmed.headers.location).toBe('/setup/claim');
    // The tablet registers as the owner: active in `approval`, the moderator.
    const owner = await register(at, tablet);
    expect(owner.status, owner.text).toBe(200);
    expect(JSON.parse(owner.text)).toMatchObject({ registrationState: 'active' });

    // The tailnet (#2817): the step after the claim, before the passkey bound to the address.
    expect((await browser.get('/setup/tailnet')).body).toContain('This server is running with');
    // Next pressed on an earlier step's page does not skip the step the setup has reached.
    const stale = await browser.post('/setup/next', { from: 'claim' });
    expect(stale.headers.location).toBe('/setup/tailnet');
    expect((await browser.get('/setup/passkey')).status).toBe(303);
    expect((await browser.post('/setup/next', { from: 'tailnet' })).headers.location).toBe(
      '/setup/passkey',
    );
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
    const waiting = await browser.get('/setup/backups?asked');
    // The wait is the whole state, in an information box: no "none yet", no success, no button.
    expect(waiting.body).toContain('<p class="notice">Waiting for the backup to run.');
    expect(waiting.body).not.toContain('No backup has run yet');
    expect(waiting.body).not.toContain('Back up now</button>');
    // No reload under the owner (WCAG 2.2.1): a button checks again when pressed.
    expect(waiting.body).not.toContain('http-equiv="refresh"');
    expect(waiting.body).toContain(
      '<form method="get" action="/setup/backups" aria-label="Check now"><button type="submit">Check now</button></form>',
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
    // A success, naming both folders in plain words, and no button to check again.
    expect(read.body).toContain(
      '<p class="notice" role="status">Both folders work: the last backup was saved on this computer, and copied to the copy kept elsewhere.</p>',
    );
    expect(read.body).not.toContain('action="/setup/backups"');
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

    // Registration: closed, chosen here, over `.env`'s approval — ONE button saves it and moves on.
    const choosing = await browser.get('/setup/registration');
    expect(choosing.body).not.toContain('name="from" value="registration"');
    expect(choosing.body).toContain('Save and go to the next step');
    const mode = await browser.post('/setup/registration/mode', { mode: 'closed' });
    expect(mode.headers.location).toBe('/setup/invite');

    // Leave, restart: a new code, and the setup resumes at the step it was on.
    await restart(at);
    codes.push(await codeInFile(at));
    const back = new Browser(at);
    const resumed = await back.signIn(codes[1] as string);
    expect(resumed.headers.location).toBe('/setup/invite');
    expect((await back.get('/setup/registration')).body).toContain(
      'value="closed" checked aria-describedby="mode-closed-meaning"><label for="mode-closed">Nobody new</label>',
    );
    // The mode is what an unauthenticated registration meets after the restart.
    const turnedAway = await register(at, await testDevice());
    expect(turnedAway.status, turnedAway.text).toBe(403);
    expect(turnedAway.text).toContain('registration_closed');

    // One rider invite, as a QR with the card.
    const made = await back.post('/setup/invite/code');
    expect(made.headers.location).toBe('/setup/invite');
    const invite = await back.get('/setup/invite');
    expect(CARD_LINE.exec(invite.body)?.[1]).toMatch(/^[a-z2-9]{4}/);
    expect((await back.post('/setup/invite/code')).status).toBe(303);
    // #2858: shown again to the session that made it, until it is used or runs out.
    expect(CARD_LINE.exec((await back.get('/setup/invite')).body)?.[1]).toBe(
      CARD_LINE.exec(invite.body)?.[1],
    );
    // Another session is told the setup made its one invite, and is never shown it.
    const other = new Browser(at);
    await other.signIn(
      (
        await setupCode(
          { database: at.path, blobs: `${at.path}.blobs` },
          { secretsDirectory: at.secrets, port: String(at.port) },
        )
      ).code,
    );
    const elsewhere = await other.get('/setup/invite');
    expect(elsewhere.body).toContain('made its one invite');
    expect(elsewhere.body).not.toContain(CARD_LINE.exec(invite.body)?.[1] ?? 'none');
    expect((await back.post('/setup/next', { from: 'invite' })).headers.location).toBe('/setup/ai');

    // AI write-ups (#2792): optional, and skipped here. Its own tests are further down.
    expect((await back.post('/setup/next', { from: 'ai' })).headers.location).toBe('/setup/finish');

    // Finish: where the server stands, in plain words, then gone.
    // The whole setup's, the first session's kit (before the restart) among them.
    expect(summaryOf((await back.get('/setup/finish')).body)).toEqual([
      'Owner: your tablet owns this server.',
      'Emergency kit: downloaded.',
      'Backups: working, on this computer and in the copy kept elsewhere.',
      'Who may join: Nobody new.',
      'Invites made: 1.',
      'AI write-ups: off. Everything else works without them.',
    ]);
    const done = await back.post('/setup/finish/done');
    expect(done.status).toBe(200);
    expect(done.body).toContain('Setup is finished');
    expect(done.headers['set-cookie']?.[0]).toMatch(/Max-Age=0/);
    // Styled with no request: /setup/setup.css is gone, so the sheet is inline, allowed by its hash.
    expect(done.body).not.toContain('rel="stylesheet"');
    const inline = /<style>([\s\S]*)<\/style>/.exec(done.body)?.[1] ?? '';
    expect(inline).toContain('.steps ol');
    const policy = String(done.headers['content-security-policy']);
    expect(policy).toContain(
      `style-src 'sha256-${createHash('sha256').update(inline).digest('base64')}'`,
    );
    expect(policy).not.toContain("'unsafe-inline'");
    expect(await fileThere(at)).toBe(false);
    await expectAllNotFound(at.port, { finishedHere: true });
    // #2858: through the tunnel `/setup` stays byte-identical to a missing route.
    await expectAllNotFound(portOf(at.instance));

    // Done is the database's: a restart neither reopens it nor writes a code.
    at.lines.length = 0;
    await restart(at);
    await restart(at);
    expect(await fileThere(at)).toBe(false);
    expect(at.lines.join('\n')).not.toContain('first-run-setup');
    // Nor does a start after Finish leave a "setup code made: refused" entry in the operator
    // log each time (owner, 2026-11-19): it asks for no code once the setup is done.
    const logged = await openSqlStore(at.path);
    try {
      const minted = (await logged.listOperatorLogPage(undefined, 200))
        .filter((entry) => entry.action === 'setup_code_minted')
        .map((entry) => entry.outcome);
      expect(minted.length).toBeGreaterThan(0);
      expect(minted).not.toContain('refused');
    } finally {
      await logged.close();
    }
    await expectAllNotFound(at.port, { finishedHere: true });
    await expect(
      setupCode({ database: at.path, blobs: `${at.path}.blobs` }, { secretsDirectory: at.secrets }),
    ).rejects.toThrow(/setup is done/);
    // #2920: the operator ran `setup-code`, so its refusal IS logged, once, from the CLI.
    const afterCli = await openSqlStore(at.path);
    try {
      const refused = (await afterCli.listOperatorLogPage(undefined, 200))
        .filter((entry) => entry.action === 'setup_code_minted' && entry.outcome === 'refused')
        .map((entry) => entry.source);
      expect(refused).toEqual(['cli']);
    } finally {
      await afterCli.close();
    }

    // ADR 0004 D, ADR 0069 D-4: no page and no log line holds a setup code or the secret.
    const everything = [...at.pages, ...at.lines].join('\n');
    for (const code of codes) expect(everything).not.toContain(code);
    expect(everything).not.toContain(KIT_SECRET.text);
    expect(at.lines.join('\n')).not.toContain(claim);
    // WCAG 2.2.1: no page the setup served reloads itself, so none restarts the idle limit unasked.
    expect(at.pages.join('\n')).not.toMatch(/http-equiv="?refresh/i);
  });

  it('keeps the same claim QR while the tablet has not scanned it, checking again when asked, then says the tablet owns the server', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const shown = await browser.post('/setup/claim/code');
    expect(shown.status).toBe(303);
    expect(shown.headers.location).toBe('/setup/claim');

    // "Compare the number" before the scan: the same code, still waiting, and NO reload under the
    // owner (WCAG 2.2.1, F41): the code beside the QR stays selectable until they press the button.
    const waiting = await browser.get('/setup/claim');
    const claim = CARD_LINE.exec(waiting.body)?.[1] ?? '';
    expect(claim).toMatch(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/);
    expect(waiting.body).toContain('Waiting for your tablet to scan the code.');
    expect(waiting.body).not.toContain('http-equiv="refresh"');
    expect(waiting.body).toContain(
      '<form method="get" action="/setup/claim" aria-label="I’ve scanned it"><button type="submit">I’ve scanned it</button></form>',
    );
    expect(waiting.body).toMatch(/It works once, and stops working in (9|10) minutes\./);
    expect(waiting.body).not.toContain('UTC');
    expect(waiting.body).not.toContain('Show the claim code');
    const again = await browser.get('/setup/claim');
    expect(CARD_LINE.exec(again.body)?.[1]).toBe(claim);
    // Another session of the setup is not shown this browser's code.
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    const other = new Browser(at);
    await other.signIn(printed.code);
    const elsewhere = await other.get('/setup/claim');
    expect(elsewhere.body).not.toContain(claim);
    expect(elsewhere.body).toContain('Show the claim code');

    // The tablet scans: the number to compare, large, in two groups, and no reload under the owner.
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect(pending.body).toContain(
      `<p class="compare"><strong>${comparison.slice(0, 3)}</strong> <strong>${comparison.slice(3)}</strong></p>`,
    );
    expect(pending.body).not.toContain('I’ve scanned it');

    // Yes: the claim step says so plainly, with the way on, before the next step.
    const confirmed = await browser.post('/setup/claim/confirm', { comparison });
    expect(confirmed.headers.location).toBe('/setup/claim');
    const owned = await browser.get('/setup/claim');
    expect(owned.body).toContain(
      '<p class="notice" role="status">Your tablet now owns this server.</p>',
    );
    expect(owned.body).toContain('name="from" value="claim"');
    expect(owned.body).not.toContain(claim);
    expect((await browser.post('/setup/next', { from: 'claim' })).headers.location).toBe(
      '/setup/tailnet',
    );

    // The invite step before the tablet has signed in: an instruction, not a fault.
    for (const from of ['tailnet', 'passkey', 'secrets', 'backups'])
      await browser.post('/setup/next', { from });
    await browser.post('/setup/registration/mode', { mode: 'invite' });
    const early = await browser.get('/setup/invite');
    expect(early.body).toContain('<p class="notice">One more thing on your tablet first:');
    expect(early.body).not.toContain('class="problem"');
    expect(early.body).not.toContain('Make an invite');
    expect((await register(at, tablet)).status).toBe(200);
    expect((await browser.get('/setup/invite')).body).toContain('Make an invite');

    // A backup with no copy kept elsewhere: the step warns, and the finish says this computer only.
    const stop = new AbortController();
    await backupLoop(
      { database: at.path, blobs: join(at.path, '..', 'blobs') },
      join(at.path, '..', 'backups-only'),
      {
        intervalSeconds: 21_600,
        signal: stop.signal,
        wait: () => {
          stop.abort();
          return Promise.resolve();
        },
        report: () => undefined,
      },
    );
    expect((await browser.get('/setup/backups')).body).toContain(
      '<p class="warning">The last backup was saved on this computer only',
    );
    for (const from of ['invite', 'ai']) await browser.post('/setup/next', { from });
    expect(summaryOf((await browser.get('/setup/finish')).body)).toEqual([
      'Owner: your tablet owns this server.',
      'Emergency kit: not downloaded. You can download it later from the admin pages on this computer, once you have added a passkey there.',
      'Backups: on this computer only. The copy kept elsewhere is not working.',
      'Who may join: Only people I invite.',
      'Invites made: none.',
      'AI write-ups: off. Everything else works without them.',
    ]);

    // Who may join, changed from the finish: saved, and back to the finish, not on to the invite.
    const changed = await browser.post('/setup/registration/mode', { mode: 'closed' });
    expect(changed.headers.location).toBe('/setup/finish');
    expect(summaryOf((await browser.get('/setup/finish')).body)).toContain(
      'Who may join: Nobody new.',
    );
  });

  it('stops showing a claim code once its ten minutes are over, and offers a new one', async () => {
    const at = await world();
    at.clock = Date.now();
    await restart(at);
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const shown = await showClaim(browser);
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    expect(claim).toMatch(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/);
    // Nine minutes on, inside the code's ten and the session's fifteen idle: still the same code.
    at.clock += 9 * 60 * 1000;
    expect(CARD_LINE.exec((await browser.get('/setup/claim')).body)?.[1]).toBe(claim);
    // Past ten minutes the code is dead on the server, so the page no longer draws it.
    at.clock += 2 * 60 * 1000;
    const expired = await browser.get('/setup/claim');
    expect(expired.status).toBe(200);
    expect(expired.body).toContain('Show the claim code');
    expect(expired.body).not.toContain(claim);
    expect(expired.body).not.toContain('I’ve scanned it');
    expect(expired.body).not.toContain('http-equiv="refresh"');
    // And it says why the QR went (#2825), once: the dead code is dropped where it is found.
    const ranOut = '<p class="problem" role="alert">That code ran out. Show a new one.</p>';
    expect(expired.body).toContain(ranOut);
    const after = await browser.get('/setup/claim');
    expect(after.body).toContain('Show the claim code');
    expect(after.body).not.toContain('That code ran out.');
    // A new code is a new ten minutes, with no word about the old one.
    const fresh = await showClaim(browser);
    expect(CARD_LINE.exec(fresh.body)?.[1]).toMatch(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/);
    expect(CARD_LINE.exec(fresh.body)?.[1]).not.toBe(claim);
    expect(fresh.body).not.toContain('That code ran out.');
  });

  it('says a claim code ran out only to the session that was shown it (#2825)', async () => {
    const at = await world();
    at.clock = Date.now();
    await restart(at);
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    await showClaim(browser);
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port), now: () => new Date(at.clock ?? 0) },
    );
    const other = new Browser(at);
    await other.signIn(printed.code);
    at.clock += 11 * 60 * 1000;
    // Never shown the code, so told nothing about it.
    const elsewhere = await other.get('/setup/claim');
    expect(elsewhere.body).toContain('Show the claim code');
    expect(elsewhere.body).not.toContain('That code ran out.');
  });

  it('says how long ago the last backup ran, never a UTC moment (#2825)', async () => {
    const at = await world();
    at.clock = Date.now();
    await restart(at);
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    expect((await tabletRedeems(at, await testDevice(), claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    for (const from of ['claim', 'tailnet', 'passkey', 'secrets'])
      await browser.post('/setup/next', { from });

    const ran = new Date(at.clock);
    const stop = new AbortController();
    await backupLoop(
      { database: at.path, blobs: join(at.path, '..', 'blobs') },
      join(at.path, '..', 'backups-dir'),
      {
        intervalSeconds: 21_600,
        signal: stop.signal,
        now: () => ran,
        wait: () => {
          stop.abort();
          return Promise.resolve();
        },
        report: () => undefined,
      },
    );
    const stamp = `datetime="${ran.toISOString().slice(0, 19)}.000Z"`;
    const justNow = await browser.get('/setup/backups');
    expect(justNow.body).toContain(
      `<p>The last backup ran <time ${stamp}>less than a minute ago</time>.</p>`,
    );
    // Fourteen minutes on, inside the session's fifteen idle: the page counts from the server's clock.
    at.clock += 14 * 60 * 1000;
    const later = await browser.get('/setup/backups');
    expect(later.body).toContain(
      `<p>The last backup ran <time ${stamp}>14 minutes ago</time>.</p>`,
    );
    expect(later.body).not.toContain('UTC');
    expect(later.body).not.toContain('The last backup ran at');
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
    // A page from this origin that the browser says is cross-site is refused (layer 3's second half).
    const crossSite = await send(
      at.port,
      'POST',
      '/setup/sign-in',
      {
        host: `localhost:${String(at.port)}`,
        origin: `http://localhost:${String(at.port)}`,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/x-www-form-urlencoded',
      },
      'code=aaaa-bbbb-cccc-dddd',
    );
    expect(crossSite.status).toBe(403);
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

describe('the setup’s optional AI step (#2792, ADR 0046)', () => {
  /** `models-box` is the stub Ollama's loopback; no other name resolves. */
  const resolve: Resolver = (name) =>
    name === 'models-box'
      ? Promise.resolve(['127.0.0.1'])
      : Promise.reject(new Error('no such name'));

  /** A host's user name, as Ollama's own words about a download can carry it. */
  const HOST_USER = 'MARKER-hostuser-2792';

  /** A stub Ollama, and a fresh setup that looks for it after an address where nothing is. */
  async function worldWith(options: OllamaStubOptions): Promise<{ at: World; stub: OllamaStub }> {
    const stub = await startOllamaStub(options);
    stubs.push(stub);
    const at = await world({
      ollama: ['http://no-such-name:11434/v1', `http://models-box:${String(stub.port)}/v1`],
      resolve,
    });
    return { at, stub };
  }

  /** The setup walked to its AI step: claimed, the tablet signed in as the owner, each step passed. */
  async function atAiStep(at: World): Promise<{ browser: Browser; ownerId: string }> {
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    const owner = await register(at, tablet);
    expect(owner.status, owner.text).toBe(200);
    let landed: Answer | undefined;
    for (const from of ['tailnet', 'passkey', 'secrets', 'backups', 'registration', 'invite']) {
      landed = await browser.post('/setup/next', { from });
    }
    expect(landed?.headers.location).toBe('/setup/ai');
    return { browser, ownerId: (JSON.parse(owner.text) as { athleteId: string }).athleteId };
  }

  /** The AI step, loaded again until it says `wanted`: a download ends when Ollama ends it. */
  async function untilAiSays(browser: Browser, wanted: string): Promise<Answer> {
    for (;;) {
      const answer = await browser.get('/setup/ai');
      if (answer.body.includes(wanted)) return answer;
      await new Promise((settle) => setTimeout(settle, 10));
    }
  }

  /** A download Ollama holds half way, and the function that lets it go on. */
  function held(): { readonly hold: Promise<void>; readonly release: () => void } {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((settle) => {
      release = settle;
    });
    return { hold, release: () => release() };
  }

  /** What the setup wrote to the operator log about the model, oldest first. */
  async function modelLog(at: World): Promise<(string | null)[][]> {
    const store = await openSqlStore(at.path);
    try {
      return (await store.listOperatorLogPage(undefined, 200))
        .filter((entry) => entry.action.startsWith('analysis_'))
        .map((entry) => [entry.source, entry.action, entry.outcome, entry.detail])
        .reverse();
    } finally {
      await store.close();
    }
  }

  const DOWNLOADING = [
    { status: 'pulling manifest' },
    { status: 'pulling aaa', digest: 'sha256:aaa', total: 4_000_000_000, completed: 1_000_000_000 },
  ];
  const RUNNING_TEXT =
    'Downloading the model: 25 % so far, 1.0 GB of 4.0 GB. Press Check now to see how far it has got.';

  it('finds Ollama, says how each model fits, downloads the one the owner names, and after a restart the next write-up runs on the model chosen', async () => {
    const pulling = held();
    const { at, stub } = await worldWith({
      ...CURRENT_SERVER,
      show: {
        ...CURRENT_SERVER.show,
        'delta:8b': { capabilities: ['completion', 'tools'] },
      },
      pull: () => ({
        lines: DOWNLOADING,
        hold: pulling.hold,
        then: [{ status: 'success' }],
        adds: { name: 'delta:8b', model: 'delta:8b', size: 5_200_000_000 },
      }),
      // Loaded whole into GPU memory.
      load: (model) => ({ name: model, model, size: 6_000_000_000, size_vram: 6_000_000_000 }),
      completions: () => ({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1_790_000_000,
        model: 'scripted',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'A steady ride.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    });
    const { browser, ownerId } = await atAiStep(at);

    // Found, at the second address looked at, and each model with how it fits — read from
    // what Ollama has loaded, never guessed from a file's size.
    const found = await browser.get('/setup/ai');
    expect(found.status).toBe(200);
    expect(found.body).toContain('<p>Ollama is running on this computer.</p>');
    expect(found.body).toContain(
      '<code>alpha:14b</code>: 9.0 GB. It fits in the graphics card’s memory, so it runs at full speed.',
    );
    expect(found.body).toContain(
      '<code>beta:32b</code>: 20 GB. Only 62 % of it fits in the graphics card’s memory, so it runs slowly.',
    );
    expect(found.body).toContain(
      '<code>gamma:26b</code>: 17 GB. How well it fits the graphics card is not known until it has been loaded.',
    );
    // A model Ollama says cannot call tools is listed, with why it has no button.
    expect(found.body).toContain('<button type="submit">Use alpha:14b</button>');
    expect(found.body).not.toContain('Use gamma:26b');
    expect(found.body).toContain('Write-ups cannot run on this model');
    expect(found.body).not.toContain('two words');
    expect(found.body).not.toContain('AI write-ups are on.');
    expect(found.body).not.toContain('Ollama was not found');
    // Optional whatever it found.
    expect(found.body).toContain('name="from" value="ai"');

    // The download: asked of Ollama by the name the owner typed, and the page says how far it
    // has got when the owner asks — it never reloads itself.
    const asked = await browser.post('/setup/ai/pull', { model: ' delta:8b ' });
    expect(asked.status).toBe(303);
    expect(asked.headers.location).toBe('/setup/ai');
    const midway = await untilAiSays(browser, '25 %');
    expect(midway.body).toContain(`<p class="notice">${RUNNING_TEXT}</p>`);
    expect(midway.body).toContain(
      '<form method="get" action="/setup/ai" aria-label="Check now"><button type="submit">Check now</button></form>',
    );
    expect(midway.body).not.toContain('http-equiv="refresh"');
    // One at a time: no form for a second while one runs.
    expect(midway.body).not.toContain('action="/setup/ai/pull"');
    expect(stub.requests.filter((request) => request.path === '/api/pull')).toEqual([
      { method: 'POST', path: '/api/pull', body: { model: 'delta:8b', stream: true } },
    ]);

    pulling.release();
    const downloaded = await untilAiSays(browser, 'The download finished.');
    expect(downloaded.body).toContain(
      '<code>delta:8b</code>: 5.2 GB. How well it fits the graphics card is not known until it has been loaded.',
    );
    expect(downloaded.body).toContain('action="/setup/ai/pull"');
    // Downloaded is not chosen: nothing is saved until the owner says which.
    expect(downloaded.body).not.toContain('AI write-ups are on.');

    // Chosen: saved, loaded once, and the page then says how it fits.
    const used = await browser.post('/setup/ai/use', { model: 'delta:8b' });
    expect(used.status).toBe(303);
    expect(used.headers.location).toBe('/setup/ai');
    expect(stub.requests.filter((request) => request.path === '/api/generate')).toEqual([
      { method: 'POST', path: '/api/generate', body: { model: 'delta:8b', stream: false } },
    ]);
    const on = await browser.get('/setup/ai');
    expect(on.body).toContain(
      '<p class="notice" role="status">AI write-ups are on. They run on this model: <code>delta:8b</code></p>',
    );
    expect(on.body).toContain(
      '<code>delta:8b</code>: 5.2 GB. It fits in the graphics card’s memory, so it runs at full speed.',
    );
    expect(on.body).toContain('<p class="notice">Write-ups run on this model.</p>');
    expect(on.body).not.toContain('Use delta:8b');
    expect((await browser.post('/setup/next', { from: 'ai' })).headers.location).toBe(
      '/setup/finish',
    );
    expect(summaryOf((await browser.get('/setup/finish')).body).at(-1)).toBe(
      'AI write-ups: on, made on this computer.',
    );

    // Logged from the setup, naming which settings changed and never the model or its address.
    expect(await modelLog(at)).toEqual([
      ['setup', 'analysis_model_pull', 'done', null],
      ['setup', 'analysis_settings_set', 'done', 'local_url,local_model,offer_local'],
    ]);
    // The instance's own log says where the model is now set, as a save from the app does.
    expect(at.lines.filter((line) => line.includes('"event":"analysis-model"')).at(-1)).toContain(
      '"setIn":"app"',
    );
    expect(at.lines.join('\n')).not.toContain('delta:8b');
    expect(at.lines.join('\n')).not.toContain('models-box');

    // Closed and opened again on the same file: the owner's next write-up is built with the
    // model chosen, read at the request the model server is sent — the job engine's own path.
    await restart(at);
    const jobs = at.instance.analysisJobs();
    if (jobs === undefined) throw new Error('no analysis jobs');
    const caller = { athleteId: ownerId } as Caller;
    const started = await jobs.start(caller, jobBody());
    if (!started.ok) throw new Error(`the job was refused: ${started.code}`);
    await jobs.idle();
    const stream = await jobs.events(caller, started.value.jobId, null);
    expect(parseStream((await stream?.text()) ?? '').events.at(-1)?.data).toEqual({
      status: 'succeeded',
      writeUp: 'A steady ride.',
      templateVersion: '2',
    });
    expect(
      stub.requests
        .filter((request) => request.path === '/v1/chat/completions')
        .map((request) => (request.body as { model?: unknown }).model),
    ).toEqual(['delta:8b']);
  });

  it('downloads the recommended model with one press, then offers it first with no download, and Use turns write-ups on (#2869, ADR 0086)', async () => {
    const { at, stub } = await worldWith({
      ...CURRENT_SERVER,
      tags: { models: [] },
      ps: { models: [] },
      show: { 'qwen3:8b': { capabilities: ['completion', 'tools'] } },
      pull: () => ({
        lines: [{ status: 'pulling manifest' }],
        then: [{ status: 'success' }],
        adds: { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_200_000_000 },
      }),
      load: (model) => ({ name: model, model, size: 6_000_000_000, size_vram: 6_000_000_000 }),
    });
    const { browser } = await atAiStep(at);
    const before = await browser.get('/setup/ai');
    // The one press, above the typed field, sending the name the page filled in.
    const press =
      /<form method="post" action="\/setup\/ai\/pull" aria-label="Download the recommended model \(qwen3:8b, about 5 GB\)">[\s\S]*?<\/form>/.exec(
        before.body,
      )?.[0];
    expect(press).toBeDefined();
    expect(before.body.indexOf(press ?? '')).toBeLessThan(before.body.indexOf('id="model"'));
    const sends = /name="model" value="([^"]*)"/.exec(press ?? '')?.[1];
    expect(sends).toBe('qwen3:8b');

    const asked = await browser.post('/setup/ai/pull', { model: sends ?? '' });
    expect(asked.headers.location).toBe('/setup/ai');
    const done = await untilAiSays(browser, 'The download finished.');
    expect(stub.requests.filter((request) => request.path === '/api/pull')).toEqual([
      { method: 'POST', path: '/api/pull', body: { model: 'qwen3:8b', stream: true } },
    ]);
    // Now here: offered first, and nothing more is recommended for download.
    expect(done.body).toContain(
      'A model already on this computer can run write-ups, so nothing needs downloading.',
    );
    expect(done.body).not.toContain('Download the recommended model');
    expect(done.body).toContain('<button type="submit">Use qwen3:8b</button>');
    // Downloaded is not chosen (#2792): the owner's press is.
    expect(done.body).not.toContain('AI write-ups are on.');
    await browser.post('/setup/ai/use', { model: 'qwen3:8b' });
    const on = await browser.get('/setup/ai');
    expect(on.body).toContain('AI write-ups are on. They run on this model: <code>qwen3:8b</code>');
    expect(on.body).not.toContain('nothing needs downloading');
    expect(on.body).not.toContain('Download the recommended model');
    expect(await modelLog(at)).toEqual([
      ['setup', 'analysis_model_pull', 'done', null],
      ['setup', 'analysis_settings_set', 'done', 'local_url,local_model,offer_local'],
    ]);
  });

  it('shows a download’s progress and its failure in its own words: never the model’s name, nor a path with the host’s user name', async () => {
    const pulling = held();
    const { at, stub } = await worldWith({
      ...CURRENT_SERVER,
      pull: () => ({
        lines: [
          { status: 'pulling manifest' },
          {
            status: `pulling ${HOST_USER}`,
            digest: `sha256:${HOST_USER}`,
            total: 4_000_000_000,
            completed: 1_000_000_000,
          },
        ],
        hold: pulling.hold,
        then: [
          {
            error: `pull model manifest: open /Users/${HOST_USER}/.ollama/models/manifests/registry.ollama.ai/${HOST_USER}/private-model: permission denied`,
          },
        ],
      }),
    });
    const { browser } = await atAiStep(at);
    // A model under the owner's own namespace on Ollama's library: their user name is in it.
    const model = `${HOST_USER}/private-model`;
    expect((await browser.post('/setup/ai/pull', { model })).headers.location).toBe('/setup/ai');
    const midway = await untilAiSays(browser, '25 %');
    expect(midway.body).toContain(`<p class="notice">${RUNNING_TEXT}</p>`);
    expect(midway.body).not.toContain(HOST_USER);
    // A second asked for while one runs is refused, and Ollama is asked nothing more.
    await browser.post('/setup/ai/pull', { model: 'other:1b' });
    expect(stub.requests.filter((request) => request.path === '/api/pull')).toEqual([
      { method: 'POST', path: '/api/pull', body: { model, stream: true } },
    ]);

    pulling.release();
    const failed = await untilAiSays(browser, 'The download did not finish.');
    expect(failed.body).toContain(
      '<p class="problem" role="alert">The download did not finish. Check that the name is spelled as Ollama lists it, that this computer is online and that its disk has room, then try again.</p>',
    );
    expect(failed.body).not.toContain(HOST_USER);
    expect(failed.body).not.toContain('permission denied');
    // And the form is back, to try again.
    expect(failed.body).toContain('action="/setup/ai/pull"');

    // Nowhere: no page, no log line and no operator log entry holds it.
    expect([...at.pages, ...at.lines].join('\n')).not.toContain(HOST_USER);
    expect(await modelLog(at)).toEqual([
      ['setup', 'analysis_model_pull', 'done', null],
      ['setup', 'analysis_model_pull', 'refused', 'busy'],
    ]);
  });

  it('changes nothing for a name that is not a model’s, a model Ollama does not list, or one it says cannot call tools', async () => {
    const { at, stub } = await worldWith({ ...CURRENT_SERVER, pull: () => ({ lines: [] }) });
    const { browser } = await atAiStep(at);

    const badName = await browser.post('/setup/ai/pull', { model: 'two words' });
    expect(badName.headers.location).toBe('/setup/ai?bad-name');
    expect((await browser.get('/setup/ai?bad-name')).body).toContain(
      '<p class="problem" role="alert">That is not a model’s name.',
    );
    expect(stub.requests.filter((request) => request.path === '/api/pull')).toEqual([]);

    for (const model of ['nowhere:1b', 'gamma:26b', 'two words']) {
      const refused = await browser.post('/setup/ai/use', { model });
      expect(refused.headers.location, model).toBe('/setup/ai?refused');
    }
    const said = await browser.get('/setup/ai?refused');
    expect(said.body).toContain('<p class="problem" role="alert">That model could not be used:');
    expect(said.body).not.toContain('AI write-ups are on.');
    // Nothing was loaded, and nothing saved: the settings a job reads are still nobody's.
    expect(stub.requests.filter((request) => request.path === '/api/generate')).toEqual([]);
    expect(await modelLog(at)).toEqual([['setup', 'analysis_model_pull', 'refused', 'bad_model']]);
    const store = await openSqlStore(at.path);
    try {
      expect(await store.getAnalysisSetting()).toBeUndefined();

      // Settings made elsewhere (the app, or the host's command line) are read as a job reads
      // them: the address they name is where Ollama is looked for first, and a model whose
      // source is switched off is not "on".
      const second = await startOllamaStub({
        ...CURRENT_SERVER,
        tags: { models: [{ name: 'zeta:1b', model: 'zeta:1b', size: 1_000_000_000 }] },
      });
      stubs.push(second);
      const row = {
        localUrl: `http://models-box:${String(second.port)}/v1`,
        localModel: 'zeta:1b',
        reasoningTokens: null,
        offerHosted: null,
        othersLocal: null,
        updatedAt: 1,
        updatedBy: 'cli',
      } as const;
      await store.putAnalysisSetting({ ...row, offerLocal: false });
      const off = await browser.get('/setup/ai');
      expect(off.body).toContain('<code>zeta:1b</code>');
      expect(off.body).not.toContain('alpha:14b');
      expect(off.body).not.toContain('AI write-ups are on.');
      expect(off.body).toContain('Use zeta:1b');
      await store.putAnalysisSetting({ ...row, offerLocal: null });
      const on = await browser.get('/setup/ai');
      expect(on.body).toContain(
        'AI write-ups are on. They run on this model: <code>zeta:1b</code>',
      );
      expect(on.body).not.toContain('Use zeta:1b');
    } finally {
      await store.close();
    }
  });

  it('saves nothing when the server’s name resolves somewhere else between finding it and saving it (ADR 0040 D-6)', async () => {
    const stub = await startOllamaStub(CURRENT_SERVER);
    stubs.push(stub);
    const shown = (): number =>
      stub.requests.filter((request) => request.path === '/api/show').length;
    // Local while Ollama is found and read, down to its last model's capabilities; public from
    // the lookup after that, which is the save's own check of the address.
    let publicAfter = Number.POSITIVE_INFINITY;
    const at = await world({
      ollama: [`http://models-box:${String(stub.port)}/v1`],
      resolve: (name) =>
        name !== 'models-box'
          ? Promise.reject(new Error('no such name'))
          : Promise.resolve([shown() >= publicAfter ? '8.8.8.8' : '127.0.0.1']),
    });
    const { browser } = await atAiStep(at);
    expect((await browser.get('/setup/ai')).body).toContain('Use alpha:14b');
    publicAfter = shown() + 3;
    const refused = await browser.post('/setup/ai/use', { model: 'alpha:14b' });
    expect(refused.headers.location).toBe('/setup/ai?refused');
    // Nothing was loaded, the refusal is logged naming the field and never the address, and
    // the settings a job reads are still nobody's.
    expect(stub.requests.filter((request) => request.path === '/api/generate')).toEqual([]);
    expect(await modelLog(at)).toEqual([
      ['setup', 'analysis_settings_set', 'refused', 'local_url'],
    ]);
    const store = await openSqlStore(at.path);
    try {
      expect(await store.getAnalysisSetting()).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('says in one sentence that no Ollama was found, is skipped, and the setup finishes with AI off', async () => {
    const at = await world();
    const { browser, ownerId } = await atAiStep(at);
    const none = await browser.get('/setup/ai');
    expect(none.status).toBe(200);
    expect(none.body).toContain(
      '<p class="notice">Ollama was not found on this computer, so AI write-ups stay off.</p>',
    );
    // Nothing to download or choose, and a button that looks again when the owner asks.
    expect(none.body).not.toContain('action="/setup/ai/pull"');
    expect(none.body).not.toContain('action="/setup/ai/use"');
    expect(none.body).toContain(
      '<form method="get" action="/setup/ai" aria-label="Look again"><button type="submit">Look again</button></form>',
    );
    // A form sent anyway asks for no download and saves nothing.
    expect((await browser.post('/setup/ai/pull', { model: 'delta:8b' })).headers.location).toBe(
      '/setup/ai',
    );
    expect((await browser.post('/setup/ai/use', { model: 'delta:8b' })).headers.location).toBe(
      '/setup/ai?refused',
    );
    expect(await modelLog(at)).toEqual([['setup', 'analysis_model_pull', 'refused', 'no_server']]);

    // Skipped with Next step, and finished.
    expect(none.body).toContain('name="from" value="ai"');
    expect((await browser.post('/setup/next', { from: 'ai' })).headers.location).toBe(
      '/setup/finish',
    );
    expect(summaryOf((await browser.get('/setup/finish')).body).at(-1)).toBe(
      'AI write-ups: off. Everything else works without them.',
    );
    expect((await browser.post('/setup/finish/done')).status).toBe(200);
    await expectAllNotFound(at.port, { finishedHere: true });
    // Done with AI off, as a job meets it: the owner's write-up on this computer's model is
    // refused at its start. Every step before this one worked with no model.
    const refused = await at.instance
      .analysisJobs()
      ?.start({ athleteId: ownerId } as Caller, jobBody());
    expect(refused).toMatchObject({ ok: false, code: 'local_unavailable' });
  });
});

describe('the setup’s tailnet step (#2817, ADR 0079 D-2, D-8)', () => {
  const TAILNET_ORIGIN = 'https://onyourleft.tail1a2b.ts.net';
  const RENAMED_ORIGIN = 'https://onyourleft-1.tail1a2b.ts.net';

  /** Signed in, the claim made and confirmed with a tablet: the setup lands on the tailnet step. */
  async function claimed(at: World): Promise<{ browser: Browser; card: string }> {
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const shown = await showClaim(browser);
    const card = /oyl-instance:[^ <]+/.exec(shown.body)?.[0] ?? '';
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    expect((await tabletRedeems(at, await testDevice(), claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    expect((await browser.post('/setup/next', { from: 'claim' })).headers.location).toBe(
      '/setup/tailnet',
    );
    return { browser, card };
  }

  /** The address the step says the running server read back. */
  const addressOn = (body: string): string | undefined =>
    /This server is running with this address: <code>([^<]*)<\/code>/.exec(body)?.[1];

  it('comes straight after the claim, shows the address the running server’s card names, how riders join and the access rule, and says what a change costs before how', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'tailnet' });
    const { browser, card } = await claimed(at);
    const step = await browser.get('/setup/tailnet');
    expect(step.status).toBe(200);
    // One name for the step, in the progress bar and as the page's heading (owner, 2026-11-19).
    expect(step.body).toContain('<h1>Tailnet</h1>');
    expect(step.body).toMatch(
      /aria-current="step">[\s\S]*?<span class="step-name">Tailnet<\/span>/,
    );
    // Read back from the card the claim QR carried, not from a value the step was handed.
    expect(card.startsWith(`oyl-instance:${TAILNET_ORIGIN}#`)).toBe(true);
    expect(addressOn(step.body)).toBe(TAILNET_ORIGIN);
    expect(step.body).toContain(
      '<p class="notice">That is a Tailscale address, so a device on your tailnet can reach it.</p>',
    );
    expect(step.body).not.toContain('class="problem"');
    // ADR 0079 D-2: by invitation or sharing, each on their own account, never the owner's.
    expect(step.body).toContain('Invite each rider into your tailnet');
    expect(step.body).toContain('share this machine with them');
    expect(step.body).toContain('signs in with their own Tailscale account');
    expect(step.body).toContain(
      '<p class="warning">Never sign a rider’s device in to your own Tailscale account',
    );
    // The access rule limiting every other device to the instance's port, to copy.
    const rule = /<pre class="copy"><code>([\s\S]*?)<\/code><\/pre>/.exec(step.body)?.[1] ?? '';
    const parsed = JSON.parse(rule.replaceAll('&quot;', '"')) as {
      tagOwners: Record<string, string[]>;
      grants: { src: string[]; dst: string[]; ip: string[] }[];
    };
    expect(parsed.tagOwners).toEqual({ 'tag:onyourleft': ['autogroup:owner'] });
    expect(parsed.grants).toContainEqual({
      src: ['autogroup:member', 'autogroup:shared'],
      dst: ['tag:onyourleft'],
      ip: ['tcp:443'],
    });
    // ADR 0079 D-8: the cost of a change is read before anything says how to make one.
    const warning = step.body.indexOf(
      'Every device that uses this server, your tablet too, must scan',
    );
    const how = step.body.indexOf('Set OYL_INSTANCE_ORIGIN in .env');
    expect(warning).toBeGreaterThan(-1);
    expect(step.body).toContain('every passkey made for the old address stops working');
    // The keys are wrapped under the address: a change means new ones, so a new identity.
    expect(step.body).toContain(
      'the server’s keys belong to its address, so it must make new ones, which gives it a new identity',
    );
    expect(how).toBeGreaterThan(warning);
    // #2920: the deploy is a block to copy, like every other command, never words in a sentence.
    expect(step.body).toContain(
      'Then run this beside compose.yaml. It prints Tailscale’s sign-in link',
    );
    expect(step.body).toContain('<pre class="copy"><code>bash deploy.sh</code></pre>');
    expect(step.body).not.toContain('Run bash deploy.sh');
    expect(step.body.indexOf('instance-key reset')).toBeGreaterThan(warning);
    // It changes nothing itself: its one form is the GET that reads the address back again.
    const forms = [...step.body.matchAll(/<form [^>]*>/g)].map((match) => match[0]);
    expect(forms.filter((form) => form.includes('method="post"'))).toEqual([
      expect.stringContaining('action="/setup/next"'),
    ]);
    expect(forms).toContainEqual(expect.stringContaining('action="/setup/tailnet"'));
    // Moving on leads to the passkey, which is bound to the address now settled.
    expect((await browser.post('/setup/next', { from: 'tailnet' })).headers.location).toBe(
      '/setup/passkey',
    );
  });

  it('reads the address back from the server that is running after a restart, and says it works only once a device can fetch its keys', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'tailnet' });
    const { card: before } = await claimed(at);
    expect(before.startsWith(`oyl-instance:${TAILNET_ORIGIN}#`)).toBe(true);
    // The owner changes the address in .env and deploys again: the same database, a new start.
    at.origin = RENAMED_ORIGIN;
    await restart(at);
    const tunnel = portOf(at.instance);
    const keysOnDevice = () =>
      send(tunnel, 'GET', '/v1/instance/keys', { host: `localhost:${String(tunnel)}` });
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    const after = await browser.get('/setup/tailnet');
    expect(after.status).toBe(200);
    expect(addressOn(after.body)).toBe(RENAMED_ORIGIN);
    expect(after.body).not.toContain(TAILNET_ORIGIN);
    // The keys were wrapped under the old address (keys/wrap.ts), so what a device fetches
    // first fails: the step must say so, and never that the new address can be reached.
    const fetched = await keysOnDevice();
    expect(fetched.status).toBe(503);
    expect(fetched.body).toContain('cannot be unwrapped');
    expect(after.body).toContain(
      '<p class="problem">The server cannot open its keys at this address',
    );
    expect(after.body).toContain('instance-key reset');
    expect(after.body).not.toContain('so a device on your tailnet can reach it');
    // The remedy the page names, run on the host; then Check now reads the server again.
    const paths = { database: at.path, blobs: `${at.path}.blobs` };
    const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await instanceKey(paths, { action: 'reset' }, { secret, origin: RENAMED_ORIGIN });
    const checked = await browser.get('/setup/tailnet');
    expect((await keysOnDevice()).status).toBe(200);
    expect(addressOn(checked.body)).toBe(RENAMED_ORIGIN);
    expect(checked.body).toContain('so a device on your tailnet can reach it');
    expect(checked.body).not.toContain('class="problem"');
  });

  it('says no card can be drawn, and never that the address works, when the keys cannot be read', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'tailnet' });
    await claimed(at);
    // Started again with no secret: the keys are not opened, so there is no card for any address.
    await restart(at, { noSecret: true });
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    const step = await browser.get('/setup/tailnet');
    expect(step.status).toBe(200);
    expect(addressOn(step.body)).toBe(TAILNET_ORIGIN);
    expect(step.body).toContain(
      '<p class="problem">The server’s keys could not be read, so it cannot draw a card',
    );
    expect(step.body).not.toContain('so a device on your tailnet can reach it');
  });

  it('is where an owner claimed outside the setup lands too, with the setup still at the claim', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'tailnet' });
    const { browser } = await claimed(at);
    // An owner claimed from the admin pages, say, leaves the setup's own step at the claim.
    const store = await openSqlStore(at.path);
    try {
      await store.setSetupStep('claim', Math.floor(Date.now() / 1000));
    } finally {
      await store.close();
    }
    expect((await browser.get('/setup')).headers.location).toBe('/setup/tailnet');
    expect((await browser.get('/setup/passkey')).headers.location).toBe('/setup/tailnet');
  });

  it('takes only https://<machine>.<tailnet>.ts.net for a Tailscale name', () => {
    expect(isTailscaleName(TAILNET_ORIGIN)).toBe(true);
    expect(isTailscaleName('https://onyourleft.tail1a2b.ts.net.')).toBe(true);
    for (const not of [
      'https://tail1a2b.ts.net',
      'https://a.onyourleft.tail1a2b.ts.net',
      'http://onyourleft.tail1a2b.ts.net',
      'https://onyourleft.tail1a2b.ts.net.example.org',
      'https://rides.example.org',
      'not an address',
    ]) {
      expect(isTailscaleName(not), not).toBe(false);
    }
    expect(cardOrigin(`oyl-instance:${TAILNET_ORIGIN}#${'a'.repeat(52)}`)).toBe(TAILNET_ORIGIN);
  });

  it('says a tailnet server whose address is not a Tailscale name will not be reached', async () => {
    const at = await world({ origin: 'https://rides.example.org', remotePath: 'tailnet' });
    const { browser } = await claimed(at);
    const step = await browser.get('/setup/tailnet');
    expect(addressOn(step.body)).toBe('https://rides.example.org');
    expect(step.body).toContain(
      '<p class="problem">That is not a Tailscale address, but this server is set up to be reached over your tailnet',
    );
  });

  it('says what Funnel changes on the Funnel path, and keeps the riders and the access rule', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'funnel' });
    const { browser } = await claimed(at);
    const step = await browser.get('/setup/tailnet');
    expect(step.body).toContain(
      '<p class="warning">Funnel is on, so this address is on the public internet too',
    );
    expect(step.body).toContain('<pre class="copy">');
    expect(step.body).toContain('Never sign a rider’s device in to your own Tailscale account');
  });

  it('has nothing to set up on a Cloudflare tunnel: no tailnet words, but the cost of a change still first', async () => {
    const at = await world({ origin: 'https://rides.example.org', remotePath: 'cloudflare' });
    const { browser } = await claimed(at);
    const step = await browser.get('/setup/tailnet');
    expect(step.body).toContain('reached through a Cloudflare tunnel on your own domain');
    // Still named Tailnet, and the first thing it says is that nothing is needed here.
    expect(step.body).toContain('<h1>Tailnet</h1>');
    expect(step.body).toMatch(/<h1>Tailnet<\/h1>\n<p>Nothing to do here: /);
    // No access rule to paste: the blocks to copy are what a change of address needs, the
    // deploy (#2920) and the key reset.
    expect(step.body).not.toContain('tagOwners');
    expect(
      [...step.body.matchAll(/<pre class="copy"><code>([^<]*)<\/code>/g)].map((m) => m[1]),
    ).toEqual([
      'bash deploy.sh',
      'docker compose exec instance node src/operator/cli.ts instance-key reset',
    ]);
    expect(step.body).not.toContain('Invite each rider into your tailnet');
    expect(step.body).not.toContain('class="problem"');
    expect(step.body).not.toContain('That is a Tailscale address');
    expect(step.body).toContain('every passkey made for the old address stops working');
    // How to change it names the Cloudflare address and nothing a tailnet needs.
    expect(step.body).not.toContain('ts.net');
    expect(step.body).not.toContain('COMPOSE_PROFILES=tailscale');
    expect(step.body).not.toContain('OYL_INSTANCE_REMOTE_PATH=tailnet');
    expect(step.body).toContain('your own domain that your Cloudflare tunnel serves');
  });

  it('says this step cannot check a tailnet when no path is named', async () => {
    const at = await world({ origin: TAILNET_ORIGIN });
    const { browser } = await claimed(at);
    const step = await browser.get('/setup/tailnet');
    expect(step.body).toContain('do not say how other devices reach it');
    expect(addressOn(step.body)).toBe(TAILNET_ORIGIN);
  });

  it('is not_found through the public listener, before the claim and at the step', async () => {
    const at = await world({ origin: TAILNET_ORIGIN, remotePath: 'tailnet' });
    const tunnel = portOf(at.instance);
    const missing = await noRoute(tunnel, 'GET');
    const before = await send(tunnel, 'GET', '/setup/tailnet', {
      host: `localhost:${String(tunnel)}`,
    });
    expect(before.status).toBe(404);
    expect(before.body).toBe(missing.body);
    await claimed(at);
    const during = await send(tunnel, 'GET', '/setup/tailnet', {
      host: `localhost:${String(tunnel)}`,
    });
    expect(during.status).toBe(404);
    expect(during.body).toBe(missing.body);
  });
});

describe('the setup wizard’s snags from the trial of 2026-11-18 (#2858)', () => {
  /** Signed in, claimed with a tablet and confirmed: the setup past its claim. */
  async function claimed(at: World): Promise<{ browser: Browser; tablet: TestDevice }> {
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    return { browser, tablet };
  }

  /** One backup by the backup service's own loop, at `when`. */
  async function backUp(at: World, when: Date): Promise<void> {
    const stop = new AbortController();
    await backupLoop(
      { database: at.path, blobs: join(at.path, '..', 'blobs') },
      join(at.path, '..', 'backups-dir'),
      {
        intervalSeconds: 21_600,
        signal: stop.signal,
        now: () => when,
        wait: () => {
          stop.abort();
          return Promise.resolve();
        },
        report: () => undefined,
      },
    );
  }

  it('takes "Back up now" past the 15-minute gap while the newest backup predates the claim, and says it does not hold the account', async () => {
    const at = await world();
    at.clock = Date.now();
    await restart(at);
    // The backup service's start-up backup, before anybody claimed the server.
    await backUp(at, new Date(at.clock));
    at.clock += 60 * 1000;
    const { browser } = await claimed(at);
    for (const from of ['tailnet', 'passkey', 'secrets'])
      await browser.post('/setup/next', { from });
    const step = await browser.get('/setup/backups');
    expect(step.body).toContain(
      '<p class="warning">That backup was made before your tablet claimed this server, so it does not hold your account yet.',
    );
    // Asked: one minute after the start-up backup, well inside the 15-minute gap.
    const asked = await browser.post('/setup/backups/now');
    expect(asked.headers.location).toBe('/setup/backups?asked');
    // The backup it asked for runs, after the claim: now the gap holds again, and no warning.
    at.clock += 60 * 1000;
    await backUp(at, new Date(at.clock));
    const after = await browser.get('/setup/backups');
    expect(after.body).not.toContain('before your tablet claimed this server');
    at.clock += 60 * 1000;
    expect((await browser.post('/setup/backups/now')).headers.location).toBe(
      '/setup/backups?too-soon',
    );
  });

  it('voids a claim code a restart took the page of, and says why the QR went', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const before = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    expect(before).toMatch(/^[a-z2-9]{4}/);
    await restart(at);
    const again = new Browser(at);
    await again.signIn(await codeInFile(at));
    const open = await again.get('/setup/claim');
    expect(open.body).toContain(
      '<p class="problem" role="alert">The server restarted, so a claim code it showed before no longer works. Show a new one.</p>',
    );
    // The tablet that scans the old page's QR now is refused: the code is void, not merely unseen.
    const late = await tabletRedeems(at, await testDevice(), before);
    expect(late.status).not.toBe(200);
    // Once this process has shown a new code, the sentence has done its work, for every session.
    await showClaim(again);
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    const third = new Browser(at);
    await third.signIn(printed.code);
    const elsewhere = await third.get('/setup/claim');
    expect(elsewhere.body).toContain('Show the claim code');
    expect(elsewhere.body).not.toContain('The server restarted');
  });

  it('keeps a redeemed claim waiting for Yes across a restart, and confirms it after', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    // The owner restarts between the tablet's scan and pressing Yes.
    await restart(at);
    const again = new Browser(at);
    await again.signIn(await codeInFile(at));
    const pending = await again.get('/setup/claim');
    expect(pending.body).not.toContain('The server restarted');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    expect(comparison).toMatch(/^[0-9]{6}$/);
    expect((await again.post('/setup/claim/confirm', { comparison })).status).toBe(303);
    expect((await again.get('/setup/tailnet')).status).toBe(200);
  });

  it('owner-claim reset makes the setup code and writes its file, which opens the setup', async () => {
    const at = await world();
    await claimed(at);
    await rm(join(at.secrets, SETUP_CODE_FILE), { force: true });
    const reset = await ownerClaimReset(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    expect(reset).toMatchObject({
      cleared: true,
      open: `http://localhost:${String(at.port)}/setup`,
      writtenToFile: true,
    });
    const code = await codeInFile(at);
    expect(reset).toMatchObject({ setupCode: code });
    const browser = new Browser(at);
    expect((await browser.signIn(code)).headers.location).toBe('/setup/claim');
    // With .env naming the owner the setup stays done: no code, and no file.
    await rm(join(at.secrets, SETUP_CODE_FILE), { force: true });
    const named = await ownerClaimReset(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port), ownerKey: 'a-key' },
    );
    expect(named).not.toHaveProperty('setupCode');
    expect(await fileThere(at)).toBe(false);
  });

  it('writes the whole command wherever a page names one, in a block to copy', async () => {
    const at = await world();
    const locked = await new Browser(at).get('/setup');
    expect(locked.body).toContain(
      '<pre class="copy"><code>docker compose exec instance node src/operator/cli.ts setup-code</code></pre>',
    );
    const { browser } = await claimed(at);
    expect((await browser.get('/setup/claim')).body).toContain(
      '<pre class="copy"><code>docker compose exec instance node src/operator/cli.ts owner-claim reset</code></pre>',
    );
    await browser.post('/setup/next', { from: 'claim' });
    const tailnet = (await browser.get('/setup/tailnet')).body;
    expect(tailnet).toContain(
      '<pre class="copy"><code>docker compose exec instance node src/operator/cli.ts instance-key reset</code></pre>',
    );
    await browser.post('/setup/next', { from: 'tailnet' });
    const passkey = (await browser.get('/setup/passkey')).body;
    for (const command of [
      'docker compose up -d instance',
      'docker compose exec instance node src/operator/cli.ts admin-code',
      'docker compose exec instance node src/operator/cli.ts admin-passkeys list',
      'docker compose exec instance node src/operator/cli.ts admin-passkeys confirm &lt;id&gt;',
    ]) {
      expect(passkey).toContain(`<pre class="copy"><code>${command}</code></pre>`);
    }
    await browser.post('/setup/next', { from: 'passkey' });
    await browser.post('/setup/next', { from: 'secrets' });
    const backups = (await browser.get('/setup/backups')).body;
    expect(backups).toContain('<pre class="copy"><code>docker compose ps backup</code></pre>');
    // No plain sentence says "the … command" without the command itself, nor runs one inline.
    expect(locked.body).not.toMatch(/the [a-z]+-[a-z-]+ command/);
    expect(passkey).not.toMatch(/the [a-z]+-[a-z-]+ command/);
    for (const page of [locked.body, tailnet, passkey, backups]) {
      expect(page.replaceAll(/<pre class="copy"><code>[^<]*<\/code><\/pre>/g, '')).not.toMatch(
        /docker compose|operator\/cli/,
      );
    }
  });

  it('says how to download the kit again after the one download, and a new session can', async () => {
    const at = await world();
    const { browser } = await claimed(at);
    for (const from of ['tailnet', 'passkey']) await browser.post('/setup/next', { from });
    expect((await browser.post('/setup/secrets/kit')).status).toBe(200);
    const taken = await browser.get('/setup/secrets');
    expect(taken.body).toContain('If you cancelled the save or cannot find the file');
    expect(taken.body).toContain(
      '<pre class="copy"><code>docker compose exec instance node src/operator/cli.ts setup-code</code></pre>',
    );
    // ADR 0080 D-4: once per session — this one downloads nothing more.
    expect((await browser.post('/setup/secrets/kit')).status).toBe(303);
    // The command's code opens a new session, which downloads it once more.
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    const fresh = new Browser(at);
    await fresh.signIn(printed.code);
    await fresh.get('/setup/secrets');
    const again = await fresh.post('/setup/secrets/kit');
    expect(again.status).toBe(200);
    expect(again.body).toContain(KIT_SECRET.text);
  });

  it('is shown again by the process that made it only: after a restart, the step says it was made', async () => {
    const at = await world();
    const { browser, tablet } = await claimed(at);
    expect((await register(at, tablet)).status).toBe(200);
    for (const from of ['tailnet', 'passkey', 'secrets', 'backups'])
      await browser.post('/setup/next', { from });
    await browser.post('/setup/registration/mode', { mode: 'invite' });
    await browser.post('/setup/invite/code');
    const code = CARD_LINE.exec((await browser.get('/setup/invite')).body)?.[1] ?? '';
    expect(code).toMatch(/^[a-z2-9]{4}/);
    // The database keeps only the invite's hash, so a new process cannot draw it again.
    await restart(at);
    const later = new Browser(at);
    await later.signIn(await codeInFile(at));
    const gone = await later.get('/setup/invite');
    expect(gone.body).toContain('made its one invite');
    expect(gone.body).not.toContain(code);
  });

  it('stops showing the invite once a rider has used it', async () => {
    const at = await world();
    const { browser, tablet } = await claimed(at);
    expect((await register(at, tablet)).status).toBe(200);
    for (const from of ['tailnet', 'passkey', 'secrets', 'backups'])
      await browser.post('/setup/next', { from });
    await browser.post('/setup/registration/mode', { mode: 'invite' });
    await browser.post('/setup/invite/code');
    const code = CARD_LINE.exec((await browser.get('/setup/invite')).body)?.[1] ?? '';
    const rider = await testDevice();
    const joined = await register(at, rider, code);
    expect(joined.status, joined.text).toBe(200);
    const after = await browser.get('/setup/invite');
    expect(after.body).toContain('made its one invite');
    expect(after.body).not.toContain(code);
  });
});

describe('local times with the zone named (#2858)', () => {
  it('reads a moment by a named zone, and the code’s file says it beside UTC', () => {
    const at = Date.UTC(2026, 10, 19, 10, 30) / 1000;
    expect(localTimeText(at, 'America/New_York')).toBe('2026-11-19 05:30 EST');
    expect(localTimeText(at, 'UTC')).toBe('2026-11-19 10:30 UTC');
    expect(setupCodeFileText('abcd-efgh-jkmn-pqrs', at, 8788, 'America/New_York')).toContain(
      'It works once, until 2026-11-19 05:30 EST (2026-11-19T10:30:00.000Z).',
    );
  });
});

describe('the setup session and its step gate (#2784, ADR 0069 D-4, ADR 0080 D-2)', () => {
  const MINUTE = 60 * 1000;

  /** Whether the database still holds the session this cookie names. */
  async function sessionHeld(at: World, cookie: string): Promise<boolean> {
    const store = await openSqlStore(at.path);
    try {
      return (await store.findSetupSession(await sha256Hex(cookie))) !== undefined;
    } finally {
      await store.close();
    }
  }

  it('ends a session idle for fifteen minutes, and one kept busy past two hours, and takes its row', async () => {
    const at = await world();
    at.clock = Date.now();
    await restart(at);
    const idle = new Browser(at);
    await idle.signIn(await codeInFile(at));
    const idleCookie = idle.cookie ?? '';
    expect((await idle.get('/setup/claim')).status).toBe(200);
    // Fourteen minutes of quiet is inside the limit and restarts it; sixteen is not.
    at.clock += 14 * MINUTE;
    expect((await idle.get('/setup/claim')).status).toBe(200);
    at.clock += 16 * MINUTE;
    const gone = await idle.get('/setup/claim');
    expect(gone.status).toBe(303);
    expect(gone.headers.location).toBe('/setup');

    // A session used every fourteen minutes is never idle, and still ends at two hours.
    await restart(at);
    const busy = new Browser(at);
    await busy.signIn(await codeInFile(at));
    const busyCookie = busy.cookie ?? '';
    for (let used = 1; used <= 8; used += 1) {
      at.clock += 14 * MINUTE;
      expect((await busy.get('/setup/claim')).status, `after ${String(used * 14)} minutes`).toBe(
        200,
      );
    }
    at.clock += 14 * MINUTE;
    const over = await busy.get('/setup/claim');
    expect(over.status).toBe(303);
    expect(over.headers.location).toBe('/setup');

    await running?.stop();
    running = undefined;
    expect(await sessionHeld(at, idleCookie)).toBe(false);
    expect(await sessionHeld(at, busyCookie)).toBe(false);
  });

  it('refuses a form for a step the setup has not reached, so a setup cannot finish unclaimed', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    for (const route of [
      '/setup/finish/done',
      '/setup/backups/now',
      '/setup/registration/mode',
      '/setup/invite/code',
      '/setup/ai/pull',
      '/setup/ai/use',
    ]) {
      const answer = await browser.post(route, { mode: 'closed' });
      expect(answer.status, route).toBe(303);
      expect(answer.headers.location, route).toBe('/setup/claim');
    }
    const next = await browser.post('/setup/next', { from: 'finish' });
    expect(next.headers.location).toBe('/setup/claim');
    await running?.stop();
    running = undefined;
    const store = await openSqlStore(at.path);
    try {
      expect((await store.setupState())?.doneAt ?? null).toBeNull();
      expect(await store.registrationSetting()).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('ends the session the browser held when it signs in again', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    const before = browser.cookie ?? '';
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    await browser.signIn(printed.code);
    expect(browser.cookie).not.toBe(before);
    expect(await sessionHeld(at, before)).toBe(false);
    expect(await sessionHeld(at, browser.cookie ?? '')).toBe(true);
  });
});

describe('the setup’s commands on the host (#2784, ADR 0080 D-2, D-6)', () => {
  it('owner-claim reset reopens the setup at its claim step and ends its sessions (ADR 0080 D-3)', async () => {
    const at = await world();
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    for (const from of [
      'tailnet',
      'passkey',
      'secrets',
      'backups',
      'registration',
      'invite',
      'ai',
    ]) {
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
    await expectAllNotFound(at.port, { finishedHere: true });

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
    const reclaim = CARD_LINE.exec((await showClaim(again)).body)?.[1] ?? '';
    expect((await tabletRedeems(at, tablet, reclaim)).status).toBe(200);
    const twice = await again.get('/setup/claim');
    const digits = /name="comparison" value="([0-9]{6})"/.exec(twice.body)?.[1] ?? '';
    expect((await again.post('/setup/claim/confirm', { comparison: digits })).status).toBe(303);
    for (const from of [
      'tailnet',
      'passkey',
      'secrets',
      'backups',
      'registration',
      'invite',
      'ai',
    ]) {
      await again.post('/setup/next', { from });
    }
    // This setup's, not the one before the reset: no kit downloaded since, no invite made.
    expect(summaryOf((await again.get('/setup/finish')).body)).toEqual([
      'Owner: your tablet owns this server.',
      'Emergency kit: not downloaded. You can download it later from the admin pages on this computer, once you have added a passkey there.',
      'Backups: not checked yet. No backup has run.',
      'Who may join: I approve each new rider.',
      'Invites made: none.',
      'AI write-ups: off. Everything else works without them.',
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

describe('what a device needs before it can reach the server, and an address never set (#2855)', () => {
  /** The origin line of the settings template, as an owner who filled nothing in has it in `.env`. */
  const templateOrigin = (): string =>
    /^OYL_INSTANCE_ORIGIN=(.+)$/m.exec(
      readFileSync(new URL('../../deploy/home/instance.env.example', import.meta.url), 'utf8'),
    )?.[1] ?? '';

  /** Everything before a step's button: what its page says BEFORE the code is shown. */
  const beforeTheButton = (body: string, label: string): string => {
    const at = body.indexOf(`aria-label="${label}"`);
    expect(at, label).toBeGreaterThan(0);
    return body.slice(0, at);
  };

  /** A browser signed in to the setup, on its claim step. */
  async function signedIn(at: World): Promise<Browser> {
    const browser = new Browser(at);
    await browser.signIn(await codeInFile(at));
    return browser;
  }

  /** Claim with a tablet, sign it in, and walk the setup to its invite step. */
  async function walkToInvite(at: World, browser: Browser): Promise<void> {
    await browser.get('/setup/claim');
    const claim = CARD_LINE.exec((await showClaim(browser)).body)?.[1] ?? '';
    const tablet = await testDevice();
    expect((await tabletRedeems(at, tablet, claim)).status).toBe(200);
    const pending = await browser.get('/setup/claim');
    const comparison = /name="comparison" value="([0-9]{6})"/.exec(pending.body)?.[1] ?? '';
    await browser.post('/setup/claim/confirm', { comparison });
    expect((await register(at, tablet)).status).toBe(200);
    for (const from of ['tailnet', 'passkey', 'secrets', 'backups']) {
      await browser.post('/setup/next', { from });
    }
    const mode = await browser.post('/setup/registration/mode', { mode: 'invite' });
    expect(mode.headers.location).toBe('/setup/invite');
  }

  /** `cloudflared`'s `/ready`, stood in on loopback: the connections it says it has, and how often it was asked. */
  async function tunnelStandIn(state: { connections: number; asked: number }): Promise<string> {
    const server = createServer((_request, response) => {
      state.asked += 1;
      response.writeHead(state.connections > 0 ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 200, readyConnections: state.connections }));
    });
    tunnel = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return `http://127.0.0.1:${String(port)}/ready`;
  }

  it('does not open while the address is the template’s example: no code is made or taken, and every page says what to set', async () => {
    const example = templateOrigin();
    expect(example).toMatch(/^https:\/\//);
    const at = await world({ origin: example, remotePath: 'tailnet' });
    // The start: no code file, and a line that says where the page is, never the address.
    expect(await fileThere(at)).toBe(false);
    const said = at.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(said.find((line) => line.event === 'example-address')).toEqual({
      event: 'example-address',
      open: `http://localhost:${String(at.port)}/setup`,
    });
    expect(said.some((line) => line.event === 'first-run-setup')).toBe(false);
    expect(at.lines.join('\n')).not.toContain('your-tailnet');
    // An example address is no address: the instance made no keys for it, and serves none.
    expect(said.find((line) => line.event === 'instance-keys')).toMatchObject({
      state: 'no-origin',
    });
    expect((await fetch(`${at.instance.url}/v1/instance/keys`)).status).not.toBe(200);

    // The page: one plain sentence, the setting's name in the collapsed block, and no form.
    const browser = new Browser(at);
    const refused = await browser.get('/setup');
    expect(refused.status).toBe(409);
    expect(refused.body).toContain(SETUP_EXAMPLE_ADDRESS_TEXT);
    expect(refused.body).toContain('<details>');
    expect(refused.body).toContain('OYL_INSTANCE_ORIGIN');
    expect(refused.body).not.toContain('<form');
    expect(refused.body).not.toContain('your-tailnet');
    // Its stylesheet is still served, or the page would be drawn bare.
    const sheet = await browser.get('/setup/setup.css');
    expect(sheet.status).toBe(200);
    expect(sheet.headers['content-type']).toBe('text/css; charset=utf-8');

    // A code the host's command prints is not taken either: no session, so no step and no claim code.
    const printed = await setupCode(
      { database: at.path, blobs: `${at.path}.blobs` },
      { secretsDirectory: at.secrets, port: String(at.port) },
    );
    const typed = await browser.post('/setup/sign-in', { code: printed.code });
    expect(typed.status).toBe(409);
    expect(typed.headers['set-cookie']).toBeUndefined();
    expect(typed.body).toContain(SETUP_EXAMPLE_ADDRESS_TEXT);
    for (const route of SETUP_ROUTES) {
      if (route.kind === 'stylesheet') continue;
      for (const method of route.methods) {
        const answer =
          method === 'GET' ? await browser.get(route.path) : await browser.post(route.path);
        expect(answer.status, `${method} ${route.path}`).toBe(409);
        expect(answer.body, `${method} ${route.path}`).toContain(SETUP_EXAMPLE_ADDRESS_TEXT);
        expect(answer.body, `${method} ${route.path}`).not.toMatch(CARD_LINE);
        expect(answer.headers['set-cookie'], `${method} ${route.path}`).toBeUndefined();
      }
    }
    // The instance itself runs: only the setup, and the accounts, wait for the address.
    expect((await fetch(`${at.instance.url}/health`)).status).toBe(200);
  });

  it('binds nothing to the example: once the address is set, the same database opens the setup and its claim code’s card names the new address', async () => {
    const at = await world({ origin: templateOrigin() });
    expect((await new Browser(at).get('/setup')).status).toBe(409);
    // `.env` corrected and the instance started again on the SAME database. Keys made for the
    // example would not open now (their wrap binds the origin), and there would be no card.
    at.origin = TEST_ORIGIN;
    await restart(at);
    const opened = new Browser(at);
    expect((await opened.get('/setup')).body).toContain('name="code"');
    const landed = await opened.signIn(await codeInFile(at));
    expect(landed.headers.location).toBe('/setup/claim');
    expect((await opened.get('/setup/claim')).body).toContain('Show the claim code');
    const shown = await showClaim(opened);
    expect(shown.body).toMatch(CARD_LINE);
    expect(shown.body).toContain(`oyl-instance:${TEST_ORIGIN}#`);
    // And a tablet can claim it there, on the sealed route, under those keys.
    const claim = CARD_LINE.exec(shown.body)?.[1] ?? '';
    expect((await tabletRedeems(at, await testDevice(), claim)).status).toBe(200);
  });

  it('answers another host with the setup’s one address, even while the address is the example', async () => {
    const at = await world({ origin: templateOrigin() });
    const elsewhere = await send(at.port, 'GET', '/setup', {
      host: `127.0.0.1:${String(at.port)}`,
    });
    expect(elsewhere.status).toBe(421);
    expect(elsewhere.body).toContain(`http://localhost:${String(at.port)}/setup`);
    expect(elsewhere.body).not.toContain(SETUP_EXAMPLE_ADDRESS_TEXT);
    // Through the tunnel's listener the setup is a path with no route, as it always is.
    await expectAllNotFound(portOf(at.instance));
  });

  it('serves nothing of the setup for an example address when the owner key is in the environment, and still says so in the log', async () => {
    const at = await world({ origin: templateOrigin() });
    await restart(at, { ownerKey: (await testDevice()).publicKey });
    expect(at.instance.adminLoopback).toBeUndefined();
    const said = at.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(said.filter((line) => line.event === 'example-address').at(-1)).toEqual({
      event: 'example-address',
    });
  });

  it('names the address and says the tablet must be on the tailnet before the claim code is shown, and beside the code', async () => {
    const at = await world({ remotePath: 'tailnet' });
    const browser = await signedIn(at);
    const open = await browser.get('/setup/claim');
    // Before the button that shows the code: the address, what the tablet needs, and how to check.
    const before = beforeTheButton(open.body, 'Show the claim code');
    expect(before).toContain(`<code>${TEST_ORIGIN}</code>`);
    expect(before).toContain(CLAIM_REACH_TEXT.tailnet);
    expect(before).toContain('same Tailscale network as this computer');
    expect(before).toContain(`<code>${TEST_ORIGIN}/health</code>`);
    // The address the page tells the owner to open on the tablet is one the instance answers.
    const health = await fetch(`${at.instance.url}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toContain('ok');
    // Nothing on a tailnet can be checked from this computer, so nothing is claimed.
    expect(open.body).not.toContain('Checked from this computer');

    // Beside the code too: a scan that fails sends the owner back to this page.
    const shown = await showClaim(browser);
    expect(shown.body).toMatch(CARD_LINE);
    expect(shown.body).toContain(CLAIM_REACH_TEXT.tailnet);
    expect(shown.body).toContain(`<code>${TEST_ORIGIN}</code>`);
    // Above the QR and the button, as before the code is shown (owner, 2026-11-19).
    const needs = shown.body.indexOf('same Tailscale network as this computer');
    expect(needs).toBeGreaterThan(-1);
    expect(needs).toBeLessThan(shown.body.indexOf('role="img"'));
    expect(needs).toBeLessThan(shown.body.indexOf('I’ve scanned it'));
  });

  it('says a rider’s device needs the tailnet too, before the invite is made and beside it', async () => {
    const at = await world({ remotePath: 'tailnet' });
    const browser = await signedIn(at);
    await walkToInvite(at, browser);
    const offer = await browser.get('/setup/invite');
    expect(beforeTheButton(offer.body, 'Make an invite')).toContain(INVITE_REACH_TEXT.tailnet);
    expect((await browser.post('/setup/invite/code')).headers.location).toBe('/setup/invite');
    const invite = await browser.get('/setup/invite');
    expect(invite.body).toMatch(CARD_LINE);
    expect(invite.body).toContain(INVITE_REACH_TEXT.tailnet);
    expect(invite.body).toContain('never yours');
  });

  it('takes a ts.net address for a tailnet when no path was named', async () => {
    const tailscale = 'https://onyourleft.tail1a2b.ts.net';
    const at = await world({ origin: tailscale });
    const named = await (await signedIn(at)).get('/setup/claim');
    expect(named.body).toContain(`<code>${tailscale}</code>`);
    expect(named.body).toContain(`<code>${tailscale}/health</code>`);
    expect(named.body).toContain(CLAIM_REACH_TEXT.tailnet);
  });

  it('says a domain with no path named is reached over the internet, with no Tailscale on the page', async () => {
    const at = await world();
    const browser = await signedIn(at);
    const internet = await browser.get('/setup/claim');
    expect(internet.body).toContain(`<code>${TEST_ORIGIN}</code>`);
    expect(internet.body).toContain(CLAIM_REACH_TEXT.internet);
    expect(internet.body).not.toContain('Tailscale');
    await walkToInvite(at, browser);
    const offer = await browser.get('/setup/invite');
    expect(offer.body).toContain(INVITE_REACH_TEXT.internet);
    expect(offer.body).not.toContain('Tailscale');
  });

  it('says what this computer could check of a tunnel, as the tunnel answers it on each load', async () => {
    const state = { connections: 2, asked: 0 };
    const at = await world({
      remotePath: 'cloudflare',
      tunnelReadyUrl: await tunnelStandIn(state),
    });
    const browser = await signedIn(at);
    const connected = await browser.get('/setup/claim');
    expect(connected.body).toContain(CLAIM_REACH_TEXT.internet);
    expect(connected.body).toContain(REACH_CHECKED_TEXT.connected);
    expect(connected.body).not.toContain(REACH_CHECKED_TEXT['not-connected']);
    expect(state.asked).toBe(1);
    // The tunnel drops: the next load of the step says so, before any code is shown.
    state.connections = 0;
    const dropped = await browser.get('/setup/claim');
    expect(beforeTheButton(dropped.body, 'Show the claim code')).toContain(
      REACH_CHECKED_TEXT['not-connected'],
    );
    expect(dropped.body).not.toContain(REACH_CHECKED_TEXT.connected);
    expect(state.asked).toBe(2);
  });

  it('asks no tunnel on a tailnet, even with its address left in .env, and claims no check', async () => {
    const state = { connections: 2, asked: 0 };
    const at = await world({ remotePath: 'tailnet', tunnelReadyUrl: await tunnelStandIn(state) });
    const unasked = await (await signedIn(at)).get('/setup/claim');
    expect(unasked.body).toContain(CLAIM_REACH_TEXT.tailnet);
    expect(unasked.body).not.toContain('Checked from this computer');
    expect(state.asked).toBe(0);
  });

  it('claims no check of a tunnel it was given nowhere to ask, rather than guess', async () => {
    const at = await world({ remotePath: 'cloudflare' });
    const unknown = await (await signedIn(at)).get('/setup/claim');
    expect(unknown.body).toContain(CLAIM_REACH_TEXT.internet);
    expect(unknown.body).not.toContain('Checked from this computer');
  });
});
