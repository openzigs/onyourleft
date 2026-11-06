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
 * Reading the board sends the segment's digest — and only for a segment that
 * may be published or came from the instance: the digest of one the client
 * refuses to send is a fingerprint of it, so it is not asked about at all
 * (`SegmentStanding`'s `withheld`). Publishing, sharing and
 * withdrawing are each a button, and each says beside it what it sends
 * ({@link PUBLISH_SENTENCE}, {@link SHARE_SENTENCE}). `instance/leaderboard-port.ts`
 * says what goes in each request.
 *
 * ⚠️ **Nothing here is encoded in colour alone**: the rider's own row says
 * "you" in the Rider column.
 */

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { RANKING_BASIS_LABEL } from '@onyourleft/domain';
import type { SegmentEffortRecord, SegmentRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ScrollTable } from '../design/ScrollTable';
import { StatusMessage } from '../design/StatusMessage';
import { formatDuration } from '../format';
import type {
  BoardPeriod,
  BoardScope,
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
  'Sharing puts your efforts on this segment on the board with your display name, and makes the rides they came from public here and on your instance. Only each effort’s time is sent, never a track. An effort that starts or ends in one of your privacy zones, or on a segment that passes through one, is kept to your own board. Taking your efforts off leaves the rides as they are.';

/** What taking efforts off a withheld segment's board does, said before the press. */
export const HELD_EFFORTS_SENTENCE =
  'You shared efforts on this segment before. Taking them off sends its identifier to your instance, so it can find them; nothing else of it is sent.';

/** What withdrawing a segment the rider published does, said before the press. */
export const WITHDRAW_SENTENCE =
  'You published this segment. Withdrawing it deletes it from your instance, with every effort any rider shared on it; their own copies stay on their devices.';

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
}

export function InstanceBoard({ port, segment, efforts }: InstanceBoardProps): JSX.Element {
  const instance = port.instanceName() ?? 'your instance';
  const [standing, setStanding] = useState<SegmentStanding | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<BoardScope>('instance');
  const [period, setPeriod] = useState<BoardPeriod>('all-time');
  const [board, setBoard] = useState<Board | 'unavailable' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: 'success' | 'warning'; text: string } | undefined>(
    undefined,
  );
  const scopeId = useId();
  const periodId = useId();

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
  // A segment withheld now that this device published, or shared on, before:
  // it may still be taken off, by the identifier this device recorded.
  const held = standing?.kind === 'withheld' ? standing.held : undefined;
  const onTheInstance = published ?? held?.segmentId;

  const load = useCallback(async (): Promise<void> => {
    if (published === undefined) return;
    setBoard(undefined);
    setBoard((await port.board(published, scope, period)) ?? 'unavailable');
  }, [port, published, scope, period]);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (published === undefined && (kind === 'share' || held === undefined)) return;
    setBusy(true);
    try {
      const outcome =
        kind === 'share'
          ? await port.share(segment, efforts)
          : await port.withdraw(segment, efforts);
      setSaid({
        tone: outcome.failed === 0 && outcome.notSynced === 0 ? 'success' : 'warning',
        text: shareSentence(outcome, kind === 'share' ? 'Shared' : 'Withdrew'),
      });
      if (published === undefined) setStanding(await port.standing(segment));
      else await load();
    } finally {
      setBusy(false);
    }
  }

  async function withdrawSegment(): Promise<void> {
    if (onTheInstance === undefined) return;
    setBusy(true);
    try {
      const withdrawn = await port.withdrawSegment(onTheInstance);
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
      ) : standing.kind === 'withheld' ? (
        <>
          <StatusMessage tone="info">{standing.refusal}</StatusMessage>
          {held?.shared === true && efforts.length > 0 ? (
            <>
              <p className="oyl-muted">{HELD_EFFORTS_SENTENCE}</p>
              <Button variant="tertiary" onClick={() => void send('withdraw')} disabled={busy}>
                Take my efforts off this board
              </Button>
            </>
          ) : null}
          {held?.yours === true ? (
            <>
              <p className="oyl-muted">{WITHDRAW_SENTENCE}</p>
              <Button variant="danger" onClick={() => void withdrawSegment()} disabled={busy}>
                Withdraw this segment from {instance}
              </Button>
            </>
          ) : null}
        </>
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
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.rank}>
                    <td>{row.rank}</td>
                    <td>{row.yours ? `${row.rider} (you)` : row.rider}</td>
                    <td>{formatDuration(row.elapsedSeconds)}</td>
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
