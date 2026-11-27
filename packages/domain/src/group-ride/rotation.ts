// SPDX-License-Identifier: Apache-2.0

/**
 * **The paceline rotation, for one line** — #3299, epic #3296, ADR 0101
 * (#3297, Proposed).
 *
 * Who is on the front, when a pull ends, the pull-off, the drift back and the
 * latch onto the last wheel. One pure, seeded function, {@link stepRotation},
 * which **decides once per decision window** ({@link ROTATION_WINDOW_MS},
 * ADR 0067 D-6): a step inside a window returns the last window's decision
 * unchanged, so the tick rate changes nothing. A pull-off press that arrives
 * inside a window is held for the next one, not lost.
 *
 * ## The phases (`roles.ts`)
 *
 * | From | To | When |
 * |---|---|---|
 * | `forming` | `steady` | every gap is inside the wheel band, or {@link ROTATION_FORMING_MOST_MS} has passed |
 * | `steady` | `changing` | a bot's pull timer ends or it is tired; the rider presses pull off; the rider fades on the front |
 * | `changing` | `latching` | the old front rider is behind the last wheel |
 * | `latching` | `steady` | the old front rider's gap to the last wheel is inside the wheel band |
 * | `waiting`, `regrouping` | — | `no-drop.ts` (#3301) moves the line into and out of them; here they hold |
 *
 * ## A bot's pull
 *
 * Its length is fixed when it reaches the front: {@link ROTATION_BOT_PULL_MS}
 * times its strength (its critical power over the line's mean, held to
 * {@link ROTATION_PULL_STRENGTH_LEAST} – {@link ROTATION_PULL_STRENGTH_MOST}),
 * times what is left of its reserve (`lap-race/wbal.ts`, read, not copied),
 * times a seeded variation of ±{@link ROTATION_PULL_VARIATION}. It ends early
 * when the bot is tired: exhausted, or under {@link ROTATION_TIRED_WBAL_SHARE}
 * of its W′. **Every bot pulls at the same speed**, the group's, and a bot
 * arriving on the front does not lift: in its first window there it is asked
 * for the speed the group rode in the window before. A bot aside eases by
 * {@link ROTATION_EASE_SHARE} so the line passes.
 *
 * **No pull change starts** on a bend tighter than
 * {@link ROTATION_BEND_RADIUS_METRES} or from {@link ROTATION_CLIMB_HOLD_METRES}
 * before a climb to its crest. A change due there is deferred, not dropped: its
 * cause still holds when the hold lifts, so it starts in the first window after.
 *
 * ## The rider's pull
 *
 * The rider reaches the front as any member does. Their pull's target is
 * {@link ROTATION_RIDER_PULL_MS}; at it the rotation asks for a pull-off
 * (`pull-off-due`), and once more {@link ROTATION_RIDER_GRACE_MS} later
 * (`pull-off-repeat`), and never again in that pull. The rider may press pull
 * off at any time, and the line comes round at once. With no press, a rider
 * whose speed is under the group's by {@link ROTATION_FADE_MARGIN_MPS} for
 * {@link ROTATION_FADE_DWELL_MS} is brought round anyway. Neither a press nor a
 * fade is held by a bend or a climb: nobody is kept on the front.
 *
 * A rider who sits in is never put on the front: the bot behind them pulls
 * through in their place. **A rider never has to signal anything to stay in
 * the group**: one who holds a wheel and does nothing else only ever holds the
 * line's own roles.
 *
 * ## What it reads, and what it does not
 *
 * Odometer distances, speeds, the bots' reserves, two facts about the road
 * ahead and the rider's press and sit-in choice. **No lateral position**
 * enters (ADR 0038 D-3.4): a member drawn to the side is simply somewhere in
 * the odometer order. It returns roles, the speed each bot is asked to ride
 * and {@link RotationRequest} facts for the cue selector (#3302), never a
 * sentence, never a power, and nothing that reaches a trainer.
 *
 * ## Only `+ − × ÷`, `min` and `max` (ADR 0067 D-5.2)
 *
 * No clock, no `Math.random`, no exponential: draws come from the line's seed
 * through the lap race's own generator, so a room could run this later.
 * `rotation.test.ts` scans this file for anything else.
 *
 * Every number here is *proposed*: a feel parameter for the harness (#3309)
 * and the owner's ride, not a sourced value.
 */

import { BOT_TACTICS_WINDOW_MS } from '../lap-race/archetype';
import { nextUnit, raceRandom, type RaceRandom } from '../lap-race/random';
import { BOT_TACTIC_WHEEL_FURTHEST_METRES } from '../lap-race/tactics';
import type { BotCapacity, BotEnergy } from '../lap-race/wbal';
import { GroupRideError } from './errors';
import { lineRoles, unknownValue, type LinePhase, type RiderRole } from './roles';

/** The length of a decision window, ms of ride time: the lap-race bots' **1 s**. */
export const ROTATION_WINDOW_MS = BOT_TACTICS_WINDOW_MS;

/** The longest the line may take to form before it rotates, ms: **60 s**. */
export const ROTATION_FORMING_MOST_MS = 60_000;

/** A gap to the wheel ahead this or less, odometer metres, is on the wheel: the bots' **1 m** band. */
export const ROTATION_WHEEL_BAND_METRES = BOT_TACTIC_WHEEL_FURTHEST_METRES;

/** A bot of the line's mean strength, with a full reserve, pulls this long, ms: **30 s**. */
export const ROTATION_BOT_PULL_MS = 30_000;

/** The least a bot's strength may scale its pull by: **0.5**. */
export const ROTATION_PULL_STRENGTH_LEAST = 0.5;

/** The most a bot's strength may scale its pull by: **1.5**. */
export const ROTATION_PULL_STRENGTH_MOST = 1.5;

/** A bot's pull varies by up to this share either way, from the seed: **10 %**, so the line is no metronome. */
export const ROTATION_PULL_VARIATION = 0.1;

/** A bot on the front with less than this share of its W′ left is tired, and pulls off: **a quarter**. */
export const ROTATION_TIRED_WBAL_SHARE = 0.25;

/** A bot aside eases by this share of the group's speed so the line passes: **12 %**. */
export const ROTATION_EASE_SHARE = 0.12;

/** A bot latching on rides this share above the line's speed to close the gap: **12 %**, the ease it gave up. */
export const ROTATION_CATCH_UP_SHARE = 0.12;

/**
 * A rider latching on has this gap or less to the last wheel, odometer metres,
 * to be on it: **5 m**. A bot can be asked to close up and the rider cannot, so
 * their band is wider (ADR 0101 draft, #3326: up to 5 m is ordinary latching).
 */
export const ROTATION_RIDER_WHEEL_BAND_METRES = 5;

/** The rider's pull's target, ms: **30 s**. */
export const ROTATION_RIDER_PULL_MS = 30_000;

/** After the target, the pull-off is asked for once more this much later, ms: **10 s**. */
export const ROTATION_RIDER_GRACE_MS = 10_000;

/** A rider on the front this far under the group's speed is fading, m/s: **1.5 km/h**. */
export const ROTATION_FADE_MARGIN_MPS = 1.5 / 3.6;

/** A rider fading on the front this long is brought round, ms: **5 s**. */
export const ROTATION_FADE_DWELL_MS = 5_000;

/** No pull change starts this close before a climb, metres, nor on it: **300**. */
export const ROTATION_CLIMB_HOLD_METRES = 300;

/** No pull change starts on a bend tighter than this radius, metres: **25**. */
export const ROTATION_BEND_RADIUS_METRES = 25;

/** The fewest members a line rotates with. */
export const ROTATION_LINE_LEAST = 2;

/** The most members a line holds: seven bots and the rider (ADR 0101 question 3, proposed). */
export const ROTATION_LINE_MOST = 8;

/** A member of the line: a bot, with its capacity fixed at the start, or the rider. */
export type LineMember =
  | { readonly id: string; readonly kind: 'bot'; readonly capacity: BotCapacity }
  | { readonly id: string; readonly kind: 'rider' };

/** A line at its start. */
export interface RotationSetup {
  /** The members, front first, in the order they roll out. */
  readonly line: readonly LineMember[];
  /** The line's seed: every pull's variation is drawn from it and nothing else. */
  readonly seed: number;
  /** The ride time it starts at, ms. */
  readonly atMs: number;
}

/** Where a member is, along the road only. */
export interface MemberView {
  /** Odometer, metres. */
  readonly distanceM: number;
  /** Speed, m/s. */
  readonly speedMps: number;
}

/** What the rotation reads, once per decision window. */
export interface RotationView {
  /** Ride time, ms. Time is an input: nothing here reads a clock. */
  readonly atMs: number;
  /** The group's speed now, m/s: what the plan (#3298) asks of the line. */
  readonly groupSpeedMps: number;
  /** Every member's odometer and speed, by id. */
  readonly members: Readonly<Record<string, MemberView>>;
  /** Every bot's reserve now, by id (`lap-race/wbal.ts`). */
  readonly energy: Readonly<Record<string, BotEnergy>>;
  /** Metres to the next climb's start from the front, 0 on one, `null` with none ahead (`courseHillsAhead`). */
  readonly climbAheadM: number | null;
  /** The tightest bend radius on the road just ahead, metres, `null` where it is straight. */
  readonly bendRadiusM: number | null;
  /** Whether the rider pressed pull off since the last step. */
  readonly riderSignal: boolean;
  /** Whether the rider has chosen to sit in. */
  readonly riderSittingIn: boolean;
}

/** A fact for the cue selector (#3302): never a sentence. */
export type RotationRequest =
  /** The rider's pull has reached its target: a pull-off is asked for. */
  | { readonly kind: 'pull-off-due' }
  /** The one repeat of that ask, after the grace. */
  | { readonly kind: 'pull-off-repeat' };

/** The pull running on the front. */
export interface RotationPull {
  readonly by: string;
  readonly fromMs: number;
  /** When a bot's pull ends, or when the rider's reaches its target. */
  readonly endsAtMs: number;
  /** How many pull-off asks the rider has had in this pull: at most two. */
  readonly asked: 0 | 1 | 2;
  /** Since when the rider on the front has been fading, or `null`. */
  readonly fadingSinceMs: number | null;
}

/** A line's whole state between windows: plain data. */
export interface RotationState {
  readonly phase: LinePhase;
  /** The members as the line was set up: their kinds and capacities. */
  readonly line: readonly LineMember[];
  /** The line, front first, without the member aside. */
  readonly order: readonly string[];
  /** The old front member, out of the line while it drifts back and latches on, or `null`. */
  readonly aside: string | null;
  readonly pull: RotationPull | null;
  readonly startedAtMs: number;
  /** The first instant the next decision may be made at. */
  readonly nextWindowAtMs: number;
  /** The instant of the last decision, or `null` before the first. */
  readonly decidedAtMs: number | null;
  /** The group's speed in the last window, m/s, or `null` before the first. */
  readonly groupSpeedMps: number | null;
  /** A pull-off press held from inside a window for the next decision. */
  readonly signalPending: boolean;
  readonly random: RaceRandom;
  /** The last decision's roles, returned unchanged inside a window. */
  readonly roles: Readonly<Record<string, RiderRole>>;
  /** The last decision's speed for each bot, m/s. */
  readonly demands: Readonly<Record<string, number>>;
}

/** One step's answer. */
export interface RotationStep {
  readonly state: RotationState;
  /** Every member's role. */
  readonly roles: Readonly<Record<string, RiderRole>>;
  /** The speed each bot is asked to ride, m/s, by id. Never the rider's: their physics is their own. */
  readonly demands: Readonly<Record<string, number>>;
  /** Facts made in this window, for the cue selector; empty inside a window. */
  readonly requests: readonly RotationRequest[];
}

const outOfRange = (what: string): GroupRideError => new GroupRideError('view-out-of-range', what);

const finite = (value: number): boolean => Number.isFinite(value);

function riderIdOf(line: readonly LineMember[]): string | null {
  return line.find((member) => member.kind === 'rider')?.id ?? null;
}

function checkLine(line: readonly LineMember[]): void {
  const ids = new Set(line.map((member) => member.id));
  const riders = line.filter((member) => member.kind === 'rider').length;
  const badBot = line.some(
    (member) =>
      member.kind === 'bot' &&
      !(
        finite(member.capacity.cpWatts) &&
        member.capacity.cpWatts > 0 &&
        finite(member.capacity.wPrimeJoules) &&
        member.capacity.wPrimeJoules > 0
      ),
  );
  if (
    line.length < ROTATION_LINE_LEAST ||
    line.length > ROTATION_LINE_MOST ||
    ids.size !== line.length ||
    line.some((member) => member.id.length === 0) ||
    riders > 1 ||
    badBot
  ) {
    throw new GroupRideError(
      'line-invalid',
      'a line holds two to eight members with distinct ids, at most one rider, and bots with a critical power and W prime above zero',
    );
  }
}

/** The line at its start: `forming`, the order as given, no pull yet. */
export function startRotation(setup: RotationSetup): RotationState {
  checkLine(setup.line);
  if (!Number.isSafeInteger(setup.seed)) {
    throw new GroupRideError('seed-not-integer', 'a line seed must be a whole number');
  }
  if (!finite(setup.atMs)) throw outOfRange('a line start must be a finite number of milliseconds');
  const order = setup.line.map((member) => member.id);
  return {
    phase: 'forming',
    line: setup.line,
    order,
    aside: null,
    pull: null,
    startedAtMs: setup.atMs,
    nextWindowAtMs: setup.atMs,
    decidedAtMs: null,
    groupSpeedMps: null,
    signalPending: false,
    random: raceRandom(setup.seed),
    roles: lineRoles({
      order,
      aside: null,
      phase: 'forming',
      riderId: riderIdOf(setup.line),
      sittingIn: false,
    }),
    demands: {},
  };
}

function checkView(state: RotationState, view: RotationView): void {
  if (!finite(view.atMs)) throw outOfRange('a view time must be a finite number of milliseconds');
  if (state.decidedAtMs !== null && view.atMs < state.decidedAtMs) {
    throw new GroupRideError(
      'instant-out-of-order',
      'a view time must not be before the last decision',
    );
  }
  if (!(finite(view.groupSpeedMps) && view.groupSpeedMps >= 0)) {
    throw outOfRange('a group speed must be a finite number of metres a second of at least zero');
  }
  for (const member of state.line) {
    const seen = view.members[member.id];
    if (!(seen && finite(seen.distanceM) && finite(seen.speedMps) && seen.speedMps >= 0)) {
      throw outOfRange('every member needs a finite odometer and a finite speed of at least zero');
    }
    if (member.kind !== 'bot') continue;
    const energy = view.energy[member.id];
    if (!(
      energy &&
      finite(energy.wbalJoules) &&
      energy.wbalJoules >= 0 &&
      energy.wbalJoules <= member.capacity.wPrimeJoules
    )) {
      throw outOfRange('every bot needs a W prime balance from zero to its W prime');
    }
  }
  if (view.climbAheadM !== null && !(finite(view.climbAheadM) && view.climbAheadM >= 0)) {
    throw outOfRange('the metres to a climb must be finite and at least zero, or null');
  }
  if (view.bendRadiusM !== null && !(finite(view.bendRadiusM) && view.bendRadiusM > 0)) {
    throw outOfRange('a bend radius must be finite and above zero, or null');
  }
}

/** A member's odometer in `view`, checked present by {@link checkView}. */
function distanceOf(view: RotationView, id: string): number {
  return (view.members[id] as MemberView).distanceM;
}

/** Whether every gap from one member to the next in `order` is on the wheel. */
function closedUp(view: RotationView, order: readonly string[]): boolean {
  return order.every(
    (id, at) =>
      at === 0 ||
      distanceOf(view, order[at - 1] as string) - distanceOf(view, id) <=
        ROTATION_WHEEL_BAND_METRES,
  );
}

/** `order` with a sitting-in rider moved off the front, behind the member who pulls through. */
function seated(order: readonly string[], riderId: string | null, sittingIn: boolean): string[] {
  const seats = [...order];
  if (sittingIn && seats.length > 1 && seats[0] === riderId) {
    seats[0] = seats[1] as string;
    seats[1] = riderId;
  }
  return seats;
}

/** A pull for whoever is at the front of `order` from `atMs`, with the generator after any draw. */
function startPull(
  state: RotationState,
  view: RotationView,
  front: string,
  random: RaceRandom,
): { readonly pull: RotationPull; readonly random: RaceRandom } {
  const member = state.line.find((each) => each.id === front) as LineMember;
  if (member.kind === 'rider') {
    return {
      pull: {
        by: front,
        fromMs: view.atMs,
        endsAtMs: view.atMs + ROTATION_RIDER_PULL_MS,
        asked: 0,
        fadingSinceMs: null,
      },
      random,
    };
  }
  let total = 0;
  let bots = 0;
  for (const each of state.line) {
    if (each.kind !== 'bot') continue;
    total += each.capacity.cpWatts;
    bots += 1;
  }
  const strength = Math.min(
    ROTATION_PULL_STRENGTH_MOST,
    Math.max(ROTATION_PULL_STRENGTH_LEAST, member.capacity.cpWatts / (total / bots)),
  );
  const reserve = (view.energy[front] as BotEnergy).wbalJoules / member.capacity.wPrimeJoules;
  const { value, next } = nextUnit(random);
  const variation = 1 + ROTATION_PULL_VARIATION * (2 * value - 1);
  const length = ROTATION_BOT_PULL_MS * strength * (0.5 + 0.5 * reserve) * variation;
  return {
    pull: {
      by: front,
      fromMs: view.atMs,
      endsAtMs: view.atMs + length,
      asked: 0,
      fadingSinceMs: null,
    },
    random: next,
  };
}

/** Whether a bot on the front is tired: exhausted, or under {@link ROTATION_TIRED_WBAL_SHARE} of W′. */
function tired(state: RotationState, view: RotationView, id: string): boolean {
  const member = state.line.find((each) => each.id === id);
  if (member?.kind !== 'bot') return false;
  const energy = view.energy[id] as BotEnergy;
  return (
    energy.exhausted || energy.wbalJoules < ROTATION_TIRED_WBAL_SHARE * member.capacity.wPrimeJoules
  );
}

/** Whether the road ahead holds a pull change: a tight bend, or a climb close ahead or under the front. */
function held(view: RotationView): boolean {
  return (
    (view.climbAheadM !== null && view.climbAheadM <= ROTATION_CLIMB_HOLD_METRES) ||
    (view.bendRadiusM !== null && view.bendRadiusM < ROTATION_BEND_RADIUS_METRES)
  );
}

interface Decided {
  readonly phase: LinePhase;
  readonly order: readonly string[];
  readonly aside: string | null;
  readonly pull: RotationPull | null;
  readonly random: RaceRandom;
  readonly requests: readonly RotationRequest[];
}

/**
 * The steady line's decision: the pull runs on, or the front comes round. A
 * change needs somebody to take the front: a line whose only other member is
 * a rider sitting in does not rotate.
 */
function decideSteady(
  state: RotationState,
  view: RotationView,
  order: readonly string[],
  pull: RotationPull,
  signal: boolean,
  riderId: string | null,
): Decided {
  const front = order[0] as string;
  const hold = held(view);
  const keep = (next: RotationPull, requests: readonly RotationRequest[] = []): Decided => ({
    phase: 'steady',
    order,
    aside: null,
    pull: next,
    random: state.random,
    requests,
  });
  let comeRound: boolean;
  let running = pull;
  const requests: RotationRequest[] = [];
  if (front === riderId) {
    const speed = (view.members[front] as MemberView).speedMps;
    const fading = speed < view.groupSpeedMps - ROTATION_FADE_MARGIN_MPS;
    const fadingSinceMs = fading ? (pull.fadingSinceMs ?? view.atMs) : null;
    running = { ...pull, fadingSinceMs };
    const faded = fadingSinceMs !== null && view.atMs - fadingSinceMs >= ROTATION_FADE_DWELL_MS;
    comeRound = signal || faded;
    if (!comeRound && !hold) {
      if (running.asked === 0 && view.atMs >= running.endsAtMs) {
        running = { ...running, asked: 1 };
        requests.push({ kind: 'pull-off-due' });
      } else if (running.asked === 1 && view.atMs >= running.endsAtMs + ROTATION_RIDER_GRACE_MS) {
        running = { ...running, asked: 2 };
        requests.push({ kind: 'pull-off-repeat' });
      }
    }
  } else {
    comeRound = !hold && (view.atMs >= pull.endsAtMs || tired(state, view, front));
  }
  const rest = seated(order.slice(1), riderId, view.riderSittingIn);
  if (!comeRound || rest.length === 0 || (rest[0] === riderId && view.riderSittingIn)) {
    return keep(running, requests);
  }
  const started = startPull(state, view, rest[0] as string, state.random);
  return {
    phase: 'changing',
    order: rest,
    aside: front,
    pull: started.pull,
    random: started.random,
    requests: [],
  };
}

function decide(state: RotationState, view: RotationView, signal: boolean): Decided {
  const riderId = riderIdOf(state.line);
  const order = seated(state.order, riderId, view.riderSittingIn);
  const same = (phase: LinePhase, pull: RotationPull | null = state.pull): Decided => ({
    phase,
    order,
    aside: state.aside,
    pull,
    random: state.random,
    requests: [],
  });
  const pullFor = (): { readonly pull: RotationPull; readonly random: RaceRandom } =>
    startPull(state, view, order[0] as string, state.random);
  switch (state.phase) {
    case 'forming': {
      if (!closedUp(view, order) && view.atMs - state.startedAtMs < ROTATION_FORMING_MOST_MS) {
        return same('forming', null);
      }
      const started = pullFor();
      return { ...same('steady', started.pull), random: started.random };
    }
    case 'steady': {
      // A rider who sits in while on the front hands it to the member behind,
      // who starts a pull of their own.
      if (state.pull === null || state.pull.by !== order[0]) {
        const started = pullFor();
        return { ...same('steady', started.pull), random: started.random };
      }
      return decideSteady(state, view, order, state.pull, signal, riderId);
    }
    case 'changing': {
      const aside = state.aside as string;
      const last = order[order.length - 1] as string;
      return same(distanceOf(view, aside) < distanceOf(view, last) ? 'latching' : 'changing');
    }
    case 'latching': {
      const aside = state.aside as string;
      const last = order[order.length - 1] as string;
      const band =
        aside === riderIdOf(state.line)
          ? ROTATION_RIDER_WHEEL_BAND_METRES
          : ROTATION_WHEEL_BAND_METRES;
      if (distanceOf(view, last) - distanceOf(view, aside) > band) {
        return same('latching');
      }
      return { ...same('steady'), order: [...order, aside], aside: null };
    }
    // `no-drop.ts` (#3301) moves the line into and out of these; here they hold.
    case 'waiting':
    case 'regrouping':
      return same(state.phase);
    default:
      return unknownValue(state.phase);
  }
}

/**
 * The line after one step at `view`. Inside a decision window it returns the
 * last decision unchanged, holding a pull-off press for the next window; at a
 * window it decides: see the file comment for every transition.
 *
 * @throws {GroupRideError} `view-out-of-range` for a view that is not a
 *   ride's, `instant-out-of-order` for one before the last decision, and
 *   `unknown-value` for a phase this module does not name.
 */
export function stepRotation(state: RotationState, view: RotationView): RotationStep {
  checkView(state, view);
  if (view.atMs < state.nextWindowAtMs) {
    const held = view.riderSignal ? { ...state, signalPending: true } : state;
    return { state: held, roles: state.roles, demands: state.demands, requests: [] };
  }
  const signal = view.riderSignal || state.signalPending;
  const decided = decide(state, view, signal);
  const riderId = riderIdOf(state.line);
  const roles = lineRoles({
    order: decided.order,
    aside: decided.aside,
    phase: decided.phase,
    riderId,
    sittingIn: view.riderSittingIn,
  });
  // A member new to the front asks for the speed the group rode in the
  // window before, so it does not lift (#3299).
  const lineSpeed =
    decided.order[0] !== state.order[0] && state.groupSpeedMps !== null
      ? state.groupSpeedMps
      : view.groupSpeedMps;
  const demands: Record<string, number> = {};
  for (const member of state.line) {
    if (member.kind !== 'bot') continue;
    const role = roles[member.id];
    demands[member.id] =
      role === 'drifting-back'
        ? lineSpeed * (1 - ROTATION_EASE_SHARE)
        : role === 'latching'
          ? lineSpeed * (1 + ROTATION_CATCH_UP_SHARE)
          : lineSpeed;
  }
  const following = state.nextWindowAtMs + ROTATION_WINDOW_MS;
  const next: RotationState = {
    ...state,
    phase: decided.phase,
    order: decided.order,
    aside: decided.aside,
    pull: decided.pull,
    random: decided.random,
    nextWindowAtMs: following > view.atMs ? following : view.atMs + ROTATION_WINDOW_MS,
    decidedAtMs: view.atMs,
    groupSpeedMps: view.groupSpeedMps,
    // A press is spent by a steady line; one made while the rider has just
    // reached the front, before the line is steady, waits for it.
    signalPending: signal && state.phase !== 'steady' && decided.order[0] === riderId,
    roles,
    demands,
  };
  return { state: next, roles, demands, requests: decided.requests };
}
