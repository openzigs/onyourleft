// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A notice of illegal content, from anybody** (#907), through the real
 * listener: the page a browser is served, the form it posts, and the
 * moderators' queue the notice is read back from — the path a real moderator
 * uses, never the object the route was handed.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../auth/identity.ts';
import { codeOf, startModerationWorld, type ModerationWorld } from './moderation-testing.ts';
import { NOTICES_PER_HOUR } from './moderation.ts';
import { noticePage, readNoticeForm } from './notices.ts';

const ROOM = '0123456789abcdef0123456789abcdef';

let world: ModerationWorld | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** Post the notice page's form as a browser does, from `address` when given. */
async function post(
  at: ModerationWorld,
  fields: Record<string, string>,
  address?: string,
): Promise<{ status: number; html: string; headers: Headers }> {
  const response = await fetch(`${at.url}/report`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(address === undefined ? {} : { 'x-test-client': address }),
    },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, html: await response.text(), headers: response.headers };
}

const ILLEGAL = {
  kind: 'illegal_content',
  explanation: 'The route in this room spells out a threat against a named person.',
  items: `route:${ROOM}\nresult:${ROOM}:2`,
};

interface QueuedNotice {
  readonly [step: string]: unknown;
  readonly noticeId: number;
  readonly receivedAt: number;
  readonly kind: string;
  readonly explanation: string;
  readonly items: readonly string[];
  readonly location: string | null;
  readonly notifierName: string | null;
  readonly notifierEmail: string | null;
  readonly bonaFide: boolean;
}

async function queue(at: ModerationWorld): Promise<readonly QueuedNotice[]> {
  const answer = await at.as(at.owner, 'GET', '/v1/moderation/notices');
  expect(answer.status).toBe(200);
  return (answer.body as { notices: QueuedNotice[] }).notices;
}

describe('the notice page (#907)', () => {
  it('is served to anybody, with no session, as a page that runs no script', async () => {
    world = await startModerationWorld({ config: { name: 'Club <Ride>' } });
    const response = await fetch(`${world.url}/report`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('script-src');
    const html = await response.text();
    expect(html).not.toContain('<script');
    expect(html).toContain('<html lang="en">');
    // The operator's name is configuration, never markup.
    expect(html).toContain('Club &lt;Ride&gt;');
    expect(html).not.toContain('Club <Ride>');
    expect(html).toContain('<form method="post" action="/report">');
  });

  it('labels every control, so a keyboard and a screen reader reach each one (ICU D2.4)', () => {
    const html = noticePage({ kind: 'form' }, null);
    const controls = [...html.matchAll(/<(input|textarea)\b[^>]*\bid="([^"]+)"/g)].map(
      (match) => match[2] as string,
    );
    expect(controls).toHaveLength(11);
    for (const id of controls) {
      expect(html, id).toContain(`<label for="${id}">`);
    }
    expect(html.match(/<fieldset/g)).toHaveLength(4);
    expect(html.match(/<legend>/g)).toHaveLength(4);
  });
});

describe('a notice sent from the page (#907)', () => {
  it('reaches the moderators’ queue with the time it arrived and everything the notifier chose to give', async () => {
    world = await startModerationWorld();
    const sent = await post(world, {
      ...ILLEGAL,
      location: 'The group ride on Sunday morning',
      name: 'A. Notifier',
      email: 'notifier@example.com',
      bona_fide: 'on',
    });
    expect(sent.status).toBe(200);
    expect(sent.html).toContain('Report received');
    const reference = /Its reference is <strong>(\d+)<\/strong>/.exec(sent.html)?.[1];
    expect(reference).toBeDefined();
    expect(sent.html).toContain('will write to the email address you gave');

    const [notice, ...more] = await queue(world);
    expect(more).toEqual([]);
    expect(notice).toEqual({
      noticeId: Number(reference),
      receivedAt: Math.floor(world.clock.ms / 1000),
      kind: 'illegal_content',
      explanation: ILLEGAL.explanation,
      items: [`route:${ROOM}`, `result:${ROOM}:2`],
      location: 'The group ride on Sunday morning',
      notifierName: 'A. Notifier',
      notifierEmail: 'notifier@example.com',
      bonaFide: true,
      // #1381: nothing erased while it is open.
      detailsErasedAt: null,
      // #912: no step taken yet.
      acknowledgedAt: null,
      decidedAt: null,
      decision: null,
      logId: null,
      notifierToldAt: null,
    });
  });

  it('takes a notice that gives no name, no email and no statement (Art. 16(2)(c), recital 50)', async () => {
    world = await startModerationWorld();
    const sent = await post(world, ILLEGAL);
    expect(sent.status).toBe(200);
    expect(sent.html).toContain('You did not give an email address');
    expect(await queue(world)).toMatchObject([
      { notifierName: null, notifierEmail: null, bonaFide: false, location: null },
    ]);
  });

  it('is shown to nobody but a moderator: the queue answers anybody else as though it were not there', async () => {
    world = await startModerationWorld();
    await post(world, ILLEGAL);
    const rider = await world.rider('Somebody');
    const refused = await world.as(rider, 'GET', '/v1/moderation/notices');
    expect(refused.status).toBe(404);
    expect(codeOf(refused.body)).toBe('not_found');
  });

  it('asks for a correction, keeps nothing, and echoes what was typed only as text', async () => {
    world = await startModerationWorld();
    const sent = await post(world, {
      kind: 'illegal_content',
      explanation: '',
      items: 'not-an-identifier',
      name: '<script>alert(1)</script>',
    });
    expect(sent.status).toBe(400);
    expect(sent.html).toContain('The report was not sent');
    expect(sent.html).toContain('Say why you think it is illegal.');
    expect(sent.html).toContain('is not an identifier from the app');
    expect(sent.html).toContain('aria-invalid="true"');
    expect(sent.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sent.html).not.toContain('<script>');
    expect(await queue(world)).toEqual([]);
  });

  it('takes an intimate image content report only with all of s.20A(2)’s declarations and an email', async () => {
    world = await startModerationWorld();
    const partial = await post(world, {
      ...ILLEGAL,
      kind: 'intimate_image',
      declare_intimate: 'on',
    });
    expect(partial.status).toBe(400);
    expect(partial.html.match(/An intimate image report needs this statement\./g)).toHaveLength(
      // Twice each: beside the box, and in the summary.
      4,
    );
    expect(partial.html).toContain('An intimate image report needs an email address');
    expect(await queue(world)).toEqual([]);

    const whole = await post(world, {
      ...ILLEGAL,
      kind: 'intimate_image',
      declare_intimate: 'on',
      declare_subject: 'on',
      declare_true: 'on',
      email: 'me@example.com',
    });
    expect(whole.status).toBe(200);
    expect(await queue(world)).toMatchObject([
      { kind: 'intimate_image', notifierEmail: 'me@example.com' },
    ]);
  });

  it('writes nothing a notifier typed to the instance’s log', async () => {
    world = await startModerationWorld();
    const typed = {
      ...ILLEGAL,
      explanation: 'explanation-marker-7f3a',
      location: 'location-marker-91c2',
      name: 'name-marker-55de',
      email: 'email-marker-0b1e@example.com',
      bona_fide: 'on',
    };
    expect((await post(world, typed)).status).toBe(200);
    expect((await post(world, { ...typed, explanation: '' })).status).toBe(400);
    const log = world.instance.lines.join('\n');
    expect(log).toContain('"/report"');
    for (const value of [typed.explanation, typed.location, typed.name, typed.email, ROOM]) {
      expect(log).not.toContain(value);
    }
  });
});

describe('the notice page’s hints reach a screen reader (#907)', () => {
  it('points the name and email fields, and the intimate image group, at their hints', () => {
    const page = noticePage({ kind: 'form' }, 'Test instance');
    expect(page).toMatch(/id="notice-name"[^>]*aria-describedby="notice-who-hint"/);
    expect(page).toMatch(/id="notice-email"[^>]*aria-describedby="notice-who-hint"/);
    expect(page).toMatch(/<fieldset aria-describedby="notice-intimate-hint">/);
    expect(page).toContain('id="notice-intimate-hint"');
  });
});

describe('the notice page’s limits, with no account and no stored address (#907)', () => {
  it('limits one client address, and leaves another its own allowance', async () => {
    world = await startModerationWorld({
      config: { clientAddressHeader: 'x-test-client' },
      limits: {
        ...DEFAULT_LIMITS,
        registrationPerAddress: { limit: 10_000, windowMs: 60_000 },
        sealedPerSession: { limit: 10_000, windowMs: 60_000 },
        sessionlessSealedPerAddress: { limit: 10_000, windowMs: 60_000 },
        noticesPerAddress: { limit: 2, windowMs: 60 * 60_000 },
      },
    });
    expect((await post(world, ILLEGAL, '192.0.2.1')).status).toBe(200);
    expect((await post(world, ILLEGAL, '192.0.2.1')).status).toBe(200);
    const third = await post(world, ILLEGAL, '192.0.2.1');
    expect(third.status).toBe(429);
    expect(third.html).toContain('Nothing you typed was kept');
    expect((await post(world, ILLEGAL, '198.51.100.7')).status).toBe(200);
    expect(await queue(world)).toHaveLength(3);
    // A correction is not counted: only a notice that would be kept is.
    expect((await post(world, { ...ILLEGAL, explanation: '' }, '198.51.100.7')).status).toBe(400);
    expect((await post(world, ILLEGAL, '198.51.100.7')).status).toBe(200);
    // And the hour ends.
    world.clock.ms += 60 * 60_000;
    expect((await post(world, ILLEGAL, '192.0.2.1')).status).toBe(200);
  });

  it('caps the whole instance from the notices’ own times, so a crowd of addresses cannot fill it', async () => {
    world = await startModerationWorld({ config: { clientAddressHeader: 'x-test-client' } });
    for (let index = 0; index < NOTICES_PER_HOUR; index += 1) {
      const sent = await post(
        world,
        ILLEGAL,
        `10.0.${String(Math.floor(index / 250))}.${String(index % 250)}`,
      );
      expect(sent.status).toBe(200);
    }
    expect((await post(world, ILLEGAL, '203.0.113.9')).status).toBe(429);
    expect(await queue(world)).toHaveLength(NOTICES_PER_HOUR);
    world.clock.ms += 60 * 60_000 + 1000;
    expect((await post(world, ILLEGAL, '203.0.113.9')).status).toBe(200);
  });

  it('keeps taking an intimate image report when a crowd of addresses has filled the instance’s cap', async () => {
    world = await startModerationWorld({ config: { clientAddressHeader: 'x-test-client' } });
    for (let index = 0; index < NOTICES_PER_HOUR; index += 1) {
      const sent = await post(
        world,
        ILLEGAL,
        `10.0.${String(Math.floor(index / 250))}.${String(index % 250)}`,
      );
      expect(sent.status).toBe(200);
    }
    expect((await post(world, ILLEGAL, '203.0.113.9')).status).toBe(429);
    const intimate = await post(
      world,
      {
        kind: 'intimate_image',
        explanation: 'An image of me, shared without my consent.',
        items: `route:${ROOM}`,
        email: 'me@example.org',
        declare_intimate: 'on',
        declare_subject: 'on',
        declare_true: 'on',
      },
      '203.0.113.9',
    );
    expect(intimate.status).toBe(200);
    expect(await queue(world)).toHaveLength(NOTICES_PER_HOUR + 1);
  });

  it('refuses a post a browser says came from another site, and keeps nothing', async () => {
    world = await startModerationWorld({ config: { clientAddressHeader: 'x-test-client' } });
    const response = await fetch(`${world.url}/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
      },
      body: new URLSearchParams(ILLEGAL).toString(),
    });
    expect(response.status).toBe(403);
    expect(await queue(world)).toHaveLength(0);
  });

  it('never stores a client address: no column of the notice holds one', async () => {
    world = await startModerationWorld({ config: { clientAddressHeader: 'x-test-client' } });
    expect((await post(world, ILLEGAL, '192.0.2.77')).status).toBe(200);
    expect(await world.databaseBytes()).not.toContain('192.0.2.77');
  });
});

describe('the form, read (#907)', () => {
  const read = (fields: Record<string, string>) => readNoticeForm(new URLSearchParams(fields));

  it('refuses an email that would carry mailto parameters, or a control character', () => {
    for (const email of [
      'me@x.org?bcc=attacker%40evil.com&subject=hi',
      'me@x.org&body=hi',
      'me%40x.org@x.org',
      'me@x.org\u0000',
      'a<b>@x.org',
    ]) {
      const outcome = read({ kind: 'illegal_content', explanation: 'why', location: 'w', email });
      expect(outcome.ok, email).toBe(false);
    }
    expect(
      read({
        kind: 'illegal_content',
        explanation: 'why',
        location: 'w',
        email: 'a.b+c@ex-ample.co.uk',
      }).ok,
    ).toBe(true);
  });

  it('takes a location in words when there is no identifier', () => {
    const outcome = read({ kind: 'illegal_content', explanation: 'why', location: 'where' });
    expect(outcome).toMatchObject({ ok: true, notice: { items: [], location: 'where' } });
  });

  it('refuses a notice that says neither which item nor where', () => {
    expect(read({ kind: 'illegal_content', explanation: 'why' })).toMatchObject({
      ok: false,
      problems: [{ field: 'items' }],
    });
  });

  it('refuses an unknown kind, an email that is not one, and more items than one notice may name', () => {
    const items = Array.from({ length: 21 }, (_, index) => `result:${ROOM}:${String(index + 1)}`);
    const outcome = read({
      kind: 'gossip',
      explanation: 'why',
      items: items.join('\n'),
      email: 'not an email',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.problems.map((each) => each.field).sort()).toEqual([
      'email',
      'items',
      'kind',
    ]);
  });

  it('names one item once, however many times it was pasted', () => {
    expect(
      read({ ...ILLEGAL, items: `route:${ROOM}\n route:${ROOM} \n\nroom:${ROOM}` }),
    ).toMatchObject({ ok: true, notice: { items: [`route:${ROOM}`, `room:${ROOM}`] } });
  });

  it('refuses a control character in what it keeps', () => {
    expect(read({ ...ILLEGAL, explanation: 'a\u0007b' })).toMatchObject({
      ok: false,
      problems: [{ field: 'explanation' }],
    });
  });
});
