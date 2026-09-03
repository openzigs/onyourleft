// SPDX-License-Identifier: AGPL-3.0-or-later

import { metresPerSecond } from '@onyourleft/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { formatSpeed } from './format';

describe('formatSpeed', () => {
  it('renders one decimal place and the unit', () => {
    expect(formatSpeed(metresPerSecond(10))).toBe('36.0 km/h');
  });

  it('propagates the domain package’s rejection of an impossible speed', () => {
    // The guard lives in @onyourleft/domain, at the constructor that turns an
    // untrusted number into a typed quantity, and this asserts it is still
    // reached through this path: a client that swallowed it would render
    // "NaN km/h" from a malformed sensor payload.
    expect(() => formatSpeed(metresPerSecond(Number.NaN))).toThrow(/finite/);
  });
});

describe('App', () => {
  it('renders the speed produced by the shared domain package', () => {
    // Rendered rather than inspected: this is the workspace's first consumer of
    // @onyourleft/domain, and reading the value back out of the markup is the
    // only assertion that proves the whole path resolves — workspace link, TS
    // config and JSX transform included.
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('36.0 km/h');
    expect(markup).toContain('On Your Left');
  });
});
