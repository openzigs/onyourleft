// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  CLAIM_REACH_TEXT,
  INVITE_REACH_TEXT,
  isTailscaleOrigin,
  REACH_CHECKED_TEXT,
  reachPathOf,
  SETUP_EXAMPLE_ADDRESS_EXPERT_LINES,
  SETUP_EXAMPLE_ADDRESS_TEXT,
} from './reach';
import * as reach from './reach';

describe('what a device needs before it can reach the server (#2855)', () => {
  it('reads a Tailscale name from the address alone, and nothing that only contains one', () => {
    for (const origin of [
      'https://onyourleft.tail1a2b.ts.net',
      'https://onyourleft-1.cat-dog.ts.net',
      'https://ONYOURLEFT.Tail1a2b.TS.NET',
      'https://onyourleft.tail1a2b.ts.net:8443',
      'https://onyourleft.tail1a2b.ts.net.',
    ]) {
      expect(isTailscaleOrigin(origin), origin).toBe(true);
    }
    for (const origin of [
      'https://rides.example.org',
      'https://ts.net',
      'https://onyourleft.tail1a2b.ts.net.example.org',
      'https://example.org/onyourleft.tail1a2b.ts.net',
      'https://onyourleft.tail1a2b.ts.net/health',
      'http://onyourleft.tail1a2b.ts.net',
      'https://onyourleft.tail1a2b.ts.network',
      '',
    ]) {
      expect(isTailscaleOrigin(origin), origin).toBe(false);
    }
  });

  it('takes the operator’s own word for the path, and the address only when none was named', () => {
    const tailscale = 'https://onyourleft.tail1a2b.ts.net';
    const domain = 'https://rides.example.org';
    expect(reachPathOf('tailnet', tailscale)).toBe('tailnet');
    // Funnel serves the same ts.net name on the public internet (ADR 0079 D-3).
    expect(reachPathOf('funnel', tailscale)).toBe('internet');
    expect(reachPathOf('cloudflare', domain)).toBe('internet');
    // The operator's word wins over what the address looks like, both ways.
    expect(reachPathOf('tailnet', domain)).toBe('tailnet');
    expect(reachPathOf('cloudflare', tailscale)).toBe('internet');
    expect(reachPathOf(null, tailscale)).toBe('tailnet');
    expect(reachPathOf(null, domain)).toBe('internet');
  });

  it('names Tailscale only where the device needs it', () => {
    expect(CLAIM_REACH_TEXT.tailnet).toContain('same Tailscale network as this computer');
    expect(INVITE_REACH_TEXT.tailnet).toContain('your Tailscale network');
    // A rider signs in as themselves, never as the owner (ADR 0079 D-2).
    expect(INVITE_REACH_TEXT.tailnet).toContain('never yours');
    expect(CLAIM_REACH_TEXT.internet).not.toMatch(/Tailscale/);
    expect(INVITE_REACH_TEXT.internet).not.toMatch(/Tailscale/);
    expect(REACH_CHECKED_TEXT.connected).not.toBe(REACH_CHECKED_TEXT['not-connected']);
  });

  it('keeps settings names and commands out of the plain sentences, in the expert lines only', () => {
    const plain = Object.values(reach as Record<string, unknown>).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.values(value as Record<string, string>)
          : [],
    );
    expect(plain.length).toBeGreaterThanOrEqual(10);
    for (const sentence of plain) {
      expect(sentence).not.toMatch(/OYL_|docker compose|\.env|moderator/);
    }
    expect(SETUP_EXAMPLE_ADDRESS_TEXT).toContain('settings file');
    expect(SETUP_EXAMPLE_ADDRESS_EXPERT_LINES.join(' ')).toContain('OYL_INSTANCE_ORIGIN');
    expect(SETUP_EXAMPLE_ADDRESS_EXPERT_LINES.join(' ')).toContain('docker compose up -d instance');
  });
});
