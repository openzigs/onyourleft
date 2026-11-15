// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import { Button, ButtonLink } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type {
  GpuFit,
  LocalModel,
  LocalModelState,
  LocalModelsRead,
  LocalServerState,
  OperateAnalysis,
  OperateAnalysisChange,
  OperateAnalysisRead,
  OperateJob,
  OperateJobsRead,
  OperatePort,
  ToolCheckOutcome,
} from '../instance/operate-port';
import { hrefFor, routeById } from '../shell/routes';

/**
 * **AI backend** (#2611, epic #2601): the owner's Operate section for the
 * instance's analysis — over #2609's settings and #2610's reads.
 *
 * The owner's words it answers: *"User should be able to configure if it is
 * local llm or using a remote one like anthropic in the app."*
 *
 * ## What is drawn is what the instance says
 *
 * Every line here comes from an answer of the instance's, read again after
 * each press: the *Now* line shows the model the instance's
 * `GET /v1/operate/analysis` returns, never the one picked on this screen, and
 * a switch is drawn as the read after the press says. The app never calls a
 * model (ADR 0046 D-13): *Check it calls tools* asks the instance to.
 *
 * ## No model is recommended (ADR 0031 D-4)
 *
 * The list is the local server's, in its order. None is picked until the
 * owner picks one, none is marked, and this file names no model.
 * **Save** is offered only once THIS session's check of the picked model came
 * back `tools-ok` (ADR 0046 D-7 needs tool calling); picking another model
 * withholds it again.
 *
 * ## No key
 *
 * The owner's own hosted key is described — held or not, for which origin,
 * whether this instance's secret opens it — and set, replaced or removed on
 * the Instance screen (`HostedServicePanel.tsx`, #1251). There is no key box
 * here and no key is ever on this screen.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** The section's one drawn line (#1013). */
export const AI_LINE = 'Which models your instance offers riders for ride write-ups.';

/** What the section is for, behind its ⓘ. */
export const AI_PURPOSE =
  'A write-up runs on your instance: on a model on the instance’s own machine, or on a hosted ' +
  'service a rider brings their own key for. This app never calls a model itself.';

export const AI_UNREADABLE_TEXT =
  'The AI settings could not be read from the instance, so they are not shown here.';

/** Where the local model's settings come from. */
export const SET_IN_TEXT: Readonly<Record<OperateAnalysis['local']['setIn'], string>> = {
  app: 'set here',
  env: 'from the instance’s .env',
  none: 'not set',
};

/** The local model's state, as a sentence: `on`, or the code it is off for. */
export const LOCAL_STATE_TEXT: Readonly<Record<LocalModelState, string>> = {
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
export const SERVER_STATE_TEXT: Readonly<Record<Exclude<LocalServerState, 'ollama'>, string>> = {
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
export const CHECK_TEXT: Readonly<Record<ToolCheckOutcome, string>> = {
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
  Record<OperateAnalysis['hosted']['operatorKey'], (origin: string | null) => string>
> = {
  none: () => 'No hosted key of yours is held.',
  held: (origin) =>
    `Your key is held${origin === null ? '' : ` for ${origin}`}, and this instance’s secret opens it.`,
  'held-unreadable': (origin) =>
    `Your key is held${origin === null ? '' : ` for ${origin}`}, and this instance’s secret cannot open it.`,
};
export const OWN_KEY_LINK = 'Set, replace or remove it on the Instance screen';

/** The jobs' statuses, in words. */
const STATUS_WORD: Readonly<Record<OperateJob['status'], string>> = {
  queued: 'waiting',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  withheld: 'withheld',
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
export function gpuFitText(gpu: GpuFit, percent: number | null): string {
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

const TOOLS_TEXT: Readonly<Record<LocalModel['tools'], string>> = {
  listed: 'lists tool support',
  'not-listed': 'does not list tool support',
  'not-reported': 'tool support not reported',
};

/** One model's line: what the server says of it, in its order. */
export function modelLine(model: LocalModel): string {
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

function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function jobLine(job: OperateJob): string {
  const kind = job.kind === 're-plan' ? 'Re-plan' : 'Write-up';
  const source = job.source === 'hosted' ? 'on a hosted service' : 'on this instance’s model';
  const whose = job.whose === 'own' ? 'yours' : 'another rider’s';
  const failure = job.failure === null ? '' : ` (${job.failure})`;
  return `${kind}, ${source}, ${whose}: ${STATUS_WORD[job.status]}${failure}, ${when(job.createdAt)}`;
}

type Message = { readonly tone: 'success' | 'warning'; readonly text: string } | null;

function Now({
  analysis,
  version,
}: {
  readonly analysis: OperateAnalysis;
  readonly version: string | null;
}): JSX.Element {
  const { local } = analysis;
  return (
    <>
      <h3>Now</h3>
      <ul data-oyl-ai-now="">
        <li>
          Local server: {local.url === null ? 'none' : <code>{local.url}</code>} (
          {SET_IN_TEXT[local.setIn]})
        </li>
        <li>Model: {local.model === null ? 'none chosen' : <code>{local.model}</code>}</li>
        <li>{LOCAL_STATE_TEXT[local.state]}</li>
        {version === null ? null : <li>Ollama {version}</li>}
      </ul>
    </>
  );
}

function Offers({
  analysis,
  busy,
  message,
  onChange,
}: {
  readonly analysis: OperateAnalysis;
  readonly busy: boolean;
  readonly message: Message;
  readonly onChange: (change: OperateAnalysisChange) => void;
}): JSX.Element {
  const hostedId = useId();
  const box = (label: string, checked: boolean, change: (on: boolean) => OperateAnalysisChange) => (
    <label className="oyl-announce__switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={(event) => {
          onChange(change(event.target.checked));
        }}
      />{' '}
      <span>{label}</span>
    </label>
  );
  return (
    <>
      <h3>What the instance offers riders</h3>
      <ul className="oyl-operate__offers">
        <li>{box(OFFER_LOCAL_LABEL, analysis.local.offered, (on) => ({ offerLocal: on }))}</li>
        <li>
          {box(OFFER_OTHERS_LABEL, analysis.local.othersMayUse, (on) => ({ othersLocal: on }))}
        </li>
        <li aria-describedby={hostedId}>
          {box(OFFER_HOSTED_LABEL, analysis.hosted.offered, (on) => ({ offerHosted: on }))}
        </li>
      </ul>
      <KeptVisible>
        <p id={hostedId}>{HOSTED_OFFER_SENTENCE}</p>
      </KeptVisible>
      {message === null ? null : (
        <StatusMessage
          tone={message.tone}
          label={message.tone === 'success' ? 'Saved' : 'Not saved'}
          live
        >
          {message.text}
        </StatusMessage>
      )}
    </>
  );
}

function ModelList({
  models,
  picked,
  onPick,
}: {
  readonly models: readonly LocalModel[];
  readonly picked: string | null;
  readonly onPick: (name: string) => void;
}): JSX.Element {
  const name = useId();
  return (
    <fieldset className="oyl-operate__models">
      <legend>{MODELS_LEGEND}</legend>
      <ul>
        {models.map((model) => (
          <li key={model.name}>
            <label>
              <input
                type="radio"
                name={name}
                value={model.name}
                checked={picked === model.name}
                onChange={() => {
                  onPick(model.name);
                }}
              />{' '}
              {/* One run of text, so the row's flex box wraps it as a sentence. */}
              <span>
                <code>{model.name}</code>: {modelLine(model)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** The AI backend section of Operate. @see the file comment. */
export function OperateAnalysisPanel({ port }: { readonly port: OperatePort }): JSX.Element {
  const [analysis, setAnalysis] = useState<OperateAnalysisRead | 'reading'>('reading');
  const [models, setModels] = useState<LocalModelsRead | 'reading'>('reading');
  const [jobs, setJobs] = useState<OperateJobsRead | 'reading'>('reading');
  const [picked, setPicked] = useState<string | null>(null);
  /** The models whose check came back `tools-ok` in this session. */
  const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());
  const [checked, setChecked] = useState<Message>(null);
  const [saved, setSaved] = useState<Message>(null);
  const [offered, setOffered] = useState<Message>(null);
  const [returned, setReturned] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const saveHint = useId();
  /** The model a check was asked for: an answer for another is not this model's. */
  const asking = useRef<string | null>(null);

  const readModels = useCallback(async (): Promise<void> => {
    setModels('reading');
    setModels(await port.localModels());
  }, [port]);

  useEffect(() => {
    void (async () => {
      const [settings, list, queue] = await Promise.all([
        port.analysis(),
        port.localModels(),
        port.jobs(),
      ]);
      setAnalysis(settings);
      setModels(list);
      setJobs(queue);
    })();
  }, [port]);

  /** Save `change`, then show what the instance reads back — never the form. */
  async function save(change: OperateAnalysisChange): Promise<boolean> {
    setBusy(true);
    try {
      const answer = await port.setAnalysis(change);
      const after = await port.analysis();
      setAnalysis(after);
      return answer.kind === 'analysis' && after.kind === 'analysis';
    } finally {
      setBusy(false);
    }
  }

  async function check(model: string): Promise<void> {
    asking.current = model;
    setBusy(true);
    setChecked(null);
    setSaved(null);
    try {
      const answer = await port.checkModel(model);
      if (asking.current !== model) return;
      if (answer.kind !== 'checked') {
        setChecked({ tone: 'warning', text: CHECK_UNREADABLE_TEXT });
        return;
      }
      if (answer.outcome === 'tools-ok') setPassed((before) => new Set([...before, model]));
      setChecked({
        tone: answer.outcome === 'tools-ok' ? 'success' : 'warning',
        text: CHECK_TEXT[answer.outcome],
      });
    } finally {
      setBusy(false);
    }
  }

  if (analysis === 'reading')
    return (
      <AiSection>
        <p className="oyl-muted">Reading the instance…</p>
      </AiSection>
    );
  if (analysis.kind !== 'analysis') {
    return (
      <AiSection>
        <StatusMessage tone="warning" label="Not read" live>
          {AI_UNREADABLE_TEXT}
        </StatusMessage>
      </AiSection>
    );
  }
  const list = models === 'reading' || models.kind !== 'models' ? undefined : models;
  const mayCheck = picked !== null && !busy;
  const maySave = picked !== null && passed.has(picked) && !busy;
  return (
    <AiSection>
      <Now analysis={analysis} version={list?.version ?? null} />
      <Offers
        analysis={analysis}
        busy={busy}
        message={offered}
        onChange={(change) => {
          void save(change).then((ok) => {
            setOffered(
              ok
                ? { tone: 'success', text: OFFER_SAVED_TEXT }
                : { tone: 'warning', text: OFFER_FAILED_TEXT },
            );
          });
        }}
      />

      <h3>Pick a local model</h3>
      <KeptVisible>
        <p>{MODEL_LOAD_WARNING}</p>
      </KeptVisible>
      {models === 'reading' ? (
        <p className="oyl-muted">Reading the list…</p>
      ) : models.kind !== 'models' ? (
        <StatusMessage tone="warning" label="Not read" live>
          {MODELS_UNREADABLE_TEXT}
        </StatusMessage>
      ) : models.state !== 'ollama' && models.state !== 'openai-compatible' ? (
        <StatusMessage tone="warning" label="No list" live>
          {SERVER_STATE_TEXT[models.state]}
        </StatusMessage>
      ) : (
        <>
          {models.state === 'openai-compatible' ? (
            <StatusMessage tone="info" label="Names only">
              {SERVER_STATE_TEXT['openai-compatible']}
            </StatusMessage>
          ) : null}
          {models.models.length === 0 ? (
            <StatusMessage tone="info" label="No models">
              {NO_MODELS_TEXT}
            </StatusMessage>
          ) : (
            <ModelList
              models={models.models}
              picked={picked}
              onPick={(name) => {
                setPicked(name);
                setChecked(null);
                setSaved(null);
              }}
            />
          )}
        </>
      )}
      <p>
        <Button
          variant="secondary"
          unavailable={!mayCheck}
          onClick={() => {
            if (!mayCheck) return;
            void check(picked);
          }}
        >
          {CHECK_BUTTON}
        </Button>{' '}
        <Button
          variant="secondary"
          unavailable={!maySave}
          describedBy={saveHint}
          onClick={() => {
            if (!maySave) return;
            const model = picked;
            void save({ localModel: model }).then((ok) => {
              setSaved(
                ok
                  ? { tone: 'success', text: MODEL_SAVED_TEXT }
                  : { tone: 'warning', text: MODEL_SAVE_FAILED_TEXT },
              );
            });
          }}
        >
          {SAVE_BUTTON}
        </Button>{' '}
        <Button
          variant="secondary"
          unavailable={busy}
          onClick={() => {
            if (busy) return;
            void readModels();
          }}
        >
          {READ_AGAIN_BUTTON}
        </Button>
      </p>
      <p className="oyl-muted" id={saveHint}>
        {SAVE_NEEDS_CHECK}
      </p>
      {checked === null ? null : (
        <StatusMessage tone={checked.tone} label="Check" live>
          {checked.text}
        </StatusMessage>
      )}
      {saved === null ? null : (
        <StatusMessage
          tone={saved.tone}
          label={saved.tone === 'success' ? 'Saved' : 'Not saved'}
          live
        >
          {saved.text}
        </StatusMessage>
      )}

      <h3>Your own hosted key</h3>
      <ul>
        <li>{OWN_KEY_TEXT[analysis.hosted.operatorKey](analysis.hosted.operatorKeyOrigin)}</li>
      </ul>
      <p>
        <ButtonLink variant="secondary" href={hrefFor(routeById('instance'))}>
          {OWN_KEY_LINK}
        </ButtonLink>
      </p>

      <h3>Jobs</h3>
      {jobs === 'reading' ? (
        <p className="oyl-muted">Reading the jobs…</p>
      ) : jobs.kind !== 'jobs' ? (
        <StatusMessage tone="warning" label="Not read" live>
          {JOBS_UNREADABLE_TEXT}
        </StatusMessage>
      ) : (
        <>
          <ul data-oyl-ai-counts="">
            <li>{`${String(jobs.counts.queued)} waiting, ${String(jobs.counts.running)} running`}</li>
            <li>
              {`Last seven days: ${String(jobs.counts.succeeded)} done, ${String(jobs.counts.failed)} failed, ${String(jobs.counts.withheld)} withheld, ${String(jobs.counts.cancelled)} cancelled`}
            </li>
            {jobs.failures.map((failure) => (
              <li key={failure.code ?? 'none'}>
                {`Failed ${failure.code ?? 'with no reason'}: ${String(failure.count)}`}
              </li>
            ))}
          </ul>
          {jobs.recent.length === 0 ? (
            <StatusMessage tone="info" label="No jobs">
              {NO_JOBS_TEXT}
            </StatusMessage>
          ) : (
            <ol className="oyl-operate__jobs">
              {jobs.recent.map((job, index) => (
                <li key={`${job.createdAt}-${String(index)}`}>{jobLine(job)}</li>
              ))}
            </ol>
          )}
        </>
      )}

      <h3>Return to .env</h3>
      <p>
        <Button
          variant="secondary"
          unavailable={busy}
          onClick={() => {
            if (busy) return;
            setConfirming(true);
          }}
        >
          {RETURN_BUTTON}
        </Button>
      </p>
      {returned === null ? null : (
        <StatusMessage
          tone={returned.tone}
          label={returned.tone === 'success' ? 'Returned' : 'Not returned'}
          live
        >
          {returned.text}
        </StatusMessage>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={RETURN_TITLE}
        confirmLabel={RETURN_BUTTON}
        cancelLabel={RETURN_KEEP}
        onConfirm={async () => {
          const cleared = await port.clearAnalysis();
          const after = await port.analysis();
          setAnalysis(after);
          setPicked(null);
          setReturned(
            cleared.kind === 'analysis' && after.kind === 'analysis'
              ? { tone: 'success', text: RETURNED_TEXT }
              : { tone: 'warning', text: RETURN_FAILED_TEXT },
          );
        }}
      >
        <p>{RETURN_SENTENCE}</p>
      </ConfirmDialog>
    </AiSection>
  );
}

function AiSection({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-ai">
      <SectionHeading level={2} id="oyl-operate-ai" help={<p>{AI_PURPOSE}</p>}>
        AI backend
      </SectionHeading>
      <p>{AI_LINE}</p>
      {children}
    </section>
  );
}
