// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  AI_JOBS_HEADING,
  AI_LINE,
  AI_NOW_HEADING,
  AI_OFFERS_HEADING,
  AI_OWN_KEY_HEADING,
  AI_PICK_HEADING,
  AI_PURPOSE,
  AI_RETURN_HEADING,
  AI_UNREADABLE_TEXT,
  aiNowLines,
  analysisHolds,
  CHECK_BUTTON,
  CHECK_TEXT,
  CHECK_UNREADABLE_TEXT,
  HOSTED_OFFER_SENTENCE,
  jobCountLines,
  jobLine,
  JOBS_UNREADABLE_TEXT,
  MODEL_LOAD_WARNING,
  MODEL_SAVE_FAILED_TEXT,
  MODEL_SAVED_TEXT,
  modelLine,
  MODELS_LEGEND,
  MODELS_UNREADABLE_TEXT,
  NO_JOBS_TEXT,
  NO_MODELS_TEXT,
  OFFER_FAILED_TEXT,
  OFFER_HOSTED_LABEL,
  OFFER_LOCAL_LABEL,
  OFFER_OTHERS_LABEL,
  OFFER_SAVED_TEXT,
  ownKeyText,
  READ_AGAIN_BUTTON,
  RETURN_BUTTON,
  RETURN_FAILED_TEXT,
  RETURN_KEEP,
  RETURN_SENTENCE,
  RETURN_TITLE,
  RETURNED_TEXT,
  SAVE_BUTTON,
  SAVE_NEEDS_CHECK,
  SERVER_STATE_TEXT,
  type OperateLine,
} from '@onyourleft/operate-text';
import { Button, ButtonLink } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type {
  LocalModel,
  LocalModelsRead,
  OperateAnalysis,
  OperateAnalysisChange,
  OperateAnalysisRead,
  OperateJobsRead,
  OperatePort,
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

/**
 * The section's words, moved to `@onyourleft/operate-text` by #2648 (ADR
 * 0069 D-7) so that the instance's admin AI backend page says the same; the
 * names are re-exported for this panel's tests.
 */
export {
  AI_LINE,
  AI_PURPOSE,
  AI_UNREADABLE_TEXT,
  CHECK_BUTTON,
  CHECK_TEXT,
  CHECK_UNREADABLE_TEXT,
  gpuFitText,
  HOSTED_OFFER_SENTENCE,
  JOBS_UNREADABLE_TEXT,
  LOCAL_STATE_TEXT,
  MODEL_LOAD_WARNING,
  MODEL_SAVE_FAILED_TEXT,
  MODEL_SAVED_TEXT,
  modelLine,
  MODELS_LEGEND,
  MODELS_UNREADABLE_TEXT,
  NO_JOBS_TEXT,
  NO_MODELS_TEXT,
  OFFER_FAILED_TEXT,
  OFFER_HOSTED_LABEL,
  OFFER_LOCAL_LABEL,
  OFFER_OTHERS_LABEL,
  OFFER_SAVED_TEXT,
  OPERATE_AI_KEPT_VISIBLE,
  OWN_KEY_TEXT,
  READ_AGAIN_BUTTON,
  RETURN_BUTTON,
  RETURN_FAILED_TEXT,
  RETURN_KEEP,
  RETURN_SENTENCE,
  RETURN_TITLE,
  RETURNED_TEXT,
  SAVE_BUTTON,
  SAVE_NEEDS_CHECK,
  SERVER_STATE_TEXT,
  SET_IN_TEXT,
} from '@onyourleft/operate-text';

/** Where the owner's own key is set, replaced or removed: the app's Instance screen. */
export const OWN_KEY_LINK = 'Set, replace or remove it on the Instance screen';

/** One shared line, its machine names drawn as code. */
function Line({ line }: { readonly line: OperateLine }): JSX.Element {
  return (
    <>
      {line.map((part, index) =>
        typeof part === 'string' ? part : <code key={String(index)}>{part.code}</code>,
      )}
    </>
  );
}

type Message = { readonly tone: 'success' | 'warning'; readonly text: string } | null;

function Now({
  analysis,
  version,
}: {
  readonly analysis: OperateAnalysis;
  readonly version: string | null;
}): JSX.Element {
  return (
    <>
      <h3>{AI_NOW_HEADING}</h3>
      <ul data-oyl-ai-now="">
        {aiNowLines(analysis, version).map((line, index) => (
          <li key={String(index)}>
            <Line line={line} />
          </li>
        ))}
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
  const box = (
    label: string,
    checked: boolean,
    change: (on: boolean) => OperateAnalysisChange,
    describedBy?: string,
  ) => (
    <label className="oyl-announce__switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(change(event.target.checked));
        }}
      />{' '}
      <span>{label}</span>
    </label>
  );
  return (
    <>
      <h3>{AI_OFFERS_HEADING}</h3>
      <ul className="oyl-operate__offers">
        <li>{box(OFFER_LOCAL_LABEL, analysis.local.offered, (on) => ({ offerLocal: on }))}</li>
        <li>
          {box(OFFER_OTHERS_LABEL, analysis.local.othersMayUse, (on) => ({ othersLocal: on }))}
        </li>
        <li>
          {box(
            OFFER_HOSTED_LABEL,
            analysis.hosted.offered,
            (on) => ({ offerHosted: on }),
            hostedId,
          )}
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
export function OperateAnalysisPanel({
  port,
  timeZone,
}: {
  readonly port: OperatePort;
  /** The IANA zone its moments are drawn in, named (#2917): the device's, from `OperateView`. */
  readonly timeZone: string;
}): JSX.Element {
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
    // Each read is drawn as it answers: a slow local-server read must not hold the switches back.
    void port.analysis().then(setAnalysis);
    void port.localModels().then(setModels);
    void port.jobs().then(setJobs);
  }, [port]);

  /** Save `change`, then show what the instance reads back — never the form. `true` only if the read-back holds the change. */
  async function save(change: OperateAnalysisChange): Promise<boolean> {
    setBusy(true);
    try {
      const answer = await port.setAnalysis(change);
      const after = await port.analysis();
      setAnalysis(after);
      return (
        answer.kind === 'analysis' && after.kind === 'analysis' && analysisHolds(after, change)
      );
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
      {/* After the switches: controls first (#666), the state they act on beneath. */}
      <Now analysis={analysis} version={list?.version ?? null} />

      <h3>{AI_PICK_HEADING}</h3>
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
                asking.current = null;
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

      <h3>{AI_OWN_KEY_HEADING}</h3>
      <ul>
        <li>{ownKeyText(analysis)}</li>
      </ul>
      <p>
        <ButtonLink variant="secondary" href={hrefFor(routeById('instance'))}>
          {OWN_KEY_LINK}
        </ButtonLink>
      </p>

      <h3>{AI_JOBS_HEADING}</h3>
      {jobs === 'reading' ? (
        <p className="oyl-muted">Reading the jobs…</p>
      ) : jobs.kind !== 'jobs' ? (
        <StatusMessage tone="warning" label="Not read" live>
          {JOBS_UNREADABLE_TEXT}
        </StatusMessage>
      ) : (
        <>
          <ul data-oyl-ai-counts="">
            {jobCountLines(jobs).map((line, index) => (
              <li key={String(index)}>{line}</li>
            ))}
          </ul>
          {jobs.recent.length === 0 ? (
            <StatusMessage tone="info" label="No jobs">
              {NO_JOBS_TEXT}
            </StatusMessage>
          ) : (
            <ol className="oyl-operate__jobs">
              {jobs.recent.map((job, index) => (
                <li key={`${job.createdAt}-${String(index)}`}>{jobLine(job, timeZone)}</li>
              ))}
            </ol>
          )}
        </>
      )}

      <h3>{AI_RETURN_HEADING}</h3>
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
          setBusy(true);
          try {
            const cleared = await port.clearAnalysis();
            const after = await port.analysis();
            setAnalysis(after);
            // What was checked, saved or offered was said of settings that are gone.
            asking.current = null;
            setPicked(null);
            setPassed(new Set());
            setChecked(null);
            setSaved(null);
            setOffered(null);
            setReturned(
              cleared.kind === 'analysis' && after.kind === 'analysis'
                ? { tone: 'success', text: RETURNED_TEXT }
                : { tone: 'warning', text: RETURN_FAILED_TEXT },
            );
          } finally {
            setBusy(false);
          }
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
