// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A stand-in {@link InstancePort} for the views, the accessibility walk and
 * the browser harnesses (#777). Test support, never shipped.
 *
 * It keeps what an instance would: the connection, the athlete's display name
 * and their devices, and answers every method from that — so a screen that
 * showed the name it was typed rather than the name read back would show the
 * wrong one here too. It sends nothing anywhere.
 */

import type {
  ConnectOutcome,
  DevicesOutcome,
  InstanceDevice,
  InstancePort,
  InstanceState,
} from './instance-port';
import {
  NOTHING_CHANGED_TEXT,
  type ModerationList,
  type ModerationLogEntry,
  type ModerationOutcome,
  type ModerationPort,
  type ModerationStanding,
  type OpenReport,
  type PendingRegistration,
  type SuspendedAccount,
} from './moderation-port';

export interface ScriptedInstance {
  readonly port: InstancePort;
  /** Every method called, in order. */
  readonly calls: string[];
  /** What the instance holds — change it to change what the next read answers. */
  held: {
    connected: boolean;
    origin: string;
    instanceName: string | null;
    displayName: string;
    sourceUrl: string | null;
    devices: readonly InstanceDevice[];
  };
}

/** Two devices, one of them this one — the shape `GET /v1/auth/devices` answers. */
export const SCRIPTED_DEVICES: readonly InstanceDevice[] = [
  {
    publicKey: 'a1'.repeat(32),
    addedAt: 1_790_000_000,
    lastUsedAt: 1_790_500_000,
    revokedAt: null,
    thisDevice: true,
  },
  {
    publicKey: 'b2'.repeat(32),
    addedAt: 1_790_100_000,
    lastUsedAt: null,
    revokedAt: null,
    thisDevice: false,
  },
];

export interface ScriptedInstanceOptions {
  readonly connected?: boolean;
  /** What `connect` answers, when not a plain success. */
  readonly connectAnswer?: ConnectOutcome;
  /** What `current` answers when connected, when not a plain `connected`. */
  readonly state?: InstanceState;
}

export function scriptedInstance(options: ScriptedInstanceOptions = {}): ScriptedInstance {
  const calls: string[] = [];
  const scripted: ScriptedInstance = {
    calls,
    held: {
      connected: options.connected ?? false,
      origin: 'https://ride.example',
      instanceName: 'Lanes of the Weald',
      displayName: 'Rider',
      sourceUrl:
        'https://github.com/openzigs/onyourleft/tree/0123456789abcdef0123456789abcdef01234567',
      devices: SCRIPTED_DEVICES,
    },
    port: {
      current: () => {
        calls.push('current');
        const { held } = scripted;
        if (!held.connected) return Promise.resolve({ kind: 'not-connected' });
        return Promise.resolve(
          options.state ?? {
            kind: 'connected',
            origin: held.origin,
            instanceName: held.instanceName,
            displayName: held.displayName,
            sourceUrl: held.sourceUrl,
          },
        );
      },
      connect: (address, displayName) => {
        calls.push(`connect ${address}`);
        const answer = options.connectAnswer ?? { kind: 'connected' };
        if (answer.kind === 'connected') {
          scripted.held.connected = true;
          if (displayName.trim() !== '') scripted.held.displayName = displayName.trim();
        }
        return Promise.resolve(answer);
      },
      devices: () => {
        calls.push('devices');
        const answer: DevicesOutcome = scripted.held.connected
          ? { kind: 'listed', devices: scripted.held.devices }
          : { kind: 'unavailable', text: 'not connected' };
        return Promise.resolve(answer);
      },
      disconnect: () => {
        calls.push('disconnect');
        scripted.held.connected = false;
        return Promise.resolve();
      },
    },
  };
  return scripted;
}

/**
 * A stand-in {@link ModerationPort} (#955) for the Moderation screen, the
 * accessibility walk and the browser harnesses. It keeps what an instance's
 * moderators' routes would — the approval queue, the report queue and the
 * log — and every action changes them the way the instance does, and logs
 * itself. An id it does not hold changes nothing, and answers exactly what an
 * action the instance will not apply answers: {@link NOTHING_CHANGED_TEXT}.
 */
export interface ScriptedModeration {
  readonly port: ModerationPort;
  /** Every method called, in order. */
  readonly calls: string[];
  held: {
    standing: ModerationStanding;
    me: string;
    registrations: PendingRegistration[];
    reports: OpenReport[];
    log: ModerationLogEntry[];
    /** `false` to answer a read as the port does when the log alone could not be read. */
    logReadable: boolean;
    /** `false` to answer a read as the port does when the suspended accounts alone could not be read. */
    suspendedReadable: boolean;
    /** `false` to answer every *Show more* as the port does when a page could not be read (#961). */
    moreReadable: boolean;
    /** How many rows a page of the log or of the suspended accounts holds (#961). */
    pageSize: number;
    /** Accounts suspended: id to when, in Unix seconds. */
    suspended: Map<string, number>;
    /** Accounts that exist, by id: the pending ones, the reported and this one. */
    accounts: Set<string>;
  };
}

/** This moderator's id on the scripted instance. */
export const SCRIPTED_MODERATOR = 'moderator-1';

/** The scripted instance's queues, full: two waiting, two reports — one of them about the moderator. */
export function scriptedModerationQueues(): Pick<
  ScriptedModeration['held'],
  'registrations' | 'reports' | 'log'
> {
  return {
    registrations: [
      {
        athleteId: 'pending-anna',
        displayName: 'Anna',
        createdAt: 1_790_000_000,
        adultConfirmed: true,
      },
      {
        athleteId: 'pending_bartholomew_with_a_long_unbreakable_account_identifier_0123456789',
        displayName: 'Bartholomew of the very long Sunday club ride',
        createdAt: 1_790_000_600,
        adultConfirmed: false,
      },
    ],
    reports: [
      {
        reportId: 7,
        reporterAthleteId: 'rider-carys',
        targetAthleteId: 'rider-dafydd',
        // One word wider than a 320 px phone: a reason is another rider's text.
        reason:
          'Their display name is a slur, and they post ' +
          'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogochgogogoch under every ride.',
        createdAt: 1_790_001_000,
      },
      {
        reportId: 8,
        reporterAthleteId: 'rider-dafydd',
        targetAthleteId: SCRIPTED_MODERATOR,
        reason: 'The moderator refused my account for no reason.',
        createdAt: 1_790_002_000,
      },
    ],
    log: [
      {
        logId: 1,
        action: 'approve_registration',
        actorAthleteId: SCRIPTED_MODERATOR,
        targetAthleteId: 'rider-carys',
        reportId: null,
        reason: 'Known to the club.',
        at: 1_789_990_000,
      },
    ],
  };
}

export function scriptedModeration(
  options: {
    readonly standing?: ModerationStanding;
    readonly empty?: boolean;
    /** Accounts suspended from the start: id to when, in Unix seconds (#961). */
    readonly suspended?: Readonly<Record<string, number>>;
  } = {},
): ScriptedModeration {
  const calls: string[] = [];
  const queues =
    options.empty === true
      ? { registrations: [], reports: [], log: [] }
      : scriptedModerationQueues();
  const held: ScriptedModeration['held'] = {
    standing: options.standing ?? 'moderator',
    me: SCRIPTED_MODERATOR,
    registrations: [...queues.registrations],
    reports: [...queues.reports],
    log: [...queues.log],
    logReadable: true,
    suspendedReadable: true,
    moreReadable: true,
    pageSize: 100,
    suspended: new Map(Object.entries(options.suspended ?? {})),
    accounts: new Set([
      SCRIPTED_MODERATOR,
      'rider-carys',
      'rider-dafydd',
      ...queues.registrations.map((each) => each.athleteId),
    ]),
  };
  let nextLog = held.log.length + 1;
  const nothing: ModerationOutcome = { kind: 'refused', text: NOTHING_CHANGED_TEXT };
  const logged = (
    action: string,
    targetAthleteId: string | null,
    reportId: number | null,
    reason: string,
  ): ModerationOutcome => {
    if (reason.trim() === '') return { kind: 'refused', text: 'Give a reason.' };
    held.log.push({
      logId: nextLog,
      action,
      actorAthleteId: held.me,
      targetAthleteId,
      reportId,
      reason: reason.trim(),
      at: 1_790_010_000 + nextLog,
    });
    nextLog += 1;
    return { kind: 'done' };
  };
  // As the instance does: an action on a moderator changes nothing and IS
  // logged, as `refused_<action>` (`apps/instance` §`moderation.ts`).
  const refusedAndLogged = (
    action: string,
    targetAthleteId: string | null,
    reportId: number | null,
    reason: string,
  ): Promise<ModerationOutcome> => {
    const outcome = logged(`refused_${action}`, targetAthleteId, reportId, reason);
    return Promise.resolve(outcome.kind === 'done' ? nothing : outcome);
  };
  /** A page of `rows` from `cursor`, which is an offset as text — opaque to the screen. */
  function pageFrom<T>(rows: readonly T[], cursor: string | undefined): ModerationList<T> {
    const start = cursor === undefined ? 0 : Number(cursor);
    const end = start + held.pageSize;
    return { items: rows.slice(start, end), next: end < rows.length ? String(end) : null };
  }
  const nameOf = (id: string): string =>
    held.registrations.find((each) => each.athleteId === id)?.displayName ?? id;
  /** Newest first, as the instance pages them (#961). */
  const logRows = (): ModerationLogEntry[] => [...held.log].reverse();
  const suspendedRows = (): SuspendedAccount[] =>
    [...held.suspended.entries()]
      .map(([athleteId, suspendedAt]) => ({
        athleteId,
        displayName: nameOf(athleteId),
        suspendedAt,
      }))
      .sort((left, right) => right.suspendedAt - left.suspendedAt);
  let suspendedClock = 1_790_020_000;

  const port: ModerationPort = {
    standing: () => {
      calls.push('standing');
      return Promise.resolve(held.standing);
    },
    read: () => {
      calls.push('read');
      if (held.standing !== 'moderator') return Promise.resolve({ kind: held.standing });
      return Promise.resolve({
        kind: 'moderator',
        me: held.me,
        registrations: [...held.registrations],
        reports: [...held.reports],
        suspended: held.suspendedReadable ? pageFrom(suspendedRows(), undefined) : undefined,
        log: held.logReadable ? pageFrom(logRows(), undefined) : undefined,
      });
    },
    moreLog: (cursor) => {
      calls.push(`more log ${cursor}`);
      return Promise.resolve(held.moreReadable ? pageFrom(logRows(), cursor) : undefined);
    },
    moreSuspended: (cursor) => {
      calls.push(`more suspended ${cursor}`);
      return Promise.resolve(held.moreReadable ? pageFrom(suspendedRows(), cursor) : undefined);
    },
    decideRegistration: (athleteId, decision, reason) => {
      calls.push(`${decision} ${athleteId}`);
      if (!held.registrations.some((each) => each.athleteId === athleteId)) {
        return Promise.resolve(nothing);
      }
      const outcome = logged(`${decision}_registration`, athleteId, null, reason);
      if (outcome.kind === 'done') {
        held.registrations = held.registrations.filter((each) => each.athleteId !== athleteId);
      }
      return Promise.resolve(outcome);
    },
    dismissReport: (reportId, reason) => {
      calls.push(`dismiss ${String(reportId)}`);
      const report = held.reports.find((each) => each.reportId === reportId);
      if (report === undefined) return Promise.resolve(nothing);
      if (report.targetAthleteId === held.me)
        return refusedAndLogged('dismiss_report', null, reportId, reason);
      const outcome = logged('dismiss_report', null, reportId, reason);
      if (outcome.kind === 'done') {
        held.reports = held.reports.filter((each) => each.reportId !== reportId);
      }
      return Promise.resolve(outcome);
    },
    actOnAccount: (athleteId, action, reason, reportId) => {
      calls.push(
        `${action} ${athleteId}${reportId === undefined ? '' : ` for ${String(reportId)}`}`,
      );
      const id = athleteId.trim();
      if (id === held.me) return refusedAndLogged(action, id, reportId ?? null, reason);
      if (!held.accounts.has(id)) return Promise.resolve(nothing);
      if (action === 'suspend' && held.suspended.has(id)) return Promise.resolve(nothing);
      if (action === 'unsuspend' && !held.suspended.has(id)) return Promise.resolve(nothing);
      const outcome = logged(action, id, reportId ?? null, reason);
      if (outcome.kind !== 'done') return Promise.resolve(outcome);
      if (action === 'suspend') {
        suspendedClock += 60;
        held.suspended.set(id, suspendedClock);
      }
      if (action === 'unsuspend') held.suspended.delete(id);
      if (reportId !== undefined) {
        held.reports = held.reports.filter((each) => each.reportId !== reportId);
      }
      return Promise.resolve(outcome);
    },
  };
  return { port, calls, held };
}
