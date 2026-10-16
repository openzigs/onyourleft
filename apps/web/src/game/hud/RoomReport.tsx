// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Report a rider from inside a ride** — #789: on the name the HUD shows,
 * in two presses, without stopping. *Report* beside *Follow* (one), then one
 * of a short fixed list of reasons (two). It is filed for the instance's
 * moderators with the room's id and the room's tick, by the rider's SEAT —
 * the instance's `POST /v1/rooms/{roomId}/reports` (#1375) — and nothing else
 * goes with it: no screenshot, no position, no power, no words typed.
 *
 * ## Whose name
 *
 * The rider *Follow* chose: theirs is the one name on the HUD on every
 * device, the label of the gap field (`room-ride.ts` §`roomFrame`). A race's
 * standings name more riders, but they are a tablet-only panel (#1347), and a
 * rider on a phone has to be able to report too — so reaching another rider
 * is *Follow*, and reporting the one followed is two presses from there.
 *
 * ## Who it is filed about
 *
 * The rider followed WHEN *Report* WAS PRESSED. `HudPanel` keys this by the
 * seat, so a *Follow* press while the reasons are open closes them rather
 * than turning a report about one rider into a report about another.
 *
 * ## Where the reasons go
 *
 * Under *Follow* and *Report*, on a tablet and an upright phone. On a phone
 * on its side there is no line to spare — with *Follow* the bottom row fits
 * a 736×360 stage by under a line (#1356, held by #1358), and one more line
 * pushes *Pause* off it — so there `theme.css` §"#789" lays the reasons, and then the
 * answer, IN PLACE OF *Follow* and *Report*, at the row's own height. With
 * *Report* hidden there, the reasons have two ways out besides a choice:
 * Escape, and closing by themselves after {@link REPORT_REASONS_MS} — a
 * press of *Report* by mistake costs nothing but one press to open it again.
 *
 * ⚠️ **Not a live region.** The HUD has one (`announce.ts`); the answer is
 * said by moving focus to it, from the reason button the press took away.
 * Opening moves focus to the first reason, so a keyboard is in the group.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import {
  ROOM_REPORT_REASON_KEYS,
  type RoomReportAnswer,
  type RoomReportReason,
} from '../../net/room-session';

/** The rider a report would be about: their seat, and what the HUD calls them. */
export interface RoomReportTarget {
  readonly riderId: number;
  readonly rider: string;
}

/**
 * Every rider-facing word of the control. ⚠️ Draft wording for the owner's
 * approval (#789's orchestrator comment, 2026-10-15).
 */
export const REPORT_TEXT = {
  /** The control: "Report", and the rider's name visually hidden after it. */
  open: 'Report',
  /** The reasons' group, named for the rider: "Report Bea for". */
  group: (rider: string): string => `Report ${rider} for`,
  /** Each reason: the visible word, and the rest of its name, visually hidden. */
  reasons: {
    'display-name': { shown: 'Name', hidden: ': an offensive display name' },
    cheating: { shown: 'Cheating', hidden: ', or riding that cannot be real' },
    other: { shown: 'Other', hidden: ': something else about how they rode' },
  } satisfies Record<RoomReportReason, { readonly shown: string; readonly hidden: string }>,
  sending: 'Sending the report…',
  answers: {
    reported: 'Reported. A moderator will look at it.',
    'rate-limited': 'Not sent: you have sent as many reports as an hour allows.',
    gone: 'Not sent: that rider has left the room.',
    refused: 'Not sent: your instance refused the report.',
    unreachable: 'Not sent: your instance could not be reached.',
  },
} as const;

/** How long the answer stays on the HUD, in milliseconds. Chosen. */
export const REPORT_ANSWER_MS = 8_000;

/** How long the reasons stay open with nothing chosen, in milliseconds. Chosen. */
export const REPORT_REASONS_MS = 15_000;

/** The id `aria-controls` names. One HUD per page. */
export const REPORT_REASONS_ID = 'oyl-hud-report-reasons';

/**
 * Focus without scrolling: the stage is `overflow: hidden`, and focusing a
 * control it clips scrolls the WHOLE HUD — measured at 844×390, where it
 * lifted the secondary readings 27 px off the top of the stage (#1358).
 */
const NO_SCROLL: FocusOptions = { preventScroll: true };

type Phase =
  | { readonly kind: 'closed' }
  | { readonly kind: 'choosing'; readonly target: RoomReportTarget }
  | { readonly kind: 'answered'; readonly text: string };

function answerText(answer: RoomReportAnswer): string {
  return REPORT_TEXT.answers[answer.kind];
}

export function RoomReport(props: {
  readonly target: RoomReportTarget;
  readonly onReport: (riderId: number, reason: RoomReportReason) => Promise<RoomReportAnswer>;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const said = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reasons = useRef<HTMLDivElement>(null);
  const answered = phase.kind === 'answered' ? phase.text : undefined;
  const choosing = phase.kind === 'choosing';

  const close = (): void => {
    setPhase({ kind: 'closed' });
    // Back to the control that opened them, if focus was among them.
    if (reasons.current?.contains(document.activeElement) === true)
      opener.current?.focus(NO_SCROLL);
  };

  useEffect(() => {
    if (!choosing) return undefined;
    reasons.current?.querySelector('button')?.focus(NO_SCROLL);
    const timer = setTimeout(close, REPORT_REASONS_MS);
    return () => {
      clearTimeout(timer);
    };
    // `close` reads only refs and the setter, so `choosing` is all it needs.
  }, [choosing]);

  useEffect(() => {
    if (answered === undefined) return undefined;
    // The reason pressed is gone: focus goes to what became of it.
    said.current?.focus(NO_SCROLL);
    const timer = setTimeout(() => {
      setPhase({ kind: 'closed' });
    }, REPORT_ANSWER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [answered]);

  const choose = (target: RoomReportTarget, reason: RoomReportReason): void => {
    setPhase({ kind: 'answered', text: REPORT_TEXT.sending });
    void props.onReport(target.riderId, reason).then(
      (answer) => {
        setPhase({ kind: 'answered', text: answerText(answer) });
      },
      () => {
        setPhase({ kind: 'answered', text: REPORT_TEXT.answers.unreachable });
      },
    );
  };

  return (
    <>
      <button
        ref={opener}
        type="button"
        // #788: a 48 px ride-time target, on #669's list (`design/ride-time-controls.ts`).
        className={`oyl-button oyl-button--secondary oyl-hud__report ${RIDE_SIZE_CLASS}`}
        aria-expanded={choosing}
        aria-controls={choosing ? REPORT_REASONS_ID : undefined}
        onClick={() => {
          if (choosing) close();
          else setPhase({ kind: 'choosing', target: props.target });
        }}
      >
        {REPORT_TEXT.open}
        <span className="oyl-visually-hidden"> {props.target.rider}</span>
      </button>
      {phase.kind === 'choosing' ? (
        <div
          id={REPORT_REASONS_ID}
          role="group"
          aria-label={REPORT_TEXT.group(phase.target.rider)}
          className="oyl-hud__report-reasons"
          ref={reasons}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          {ROOM_REPORT_REASON_KEYS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="oyl-button oyl-button--secondary"
              onClick={() => {
                choose(phase.target, reason);
              }}
            >
              {REPORT_TEXT.reasons[reason].shown}
              <span className="oyl-visually-hidden">{REPORT_TEXT.reasons[reason].hidden}</span>
            </button>
          ))}
        </div>
      ) : null}
      {answered === undefined ? null : (
        <p ref={said} tabIndex={-1} className="oyl-hud__report-said">
          {answered}
        </p>
      )}
    </>
  );
}
