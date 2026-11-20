// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The operator's analysis settings** — #2609, ADR 0046's amendment of
 * 2026-11-14. One database row (migration 0043) that overrides `.env`, set
 * from the app's Operate area or the operator's CLI, and read for EVERY job,
 * so a change applies to the next job with no restart.
 *
 * ## What the row decides, field by field (the amendment's points 1 and 2)
 *
 * - **The local model**: its base URL, its name and its reasoning tokens. A
 *   field the row leaves `NULL` is the `.env` line's
 *   (`OYL_INSTANCE_ANALYSIS_MODEL_URL`, `OYL_INSTANCE_ANALYSIS_MODEL`,
 *   `OYL_INSTANCE_ANALYSIS_MODEL_REASONING_TOKENS`), and the three are then read
 *   by `config.ts` §`readAnalysisModelSettings` — the ONE parser, so a row
 *   refuses exactly what `.env` refuses, with the same code. With no row, the
 *   local model is `.env`'s exactly as before ({@link effectiveAnalysisSettings}).
 * - **Which sources the instance offers riders** (point 5): each on unless the
 *   row says off. With hosted off, every hosted job and test question is
 *   refused `hosted_unavailable` — at the start before its consent is read, and
 *   at the run before any consent or key is read; with local
 *   off, every local job is refused `local_unavailable`. Nothing is deleted.
 * - **The switch for other riders** (point 6): off unless the row says on, on
 *   an existing instance as on a new one. It covers the LOCAL model only:
 *   while it is off, a job on the local model by anybody but the operator (the
 *   athlete of `OYL_INSTANCE_OWNER_KEY`, Q9) is refused `local_unavailable`
 *   before a model is called. A hosted job on a rider's own key, under their
 *   own consent, is not the switch's to refuse.
 *
 * ## What a save checks (point 4)
 *
 * Every field before anything is written: the address by ADR 0040 D-6's rule
 * as `.env`'s is (`not-a-url`, `not-base-url`, `not-local`, `tls-by-name`)
 * AND, for a name, where it resolves to now (`history/address.ts`
 * §`localAddressesOnly`: `not-local`, `unresolved`); the model's name
 * (`bad-model`); the reasoning tokens (`bad-reasoning`). A field that fails is
 * a `validation_failed` naming the field, with the code as its problem —
 * never the value. And the address is checked again on every request, the
 * resolution included (`model.ts` §`createLocalModel`), so a name that
 * resolved private when it was saved and public later is refused then.
 *
 * Every write is an entry in the operator log, in the same transaction
 * (`SqlStore.recordOperatorAction`), naming WHICH fields changed and never a
 * value. No model or vendor is named here (ADR 0031 D-4).
 */

import {
  analysisModelNameProblem,
  analysisModelUrlProblem,
  localModelServer,
  readAnalysisModelSettings,
  type AnalysisModelOffCode,
  type AnalysisModelSettings,
  type Config,
} from '../config.ts';
import type { FieldProblem } from '../errors.ts';
import { localAddressesOnly, type Resolver } from '../history/address.ts';
import {
  ANALYSIS_SETTING_FIELD_WORDS,
  type AdminSource,
  type AnalysisSettingRecord,
  type OperatorActor,
  type SqlStore,
} from '../store/sql-store.ts';
import { isReasoningTokens } from './model-turn.ts';

/** What the analysis model is configured from: `.env`, as the instance read it. */
export type AnalysisEnvironment = Pick<Config, 'analysis' | 'analysisEnv'>;

/** The settings a job runs under: the row over `.env`, field by field. */
export interface EffectiveAnalysisSettings {
  /** The local model, or why there is none. */
  readonly local: AnalysisModelSettings;
  /** Where the local model's settings come from: the row, `.env`, or nowhere. */
  readonly setIn: 'app' | 'env' | 'none';
  readonly offerLocal: boolean;
  readonly offerHosted: boolean;
  /** Whether riders other than the operator may use the local model. */
  readonly othersLocal: boolean;
}

/** Whether the row sets any of the local model's three fields. */
function setsTheLocalModel(row: AnalysisSettingRecord | undefined): boolean {
  return (
    row !== undefined &&
    (row.localUrl !== null || row.localModel !== null || row.reasoningTokens !== null)
  );
}

/**
 * The local model the row and `.env` give together, each field from the row
 * where it sets one and from `.env` where it does not — read by `.env`'s own
 * parser. With no row this is `readAnalysisModelSettings(env)` exactly.
 */
export function resolveLocalModel(
  row: AnalysisSettingRecord | undefined,
  env: Config['analysisEnv'],
): AnalysisModelSettings {
  return readAnalysisModelSettings({
    analysisModelUrl: row?.localUrl ?? env.analysisModelUrl,
    analysisModel: row?.localModel ?? env.analysisModel,
    analysisModelReasoningTokens:
      row?.reasoningTokens === null || row?.reasoningTokens === undefined
        ? env.analysisModelReasoningTokens
        : String(row.reasoningTokens),
    // `.env` only (#2840): the context is the model server's, which the app does not set.
    analysisModelContextTokens: env.analysisModelContextTokens,
  });
}

/**
 * The local SERVER the row and `.env` name, whatever model is named or not
 * (#2610): the row's address over `.env`'s, held to `.env`'s rule, and the
 * reasoning tokens the same way — or the code the address is refused with.
 * What the Operate area lists the server's models from and checks one on,
 * before the owner has picked a model to save.
 */
export function localServerOf(
  row: AnalysisSettingRecord | undefined,
  env: Config['analysisEnv'],
):
  | { readonly ok: true; readonly baseUrl: URL; readonly reasoningTokens?: number }
  | { readonly ok: false; readonly code: AnalysisModelOffCode } {
  const server = localModelServer({ analysisModelUrl: row?.localUrl ?? env.analysisModelUrl });
  if (!('baseUrl' in server)) return { ok: false, code: server.code };
  const envTokens = Number(env.analysisModelReasoningTokens?.trim() ?? '');
  const tokens = row?.reasoningTokens ?? (isReasoningTokens(envTokens) ? envTokens : undefined);
  return {
    ok: true,
    baseUrl: server.baseUrl,
    ...(tokens === undefined ? {} : { reasoningTokens: tokens }),
  };
}

/**
 * The settings now: `.env`'s local model as the instance read it at start when
 * the row sets none of its fields, the row over `.env` when it does; each
 * source offered unless the row says not; the switch off unless it says on.
 */
export function effectiveAnalysisSettings(
  row: AnalysisSettingRecord | undefined,
  environment: AnalysisEnvironment,
): EffectiveAnalysisSettings {
  const fromRow = setsTheLocalModel(row);
  const local = fromRow ? resolveLocalModel(row, environment.analysisEnv) : environment.analysis;
  const fromEnv = environment.analysis.kind === 'on' || environment.analysis.code !== 'not-set';
  return {
    local,
    setIn: fromRow ? 'app' : fromEnv ? 'env' : 'none',
    offerLocal: row?.offerLocal ?? true,
    offerHosted: row?.offerHosted ?? true,
    othersLocal: row?.othersLocal ?? false,
  };
}

/** The request's fields, each with the word the operator log names it by. */
const FIELDS = {
  localUrl: 'local_url',
  localModel: 'local_model',
  reasoningTokens: 'reasoning_tokens',
  offerLocal: 'offer_local',
  offerHosted: 'offer_hosted',
  othersLocal: 'others_local',
} as const satisfies Record<string, (typeof ANALYSIS_SETTING_FIELD_WORDS)[number]>;

type Field = keyof typeof FIELDS;

/** The row's settings alone: what a request may change. */
export type AnalysisSettingValues = Omit<AnalysisSettingRecord, 'updatedAt' | 'updatedBy'>;

const NOTHING_SET: AnalysisSettingValues = {
  localUrl: null,
  localModel: null,
  reasoningTokens: null,
  offerLocal: null,
  offerHosted: null,
  othersLocal: null,
};

/** Why a save was refused: a problem per field, each naming a code and never the value. */
export type SaveProblem = AnalysisModelOffCode | 'unresolved' | 'must-be-boolean-or-null';

/**
 * The fields of `body` the row would hold, every one checked — or the
 * problems, naming each field and its code and never a value. A field absent
 * from the body is unchanged; `null` returns it to its fallback.
 */
export async function checkedSettings(
  body: Readonly<Record<string, unknown>>,
  resolve: Resolver,
  lookupWaitMs: number = SAVE_LOOKUP_WAIT_MS,
): Promise<
  | { readonly ok: true; readonly values: Partial<AnalysisSettingValues> }
  | { readonly ok: false; readonly fields: readonly FieldProblem[] }
> {
  const fields: FieldProblem[] = [];
  const values: { -readonly [field in Field]?: AnalysisSettingValues[field] } = {};
  for (const name of Object.keys(body)) {
    if (!(name in FIELDS)) fields.push({ field: name, problem: 'is not a field of this request' });
  }
  const url = body.localUrl;
  if (url === null) values.localUrl = null;
  else if (url !== undefined) {
    const problem =
      typeof url === 'string' ? await urlProblem(url, resolve, lookupWaitMs) : 'not-a-url';
    if (problem === undefined) values.localUrl = (url as string).trim();
    else fields.push({ field: 'localUrl', problem });
  }
  const model = body.localModel;
  if (model === null) values.localModel = null;
  else if (model !== undefined) {
    const problem = typeof model === 'string' ? analysisModelNameProblem(model) : 'bad-model';
    if (problem === undefined) values.localModel = (model as string).trim();
    else fields.push({ field: 'localModel', problem });
  }
  const tokens = body.reasoningTokens;
  if (tokens === null) values.reasoningTokens = null;
  else if (tokens !== undefined) {
    if (isReasoningTokens(tokens)) values.reasoningTokens = tokens;
    else fields.push({ field: 'reasoningTokens', problem: 'bad-reasoning' });
  }
  for (const flag of ['offerLocal', 'offerHosted', 'othersLocal'] as const) {
    const said = body[flag];
    if (said === undefined) continue;
    if (said === null || typeof said === 'boolean') values[flag] = said;
    else fields.push({ field: flag, problem: 'must-be-boolean-or-null' });
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, values };
}

/**
 * How long a save waits for a name to resolve before it is refused
 * `unresolved` (#2628's review): a resolver that hangs must not hold the
 * owner's request, as #2604's tunnel probe is bounded. A lookup still running
 * then is left to finish unread.
 */
export const SAVE_LOOKUP_WAIT_MS = 3_000;

/**
 * `.env`'s rule for the address, then — for a name — where it resolves to
 * NOW: every address local, or `not-local`; none, or none within
 * {@link SAVE_LOOKUP_WAIT_MS}, `unresolved`.
 */
async function urlProblem(
  url: string,
  resolve: Resolver,
  waitMs: number,
): Promise<SaveProblem | undefined> {
  const problem = analysisModelUrlProblem(url);
  if (problem !== undefined) return problem;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'unresolved'>((settle) => {
    timer = setTimeout(() => settle('unresolved'), waitMs);
  });
  const looked = localAddressesOnly(new URL(url.trim()).hostname, resolve).then((checked) =>
    checked.ok ? undefined : checked.why,
  );
  try {
    return await Promise.race([looked, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The words of the fields `next` changes from `before`, in the log's order. */
function changedWords(before: AnalysisSettingValues, next: AnalysisSettingValues): string[] {
  return (Object.keys(FIELDS) as Field[])
    .filter((field) => before[field] !== next[field])
    .map((field) => FIELDS[field]);
}

/** What a save did: written and logged, or refused (and logged so) with the problems. */
export type SaveOutcome =
  | { readonly ok: true; readonly changed: readonly string[] }
  | { readonly ok: false; readonly fields: readonly FieldProblem[] };

/**
 * Who may write the settings: the owner's Operate area — the app, or since
 * #2648 the instance's own admin pages — the CLI, or since #2792 the
 * first-run setup's AI step on the server machine. The operator log entry
 * written in the same transaction names which, the admin pages' listener
 * included (ADR 0069 D-8). The row's `updated_by` keeps migration 0043's two
 * words: `app` for a page of the owner's by any channel, the setup's
 * included, `cli` for the host's command line. Nothing reads it but a test;
 * the log is the record of who.
 */
type SettingsActor =
  | Extract<OperatorActor, { readonly source: 'app' | 'cli' }>
  | { readonly source: AdminSource; readonly athleteId: string }
  | { readonly source: 'setup' };

/**
 * Check `body` and, if every field passes, write the row over what it held,
 * as `actor`, logged `analysis_settings_set` naming the fields it changed. A
 * refusal writes no setting and is logged `refused`, naming the fields.
 */
export async function saveAnalysisSettings(
  store: SqlStore,
  actor: SettingsActor,
  body: Readonly<Record<string, unknown>>,
  options: {
    readonly resolve: Resolver;
    readonly now: () => number;
    /** {@link SAVE_LOOKUP_WAIT_MS} unless a test's. */
    readonly lookupWaitMs?: number;
  },
): Promise<SaveOutcome> {
  const at = Math.floor(options.now() / 1000);
  const checked = await checkedSettings(body, options.resolve, options.lookupWaitMs);
  const { value } = await store.recordOperatorAction<SaveOutcome>(
    { actor, action: 'analysis_settings_set', at },
    async (inside) => {
      if (!checked.ok) {
        const words = checked.fields
          .map((problem) => FIELDS[problem.field as Field] as string | undefined)
          .filter((word): word is string => word !== undefined);
        return {
          outcome: 'refused',
          detail: words.length === 0 ? null : [...new Set(words)].join(','),
          value: checked,
        };
      }
      const held = await inside.getAnalysisSetting();
      const before = valuesOf(held);
      const next: AnalysisSettingValues = { ...before, ...checked.values };
      await inside.putAnalysisSetting({
        ...next,
        updatedAt: at,
        updatedBy: actor.source === 'cli' ? 'cli' : 'app',
      });
      const changed = changedWords(before, next);
      return {
        outcome: 'done',
        detail: changed.length === 0 ? 'unchanged' : changed.join(','),
        value: { ok: true, changed },
      };
    },
  );
  return value;
}

/** A held row's settings, without when and by whom; nothing set when there is none. */
function valuesOf(held: AnalysisSettingRecord | undefined): AnalysisSettingValues {
  if (held === undefined) return NOTHING_SET;
  return {
    localUrl: held.localUrl,
    localModel: held.localModel,
    reasoningTokens: held.reasoningTokens,
    offerLocal: held.offerLocal,
    offerHosted: held.offerHosted,
    othersLocal: held.othersLocal,
  };
}

/**
 * Remove the row, as `actor`, logged `analysis_settings_cleared`: every field
 * falls back — the local model to `.env`, both sources to offered, the
 * switch to off. Answers whether there was a row.
 */
export async function clearAnalysisSettings(
  store: SqlStore,
  actor: SettingsActor,
  now: () => number,
): Promise<boolean> {
  const { value } = await store.recordOperatorAction<boolean>(
    { actor, action: 'analysis_settings_cleared', at: Math.floor(now() / 1000) },
    async (inside) => {
      const cleared = await inside.clearAnalysisSetting();
      return { outcome: 'done', detail: cleared ? 'cleared' : 'none_set', value: cleared };
    },
  );
  return value;
}
