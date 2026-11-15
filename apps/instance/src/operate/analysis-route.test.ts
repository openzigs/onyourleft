// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET`, `POST` and `DELETE /v1/operate/analysis` (#2609), called through the
 * real listener, sealed, as every caller who might try them. What they write
 * is read back through the store on another connection and through the
 * operator log's own route, never through the answer alone. That the next
 * JOB uses what is saved is `analysis/settings-instance.test.ts`'s.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { runCommand } from '../operator/run.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { AnalysisSettingRecord, OperatorLogEntry } from '../store/sql-store.ts';

const ANALYSIS = '/v1/operate/analysis';

/** Where each name the tests save resolves to: one private, one public. */
const ADDRESSES: Readonly<Record<string, readonly string[]>> = {
  'models-box': ['10.77.0.5'],
  'leaky-box': ['10.77.0.6', '8.8.8.8'],
};

const resolve = (name: string): Promise<readonly string[]> => {
  const found = ADDRESSES[name];
  return found === undefined ? Promise.reject(new Error('no such name')) : Promise.resolve(found);
};

interface AnalysisBody {
  readonly local: {
    readonly url: string | null;
    readonly model: string | null;
    readonly reasoningTokens: number | null;
    readonly offered: boolean;
    readonly othersMayUse: boolean;
    readonly setIn: string;
    readonly state: string;
  };
  readonly hosted: {
    readonly offered: boolean;
    readonly operatorKey: string;
    readonly operatorKeyOrigin: string | null;
  };
}

const settingsRow = (world: ModerationWorld): Promise<AnalysisSettingRecord | undefined> =>
  world.freshRead((store) => store.getAnalysisSetting());

const wholeLog = (world: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  world.freshRead((store) => store.listOperatorLogPage(undefined, 200));

/** The operator's CLI, in this process, against the world's own database file. */
async function cli(
  world: ModerationWorld,
  argv: readonly string[],
  extra: { secret?: string; ownerKey?: string; input?: string } = {},
): Promise<number> {
  const report = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const refusal = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    return await runCommand(argv, {
      database: world.path,
      blobs: `${world.path}.blobs`,
      secret: extra.secret,
      ownerKey: extra.ownerKey,
      readStandardInput: () => Promise.resolve(extra.input ?? ''),
    });
  } finally {
    report.mockRestore();
    refusal.mockRestore();
  }
}

describe('/v1/operate/analysis — the owner’s, and nobody else’s (#2609)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({ resolve });
  });
  afterAll(() => world.close());

  it('answers the deputy and a rider exactly as no route, for each method, and writes nothing', async () => {
    const rider = await world.rider('Rider');
    const nowhere = await world.as(rider, 'GET', '/v1/no-such-route');
    expect(nowhere.status).toBe(404);
    const before = await wholeLog(world);
    for (const caller of [world.deputy, rider]) {
      for (const [method, body] of [
        ['GET', undefined],
        ['POST', { othersLocal: true, offerHosted: false }],
        ['DELETE', undefined],
      ] as const) {
        const answer = await world.as(caller, method, ANALYSIS, body);
        expect(answer, `${method} as ${caller === rider ? 'a rider' : 'the deputy'}`).toEqual(
          nowhere,
        );
        expect(codeOf(answer.body)).toBe('not_found');
      }
    }
    // Read back through the store: no row, and no entry.
    expect(await settingsRow(world)).toBeUndefined();
    expect(await wholeLog(world)).toEqual(before);
  });

  it('reads .env’s settings for the owner when no row is written: both sources offered, the switch off', async () => {
    const read = await world.as(world.owner, 'GET', ANALYSIS);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      local: {
        url: null,
        model: null,
        reasoningTokens: null,
        offered: true,
        othersMayUse: false,
        setIn: 'none',
        state: 'not-set',
      },
      hosted: { offered: true, operatorKey: 'none', operatorKeyOrigin: null },
    } satisfies AnalysisBody);
  });
});

describe('what POST /v1/operate/analysis saves is what is read back, and logged (#2609)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({ resolve });
  });
  afterAll(() => world.close());

  it('saves the model, the sources and the switch; reads them back through the store and the route; and logs which fields changed', async () => {
    const saved = await world.as(world.owner, 'POST', ANALYSIS, {
      localUrl: 'http://models-box:11434/v1',
      localModel: 'some-model:7b',
      reasoningTokens: 2048,
      othersLocal: true,
      offerHosted: false,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const expected: AnalysisBody = {
      local: {
        url: 'http://models-box:11434/v1',
        model: 'some-model:7b',
        reasoningTokens: 2048,
        offered: true,
        othersMayUse: true,
        setIn: 'app',
        state: 'on',
      },
      hosted: { offered: false, operatorKey: 'none', operatorKeyOrigin: null },
    };
    expect(saved.body).toEqual(expected);
    expect(await world.as(world.owner, 'GET', ANALYSIS)).toEqual({ status: 200, body: expected });
    expect(await settingsRow(world)).toMatchObject({
      localUrl: 'http://models-box:11434/v1',
      localModel: 'some-model:7b',
      reasoningTokens: 2048,
      offerLocal: null,
      offerHosted: false,
      othersLocal: true,
      updatedBy: 'app',
    });

    // A field left out is unchanged; null returns one field to its fallback.
    const again = await world.as(world.owner, 'POST', ANALYSIS, { offerHosted: null });
    expect((again.body as AnalysisBody).hosted.offered).toBe(true);
    expect((again.body as AnalysisBody).local.model).toBe('some-model:7b');

    const log = await world.as(world.owner, 'GET', '/v1/operate/log');
    expect(log.status).toBe(200);
    const entries = (log.body as { entries: Record<string, unknown>[] }).entries;
    expect(entries.slice(0, 2).map((entry) => [entry.action, entry.detail, entry.outcome])).toEqual(
      [
        ['analysis_settings_set', 'offer_hosted', 'done'],
        [
          'analysis_settings_set',
          'local_url,local_model,reasoning_tokens,offer_hosted,others_local',
          'done',
        ],
      ],
    );
    expect((await wholeLog(world))[0]?.actorAthleteId).toBe(world.owner.athleteId);
  });

  it('clears every field with DELETE, back to .env, and logs it', async () => {
    const cleared = await world.as(world.owner, 'DELETE', ANALYSIS);
    expect(cleared.status).toBe(200);
    expect((cleared.body as AnalysisBody).local).toMatchObject({
      setIn: 'none',
      othersMayUse: false,
      offered: true,
    });
    expect(await settingsRow(world)).toBeUndefined();
    const again = await world.as(world.owner, 'DELETE', ANALYSIS);
    expect(again.status).toBe(200);
    expect(
      (await wholeLog(world)).slice(0, 2).map((entry) => [entry.action, entry.detail]),
    ).toEqual([
      ['analysis_settings_cleared', 'none_set'],
      ['analysis_settings_cleared', 'cleared'],
    ]);
  });

  it('writes and logs the CLI’s clear and switch as the CLI’s', async () => {
    expect(await cli(world, ['analysis-settings', 'others', 'on'])).toBe(0);
    expect((await settingsRow(world))?.othersLocal).toBe(true);
    expect(
      ((await world.as(world.owner, 'GET', ANALYSIS)).body as AnalysisBody).local.othersMayUse,
    ).toBe(true);
    expect(await cli(world, ['analysis-settings', 'clear'])).toBe(0);
    expect(await settingsRow(world)).toBeUndefined();
    expect(await cli(world, ['analysis-settings', 'others', 'maybe'])).not.toBe(0);
    expect(
      (await wholeLog(world))
        .slice(0, 2)
        .map((entry) => [entry.source, entry.actorAthleteId, entry.action, entry.detail]),
    ).toEqual([
      ['cli', null, 'analysis_settings_cleared', 'cleared'],
      ['cli', null, 'analysis_settings_set', 'others_local'],
    ]);
  });
});

describe('a setting that fails the address rule is refused when saved, and nothing is written (#2609, ADR 0040 D-6)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({ resolve });
  });
  afterAll(() => world.close());

  it.each([
    ['a public host name', 'http://models.example.com/v1', 'not-local'],
    ['a .local name', 'http://box.local:11434/v1', 'not-local'],
    ['https: by a name', 'https://models-box:11434/v1', 'tls-by-name'],
    ['a name that resolves to a public address too', 'http://leaky-box:11434/v1', 'not-local'],
    ['a name that does not resolve', 'http://nowhere-box:11434/v1', 'unresolved'],
    ['a public address', 'http://8.8.8.8/v1', 'not-local'],
    ['not a URL', 'models-box', 'not-a-url'],
    ['a URL with a query', 'http://models-box:11434/v1?key=1', 'not-base-url'],
  ])('refuses %s with its code, naming the field and not the value', async (_name, url, code) => {
    const before = await wholeLog(world);
    const answer = await world.as(world.owner, 'POST', ANALYSIS, {
      localUrl: url,
      localModel: 'some-model',
      othersLocal: true,
    });
    expect(answer.status).toBe(400);
    expect(codeOf(answer.body)).toBe('validation_failed');
    expect((answer.body as { error: { fields: unknown } }).error.fields).toEqual([
      { field: 'localUrl', problem: code },
    ]);
    expect(JSON.stringify(answer.body)).not.toContain(url);
    // Read back: no row, not even the fields that passed.
    expect(await settingsRow(world)).toBeUndefined();
    const after = await wholeLog(world);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({
      action: 'analysis_settings_set',
      detail: 'local_url',
      outcome: 'refused',
    });
  });

  it('refuses a bad model name, bad reasoning tokens, a flag that is not one and a field it does not know', async () => {
    const answer = await world.as(world.owner, 'POST', ANALYSIS, {
      localModel: 'two words',
      reasoningTokens: 0,
      offerLocal: 'yes',
    });
    expect(answer.status).toBe(400);
    expect((answer.body as { error: { fields: unknown } }).error.fields).toEqual([
      { field: 'localModel', problem: 'bad-model' },
      { field: 'reasoningTokens', problem: 'bad-reasoning' },
      { field: 'offerLocal', problem: 'must-be-boolean-or-null' },
    ]);
    expect(await settingsRow(world)).toBeUndefined();
  });
});

describe('a save and its operator log entry are one transaction (#2609, #2602)', () => {
  it('applies nothing when the entry cannot be written', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      const database = openDatabase(world.path);
      try {
        database.exec(`create trigger operator_log_refused before insert on operator_log
          begin select raise(abort, 'the operator log is full'); end`);
      } finally {
        database.close();
      }
      const answer = await world.as(world.owner, 'POST', ANALYSIS, { othersLocal: true });
      expect(answer.status).toBe(500);
      expect(await settingsRow(world)).toBeUndefined();
      const cleared = await world.as(world.owner, 'DELETE', ANALYSIS);
      expect(cleared.status).toBe(500);
    } finally {
      await world.close();
    }
  });
});

describe('/v1/operate/analysis carries no secret the instance holds (#2609)', () => {
  it('returns none of the secret key, the operator’s hosted key, a rider’s hosted key, a session token or a resolved address', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      const secret = btoa(String.fromCharCode(...secretBytes(7)));
      const operatorKey = 'sk-MARKER-operator-hosted-key-2609';
      const riderKey = 'sk-MARKER-rider-hosted-key-2609';
      expect(
        await cli(
          world,
          ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
          { secret, ownerKey: world.owner.device.publicKey, input: operatorKey },
        ),
      ).toBe(0);
      const rider = await world.rider('Rider');
      const stored = await world.as(rider, 'POST', '/v1/analysis/hosted/key', {
        url: 'https://other.example/v1',
        model: 'm',
        key: riderKey,
      });
      expect(stored.status).toBe(200);

      const answers = [
        await world.as(world.owner, 'POST', ANALYSIS, {
          localUrl: 'http://models-box:11434/v1',
          localModel: 'm',
        }),
        await world.as(world.owner, 'GET', ANALYSIS),
        await world.as(world.owner, 'DELETE', ANALYSIS),
      ];
      // The operator's key was read, so its marker was in reach.
      expect((answers[1]?.body as AnalysisBody).hosted).toEqual({
        offered: true,
        operatorKey: 'held',
        operatorKeyOrigin: 'https://models.example',
      });
      for (const answer of answers) {
        expect(answer.status).toBe(200);
        const body = JSON.stringify(answer.body);
        for (const marker of [
          secret,
          operatorKey,
          riderKey,
          world.owner.token,
          rider.token,
          world.owner.device.publicKey,
          '10.77.0.5',
        ]) {
          expect(body).not.toContain(marker);
        }
      }
    } finally {
      await world.close();
    }
  });
});
