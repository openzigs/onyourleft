// SPDX-License-Identifier: Apache-2.0

/**
 * Test support for #3299 and #3302: a whole line ridden on made-up speeds, one
 * decision window a second, without the physics, so a ride of an hour runs in
 * milliseconds. Members on a wheel hold it exactly, half a metre back; the
 * front rides what it is asked; a member aside eases as it is asked. The line
 * on the one physics is #3300's, and the harness with scripted riders #3309's.
 */

import type { BotEnergy } from '../lap-race/wbal';
import type { LinePhase, RiderRole } from './roles';
import {
  ROTATION_CATCH_UP_SHARE,
  ROTATION_EASE_SHARE,
  ROTATION_WINDOW_MS,
  startRotation,
  stepRotation,
  type LineMember,
  type MemberView,
  type RotationRequest,
  type RotationState,
  type RotationView,
} from './rotation';

/** The gap a member on a wheel holds in the script, odometer metres. */
export const SCRIPT_WHEEL_GAP_METRES = 0.5;

/** The group's speed in the script unless a ride names its own: **30 km/h**. */
export const SCRIPT_GROUP_SPEED_MPS = 30 / 3.6;

/** How the scripted rider rides. */
export interface ScriptedRider {
  /** How long into their own pull they press pull off, ms; absent, never. */
  readonly signalAfterMs?: number;
  /** On the front, from this long into their pull, they ride this far under the group's speed. */
  readonly fade?: { readonly afterMs: number; readonly underMps: number };
  /** From when they sit in, ms of ride time; absent, never. */
  readonly sittingInFromMs?: number;
}

/** A ride for {@link rideLine}. */
export interface LineScript {
  readonly line: readonly LineMember[];
  readonly seed: number;
  readonly seconds: number;
  readonly rider?: ScriptedRider;
  /** The group's speed at each instant; absent, {@link SCRIPT_GROUP_SPEED_MPS}. */
  readonly groupSpeed?: (atMs: number) => number;
  /** Metres to the next climb from the front's odometer; absent, none. */
  readonly climbAheadM?: (frontM: number) => number | null;
  /** The tightest bend ahead of the front's odometer; absent, straight. */
  readonly bendRadiusM?: (frontM: number) => number | null;
  /** A bot's reserve at an instant; absent, full. */
  readonly energy?: (id: string, atMs: number) => BotEnergy;
  /** Steps per window: above 1, the steps between windows read views that move on. */
  readonly ticksPerWindow?: number;
}

/** One decision window of a scripted ride. */
export interface LineWindow {
  readonly atMs: number;
  readonly phase: LinePhase;
  readonly order: readonly string[];
  readonly roles: Readonly<Record<string, RiderRole>>;
  readonly demands: Readonly<Record<string, number>>;
  readonly requests: readonly RotationRequest[];
  /** The view the window decided on. */
  readonly view: RotationView;
}

/** The front member's id in a view's terms: the first of the order. */
function frontOf(state: RotationState): string {
  return state.order[0] as string;
}

/** A scripted ride of `script.seconds`, one window a second from 0. */
export function rideLine(script: LineScript): {
  readonly windows: readonly LineWindow[];
  readonly state: RotationState;
} {
  const riderId = script.line.find((member) => member.kind === 'rider')?.id ?? null;
  const speedAt = script.groupSpeed ?? (() => SCRIPT_GROUP_SPEED_MPS);
  const ticks = script.ticksPerWindow ?? 1;
  let state = startRotation({ line: script.line, seed: script.seed, atMs: 0 });
  const distance = new Map<string, number>();
  const speed = new Map<string, number>();
  script.line.forEach((member, at) => {
    distance.set(member.id, -at * SCRIPT_WHEEL_GAP_METRES);
    speed.set(member.id, speedAt(0));
  });

  const viewAt = (atMs: number, along: number, signal: boolean): RotationView => {
    const members: Record<string, MemberView> = {};
    const energy: Record<string, BotEnergy> = {};
    for (const member of script.line) {
      members[member.id] = {
        distanceM: (distance.get(member.id) as number) + along * (speed.get(member.id) as number),
        speedMps: speed.get(member.id) as number,
      };
      if (member.kind === 'bot') {
        energy[member.id] = script.energy?.(member.id, atMs) ?? {
          wbalJoules: member.capacity.wPrimeJoules,
          exhausted: false,
        };
      }
    }
    const frontM = (members[frontOf(state)] as MemberView).distanceM;
    return {
      atMs,
      groupSpeedMps: speedAt(atMs),
      members,
      energy,
      climbAheadM: script.climbAheadM?.(frontM) ?? null,
      bendRadiusM: script.bendRadiusM?.(frontM) ?? null,
      riderSignal: signal,
      riderSittingIn:
        script.rider?.sittingInFromMs !== undefined && atMs >= script.rider.sittingInFromMs,
    };
  };

  const windows: LineWindow[] = [];
  const seconds = script.seconds;
  for (let second = 0; second < seconds; second += 1) {
    const atMs = second * ROTATION_WINDOW_MS;
    const intoPull = state.pull === null ? 0 : atMs - state.pull.fromMs;
    const riderOnFront = riderId !== null && state.phase === 'steady' && frontOf(state) === riderId;
    const signal =
      riderOnFront &&
      script.rider?.signalAfterMs !== undefined &&
      intoPull >= script.rider.signalAfterMs;
    const view = viewAt(atMs, 0, signal);
    const step = stepRotation(state, view);
    state = step.state;
    windows.push({
      atMs,
      phase: state.phase,
      order: state.order,
      roles: step.roles,
      demands: step.demands,
      requests: step.requests,
      view,
    });

    // Move everyone on to the next window, by the roles just decided.
    const group = speedAt(atMs);
    const front = frontOf(state);
    const fade = script.rider?.fade;
    const fading =
      front === riderId &&
      fade !== undefined &&
      state.pull !== null &&
      atMs - state.pull.fromMs >= fade.afterMs;
    const frontSpeed =
      front === riderId
        ? fading
          ? group - (fade?.underMps ?? 0)
          : group
        : (step.demands[front] as number);
    const aside = state.aside;

    // The steps inside the window read the line moving on; they decide nothing.
    for (let tick = 1; tick < ticks; tick += 1) {
      const inside = stepRotation(
        state,
        viewAt(atMs + (tick * ROTATION_WINDOW_MS) / ticks, tick / ticks, false),
      );
      state = inside.state;
    }

    const frontAt = (distance.get(front) as number) + frontSpeed;
    distance.set(front, frontAt);
    speed.set(front, frontSpeed);
    let ahead = frontAt;
    for (const id of state.order.slice(1)) {
      ahead -= SCRIPT_WHEEL_GAP_METRES;
      distance.set(id, ahead);
      speed.set(id, frontSpeed);
    }
    if (aside !== null) {
      // A bot rides what it is asked, in both roles; the rider, who is not
      // asked, eases and closes up by the same shares.
      const role = step.roles[aside];
      const was = distance.get(aside) as number;
      const asked =
        step.demands[aside] ??
        group * (role === 'latching' ? 1 + ROTATION_CATCH_UP_SHARE : 1 - ROTATION_EASE_SHARE);
      // It cannot pass the last wheel: it closes up to it and no further.
      const at =
        role === 'latching' ? Math.min(ahead - SCRIPT_WHEEL_GAP_METRES, was + asked) : was + asked;
      distance.set(aside, at);
      speed.set(aside, asked);
    }
  }
  return { windows, state };
}

/** The members who were on the front, in turn, one entry for each spell there. */
export function frontSpells(
  windows: readonly LineWindow[],
): readonly { readonly id: string; readonly windows: number }[] {
  const spells: { id: string; windows: number }[] = [];
  for (const window of windows) {
    const front = window.order[0] as string;
    const last = spells[spells.length - 1];
    if (last?.id === front) last.windows += 1;
    else spells.push({ id: front, windows: 1 });
  }
  return spells;
}
