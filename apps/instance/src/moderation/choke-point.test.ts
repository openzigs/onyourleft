// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Blocking is enforced at ONE choke point, and every path is walked from the
 * route table** (#83's first criterion).
 *
 * Nothing here is a list somebody remembered. Every route in `ROUTES`
 * declares whom it reaches (`route-kit.ts` §`Reach`, required by the type), and
 * this file sorts the table by that declaration:
 *
 * - every route that reaches another athlete through its path is called as a
 *   blocked rider, as the blocker, and about a suspended rider, and must answer
 *   byte for byte what it answers about an athlete who does not exist — with
 *   an unrelated rider as the control that must NOT answer that;
 * - every moderators' route is called as an ordinary rider and must answer
 *   what an address with no route answers;
 * - every route that names an athlete in its path or its body and says it
 *   reaches only its caller's own data fails, so a new route cannot put an
 *   athlete id somewhere and skip the question;
 * - every exempt route has an entry here saying what holds it instead;
 * - every PATH PARAMETER of every route is either the athlete it declares it
 *   reaches, or named in {@link NOT_AN_ATHLETE} with what it names instead —
 *   so a new route that names a rider `{riderId}` or `{followee}` fails here
 *   rather than passing as `own` because its name does not say "athlete"
 *   (#891's review);
 * - and every REQUEST BODY field of every route the same way, named in
 *   {@link NOT_AN_ATHLETE_FIELD} (#899): until then a body field was caught
 *   only if its name matched `/athlete/i`.
 *
 * ⚠️ **The "answers alike" routes are called by ONE caller**, about a rider
 * who blocked them and about nobody, and what they leave behind is read back
 * by that same caller: their list of blocks, and their report allowance.
 * Until #891's review each probe had a fresh caller, which is exactly what
 * hid two oracles — a block of nobody was not listed, and a report about
 * nobody did not spend the allowance.
 *
 * ⚠️ The instance has, today, ONE route that reads another athlete — their
 * public profile. #83 lists a feed, comments, kudos, follower lists,
 * leaderboards, club rosters and search; none of those routes exists on the
 * instance yet (#13's sub-issues build them). When they are added they are
 * walked here with no edit to this file but a request body in
 * {@link REQUESTS}, and the test fails until that is given.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scriptedEngine } from '../analysis/jobs-testing.ts';
import type { Reach, Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import { codeOf as sealedCodeOf, sealedCall } from '../sealed/sealed-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
  type Rider,
  TEST_STATEMENT,
} from './moderation-testing.ts';

const isAthleteReach = (reach: Reach): reach is { readonly athlete: string } =>
  typeof reach === 'object' && 'athlete' in reach;
const isExempt = (reach: Reach): reach is { readonly exempt: string } =>
  typeof reach === 'object' && 'exempt' in reach;

const ATHLETE_ROUTES = ROUTES.filter((route) => isAthleteReach(route.reaches));
const MODERATOR_ROUTES = ROUTES.filter((route) => route.reaches === 'moderation');
const EXEMPT_ROUTES = ROUTES.filter((route) => isExempt(route.reaches));

/** A body each athlete-reaching route accepts, by operation id. */
const REQUESTS: Readonly<Record<string, { readonly body?: unknown }>> = {
  getAthlete: {},
};

/**
 * What holds each exempt route instead of the choke point. `answersAlike`
 * routes are called about a rider who blocked the caller, about one the
 * caller blocked, and about nobody, and must answer all three identically.
 */
const EXEMPT: Readonly<
  Record<
    string,
    | { readonly answersAlike: (subject: string) => { path: string; body?: unknown } }
    | { readonly heldElsewhere: string }
  >
> = {
  blockAthlete: { answersAlike: (subject) => ({ path: `/v1/blocks/${subject}` }) },
  unblockAthlete: { answersAlike: (subject) => ({ path: `/v1/blocks/${subject}` }) },
  reportAthlete: {
    answersAlike: (subject) => ({
      path: '/v1/reports',
      body: { athleteId: subject, reason: 'Abusive display name' },
    }),
  },
  getNoticePage: {
    heldElsewhere:
      'the notice page (#907): the same form for anybody, naming nobody and reading nothing (moderation/notices.test.ts)',
  },
  submitNotice: {
    heldElsewhere:
      'a notice goes to the moderators, not to anybody it names, and answers the same whatever its items name: it never looks them up (moderation/notices.test.ts)',
  },
  createRoomTicket: {
    heldElsewhere:
      'names a room, not an athlete; blocking inside a room is #789’s (room moderation), and suspension is held by the session, which a suspended account no longer has',
  },
  startRoom: {
    heldElsewhere:
      'names a room, not an athlete, and starts only a race the caller is seated and connected in — seated by a ticket, which is the choke point for entering a room (#785’s rule)',
  },
  joinRoom: {
    heldElsewhere:
      'names a room by its code, never an athlete; a room’s members are whoever holds its code (ADR 0028 D-6.3), and blocking inside a room is #789’s',
  },
  listPublicRooms: {
    heldElsewhere:
      'names no athlete in its answer; an eligible caller is listed no room holding anybody they block or who blocks them, either way round (#788, rooms/public-rooms.test.ts)',
  },
  joinPublicRoom: {
    heldElsewhere:
      'names a room, never an athlete; a room holding anybody the caller blocks or who blocks them is `not_found`, and the ticket asks again (#788, rooms/public-rooms.test.ts)',
  },
  getRoomRoute: {
    heldElsewhere:
      'the creator’s route, relayed to the members of their own room (#784); it names no athlete',
  },
  getRiderGhost: {
    heldElsewhere:
      'names a route by its digest, never an athlete; every candidate rider is asked of the choke point itself (`canSee`) inside the read, and one the caller may not see is passed over (sync/race-ghost.test.ts)',
  },
  reportInRoom: {
    heldElsewhere:
      'names a seat in a room the caller is a member of; the athlete in it is the room’s answer, and the report reaches the moderators, never that athlete (#789, rooms/room-moderation.test.ts)',
  },
  removeFromMyRoom: {
    heldElsewhere:
      'only the host of a private room, for a seat in their own room; the athlete in it is the room’s answer, and the removal is logged (#789, rooms/room-moderation.test.ts)',
  },
  getRoomResults: {
    heldElsewhere:
      'a race’s result for its riders only; every other rider in it is named through the choke point itself (`canSee`), and one the caller may not see is “a rider” with no name (rooms/rooms.test.ts)',
  },
};

/**
 * Every path parameter that does NOT name an athlete, and what it names. A
 * parameter no entry here names, and no route declares it reaches, fails.
 */
const NOT_AN_ATHLETE: Readonly<Record<string, string>> = {
  roomId: 'a room; who may enter it is the ticket’s rule, and blocking inside it is #789’s',
  publicKey: 'one of the CALLER’s own device keys; the store scopes the revocation to them',
  reportId: 'a report, read and decided only on the moderators’ routes',
  statementId:
    'a statement of reasons; the store files an appeal only against one about the CALLER (#911)',
  appealId: 'an appeal, read and decided only on the moderators’ routes (#911)',
  noticeId: 'a notice, read and recorded only on the moderators’ routes (#912)',
  content:
    'the SHA-256 of an activity file; the sync store reads only the record the CALLER holds of it (#38, #776)',
  kind: 'a kind of sync item; the item read or written is the CALLER’s own (#776)',
  key: 'the key of one of the CALLER’s own sync items (#776)',
  jobId: 'one of the CALLER’s own analysis jobs; the store reads only the caller’s (#1095)',
  route:
    'the SHA-256 of a route’s canonical GPX (#331); the riders behind it are each asked of the choke point',
};

/**
 * Every REQUEST BODY field, of any route, that does NOT name an athlete, and
 * what it names (#899). A field no entry here names fails unless it is the
 * `athleteId` of a moderators' or exempt route, which reach athletes by
 * design — so a new route that puts a rider in its body as `riderId` or
 * `followee` fails here, rather than passing as `own` because its name does
 * not say "athlete". Until #899 the body was matched by `/athlete/i` alone.
 */
const NOT_AN_ATHLETE_FIELD: Readonly<Record<string, string>> = {
  v: 'the sealed envelope’s version (ADR 0047); the route inside is checked as itself',
  keyId: 'which of the INSTANCE’s keys a sealed envelope is sealed to (ADR 0047)',
  enc: 'a sealed envelope’s encapsulated key (HPKE, ADR 0047)',
  ct: 'a sealed envelope’s ciphertext; the route inside it is checked as itself',
  publicKey:
    'the CALLER’s own device key: the key signing in, linking or recovering, or one of their own to revoke',
  purpose: 'the purpose string a signed statement is bound to (ADR 0014)',
  instanceOrigin: 'this instance’s origin, which a signed statement is bound to',
  nonce: 'a challenge this instance issued',
  issuedAt: 'when the caller signed their statement',
  signature: 'the caller’s signature over their own statement',
  displayName: 'the CALLER’s own display name',
  recoveryEmail: 'the CALLER’s own recovery address',
  inviteCode: 'a moderator’s invitation the caller spends on registering',
  confirmsAdult: 'the CALLER’s own 18+ self-declaration (ruling Q5)',
  declaredMassKilograms: 'the CALLER’s own declared mass, for a room’s physics',
  recoveryCode: 'one of the CALLER’s own recovery codes',
  through: 'the last of the CALLER’s own account changes they have read',
  linkCode: 'a link code the caller’s own account minted',
  emailToken: 'a token mailed to the CALLER’s own recovery address',
  reset: 'whether the caller replaces their own recovery codes',
  revokeOtherKeys: 'whether the caller revokes their own other device keys',
  address: 'the CALLER’s own recovery address',
  confirmed: 'the CALLER’s own 18+ self-declaration (ruling Q5)',
  token: 'a token mailed to the CALLER’s own recovery address',
  reason: 'free text a reporter or a moderator writes; never an id the route acts on',
  reportId: 'a report, read and decided only on the moderators’ routes',
  statement:
    'the CALLER’s own signed erasure statement, or the statement of reasons a moderator writes with a restriction (#910)',
  mayBeRaced: 'the CALLER’s consent for their own ride (#331)',
  routeSha256:
    'the SHA-256 of a route’s canonical GPX (#331); the riders behind it are each asked of the choke point',
  body: 'one of the CALLER’s own sync items (#776)',
  record: 'the CALLER’s own signed activity record (ADR 0014)',
  file: 'the CALLER’s own activity file',
  query: 'the text the caller searches their own history for',
  limit: 'how many results the caller asks for',
  characters: 'how much of each result the caller asks for',
  rideId: 'one of the CALLER’s own rides',
  input: 'the CALLER’s own analysis input',
  templateVersion: 'which analysis template the caller asks for',
  source: 'where an analysis or a picture is worked out: the hosted model or the caller’s own',
  url: 'the endpoint of the CALLER’s own hosted model',
  model: 'the name of the CALLER’s own hosted model',
  key: 'the CALLER’s own hosted model key',
  reasoningTokens: 'a setting of the CALLER’s own hosted model',
  endpoint: 'the hosted model endpoint the caller consents to',
  picture: 'the CALLER’s own side-camera picture',
  kind: 'a room’s kind: a group ride or a race',
  ridingPosition: 'a room’s riding position setting',
  drafting: 'whether a room models drafting',
  loop: 'whether a room’s route loops',
  lengthMetres: 'a room’s route length',
  grades: 'a room’s route gradients',
  gpx: 'the creator’s own route for a room',
  visibility: 'whether a room a rider makes is private or public (#788)',
  startsAt: 'when a public room’s creator says it starts (#788)',
  code: 'a room’s code; its members are whoever holds it (ADR 0028 D-6.3)',
  riderId:
    'a SEAT in a room the caller is in (#789); the room itself says who sits there, and the report or removal goes through the moderators’ log',
  grounds: 'the CALLER’s own grounds for appealing a decision about them (#911)',
  item: 'which item a moderator hides — a room’s listing, its route or one result row — by its identifier (#913)',
  outcome: 'a moderator’s outcome for an appeal: upheld or reversed (#911)',
  decision: 'free text a moderator writes: what the rider or the notifier is told (#911, #912)',
  step: 'which step a moderator records on a notice (#912)',
  logId: 'a moderation log entry, read only on the moderators’ routes (#912)',
};

const bodyFields = (route: Route): string[] =>
  route.request !== undefined && 'properties' in route.request
    ? Object.keys(route.request.properties)
    : [];

/** An athlete id nobody holds, shaped like one that somebody might. */
const NOBODY = 'f'.repeat(32);

const pathFor = (route: Route, param: string, subject: string): string =>
  route.path.replace(`{${param}}`, subject);

const namesAnAthlete = (name: string): boolean => /athlete/i.test(name);

describe('the route table declares whom every route reaches (#83)', () => {
  it('sorts every route into exactly one kind, and has at least one of each that matters', () => {
    for (const route of ROUTES) {
      const reach = route.reaches;
      const known =
        reach === 'own' || reach === 'moderation' || isAthleteReach(reach) || isExempt(reach);
      expect(known, route.operationId).toBe(true);
    }
    expect(ATHLETE_ROUTES.length).toBeGreaterThan(0);
    expect(MODERATOR_ROUTES.length).toBeGreaterThan(0);
  });

  it('lets no route that says it reaches only its own name an athlete in its path or body', () => {
    for (const route of ROUTES.filter((each) => each.reaches === 'own')) {
      const params = [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => match[1] ?? '');
      const fields =
        route.request !== undefined && 'properties' in route.request
          ? Object.keys(route.request.properties)
          : [];
      for (const name of [...params, ...fields]) {
        expect(namesAnAthlete(name), `${route.operationId}: ${name}`).toBe(false);
      }
    }
  });

  it('knows what every request body field of every route names — an athlete it declares, or something else (#899)', () => {
    const undeclared = ROUTES.flatMap((route) =>
      bodyFields(route)
        .filter(
          (name) =>
            !(
              (route.reaches === 'moderation' || isExempt(route.reaches)) &&
              name === 'athleteId'
            ) && !(name in NOT_AN_ATHLETE_FIELD),
        )
        .map((name) => `${route.operationId}: ${name}`),
    );
    expect(undeclared).toEqual([]);
  });

  it('says what every declared body field names, and declares none no route has (#899)', () => {
    const used = new Set(ROUTES.flatMap(bodyFields));
    for (const [name, names] of Object.entries(NOT_AN_ATHLETE_FIELD)) {
      expect(used.has(name), `${name} is in no route's body`).toBe(true);
      expect(names.length, name).toBeGreaterThan(10);
    }
  });

  it('knows what every path parameter of every route names — an athlete it declares, or something else (#891)', () => {
    for (const route of ROUTES) {
      const params = [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => match[1] ?? '');
      for (const name of params) {
        const declared =
          (isAthleteReach(route.reaches) && route.reaches.athlete === name) ||
          // A moderators' route and an exempt route reach athletes by design,
          // and say so; their `athleteId` is that athlete.
          ((route.reaches === 'moderation' || isExempt(route.reaches)) && name === 'athleteId');
        expect(declared || name in NOT_AN_ATHLETE, `${route.operationId}: {${name}}`).toBe(true);
      }
    }
  });

  it('puts every route that reaches another athlete behind a signed-in session', () => {
    for (const route of [...ATHLETE_ROUTES, ...MODERATOR_ROUTES]) {
      expect(route.auth, route.operationId).toBe('session');
      if (isAthleteReach(route.reaches)) {
        expect(route.path, route.operationId).toContain(`{${route.reaches.athlete}}`);
      }
    }
  });

  it('says, for every exempt route, what holds it instead — and nothing else is exempt', () => {
    expect(Object.keys(EXEMPT).sort()).toEqual(
      EXEMPT_ROUTES.map((route) => route.operationId).sort(),
    );
    for (const route of EXEMPT_ROUTES) {
      expect(isExempt(route.reaches) && route.reaches.exempt.length > 20, route.operationId).toBe(
        true,
      );
    }
  });

  it('has a request for every route that reaches another athlete', () => {
    expect(Object.keys(REQUESTS).sort()).toEqual(
      ATHLETE_ROUTES.map((route) => route.operationId).sort(),
    );
  });
});

describe('every path a blocked athlete could use is refused, as though nobody were there (#83)', () => {
  let world: ModerationWorld;
  let viewer: Rider;
  let blocksViewer: Rider;
  let blockedByViewer: Rider;
  let suspended: Rider;
  let unrelated: Rider;

  beforeAll(async () => {
    world = await startModerationWorld();
    viewer = await world.rider('Viewer');
    blocksViewer = await world.rider('Blocks the viewer');
    blockedByViewer = await world.rider('Blocked by the viewer');
    suspended = await world.rider('Suspended');
    unrelated = await world.rider('Unrelated');
    expect((await world.as(blocksViewer, 'POST', `/v1/blocks/${viewer.athleteId}`)).status).toBe(
      204,
    );
    expect((await world.as(viewer, 'POST', `/v1/blocks/${blockedByViewer.athleteId}`)).status).toBe(
      204,
    );
    expect(
      (
        await world.as(
          world.owner,
          'POST',
          `/v1/moderation/athletes/${suspended.athleteId}/suspend`,
          {
            reason: 'Cheating',
            statement: TEST_STATEMENT,
          },
        )
      ).status,
    ).toBe(200);
  });
  afterAll(() => world.close());

  describe.each(ATHLETE_ROUTES.map((route) => [route.operationId, route] as const))(
    '%s',
    (_operation, route) => {
      const param = isAthleteReach(route.reaches) ? route.reaches.athlete : '';
      const call = (as: Rider, subject: string) =>
        world.as(
          as,
          route.method,
          pathFor(route, param, subject),
          REQUESTS[route.operationId]?.body,
        );

      it('answers about a rider who blocked the caller exactly as about nobody', async () => {
        const nobody = await call(viewer, NOBODY);
        expect(nobody.status).toBe(404);
        expect(await call(viewer, blocksViewer.athleteId)).toEqual(nobody);
      });

      it('answers the blocker about the rider they blocked exactly as about nobody — symmetric', async () => {
        expect(await call(viewer, blockedByViewer.athleteId)).toEqual(await call(viewer, NOBODY));
        // And the other way round: the blocked rider cannot reach the blocker.
        expect(await call(blockedByViewer, viewer.athleteId)).toEqual(
          await call(blockedByViewer, NOBODY),
        );
      });

      it('answers about a suspended rider exactly as about nobody', async () => {
        expect(await call(viewer, suspended.athleteId)).toEqual(await call(viewer, NOBODY));
      });

      it('answers about an unrelated rider — the control that shows the route works', async () => {
        const answer = await call(viewer, unrelated.athleteId);
        expect(answer.status).toBeLessThan(300);
        expect(answer).not.toEqual(await call(viewer, NOBODY));
      });
    },
  );

  it.each(MODERATOR_ROUTES.map((route) => [route.operationId, route] as const))(
    '%s answers an ordinary rider as though there were no such route',
    async (_operation, route) => {
      const path = route.path.replace(/\{[A-Za-z]+\}/g, unrelated.athleteId);
      const body = route.method === 'GET' ? undefined : { reason: 'Because' };
      const answer = await world.as(viewer, route.method, path, body);
      const nowhere = await world.as(viewer, 'GET', '/v1/no-such-route');
      expect(answer.status).toBe(404);
      expect(codeOf(answer.body)).toBe('not_found');
      expect(answer).toEqual(nowhere);
    },
  );

  it.each(
    Object.entries(EXEMPT).flatMap(([operation, rule]) =>
      'answersAlike' in rule ? [[operation, rule.answersAlike] as const] : [],
    ),
  )(
    '%s answers ONE caller alike about a blocker, a blocked rider and nobody',
    async (operation, request) => {
      const route = ROUTES.find((each) => each.operationId === operation);
      if (route === undefined) throw new Error(operation);
      // ONE caller for all three (#891's review): whatever the first request
      // leaves behind is there when the next is answered.
      const caller = await world.rider();
      await world.as(blocksViewer, 'POST', `/v1/blocks/${caller.athleteId}`);
      await world.as(caller, 'POST', `/v1/blocks/${blockedByViewer.athleteId}`);
      const answers = [];
      for (const subject of [NOBODY, blocksViewer.athleteId, blockedByViewer.athleteId]) {
        const { path, body } = request(subject);
        answers.push(await world.as(caller, route.method, path, body));
      }
      expect(answers[0]?.status).toBeLessThan(300);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    },
  );

  describe('what ONE caller reads back afterwards says nothing either (#891)', () => {
    /** A caller whom `blocksViewer` has blocked, as `viewer` is. */
    async function blockedCaller(): Promise<Rider> {
      const caller = await world.rider();
      expect((await world.as(blocksViewer, 'POST', `/v1/blocks/${caller.athleteId}`)).status).toBe(
        204,
      );
      return caller;
    }

    it('lists a block of a rider who blocked the caller exactly as a block of nobody', async () => {
      const caller = await blockedCaller();
      for (const subject of [blocksViewer.athleteId, NOBODY]) {
        expect((await world.as(caller, 'POST', `/v1/blocks/${subject}`)).status).toBe(204);
      }
      const listed = await world.as(caller, 'GET', '/v1/blocks');
      expect(listed).toEqual({
        status: 200,
        body: { athleteIds: [blocksViewer.athleteId, NOBODY].sort() },
      });
      // And the rider who blocked them is still nobody to the caller.
      expect(await world.as(caller, 'GET', `/v1/athletes/${blocksViewer.athleteId}`)).toEqual(
        await world.as(caller, 'GET', `/v1/athletes/${NOBODY}`),
      );
    });

    it('unblocks, and lists afterwards, the blocker and nobody alike', async () => {
      const caller = await blockedCaller();
      for (const subject of [blocksViewer.athleteId, NOBODY]) {
        await world.as(caller, 'POST', `/v1/blocks/${subject}`);
      }
      const unblocked = [];
      for (const subject of [blocksViewer.athleteId, NOBODY]) {
        unblocked.push(await world.as(caller, 'DELETE', `/v1/blocks/${subject}`));
      }
      expect(unblocked[1]).toEqual(unblocked[0]);
      expect((await world.as(caller, 'GET', '/v1/blocks')).body).toEqual({ athleteIds: [] });
    });

    it.each([
      ['the blocker, then nobody', () => [blocksViewer.athleteId, NOBODY]],
      ['nobody, then the blocker', () => [NOBODY, blocksViewer.athleteId]],
    ] as const)(
      'spends one report allowance on %s, and the 429 lands in the same place',
      async (_order, subjects) => {
        const caller = await blockedCaller();
        const report = (athleteId: string) =>
          world.as(caller, 'POST', '/v1/reports', { athleteId, reason: 'Abusive display name' });
        const answers = [];
        // Three about a rider the caller can see, then the two in question,
        // then one more: the allowance is five an hour.
        for (let each = 0; each < 3; each += 1) answers.push(await report(unrelated.athleteId));
        for (const subject of subjects()) answers.push(await report(subject));
        answers.push(await report(unrelated.athleteId));
        expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204, 204, 204, 429]);
        expect(answers[3]).toEqual(answers[4]);
      },
    );
  });
});

/**
 * A suspended rider's way out (#898): the routes that admit their limited
 * session are FOUR since #911, declared on the route table, and every other
 * session route refuses it — walked from the table, so a route added later is
 * walked too. The third is reading the statements of reasons about their own
 * account: a suspended rider must be able to read why (DSA Art. 17(1)(d),
 * #910); the fourth is appealing one of them (OSA s.21(4)(d), #911).
 */
const ADMITS_SUSPENDED = ['appealStatement', 'eraseAccount', 'exportAccount', 'listStatements'];

describe('a suspended rider’s way-out session reaches the export, the deletion, their statements and an appeal, and nothing else (#898, #910, #911)', () => {
  it('is declared by exactly the account export and deletion, the statements and the appeal, and no other route', () => {
    expect(
      ROUTES.filter((route) => route.admitsSuspended === true)
        .map((route) => route.operationId)
        .sort(),
    ).toEqual(ADMITS_SUSPENDED);
    for (const route of ROUTES.filter((each) => each.admitsSuspended === true)) {
      // Only on a signed-in route about the caller's own account.
      expect(route.auth, route.operationId).toBe('session');
      expect(route.reaches, route.operationId).toBe('own');
    }
  });

  let world: ModerationWorld;
  let token: string;
  let leaving: Rider;
  beforeAll(async () => {
    // Analysis jobs on, so their routes answer as a running instance's do (#1095).
    world = await startModerationWorld({
      analysis: { engine: scriptedEngine().engine, available: () => true },
    });
    leaving = await world.rider('Leaving');
    const suspended = await world.as(
      world.owner,
      'POST',
      `/v1/moderation/athletes/${leaving.athleteId}/suspend`,
      { reason: 'Cheating', statement: TEST_STATEMENT },
    );
    expect(suspended.status).toBe(200);
    const opened = await world.call('POST', '/v1/auth/leave-session', {
      body: await leaving.device.statement(await world.nonceFor(leaving.device)),
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    token = (opened.body as { sessionToken: string }).sessionToken;
  });
  afterAll(() => world.close());

  const refused = ROUTES.filter(
    (route) => route.auth === 'session' && route.admitsSuspended !== true,
  );

  it('walks every other session route', () => {
    expect(refused.length).toBeGreaterThan(10);
  });

  it.each(refused.map((route) => [route.operationId, route] as const))(
    '%s answers the way-out session `account_suspended`',
    async (_operation, route) => {
      if (route.sealed === 'only') {
        // Reachable only sealed (#1191): the same choke point, inside the envelope.
        const sealed = await sealedCall(world, {
          method: route.method,
          path: route.path.replace(/\{[A-Za-z]+\}/g, 'x'),
          token,
          signer: leaving.device.signingKey,
          ...(route.method === 'GET' ? {} : { body: {} }),
        });
        expect(sealed.reply?.status).toBe(403);
        expect(sealedCodeOf(sealed)).toBe('account_suspended');
        return;
      }
      const answer = await world.call(route.method, route.path.replace(/\{[A-Za-z]+\}/g, 'x'), {
        token,
        ...(route.method === 'GET' ? {} : { body: {} }),
      });
      expect(answer.status).toBe(403);
      expect(codeOf(answer.body)).toBe('account_suspended');
    },
  );

  it('reaches the export — the control that shows the session works', async () => {
    expect((await world.call('GET', '/v1/account/export', { token })).status).toBe(200);
  });
});
