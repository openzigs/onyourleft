// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A browser's signature, verified by the Node instance — #772's
 * cross-platform criterion (ADR 0014 D-8). Read `identity-harness.ts` first.
 *
 * The instance runs in THIS process: the real handler behind the real Node
 * listener, the real identity routes and a real SQLite file, from
 * `apps/instance`'s own test support. It is imported by a computed path
 * because `apps/instance` is written for Node's type stripping (`.ts`
 * specifiers) and `apps/web`'s typecheck does not follow those; the shape it
 * is used through is written down here.
 */

import { expect, test, type Page } from '@playwright/test';

import type { IdentityHarness, WriteUpState } from './identity-harness';

interface IdentityInstance {
  readonly url: string;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; plain?: boolean },
  ): Promise<{ status: number; body: unknown }>;
  freshRead<T>(
    read: (store: {
      listDeviceKeys(athleteId: string): Promise<readonly { publicKey: string }[]>;
    }) => Promise<T>,
  ): Promise<T>;
  /** The instance's keys (#1189): its card. */
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

/** What the write-up case reads of the instance's store (#1227). */
interface AnalysisStoreReads {
  getAnalysisJob(athleteId: string, jobId: string): Promise<{ status: string } | undefined>;
  listAnalysisEvents(
    athleteId: string,
    jobId: string,
    after: number,
    limit: number,
  ): Promise<readonly unknown[]>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    originIsTheListener?: boolean;
    config?: { name?: string };
    startsAt?: number;
    analysis?: { engine: unknown; available: () => boolean; heartbeatMs?: number };
  }): Promise<IdentityInstance>;
}

/** `apps/instance` §`analysis/fake-model-server-testing.ts` (#1096), as far as it is used here. */
interface FakeModelTesting {
  startFakeModelServer(
    script: readonly {
      kind: 'slow';
      milliseconds: number;
      then: { kind: 'text'; text: string };
    }[],
  ): Promise<{ readonly baseUrl: URL; readonly paths: string[]; close(): Promise<void> }>;
}

/** `apps/instance` §`analysis/engine.ts`, as far as it is used here. */
interface EngineModule {
  readonly agentEngine: (options: {
    reads: { listLiveSyncItems(): Promise<readonly unknown[]> };
    sources: { local: unknown; hostedKey: () => Promise<{ kind: 'none' }> };
    clock: { now(): number };
  }) => unknown;
}

/** `apps/instance` §`analysis/model.ts`, as far as it is used here. */
interface ModelModule {
  readonly createLocalModel: (options: {
    settings: { kind: 'on'; baseUrl: URL; model: string };
    resolve: (hostname: string) => Promise<readonly string[]>;
  }) => unknown;
}

const INSTANCE_TESTING = new URL('../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const FAKE_MODEL = new URL(
  '../../instance/src/analysis/fake-model-server-testing.ts',
  import.meta.url,
).href;
const ENGINE = new URL('../../instance/src/analysis/engine.ts', import.meta.url).href;
const MODEL = new URL('../../instance/src/analysis/model.ts', import.meta.url).href;

let testing: IdentityTesting;
let world: IdentityInstance;

test.beforeAll(async () => {
  testing = (await import(INSTANCE_TESTING)) as IdentityTesting;
});

test.beforeEach(async () => {
  world = await testing.startIdentityInstance();
});

test.afterEach(async () => {
  await world.close();
});

async function openHarness(page: Page): Promise<void> {
  // Plaintext, as the page sent it: the challenge, and a known key's sign-in.
  await page.exposeFunction('oylInstancePost', (path: string, body: Record<string, unknown>) =>
    world.call('POST', path, { body, plain: true }),
  );
  // A raw request — the sealed one the page made (#1192) — to the same instance.
  await page.exposeFunction(
    'oylInstanceFetch',
    async (
      path: string,
      init: { method: string; headers: Record<string, string>; body: string | null },
    ) => {
      const response = await fetch(`${world.url}${path}`, {
        method: init.method,
        headers: init.headers,
        ...(init.body === null ? {} : { body: init.body }),
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text: await response.text(),
      };
    },
  );
  const response = await page.goto('/identity.html');
  expect(
    response?.status(),
    'identity.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylIdentity !== undefined);
}

function signIn(page: Page, origin: string, flipSignature = false, database = 'identity-gate') {
  return page.evaluate(
    ([o, d, i, f]) =>
      (window.__oylIdentity as IdentityHarness).signIn(o as string, d as string, {
        instanceOrigin: i as string,
        flipSignature: f === 'flip',
      }),
    [origin, database, testing.TEST_ORIGIN, flipSignature ? 'flip' : 'keep'],
  );
}

test.describe('the device key, from the browser to the Node instance (#772)', () => {
  test('a statement the browser signed registers an athlete, and the same stored key signs in again', async ({
    page,
  }) => {
    await openHarness(page);
    const first = await signIn(page, testing.TEST_ORIGIN);
    expect(first.registered).toBe(true);
    expect(first.recoveryCodes).toHaveLength(10);

    const second = await signIn(page, testing.TEST_ORIGIN);
    expect(second.registered).toBe(false);
    expect(second.instanceAthleteId).toBe(first.instanceAthleteId);

    const keys = await world.freshRead((store) => store.listDeviceKeys(first.instanceAthleteId));
    expect(keys).toHaveLength(1);
    // The browser kept the instance's athlete id on the device.
    const kept = await page.evaluate(() => localStorage.getItem('oyl.instance.account.v1'));
    expect(kept).toContain(first.instanceAthleteId);
  });

  test('the control: one flipped signature byte in transit is refused by the instance', async ({
    page,
  }) => {
    // Flipped in the page, before it is sealed: nothing on the way can read it (#1192).
    await openHarness(page);
    await expect(signIn(page, testing.TEST_ORIGIN, true)).rejects.toThrow(/bad_signature/);
  });

  test('the control: a browser signing for another instance is refused', async ({ page }) => {
    await openHarness(page);
    await expect(signIn(page, 'https://other.example')).rejects.toThrow(/wrong_instance/);
  });
});

test.describe('the production transport, from the browser to the Node instance (#777)', () => {
  test('connects cross-origin with the real fetch, and a reload reads the names back from the instance', async ({
    page,
  }) => {
    // Its own instance, at the address the page really reaches — another
    // origin than the page's, so the instance's CORS answers are in the path.
    const own = await testing.startIdentityInstance({
      originIsTheListener: true,
      config: { name: 'Lanes of the Weald' },
      // The page judges the instance's key statements by its own clock (#1190, #1192).
      startsAt: Date.now(),
    });
    try {
      await openHarness(page);
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.url().startsWith(own.url))
          requests.push(`${request.method()} ${request.url()}`);
      });
      // The instance's card, as its operator hands it over (#1190, #1192).
      const card = (await own.instanceKeys.show()).card;
      const result = await page.evaluate(
        ([address, given]) =>
          (window.__oylIdentity as IdentityHarness).connect(
            address as string,
            'instance-gate',
            given as string,
          ),
        [own.url, card],
      );
      expect(result.connected).toMatchObject({ kind: 'connected' });
      expect(result.current).toMatchObject({
        kind: 'connected',
        origin: own.url,
        instanceName: 'Lanes of the Weald',
        displayName: 'Anna',
      });
      expect(result.devices).toMatchObject({ kind: 'listed' });
      // The requests went from the page to the instance, preflights included.
      // Registered SEALED (#1192): the session request went inside `/v1/sealed`.
      expect(requests.some((line) => line.startsWith('POST') && line.endsWith('/v1/sealed'))).toBe(
        true,
      );
      expect(
        requests.some((line) => line.startsWith('POST') && line.endsWith('/v1/auth/session')),
      ).toBe(false);

      const reloaded = await page.evaluate(() =>
        (window.__oylIdentity as IdentityHarness).reload('instance-gate'),
      );
      expect(reloaded).toMatchObject({
        kind: 'connected',
        instanceName: 'Lanes of the Weald',
        displayName: 'Anna',
      });
    } finally {
      await own.close();
    }
  });
});

/**
 * #1102's browser-gate criterion (#1227): the instance write-up from the real
 * page against a REAL instance — the real handler, job engine and
 * tool-calling agent, over `apps/instance`'s fake model server (#1096) — with
 * the page reaching the instance's own listener on loopback through the real
 * `fetch`, every job call sealed (#1192), and the card pinned by the
 * production port's own connect.
 *
 * The model answers SLOWLY ({@link MODEL_THINKS_MS}), so the page is part-way
 * through a stream — it holds the job's first progress event and nothing
 * more — when the network goes, or when the stream falls silent.
 */
test.describe('the instance write-up, from the browser to the Node instance (#1227)', () => {
  const PASSING_WRITE_UP = [
    'A steady ride of an hour, with the effort held well throughout.',
    'The flat start was easy, and the climb took the most effort, at a 5.2% gradient.',
    'The descent was a recovery, with power well below the ride’s average.',
  ].join('\n\n');
  /** How long the fake model takes to answer: the job's stream is open and quiet all that time. */
  const MODEL_THINKS_MS = 8_000;
  /**
   * The control's idle cut, in place of the shipped 75 s
   * (`instance-transport.ts` §`SEALED_STREAM_IDLE_MILLISECONDS`): well under
   * the model's answer, so a stream with no heartbeat must be cut.
   */
  const IDLE_CUT_MS = 2_000;

  let analysing: IdentityInstance | undefined;
  let model: Awaited<ReturnType<FakeModelTesting['startFakeModelServer']>> | undefined;

  test.afterEach(async () => {
    await analysing?.close();
    analysing = undefined;
    await model?.close();
    model = undefined;
  });

  /** A real instance whose jobs run the agent over the fake model, with this heartbeat. */
  async function analysingInstance(heartbeatMs: number): Promise<IdentityInstance> {
    const fake = (await import(FAKE_MODEL)) as FakeModelTesting;
    const { agentEngine } = (await import(ENGINE)) as EngineModule;
    const { createLocalModel } = (await import(MODEL)) as ModelModule;
    model = await fake.startFakeModelServer([
      {
        kind: 'slow',
        milliseconds: MODEL_THINKS_MS,
        then: { kind: 'text', text: PASSING_WRITE_UP },
      },
    ]);
    const local = createLocalModel({
      settings: { kind: 'on', baseUrl: model.baseUrl, model: 'scripted' },
      resolve: () => Promise.resolve(['127.0.0.1']),
    });
    analysing = await testing.startIdentityInstance({
      originIsTheListener: true,
      // The page judges the instance's key statements by its own clock (#1190, #1192).
      startsAt: Date.now(),
      analysis: {
        engine: agentEngine({
          reads: { listLiveSyncItems: () => Promise.resolve([]) },
          sources: { local, hostedKey: () => Promise.resolve({ kind: 'none' }) },
          clock: { now: () => Date.now() },
        }),
        available: () => true,
        heartbeatMs,
      },
    });
    return analysing;
  }

  /** Connect the page to `instance` with its card, as the Connect screen does; its athlete id. */
  async function connected(page: Page, instance: IdentityInstance): Promise<string> {
    await openHarness(page);
    const card = (await instance.instanceKeys.show()).card;
    const result = await page.evaluate(
      ([address, given]) =>
        (window.__oylIdentity as IdentityHarness).connect(
          address as string,
          'write-up-gate',
          given as string,
        ),
      [instance.url, card],
    );
    expect(result.connected).toMatchObject({ kind: 'connected' });
    const account = await page.evaluate(() => localStorage.getItem('oyl.instance.account.v1'));
    const athleteId = (JSON.parse(account ?? '{}') as { instanceAthleteId?: unknown })
      .instanceAthleteId;
    expect(typeof athleteId, 'the account the page kept').toBe('string');
    return athleteId as string;
  }

  /** Close every connection the instance's listener holds: the open stream among them. */
  function dropOpenConnections(instance: IdentityInstance): void {
    (
      instance as unknown as {
        instance: { listening: { server: { closeAllConnections(): void } } };
      }
    ).instance.listening.server.closeAllConnections();
  }

  const state = (page: Page): Promise<WriteUpState> =>
    page.evaluate(() => (window.__oylIdentity as IdentityHarness).writeUpState());

  /** Press for a write-up, and wait until the job's first step has arrived and nothing more. */
  async function partWay(page: Page, idleMilliseconds?: number): Promise<string> {
    await page.evaluate(
      (idle) =>
        (window.__oylIdentity as IdentityHarness).startWriteUp(
          'write-up-gate',
          idle === null ? {} : { idleMilliseconds: idle },
        ),
      idleMilliseconds ?? null,
    );
    await expect
      .poll(async () => (await state(page)).views.some((view) => view.step === 1))
      .toBe(true);
    expect((await state(page)).views.some((view) => view.sections.length > 0)).toBe(false);
    // The job the page noted while it waits (`PENDING_JOBS_STORAGE_KEY`): ids only.
    const note = await page.evaluate(() => localStorage.getItem('oyl.analysis.pending-jobs.v1'));
    const jobs = Object.values(JSON.parse(note ?? '{}') as Record<string, { jobId: string }>);
    expect(jobs, 'the job the page is following').toHaveLength(1);
    return jobs[0]?.jobId ?? '';
  }

  /** Written, read back fresh, every section shown once, and the job acknowledged on the instance. */
  async function savedAndAcknowledged(
    page: Page,
    instance: IdentityInstance,
    athleteId: string,
    jobId: string,
  ): Promise<WriteUpState> {
    await expect
      .poll(async () => (await state(page)).outcome, { timeout: 60_000 })
      .toEqual({ kind: 'written' });
    const ended = await state(page);
    expect(ended.saved).toEqual({ text: PASSING_WRITE_UP, source: 'instance-local' });
    // The page was handed the sections as they came, each once, before it saved.
    const shown = ended.views.filter((view) => view.phase === 'streaming').at(-1)?.sections;
    expect(shown).toHaveLength(3);
    expect(new Set(shown).size).toBe(3);
    // Acknowledged (ADR 0046 D-12): the job ended, and its events are gone.
    const reads = (store: unknown) => store as AnalysisStoreReads;
    expect(
      (await instance.freshRead((store) => reads(store).getAnalysisJob(athleteId, jobId)))?.status,
    ).toBe('succeeded');
    await expect
      .poll(() =>
        instance.freshRead((store) => reads(store).listAnalysisEvents(athleteId, jobId, 0, 100)),
      )
      .toEqual([]);
    // One model call: every resume followed the SAME job, and none started another.
    expect(model?.paths).toStrictEqual(['/v1/chat/completions']);
    return ended;
  }

  test('streams a job from the real page, resumes after the network goes and comes back, saves and acknowledges', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    // A heartbeat every second: a quiet stream is never cut for being quiet.
    const instance = await analysingInstance(1_000);
    const athleteId = await connected(page, instance);
    const jobId = await partWay(page);

    await context.setOffline(true);
    // ⚠️ Chromium's offline emulation fails every NEW request and leaves a
    // connection already open alone — measured: without the next line the
    // stream carried on to the result with the network "off". A network that
    // goes takes its open connections with it, so the instance's are closed.
    dropOpenConnections(instance);
    // Dropped, and at least one try has failed with the network still off.
    await expect
      .poll(
        async () =>
          (await state(page)).views.filter((view) => view.phase === 'reconnecting').length,
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);
    expect((await state(page)).views.some((view) => view.sections.length > 0)).toBe(false);
    await context.setOffline(false);

    const ended = await savedAndAcknowledged(page, instance, athleteId, jobId);
    const phases = ended.views.map((view) => view.phase);
    expect(phases.indexOf('reconnecting')).toBeLessThan(phases.lastIndexOf('streaming'));
  });

  test('the control: with no heartbeat, the idle cut drops the quiet stream, and the page resumes it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // No heartbeat, and an idle cut well under the model's answer.
    const instance = await analysingInstance(0);
    const athleteId = await connected(page, instance);
    const jobId = await partWay(page, IDLE_CUT_MS);
    // Silent past the cut: dropped, and the page says it is reconnecting.
    await expect
      .poll(async () => (await state(page)).views.some((view) => view.phase === 'reconnecting'), {
        timeout: 30_000,
      })
      .toBe(true);
    await savedAndAcknowledged(page, instance, athleteId, jobId);
  });
});
