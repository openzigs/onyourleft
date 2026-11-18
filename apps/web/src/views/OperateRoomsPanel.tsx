// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  END_ROOM_CONFIRM_TEXT,
  endRoomTypeText,
  NO_ROOM_TEXT,
  ROOM_END_REASON_TEXT,
  END_ROOM_REASON_LABEL,
  ROOM_END_REASONS,
  ROOM_NOT_ENDED_TEXT,
  roomLine,
  ROOMS_LIST_TEXT,
  ROOMS_NAMES_ONLY_TEXT,
  ROOMS_UNREADABLE_TEXT,
  type OperateRoomEndReason,
} from '@onyourleft/operate-text';
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type { OperatePort, OperateRoom, OperateRoomsRead } from '../instance/operate-port';

/**
 * **Rooms** (#2612, epic #2601): the owner's view of every room riders have
 * open on the instance, and *End room* (`GET /v1/operate/rooms`,
 * `POST /v1/operate/rooms/{roomId}/end`).
 *
 * ## What is shown is read back
 *
 * The list is the port's read of the instance, read as the section opens and
 * again after every *End room*, whatever it answered: a room is gone from the
 * screen only once the instance's own list no longer has it.
 *
 * ## Ending a room is typed
 *
 * *End room* opens a confirmation that says what ending does — every rider in
 * it rides on alone and goes on recording, nothing is sent to any trainer —
 * and its own *End room* cannot act until the owner has typed the room's code.
 * The instance checks the code as well, so a press that skipped this screen
 * changes nothing either.
 *
 * ⚠️ **Nothing here reaches a trainer.** The panel's only calls are the
 * port's two (`operate-cannot-reach-trainer.test.ts`).
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

export {
  END_ROOM_CONFIRM_TEXT,
  ROOM_NOT_ENDED_TEXT,
  ROOMS_UNREADABLE_TEXT,
} from '@onyourleft/operate-text';

function Row({
  room,
  onEnd,
}: {
  readonly room: OperateRoom;
  readonly onEnd: (room: OperateRoom) => void;
}): JSX.Element {
  const line = roomLine(room);
  return (
    <li>
      <strong>{line.kind}</strong>
      {line.rest.map((part, index) =>
        typeof part === 'string' ? part : <code key={String(index)}>{part.code}</code>,
      )}{' '}
      <Button
        variant="secondary"
        onClick={() => {
          onEnd(room);
        }}
      >
        End room
      </Button>
    </li>
  );
}

/** The Rooms section: the open rooms, who is in each, and *End room*. */
export function OperateRoomsPanel({
  port,
}: {
  readonly port: Pick<OperatePort, 'rooms' | 'endRoom'>;
}): JSX.Element {
  const [read, setRead] = useState<OperateRoomsRead | undefined>(undefined);
  /** The room whose *End room* is open, or `undefined`. */
  const [ending, setEnding] = useState<OperateRoom | undefined>(undefined);
  const [reason, setReason] = useState<OperateRoomEndReason>('other');
  const [typed, setTyped] = useState('');
  /** The last *End room* did not end it. */
  const [notEnded, setNotEnded] = useState(false);
  const mounted = useRef(true);
  /** Where focus goes once *End room* closes: the row it was opened from may be gone. */
  const landing = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  const codeId = useId();

  const reread = useCallback(async (): Promise<void> => {
    const next = await port.rooms();
    if (mounted.current) setRead(next);
  }, [port]);

  useEffect(() => {
    mounted.current = true;
    void reread();
    return () => {
      mounted.current = false;
    };
  }, [reread]);

  async function endRoom(room: OperateRoom): Promise<void> {
    const answer = await port.endRoom(room.roomId, reason, typed);
    if (!mounted.current) return;
    setNotEnded(answer.kind !== 'ended');
    // Read again whatever the answer: the list is the instance's, never edited here.
    await reread();
  }

  const title = <h2 id="oyl-operate-rooms">Rooms</h2>;
  if (read === undefined) {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-rooms">
        {title}
        <p className="oyl-muted">Reading the rooms…</p>
      </section>
    );
  }
  if (read.kind !== 'rooms') {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-operate-rooms">
        {title}
        <StatusMessage tone="warning" label="Not read" live>
          {ROOMS_UNREADABLE_TEXT}
        </StatusMessage>
      </section>
    );
  }
  const matches = ending !== undefined && typed.trim().toLowerCase() === ending.shortCode;
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-rooms">
      <SectionHeading level={2} id="oyl-operate-rooms" help={<p>{ROOMS_NAMES_ONLY_TEXT}</p>}>
        Rooms
      </SectionHeading>
      <div ref={landing} tabIndex={-1}>
        <p>{ROOMS_LIST_TEXT}</p>
      </div>
      {notEnded ? (
        <StatusMessage tone="warning" label="Not ended" live>
          {ROOM_NOT_ENDED_TEXT}
        </StatusMessage>
      ) : null}
      {read.rooms.length === 0 ? (
        <p className="oyl-muted">{NO_ROOM_TEXT}</p>
      ) : (
        <ol className="oyl-operate__rooms">
          {read.rooms.map((room) => (
            <Row
              key={room.roomId}
              room={room}
              onEnd={(chosen) => {
                setReason('other');
                setTyped('');
                setEnding(chosen);
              }}
            />
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={ending !== undefined}
        onOpenChange={(open) => {
          if (!open) setEnding(undefined);
        }}
        title="End this room?"
        confirmLabel="End room"
        cancelLabel="Keep it open"
        confirmUnavailable={!matches}
        onConfirm={() => (ending === undefined ? undefined : endRoom(ending))}
        onClosed={() => {
          // The row the dialog was opened from may be gone: focus the list's sentence.
          if (landing.current === null) return false;
          landing.current.focus();
          return true;
        }}
      >
        <p>{END_ROOM_CONFIRM_TEXT}</p>
        <p className="oyl-field">
          <label htmlFor={reasonId}>{END_ROOM_REASON_LABEL}</label>{' '}
          <select
            id={reasonId}
            className="oyl-input oyl-input--block"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as OperateRoomEndReason);
            }}
          >
            {ROOM_END_REASONS.map((each) => (
              <option key={each} value={each}>
                {ROOM_END_REASON_TEXT[each]}
              </option>
            ))}
          </select>
        </p>
        <p className="oyl-field">
          <label htmlFor={codeId}>
            {ending === undefined ? '' : endRoomTypeText(ending.shortCode)}
          </label>{' '}
          <input
            id={codeId}
            className="oyl-input oyl-input--block"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </p>
      </ConfirmDialog>
    </section>
  );
}
