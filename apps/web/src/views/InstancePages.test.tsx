// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * About links to the notice page of the instance the rider connected to
 * (#907) — and only that instance's, and only the link: the page itself is
 * the instance's.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedInstance } from '../instance/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { AboutView } from './AboutView';
import { LEGAL_LINK_TEXT, REPORT_LINK_TEXT, TERMS_LINK_TEXT } from './InstancePages';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function linksNamed(text: string): HTMLAnchorElement[] {
  if (mounted === undefined) throw new Error('nothing mounted');
  return queryAll<HTMLAnchorElement>(mounted.container, 'a').filter(
    (link) => link.textContent === text,
  );
}

const reportLinks = (): HTMLAnchorElement[] => linksNamed(REPORT_LINK_TEXT);

describe('About’s link to the instance’s notice page (#907)', () => {
  it('goes to the notice page of the instance this device is connected to, in a new tab', async () => {
    const instance = scriptedInstance({ connected: true });
    mounted = await mount(<AboutView instance={instance.port} />);
    await settle();
    const [link, ...more] = reportLinks();
    expect(more).toEqual([]);
    expect(link?.getAttribute('href')).toBe('https://ride.example/report');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
  });

  it('follows the instance the device connected to, not one written into the app', async () => {
    const instance = scriptedInstance({ connected: true });
    instance.held.origin = 'https://club.example:8443';
    mounted = await mount(<AboutView instance={instance.port} />);
    await settle();
    expect(reportLinks()[0]?.getAttribute('href')).toBe('https://club.example:8443/report');
  });

  it('shows nothing on a device connected to no instance, or with no instance port at all', async () => {
    mounted = await mount(<AboutView instance={scriptedInstance({ connected: false }).port} />);
    await settle();
    expect(reportLinks()).toEqual([]);
    expect(mounted.container.textContent).not.toContain('Your instance');
    mounted.unmount();
    mounted = await mount(<AboutView />);
    await settle();
    expect(reportLinks()).toEqual([]);
  });

  it('links the legal and contact page of the same instance (#908)', async () => {
    const instance = scriptedInstance({ connected: true });
    instance.held.origin = 'https://club.example:8443';
    mounted = await mount(<AboutView instance={instance.port} />);
    await settle();
    const [link, ...more] = linksNamed(LEGAL_LINK_TEXT);
    expect(more).toEqual([]);
    expect(link?.getAttribute('href')).toBe('https://club.example:8443/legal');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('links the terms of service of the same instance (#909)', async () => {
    const instance = scriptedInstance({ connected: true });
    instance.held.origin = 'https://club.example:8443';
    mounted = await mount(<AboutView instance={instance.port} />);
    await settle();
    const [link, ...more] = linksNamed(TERMS_LINK_TEXT);
    expect(more).toEqual([]);
    expect(link?.getAttribute('href')).toBe('https://club.example:8443/terms');
  });
});
