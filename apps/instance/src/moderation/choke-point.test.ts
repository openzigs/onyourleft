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
 * - every exempt route has an entry here saying what holds it instead.
 *
 * ⚠️ The instance has, today, ONE route that reads another athlete — their
 * public profile. #83 lists a feed, comments, kudos, follower lists,
 * leaderboards, club rosters and search; none of those routes exists on the
 * instance yet (#13's sub-issues build them). When they are added they are
 * walked here with no edit to this file but a request body in
 * {@link REQUESTS}, and the test fails until that is given.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Reach, Route } from '../route-kit.ts';
import { ROUTES } from '../routes.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
  type Rider,
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
  createRoomTicket: {
    heldElsewhere:
      'names a room, not an athlete; blocking inside a room is #789’s (room moderation), and suspension is held by the session, which a suspended account no longer has',
  },
};

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
  )('%s answers alike about a blocker, a blocked rider and nobody', async (operation, request) => {
    const route = ROUTES.find((each) => each.operationId === operation);
    if (route === undefined) throw new Error(operation);
    // A fresh caller each time, so a report's rate limit is not what differs.
    const answers = [];
    for (const subject of [NOBODY, blocksViewer.athleteId, blockedByViewer.athleteId]) {
      const caller = await world.rider();
      await world.as(blocksViewer, 'POST', `/v1/blocks/${caller.athleteId}`);
      await world.as(caller, 'POST', `/v1/blocks/${blockedByViewer.athleteId}`);
      const { path, body } = request(subject);
      answers.push(await world.as(caller, route.method, path, body));
    }
    expect(answers[0]?.status).toBeLessThan(300);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
});
