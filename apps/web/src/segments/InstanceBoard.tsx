// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One segment's leaderboard on the rider's instance** (#68), on the
 * segment's own screen, below the rider's own history.
 *
 * ## It says whose board it is, in words
 *
 * #68's last criterion: *"The UI states the scope of the board it is showing
 * ("this instance", "your club") in text, not only in a filter control."* So
 * the heading names the instance, and the sentence beneath it says what the
 * board is and what it is not — this instance's riders, never every instance
 * ({@link scopeSentence}). There is no global board (#56) and there is no club
 * or follow board yet (#79, #82), and nothing here implies one.
 *
 * ## Nothing leaves without a press
 *
 * Reading the board sends the segment's digest. Publishing, sharing and
 * withdrawing are each a button, and each says beside it what it sends
 * ({@link PUBLISH_SENTENCE}, {@link SHARE_SENTENCE}). `instance/leaderboard-port.ts`
 * says what goes in each request.
 *
 * ⚠️ **Nothing here is encoded in colour alone**: the rider's own row says
 * "you" in the Rider column.
 */

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import {
  EFFORT_FLAG_REASONS,
  HAZARD_REASONS,
  RANKING_BASIS_LABEL,
  type EffortFlagReason,
  type HazardReason,
} from '@onyourleft/domain';
import type { SegmentEffortRecord, SegmentRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ScrollTable } from '../design/ScrollTable';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration } from '../format';
import type {
  BoardPeriod,
  BoardScope,
  FlagOutcome,
  InstanceBoard as Board,
  LeaderboardPort,
  SegmentStanding,
  ShareOutcome,
} from '../instance/leaderboard-port';

/** What publishing sends, said before the press. */
export const PUBLISH_SENTENCE =
  'Publishing sends this segment’s name and path — a stretch of your own ride — to every rider on your instance, so they can match their own rides against it. Nothing else of the ride is sent.';

/** What sharing sends, said before the press. */
export const SHARE_SENTENCE =
  'Sharing puts your efforts on this segment on the board with your display name, and makes the rides they came from public here and on your instance. Only each effort’s time is sent, never a track. An effort that starts or ends in one of your privacy zones is kept to your own board.';

/** What withdrawing a segment the rider published does, said before the press. */
export const WITHDRAW_SENTENCE =
  'You published this segment. Withdrawing it deletes it from your instance, with every effort any rider shared on it; their own copies stay on their devices.';

/** What flagging a time does, said before the press (#69). */
export const FLAG_SENTENCE =
  'If a time on this board cannot be a real effort, flag it. It comes off the board at once, its rider still sees it, and their ride is unchanged. You may flag only on a segment you have an effort of your own on, and at most 10 times a day.';

/** What flagging the segment does, said before the press (#69). */
export const HAZARD_SENTENCE =
  'If riding this segment fast is dangerous — through a junction, down steps, in traffic — flag it. Once 3 different riders have, nothing on it is ranked any more, for anybody, and no personal best is awarded on it. Nobody can undo that yet.';

/** The question the hazard flag asks before it is raised (#69): the flag is board-wide and cannot yet be taken back. */
export const HAZARD_CONFIRM_SENTENCE =
  'Are you sure? Your flag counts toward switching this segment’s board off for every rider, and you cannot take it back.';

/** What the board says of a segment flagged hazardous (#69). */
export const HAZARDOUS_BOARD_SENTENCE =
  'Riders flagged this segment as hazardous, so nothing on it is ranked and no personal best is awarded on it.';

const EFFORT_REASON_LABELS: Readonly<Record<EffortFlagReason, string>> = {
  vehicle: 'Ridden in a vehicle',
  'gps-error': 'A GPS error',
  'wrong-sport': 'The wrong sport',
  'impossible-time': 'An impossible time',
  other: 'Something else',
};

const HAZARD_REASON_LABELS: Readonly<Record<HazardReason, string>> = {
  traffic: 'In traffic',
  junction: 'Through a junction',
  'unsuitable-path': 'On a path that is not for riding fast',
  other: 'Something else',
};

/** What a flag came to, in a sentence. */
export function flagSentence(outcome: FlagOutcome, instance: string): string {
  switch (outcome) {
    case 'flagged':
      return 'Flagged. It is off the board.';
    case 'already':
      return 'You had flagged it already.';
    case 'rate-limited':
      return 'You have flagged as many as you may today, so nothing was flagged.';
    case 'refused':
      return `${instance} did not take the flag: either you have no counted effort of your own shared on this segment, or what you flagged is no longer there.`;
    case 'unavailable':
      return `${instance} could not be reached, so nothing was flagged.`;
  }
}

/** Whose board it is, in words: #68's last criterion. */
export function scopeSentence(scope: BoardScope, instance: string): string {
  return scope === 'instance'
    ? `The riders on ${instance} who shared their efforts: this instance only, not every instance.`
    : `Only your own efforts you shared on ${instance}.`;
}

const PERIOD_LABELS: Readonly<Record<BoardPeriod, string>> = {
  'all-time': 'All time',
  'last-90-days': 'The last 90 days',
  'last-30-days': 'The last 30 days',
};

/** What a share or a withdrawal came to, in a sentence. */
export function shareSentence(outcome: ShareOutcome, verb: 'Shared' | 'Withdrew'): string {
  const parts = [
    `${verb} efforts from ${String(outcome.rides)} ${outcome.rides === 1 ? 'ride' : 'rides'}.`,
  ];
  if (outcome.notSynced > 0) {
    parts.push(
      `${String(outcome.notSynced)} ${outcome.notSynced === 1 ? 'ride is' : 'rides are'} not on your instance yet: sync first, on the Instance screen.`,
    );
  }
  if (outcome.failed > 0) {
    parts.push(
      `Your instance did not take ${String(outcome.failed)} ${outcome.failed === 1 ? 'ride' : 'rides'}; nothing about ${outcome.failed === 1 ? 'it' : 'them'} changed there.`,
    );
  }
  return parts.join(' ');
}

export interface InstanceBoardProps {
  readonly port: LeaderboardPort;
  readonly segment: SegmentRecord;
  /** The rider's own efforts on it, as this device holds them. */
  readonly efforts: readonly SegmentEffortRecord[];
  /**
   * Told whether the instance says the segment is hazardous (#69), so the
   * screen above awards no personal best on it either.
   */
  readonly onHazardous?: ((hazardous: boolean) => void) | undefined;
}

export function InstanceBoard({
  port,
  segment,
  efforts,
  onHazardous,
}: InstanceBoardProps): JSX.Element {
  const instance = port.instanceName() ?? 'your instance';
  const [standing, setStanding] = useState<SegmentStanding | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<BoardScope>('instance');
  const [period, setPeriod] = useState<BoardPeriod>('all-time');
  const [board, setBoard] = useState<Board | 'unavailable' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirmingHazard, setConfirmingHazard] = useState(false);
  const [said, setSaid] = useState<{ tone: 'success' | 'warning'; text: string } | undefined>(
    undefined,
  );
  const scopeId = useId();
  const periodId = useId();
  const flagId = useId();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([port.standing(segment), port.publishRefusal(segment)]).then(
      ([found, refused]) => {
        if (cancelled) return;
        setStanding(found);
        setRefusal(refused);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [port, segment]);

  const published = standing?.kind === 'published' ? standing.segmentId : undefined;

  const load = useCallback(async (): Promise<void> => {
    if (published === undefined) return;
    setBoard(undefined);
    setBoard((await port.board(published, scope, period)) ?? 'unavailable');
  }, [port, published, scope, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (board !== undefined && board !== 'unavailable') onHazardous?.(board.hazardous);
  }, [board, onHazardous]);

  async function flag(kind: 'effort' | 'hazard', form: HTMLFormElement): Promise<void> {
    if (published === undefined) return;
    const fields = new FormData(form);
    setBusy(true);
    try {
      const field = (name: string): string => {
        const value = fields.get(name);
        return typeof value === 'string' ? value : '';
      };
      // The select's own options are the closed lists: the instance refuses any other word.
      const outcome =
        kind === 'effort'
          ? await port.flagEffort(published, field('effort'), field('reason') as EffortFlagReason)
          : await port.flagHazard(published, field('reason') as HazardReason);
      setSaid({
        tone: outcome === 'flagged' ? 'success' : 'warning',
        text: flagSentence(outcome, instance),
      });
      if (kind === 'hazard') setConfirmingHazard(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    setBusy(true);
    try {
      const outcome = await port.publish(segment);
      if (outcome === 'published') {
        setSaid({ tone: 'success', text: `Published on ${instance}.` });
        setStanding(await port.standing(segment));
      } else {
        setSaid({
          tone: 'warning',
          text:
            outcome === 'refused'
              ? `${instance} did not take this segment, so nothing was published.`
              : `${instance} could not be reached, so nothing was published.`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function send(kind: 'share' | 'withdraw'): Promise<void> {
    if (published === undefined) return;
    setBusy(true);
    try {
      const outcome =
        kind === 'share'
          ? await port.share(published, efforts)
          : await port.withdraw(published, efforts);
      setSaid({
        tone: outcome.failed === 0 && outcome.notSynced === 0 ? 'success' : 'warning',
        text: shareSentence(outcome, kind === 'share' ? 'Shared' : 'Withdrew'),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function withdrawSegment(): Promise<void> {
    if (published === undefined) return;
    setBusy(true);
    try {
      const withdrawn = await port.withdrawSegment(published);
      setSaid(
        withdrawn
          ? { tone: 'success', text: `Withdrew this segment from ${instance}.` }
          : { tone: 'warning', text: `${instance} did not withdraw it, so it is still there.` },
      );
      setStanding(await port.standing(segment));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${scopeId}-heading`}>
      <h3 id={`${scopeId}-heading`}>Leaderboard on {instance}</h3>
      {standing === undefined ? (
        <p className="oyl-muted">Asking {instance} about this segment…</p>
      ) : standing.kind === 'unavailable' ? (
        <StatusMessage tone="warning">
          {instance} could not be asked about this segment. Your own efforts above are unaffected.
        </StatusMessage>
      ) : standing.kind === 'not-published' ? (
        refusal === undefined ? (
          <>
            <p>This segment is not on {instance} yet.</p>
            <p className="oyl-muted">{PUBLISH_SENTENCE}</p>
            <Button variant="secondary" onClick={() => void publish()} disabled={busy}>
              {busy ? 'Publishing…' : `Publish to ${instance}`}
            </Button>
          </>
        ) : (
          <StatusMessage tone="info">{refusal}</StatusMessage>
        )
      ) : (
        <>
          <p>
            {scopeSentence(scope, instance)} {RANKING_BASIS_LABEL}.
          </p>
          <p className="oyl-field">
            <label htmlFor={`${scopeId}-scope`}>Whose efforts</label>
            <select
              id={`${scopeId}-scope`}
              value={scope}
              onChange={(event) => {
                setScope(event.target.value as BoardScope);
              }}
            >
              <option value="instance">Everyone on {instance}</option>
              <option value="personal">Only mine</option>
            </select>
          </p>
          <p className="oyl-field">
            <label htmlFor={periodId}>When</label>
            <select
              id={periodId}
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as BoardPeriod);
              }}
            >
              {(Object.keys(PERIOD_LABELS) as BoardPeriod[]).map((each) => (
                <option key={each} value={each}>
                  {PERIOD_LABELS[each]}
                </option>
              ))}
            </select>
          </p>
          {period === 'all-time' ? null : (
            <p className="oyl-muted">
              Efforts ridden before this segment was published on {instance} are not counted here.
            </p>
          )}
          {board !== undefined && board !== 'unavailable' && board.hazardous ? (
            <StatusMessage tone="info">{HAZARDOUS_BOARD_SENTENCE}</StatusMessage>
          ) : null}
          {board === undefined ? (
            <p className="oyl-muted">Reading the board…</p>
          ) : board === 'unavailable' ? (
            <StatusMessage tone="warning">{instance} could not send this board.</StatusMessage>
          ) : board.rows.length === 0 ? (
            <p>Nobody has shared an effort here for this time yet.</p>
          ) : (
            <ScrollTable
              className="oyl-data-table"
              caption={
                <>
                  {scopeSentence(board.scope, instance)} {PERIOD_LABELS[board.period]}.{' '}
                  {RANKING_BASIS_LABEL}.
                </>
              }
            >
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Rider</th>
                  <th scope="col">Time</th>
                  {board.scope === 'personal' ? <th scope="col">Counted</th> : null}
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.effortId}>
                    <td>{row.rank ?? '—'}</td>
                    <td>{row.yours ? `${row.rider} (you)` : row.rider}</td>
                    <td>{formatDuration(row.elapsedSeconds)}</td>
                    {board.scope === 'personal' ? <td>{row.excluded ?? 'Yes'}</td> : null}
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          )}
          {efforts.length === 0 ? null : (
            <>
              <p className="oyl-muted">{SHARE_SENTENCE}</p>
              <Button variant="secondary" onClick={() => void send('share')} disabled={busy}>
                Share my efforts on this board
              </Button>{' '}
              <Button variant="tertiary" onClick={() => void send('withdraw')} disabled={busy}>
                Take my efforts off this board
              </Button>
            </>
          )}
          {efforts.length === 0 ||
          board === undefined ||
          board === 'unavailable' ||
          board.hazardous ? null : (
            <>
              {board.scope === 'instance' && board.rows.some((row) => !row.yours) ? (
                <form
                  className="oyl-form"
                  aria-labelledby={`${flagId}-effort`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void flag('effort', event.currentTarget);
                  }}
                >
                  <h4 id={`${flagId}-effort`}>Flag a time</h4>
                  <p className="oyl-muted">{FLAG_SENTENCE}</p>
                  <p className="oyl-field">
                    <label htmlFor={`${flagId}-which`}>Which time</label>
                    <select id={`${flagId}-which`} name="effort">
                      {board.rows
                        .filter((row) => !row.yours)
                        .map((row) => (
                          <option key={row.effortId} value={row.effortId}>
                            {row.rider}, {formatDuration(row.elapsedSeconds)}
                          </option>
                        ))}
                    </select>
                  </p>
                  <p className="oyl-field">
                    <label htmlFor={`${flagId}-why`}>Why</label>
                    <select id={`${flagId}-why`} name="reason">
                      {EFFORT_FLAG_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {EFFORT_REASON_LABELS[reason]}
                        </option>
                      ))}
                    </select>
                  </p>
                  <Button variant="secondary" type="submit" disabled={busy}>
                    Flag this time
                  </Button>
                </form>
              ) : null}
              <form
                className="oyl-form"
                aria-labelledby={`${flagId}-hazard`}
                onSubmit={(event) => {
                  event.preventDefault();
                  // Board-wide and not yet reversible: asked twice.
                  if (!confirmingHazard) {
                    setConfirmingHazard(true);
                    return;
                  }
                  void flag('hazard', event.currentTarget);
                }}
              >
                <h4 id={`${flagId}-hazard`}>Flag the segment as hazardous</h4>
                <p className="oyl-muted">{HAZARD_SENTENCE}</p>
                <p className="oyl-field">
                  <label htmlFor={`${flagId}-hazard-why`}>Why</label>
                  <select id={`${flagId}-hazard-why`} name="reason">
                    {HAZARD_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {HAZARD_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </p>
                {confirmingHazard ? (
                  <StatusMessage tone="warning">{HAZARD_CONFIRM_SENTENCE}</StatusMessage>
                ) : null}
                <Button variant="secondary" type="submit" disabled={busy}>
                  {confirmingHazard ? 'Yes, flag it as hazardous' : 'Flag it as hazardous'}
                </Button>
                {confirmingHazard ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setConfirmingHazard(false)}
                  >
                    No, keep it as it is
                  </Button>
                ) : null}
              </form>
            </>
          )}
          {standing.yours ? (
            <>
              <p className="oyl-muted">{WITHDRAW_SENTENCE}</p>
              <Button variant="danger" onClick={() => void withdrawSegment()} disabled={busy}>
                Withdraw this segment from {instance}
              </Button>
            </>
          ) : null}
        </>
      )}
      {said === undefined ? null : (
        <StatusMessage tone={said.tone} live>
          {said.text}
        </StatusMessage>
      )}
    </section>
  );
}
