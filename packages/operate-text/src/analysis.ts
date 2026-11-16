// SPDX-License-Identifier: Apache-2.0

/**
 * **AI backend**'s words (#2611, moved here by #2648, ADR 0069 D-7): what the
 * section says over what `GET /v1/operate/analysis`, `GET
 * /v1/operate/analysis/models`, `POST /v1/operate/analysis/check` and `GET
 * /v1/operate/analysis/jobs` return. The app's `OperateAnalysisPanel` and the
 * instance's admin AI backend page (#2648) both draw from here.
 *
 * No model is recommended (ADR 0031 D-4): nothing here names one. No key is
 * ever said: the owner's own hosted key is described as held or not, and for
 * which origin, and never shown.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** Why the local model is off, by the instance's own code, or `on`. */
export type OperateLocalModelState =
  | 'on'
  | 'not-set'
  | 'not-a-url'
  | 'not-base-url'
  | 'not-local'
  | 'tls-by-name'
  | 'no-model'
  | 'bad-model'
  | 'bad-reasoning';

/** The operator's analysis settings, as `GET /v1/operate/analysis` answers them. Never a key. */
export interface OperateAnalysisAnswer {
  readonly local: {
    readonly url: string | null;
    readonly model: string | null;
    readonly reasoningTokens: number | null;
    readonly offered: boolean;
    readonly othersMayUse: boolean;
    readonly setIn: 'app' | 'env' | 'none';
    readonly state: OperateLocalModelState;
  };
  readonly hosted: {
    readonly offered: boolean;
    readonly operatorKey: 'none' | 'held' | 'held-unreadable';
    readonly operatorKeyOrigin: string | null;
  };
}

/** What a save may change: a field left out is unchanged, `null` returns it to its fallback. */
export interface OperateAnalysisChange {
  readonly localModel?: string | null;
  readonly offerLocal?: boolean | null;
  readonly offerHosted?: boolean | null;
  readonly othersLocal?: boolean | null;
}

/** How much of a model is in GPU memory: of a loaded model only, never guessed. */
export type OperateGpuFit = 'all' | 'part' | 'none' | 'not-loaded' | 'not-reported' | 'not-known';

/** One model the local server offers, as `GET /v1/operate/analysis/models` answers it. */
export interface OperateLocalModel {
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly parameters: string | null;
  readonly quantisation: string | null;
  readonly tools: 'listed' | 'not-listed' | 'not-reported';
  readonly gpu: OperateGpuFit;
  readonly gpuPercent: number | null;
}

/** What the local server is, or why it could not be read. */
export type OperateLocalServerState =
  'ollama' | 'openai-compatible' | 'no-address' | 'not-local' | 'unresolved' | 'unreachable';

/** `GET /v1/operate/analysis/models`'s answer. */
export interface OperateLocalModelsAnswer {
  readonly state: OperateLocalServerState;
  readonly version: string | null;
  readonly models: readonly OperateLocalModel[];
}

/** How a tool check went, by the instance's own word. */
export type OperateToolCheckOutcome =
  | 'tools-ok'
  | 'no-tool-call'
  | 'does-not-support-tools'
  | 'server-error'
  | 'not-local'
  | 'out-of-time'
  | 'stopped'
  | 'no-address'
  | 'busy';

export type OperateJobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'withheld';

/** One analysis job as the owner is shown it: never which rider, nor what it said. */
export interface OperateJob {
  readonly kind: 'write-up' | 're-plan';
  readonly source: 'local' | 'hosted';
  readonly status: OperateJobStatus;
  readonly failure: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly whose: 'own' | 'other';
}

/** `GET /v1/operate/analysis/jobs`'s answer. */
export interface OperateJobsAnswer {
  readonly counts: Readonly<Record<OperateJobStatus, number>>;
  readonly failures: readonly { readonly code: string | null; readonly count: number }[];
  readonly recent: readonly OperateJob[];
}

/**
 * One line as both apps draw it: text, and a machine name (an address or a
 * model's name) that each draws as code. Its text is the parts in order.
 */
export type OperateLine = readonly (string | { readonly code: string })[];

/** The section's one drawn line (#1013). */
export const AI_LINE = 'Which models your instance offers riders for ride write-ups.';

/** What the section is for, behind its ⓘ. */
export const AI_PURPOSE =
  'A write-up runs on your instance: on a model on the instance’s own machine, or on a hosted ' +
  'service a rider brings their own key for. This app never calls a model itself.';

export const AI_UNREADABLE_TEXT =
  'The AI settings could not be read from the instance, so they are not shown here.';

/** The section's headings, in the order they are drawn. */
export const AI_OFFERS_HEADING = 'What the instance offers riders';
export const AI_NOW_HEADING = 'Now';
export const AI_PICK_HEADING = 'Pick a local model';
export const AI_OWN_KEY_HEADING = 'Your own hosted key';
export const AI_JOBS_HEADING = 'Jobs';
export const AI_RETURN_HEADING = 'Return to .env';

/** Where the local model's settings come from. */
export const SET_IN_TEXT: Readonly<Record<OperateAnalysisAnswer['local']['setIn'], string>> = {
  app: 'set here',
  env: 'from the instance’s .env',
  none: 'not set',
};

/** The local model's state, as a sentence: `on`, or the code it is off for. */
export const LOCAL_STATE_TEXT: Readonly<Record<OperateLocalModelState, string>> = {
  on: 'On: write-ups can run on it.',
  'not-set': 'Off: no local server address is set.',
  'not-a-url': 'Off: the local server address is not a web address.',
  'not-base-url': 'Off: the local server address has more than the server’s base address in it.',
  'not-local': 'Off: the local server address is not on this machine or its private network.',
  'tls-by-name':
    'Off: the address is https: by a name, which cannot be checked. Use http: on the private network.',
  'no-model': 'Off: no model is chosen.',
  'bad-model': 'Off: the model’s name is not one the instance accepts.',
  'bad-reasoning': 'Off: the reasoning allowance in .env is not a whole number in range.',
};

export const OFFER_LOCAL_LABEL = 'A model on this instance';
export const OFFER_OTHERS_LABEL = 'Riders other than you may use the model on this instance';
export const OFFER_HOSTED_LABEL = 'A hosted service, on each rider’s own key';

/** Under the hosted switch: kept on the screen, as what leaves and on whose key. */
export const HOSTED_OFFER_SENTENCE =
  'Each rider brings their own key and agrees to the service by name. This instance never ' +
  'shares your key with them.';

/** Under *What the instance offers riders*, once a switch's press is read back. */
export const OFFER_SAVED_TEXT = 'Saved. This is what the instance now offers.';
export const OFFER_FAILED_TEXT = 'The instance did not take that change. Nothing was changed.';

/** Above the list: kept on the screen, because it may slow a rider down. */
export const MODEL_LOAD_WARNING =
  'Checking or switching a model loads it on the server, which may slow a rider’s write-up that is running.';

/** What this section keeps on the screen (`a11y/kept-visible.a11y.test.tsx`): whose key, and what a check costs riders. */
export const OPERATE_AI_KEPT_VISIBLE: readonly string[] = [
  HOSTED_OFFER_SENTENCE,
  MODEL_LOAD_WARNING,
];

export const MODELS_LEGEND = 'Models on the local server';

/** Why there is no list, by the instance's word for the server's state. */
export const SERVER_STATE_TEXT: Readonly<
  Record<Exclude<OperateLocalServerState, 'ollama'>, string>
> = {
  'openai-compatible':
    'The local server is not Ollama, so it lists names only: no size, tools or memory.',
  'no-address': 'No usable local server address is set, so there is no list.',
  'not-local':
    'The local server’s address is not on this machine or its private network now, so nothing was asked.',
  unresolved: 'The local server’s name did not resolve, so nothing was asked.',
  unreachable: 'The local server did not answer.',
};

export const MODELS_UNREADABLE_TEXT = 'The list of models could not be read from the instance.';
export const NO_MODELS_TEXT = 'The local server lists no models.';

export const CHECK_BUTTON = 'Check it calls tools';
export const SAVE_BUTTON = 'Save this model';
export const READ_AGAIN_BUTTON = 'Read the list again';

/** Why *Save this model* does nothing yet. */
export const SAVE_NEEDS_CHECK =
  'Save is offered once this model’s check says it calls tools: write-ups need it.';

/** How a check went, by the instance's word for it. */
export const CHECK_TEXT: Readonly<Record<OperateToolCheckOutcome, string>> = {
  'tools-ok': 'It called the tool and answered. You can save it.',
  'no-tool-call': 'It answered without calling the tool, so it cannot run a write-up.',
  'does-not-support-tools': 'The server says this model does not support tools.',
  'server-error': 'The server did not answer the check properly. Try again.',
  'not-local':
    'The local server’s address is not on this machine or its private network now, so nothing was sent.',
  'out-of-time': 'The check ran out of time. A model that is still loading may need a second try.',
  stopped: 'The instance stopped during the check.',
  'no-address': 'No usable local server address is set, so nothing was sent.',
  busy: 'Another check is running. Try again when it ends.',
};
export const CHECK_UNREADABLE_TEXT = 'The check’s outcome did not come back from the instance.';

export const MODEL_SAVED_TEXT = 'Saved. The instance now runs write-ups on the model above.';
export const MODEL_SAVE_FAILED_TEXT = 'The instance did not take that model. Nothing was changed.';

/** The owner's own hosted key, as the instance says it holds it. */
export const OWN_KEY_TEXT: Readonly<
  Record<OperateAnalysisAnswer['hosted']['operatorKey'], (origin: string | null) => string>
> = {
  none: () => 'No hosted key of yours is held.',
  held: (origin) =>
    `Your key is held${origin === null ? '' : ` for ${origin}`}, and this instance’s secret opens it.`,
  'held-unreadable': (origin) =>
    `Your key is held${origin === null ? '' : ` for ${origin}`}, and this instance’s secret cannot open it.`,
};

export const JOBS_UNREADABLE_TEXT = 'The jobs could not be read from the instance.';
export const NO_JOBS_TEXT = 'No write-ups in the last seven days.';

export const RETURN_BUTTON = 'Return to .env';
export const RETURN_TITLE = 'Return the AI settings to the instance’s .env?';
export const RETURN_SENTENCE =
  'The model, its address and both offers go back to what the instance’s .env says, and riders ' +
  'other than you can no longer use the model on this instance. Nothing else is deleted.';
export const RETURN_KEEP = 'Keep these settings';
export const RETURNED_TEXT = 'Returned to .env. This is what the instance now says.';
export const RETURN_FAILED_TEXT = 'The instance did not return to .env. Nothing was changed.';

/** A size in gigabytes, one decimal: what a card's memory is counted in. */
function gigabytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** How much of a model is in GPU memory, in words. */
export function gpuFitText(gpu: OperateGpuFit, percent: number | null): string {
  switch (gpu) {
    case 'all':
      return 'in GPU memory: all';
    case 'part':
      return `in GPU memory: part, ${String(percent ?? 0)} %`;
    case 'none':
      return 'in GPU memory: none';
    case 'not-loaded':
      return 'in GPU memory: not known until loaded';
    case 'not-reported':
      return 'in GPU memory: not reported';
    case 'not-known':
      return 'in GPU memory: not known';
  }
}

const TOOLS_TEXT: Readonly<Record<OperateLocalModel['tools'], string>> = {
  listed: 'lists tool support',
  'not-listed': 'does not list tool support',
  'not-reported': 'tool support not reported',
};

/** One model's line: what the server says of it, in its order. */
export function modelLine(model: OperateLocalModel): string {
  return [
    model.parameters,
    model.quantisation,
    model.sizeBytes === null ? null : gigabytes(model.sizeBytes),
    TOOLS_TEXT[model.tools],
    gpuFitText(model.gpu, model.gpuPercent),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
}

/** The jobs' statuses, in words. */
const STATUS_WORD: Readonly<Record<OperateJobStatus, string>> = {
  queued: 'waiting',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  withheld: 'withheld',
};

function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** One job's line: never which rider, nor what it said. */
export function jobLine(job: OperateJob): string {
  const kind = job.kind === 're-plan' ? 'Re-plan' : 'Write-up';
  const source = job.source === 'hosted' ? 'on a hosted service' : 'on this instance’s model';
  const whose = job.whose === 'own' ? 'yours' : 'another rider’s';
  const failure = job.failure === null ? '' : ` (${job.failure})`;
  return `${kind}, ${source}, ${whose}: ${STATUS_WORD[job.status]}${failure}, ${when(job.createdAt)}`;
}

/** The queue's counts, as lines: waiting and running, the last seven days, and each failure's code. */
export function jobCountLines(jobs: OperateJobsAnswer): readonly string[] {
  const { counts } = jobs;
  return [
    `${String(counts.queued)} waiting, ${String(counts.running)} running`,
    `Last seven days: ${String(counts.succeeded)} done, ${String(counts.failed)} failed, ${String(counts.withheld)} withheld, ${String(counts.cancelled)} cancelled`,
    ...jobs.failures.map(
      (failure) => `Failed ${failure.code ?? 'with no reason'}: ${String(failure.count)}`,
    ),
  ];
}

/**
 * The *Now* lines: the local server and where it is set, the model, its
 * state, and the server's version when it is Ollama and said one.
 */
export function aiNowLines(
  analysis: OperateAnalysisAnswer,
  version: string | null,
): readonly OperateLine[] {
  const { local } = analysis;
  return [
    [
      'Local server: ',
      local.url === null ? 'none' : { code: local.url },
      ` (${SET_IN_TEXT[local.setIn]})`,
    ],
    ['Model: ', local.model === null ? 'none chosen' : { code: local.model }],
    [LOCAL_STATE_TEXT[local.state]],
    ...(version === null ? [] : [[`Ollama ${version}`]]),
  ];
}

/** The owner's own hosted key, as one sentence: held or not, for which origin. Never the key. */
export function ownKeyText(analysis: OperateAnalysisAnswer): string {
  return OWN_KEY_TEXT[analysis.hosted.operatorKey](analysis.hosted.operatorKeyOrigin);
}

/** Whether the settings the instance reads back hold every field `change` set. */
export function analysisHolds(read: OperateAnalysisAnswer, change: OperateAnalysisChange): boolean {
  return (
    (change.localModel === undefined || read.local.model === change.localModel) &&
    (change.offerLocal === undefined || read.local.offered === (change.offerLocal ?? true)) &&
    (change.othersLocal === undefined ||
      read.local.othersMayUse === (change.othersLocal ?? false)) &&
    (change.offerHosted === undefined || read.hosted.offered === (change.offerHosted ?? true))
  );
}
