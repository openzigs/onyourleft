// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride screen's ONE announcement region — #445.
 *
 * ## What it replaced
 *
 * Until #445 this screen spoke through four writers that could not see one
 * another: #394's `live` regions on *Control lost*, *Not released* and a
 * workout fault, and the workout's own region, into which the block change
 * was written directly and the lookahead through the announcer. So the order
 * `game/hud/announce.ts` states was not what a rider heard: two of them could
 * speak in the same second, and which one a screen reader finished was up to
 * the screen reader. Everything now goes through the announcer core, into this
 * one region, and the order is the core's.
 *
 * ⚠️ **The visible messages did not move.** `TrainerPanel`'s *Control lost*
 * and *Not released* and `WorkoutPanel`'s fault are still on the screen for a
 * rider who can see it — they are plain `StatusMessage`s now, without `live`,
 * because a second writer is exactly what this file exists to remove.
 *
 * | what | kind | said as |
 * |---|---|---|
 * | `TrainerSnapshot.lost`, when it appears or changes | `trainer-lost` | "Control lost: …", the words `TrainerPanel` shows |
 * | `TrainerSnapshot.releaseFault`, likewise | `trainer-lost` | "Not released: …" |
 * | `RideWorkoutSnapshot.fault`, likewise | `workout-fault` | "Heads up: …" |
 * | `RideWorkoutSnapshot.nowRiding`, when it changes | `interval-now` | "Now: …" (#394) |
 * | the next block, `lead` seconds before it | `interval-ahead` | #398's sentence |
 *
 * **When something APPEARS or CHANGES, never when it is first rendered** —
 * #394's rule, kept: a screen a rider navigates back to, with control already
 * lost, does not announce it again. Each value is remembered on the first
 * render and spoken only once it differs.
 *
 * ## Which clock
 *
 * ⚠️ **The throttle runs on the WALL clock, where the workout's region used
 * the workout's.** The workout's clock stands still while it is paused — and
 * losing control is precisely what pauses a workout (`ride/controller.ts`
 * §`onControlLost`). On that clock, a *Control lost* arriving within three
 * seconds of the last sentence would have waited for a window that never
 * opened. The lookahead still decides WHEN a block is coming on the
 * workout's own clock (`lookahead.ts`), which is correct for it; only the
 * one-sentence-per-window throttle moved. And because a waiting sentence may
 * have no render to carry it, a timer re-asks the core when the window opens.
 *
 * Visually hidden by CLIP (`oyl-visually-hidden`), never `display: none`,
 * `hidden` or `aria-hidden`, any of which would silence it.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import {
  ANNOUNCE_WINDOW_SECONDS,
  announce,
  INITIAL_ANNOUNCER,
  type AnnouncementEvent,
  type AnnouncementKind,
  type AnnouncerState,
} from '../game/hud/announce';
import {
  deviceStorage,
  readAnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { upcomingBlock } from './lookahead';
import { LOSS_REASON } from './TrainerPanel';

/** The wall clock, in seconds. */
const wallSeconds = (): number => performance.now() / 1000;

export interface RideAnnouncerProps {
  readonly trainer: TrainerSnapshot;
  readonly workout: RideWorkoutSnapshot | undefined;
  /** Where the rider's announcement choice is read from. This device's, by default. */
  readonly storage?: PreferenceStorage | undefined;
  /**
   * Told the kind of every sentence as it is SAID — #400's interval sound plays
   * on the `interval-now` it belongs to, and never alone.
   */
  readonly onSaid?: ((kind: AnnouncementKind) => void) | undefined;
  /** The throttle's clock, in seconds. The wall clock unless a test hands one in. */
  readonly clock?: (() => number) | undefined;
}

/** What each watched value last was, so a change is told from a first render. */
interface Seen {
  readonly lost: TrainerSnapshot['lost'];
  readonly releaseFault: string | undefined;
  readonly fault: string | undefined;
  readonly nowRiding: string | undefined;
}

function seenIn(trainer: TrainerSnapshot, workout: RideWorkoutSnapshot | undefined): Seen {
  return {
    lost: trainer.lost,
    releaseFault: trainer.releaseFault,
    fault: workout?.fault,
    nowRiding: workout?.nowRiding,
  };
}

/** The events one render carries: whatever APPEARED or CHANGED since the last. */
function changes(before: Seen, now: Seen): AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
  // ⚠️ A block that CHANGED, not a workout that started: `undefined` to a
  // block is the rider pressing *Ride*, and #394 was that the block is said
  // when it changes and never on first appearance — which is what the region
  // did when it lived inside the running workout's own panel and mounted with
  // it.
  if (
    now.nowRiding !== before.nowRiding &&
    now.nowRiding !== undefined &&
    before.nowRiding !== undefined
  ) {
    events.push({ kind: 'interval-now', text: `Now: ${now.nowRiding}` });
  }
  if (now.fault !== before.fault && now.fault !== undefined) {
    events.push({ kind: 'workout-fault', text: `Heads up: ${now.fault}` });
  }
  if (now.releaseFault !== before.releaseFault && now.releaseFault !== undefined) {
    events.push({ kind: 'trainer-lost', text: `Not released: ${now.releaseFault}` });
  }
  if (now.lost !== before.lost && now.lost !== undefined) {
    events.push({ kind: 'trainer-lost', text: `Control lost: ${LOSS_REASON[now.lost]}` });
  }
  return events;
}

export function RideAnnouncer({
  trainer,
  workout,
  storage,
  onSaid,
  clock,
}: RideAnnouncerProps): JSX.Element {
  const [said, setSaid] = useState('');
  // Read once, when the screen appears: a preference is a setting, not a live
  // value, and a rider changes it on Settings rather than mid-interval.
  const [preference] = useState(() =>
    readAnnouncementPreference(storage === undefined ? deviceStorage() : storage),
  );
  const announcer = useRef<AnnouncerState>(INITIAL_ANNOUNCER);
  const seen = useRef<Seen>(seenIn(trainer, workout));
  /** The boundary last offered, so one change is announced once. */
  const offered = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useRef(clock ?? wallSeconds);
  now.current = clock ?? wallSeconds;
  const told = useRef(onSaid);
  told.current = onSaid;

  /**
   * One call of the core. ⚠️ The only place this component writes the region,
   * which is the whole of #445: a second writer is a second voice.
   */
  const hear = useRef((events: readonly AnnouncementEvent[]): void => {
    clearTimeout(timer.current);
    const at = now.current();
    const heard = announce(announcer.current, {
      now: at,
      readings: [],
      events,
      // Nothing here is a reading: the Ride screen's numbers are `MetricGrid`'s
      // own per-cell sentences, and a cadence left at its default would say
      // "No power reading" every minute.
      preference: { ...preference, powerEverySeconds: 'never', distanceEvery: 'never' },
    });
    announcer.current = heard.state;
    if (heard.sentence !== undefined && heard.kind !== undefined) {
      setSaid(heard.sentence);
      told.current?.(heard.kind);
    }
    // A sentence that is WAITING for the window has no render to carry it — a
    // paused workout re-renders nothing — so ask again when the window opens.
    const last = heard.state.lastSpokenAt;
    if (heard.state.pending !== undefined && last !== undefined) {
      const wait = Math.max(0, ANNOUNCE_WINDOW_SECONDS - (at - last)) * 1000;
      timer.current = setTimeout(() => {
        hear.current([]);
      }, wait + 1);
    }
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const lead = preference.intervalLeadSeconds;
  const timeline = workout?.timeline;
  const elapsedSeconds = workout?.elapsedSeconds;
  const status = workout?.status;
  const { lost, releaseFault, fault, nowRiding } = seenIn(trainer, workout);

  useEffect(() => {
    const events = changes(seen.current, { lost, releaseFault, fault, nowRiding });
    seen.current = { lost, releaseFault, fault, nowRiding };
    if (
      preference.enabled &&
      lead !== 'never' &&
      status === 'running' &&
      timeline !== undefined &&
      elapsedSeconds !== undefined
    ) {
      const ahead = upcomingBlock(timeline, elapsedSeconds, lead);
      if (ahead !== undefined && ahead.boundary !== offered.current) {
        offered.current = ahead.boundary;
        events.push({ kind: 'interval-ahead', text: ahead.sentence });
      }
    }
    hear.current(events);
  }, [lost, releaseFault, fault, nowRiding, preference, lead, timeline, elapsedSeconds, status]);

  return (
    <p className="oyl-visually-hidden" role="status" data-oyl-announcer="ride">
      {said}
    </p>
  );
}
