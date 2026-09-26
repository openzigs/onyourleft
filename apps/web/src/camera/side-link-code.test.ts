// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  candidateAccepted,
  MAXIMUM_PAIRING_CANDIDATES,
  MAXIMUM_PAIRING_CODE_LENGTH,
  PAIRING_CODE_PREFIX,
  PAIRING_REFUSAL_TEXT,
  pairingCodeText,
  readPairingCode,
  type PairingRefusal,
} from './side-link-code';
import type { SideCandidate, SidePeerParameters } from './side-link-sdp';

const host = (address: string, port = 50_000): SideCandidate => ({
  address,
  port,
  transport: 'udp',
  type: 'host',
});

const SECRET = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);

const OFFER_PARAMETERS: SidePeerParameters = {
  ufrag: 'Zq8h',
  password: 'Qm3v0f8y1Jc9dZ2kL5nH7tRp',
  fingerprint: Uint8Array.from({ length: 32 }, (_, index) => index * 7),
  setup: 'actpass',
  candidates: [host('192.168.68.69', 50_123)],
};

const ANSWER_PARAMETERS: SidePeerParameters = { ...OFFER_PARAMETERS, setup: 'active' };

function offerText(parameters: SidePeerParameters = OFFER_PARAMETERS): string {
  const made = pairingCodeText('offer', parameters, SECRET);
  if (!('text' in made)) {
    throw new Error(`no offer: ${made.refusal}`);
  }
  return made.text;
}

function refusalOf(
  text: string,
  expected: 'offer' | 'answer' = 'offer',
): PairingRefusal | undefined {
  const read = readPairingCode(text, expected);
  return 'refusal' in read ? read.refusal : undefined;
}

/** An offer's body with one field changed, re-serialised. */
function withField(field: string, value: unknown): string {
  const body = JSON.parse(offerText().slice(PAIRING_CODE_PREFIX.length)) as Record<string, unknown>;
  body[field] = value;
  return `${PAIRING_CODE_PREFIX}${JSON.stringify(body)}`;
}

describe('D-4’s candidate rule', () => {
  it('accepts a UDP host candidate on the rider’s own network', () => {
    for (const address of [
      '192.168.1.20',
      '10.0.0.5',
      '172.16.4.4',
      '169.254.10.1',
      '100.64.0.9',
      'fe80::1c2d:3e4f:5a6b:7c8d',
      'FD12:3456::1',
      'fe80::1%wlan0',
      '1f2e3d4c-5b6a-4789-8abc-def012345678.local',
    ]) {
      expect(candidateAccepted(host(address)), address).toBe(true);
    }
  });

  it('refuses a public address, loopback, and the names a URL rule admits but ICE never writes', () => {
    for (const address of [
      '203.0.113.9',
      '8.8.8.8',
      '127.0.0.1',
      '::1',
      '2001:db8::1',
      'localhost',
      'nas.home.arpa',
      'box.internal',
      'evil.example.com',
      'a b.local',
      '.local',
    ]) {
      expect(candidateAccepted(host(address)), address).toBe(false);
    }
  });

  it('brackets an IPv6 address before classifying it — the adapter D-4 requires', () => {
    // Without the brackets `addressSpaceOf` reads every IPv6 address as
    // `undefined`, so a unique-local candidate would be refused for the wrong
    // reason. This is the case that goes red when the adapter is removed.
    expect(candidateAccepted(host('fd00::1'))).toBe(true);
  });

  it('refuses anything that is not a UDP host candidate, however local', () => {
    expect(candidateAccepted({ ...host('192.168.1.2'), transport: 'tcp' })).toBe(false);
    expect(candidateAccepted({ ...host('192.168.1.2'), type: 'srflx' })).toBe(false);
    expect(candidateAccepted({ ...host('192.168.1.2'), type: 'relay' })).toBe(false);
    expect(candidateAccepted(host('192.168.1.2', 0))).toBe(false);
  });
});

describe('making a code', () => {
  it('round-trips an offer, the secret included', () => {
    const read = readPairingCode(offerText(), 'offer');
    expect('code' in read).toBe(true);
    if (!('code' in read)) {
      return;
    }
    expect(read.code.role).toBe('offer');
    expect(read.code.parameters).toEqual(OFFER_PARAMETERS);
    expect([...(read.code.secret ?? [])]).toEqual([...SECRET]);
  });

  it('round-trips an answer, which carries no secret', () => {
    const made = pairingCodeText('answer', ANSWER_PARAMETERS);
    expect('text' in made).toBe(true);
    if (!('text' in made)) {
      return;
    }
    expect(made.text).not.toContain('"k"');
    const read = readPairingCode(made.text, 'answer');
    expect('code' in read && read.code.secret).toBeUndefined();
    expect('code' in read && read.code.parameters).toEqual(ANSWER_PARAMETERS);
  });

  it('leaves out every candidate the rule refuses — a global IPv6 one is omitted, not fatal', () => {
    const text = offerText({
      ...OFFER_PARAMETERS,
      candidates: [
        host('2001:db8::1'),
        { ...host('192.168.68.69'), transport: 'tcp' },
        host('203.0.113.9'),
        host('192.168.68.69', 50_123),
        host('fe80::1'),
      ],
    });
    expect(text).not.toContain('2001');
    expect(text).not.toContain('203.0');
    const read = readPairingCode(text, 'offer');
    expect('code' in read && read.code.parameters.candidates).toEqual([
      host('192.168.68.69', 50_123),
      host('fe80::1'),
    ]);
  });

  it('refuses to make a code with nothing left to connect to', () => {
    expect(
      pairingCodeText('offer', { ...OFFER_PARAMETERS, candidates: [host('203.0.113.9')] }, SECRET),
    ).toEqual({ refusal: 'no-candidate' });
  });

  it('refuses to make an offer without a secret of the fixed length', () => {
    expect(() => pairingCodeText('offer', OFFER_PARAMETERS)).toThrow(RangeError);
    expect(() => pairingCodeText('offer', OFFER_PARAMETERS, new Uint8Array(16))).toThrow(
      RangeError,
    );
  });

  it('is small enough for a QR code a phone reads across a metre', () => {
    const text = offerText({
      ...OFFER_PARAMETERS,
      password: 'x'.repeat(24),
      candidates: [host('192.168.68.69', 50_123), host('fe80::1c2d:3e4f:5a6b:7c8d', 50_124)],
    });
    // Byte-mode QR version 10 at level M holds 213 bytes; version 13, 311.
    expect(text.length).toBeLessThan(300);
  });
});

describe('reading a code — every other thing is refused', () => {
  it('refuses what is not this app’s code, or not this version', () => {
    expect(refusalOf('https://example.com/')).toBe('not-a-pairing-code');
    expect(refusalOf(offerText().replace(PAIRING_CODE_PREFIX, 'OYLSIDE2'))).toBe(
      'not-a-pairing-code',
    );
    expect(refusalOf(`${PAIRING_CODE_PREFIX}{not json`)).toBe('not-a-pairing-code');
    expect(refusalOf(`${PAIRING_CODE_PREFIX}[1,2]`)).toBe('not-a-pairing-code');
    expect(refusalOf(`${PAIRING_CODE_PREFIX}${' '.repeat(MAXIMUM_PAIRING_CODE_LENGTH)}`)).toBe(
      'not-a-pairing-code',
    );
  });

  it('refuses the other step’s code', () => {
    expect(refusalOf(offerText(), 'answer')).toBe('wrong-code');
  });

  it('refuses an unknown field rather than ignoring it — ADR 0017 D-4', () => {
    expect(refusalOf(withField('turn', 'turn:relay.example.com'))).toBe('malformed');
  });

  it('refuses a field out of its bounds', () => {
    expect(refusalOf(withField('u', 'ab'))).toBe('malformed');
    expect(refusalOf(withField('u', 'has space'))).toBe('malformed');
    expect(refusalOf(withField('p', 'short'))).toBe('malformed');
    expect(refusalOf(withField('f', 'AAAA'))).toBe('malformed');
    expect(refusalOf(withField('f', 7))).toBe('malformed');
    expect(refusalOf(withField('s', 'active'))).toBe('malformed');
    expect(refusalOf(withField('k', 'AAAA'))).toBe('malformed');
    expect(refusalOf(withField('k', undefined))).toBe('malformed');
    expect(refusalOf(withField('r', 'x'))).toBe('malformed');
    expect(refusalOf(withField('c', 'not-a-list'))).toBe('malformed');
    expect(refusalOf(withField('c', [42]))).toBe('malformed');
    expect(refusalOf(withField('c', ['192.168.1.2']))).toBe('malformed');
    expect(
      refusalOf(
        withField(
          'c',
          Array.from({ length: MAXIMUM_PAIRING_CANDIDATES + 1 }, () => '10.0.0.1:1'),
        ),
      ),
    ).toBe('malformed');
  });

  it('refuses the whole code for one candidate off the rider’s own network', () => {
    expect(refusalOf(withField('c', ['192.168.1.2:5000', '203.0.113.9:5000']))).toBe('not-local');
    expect(refusalOf(withField('c', ['[2001:db8::1]:5000']))).toBe('not-local');
    expect(refusalOf(withField('c', ['127.0.0.1:5000']))).toBe('not-local');
    expect(refusalOf(withField('c', ['192.168.1.2:0']))).toBe('not-local');
  });

  it('judges the candidates before the secret — the order #550’s fix chose, pinned', () => {
    // A bad secret AND a public candidate: the candidate's refusal wins,
    // because the secret is decoded last (where its type is narrowed). Either
    // answer names nothing of the code (`PAIRING_REFUSAL_TEXT`); this pins
    // WHICH, so a reorder is a decision rather than a drift.
    const both = (candidates: readonly string[]): string => {
      const body = JSON.parse(offerText().slice(PAIRING_CODE_PREFIX.length)) as Record<
        string,
        unknown
      >;
      body['k'] = 'AAAA';
      body['c'] = candidates;
      return `${PAIRING_CODE_PREFIX}${JSON.stringify(body)}`;
    };
    expect(refusalOf(both(['203.0.113.9:5000']))).toBe('not-local');
    expect(refusalOf(both([]))).toBe('no-candidate');
    expect(refusalOf(both(['192.168.1.2']))).toBe('malformed');
    // …and with good candidates, the bad secret is still refused.
    expect(refusalOf(both(['192.168.1.2:5000']))).toBe('malformed');
  });

  it('refuses a code with no candidate at all', () => {
    expect(refusalOf(withField('c', []))).toBe('no-candidate');
  });

  it('does NOT refuse a code whose candidates are all mDNS names — ICE finds that out', () => {
    // #529, from spike 0011's review: two desktop Chromes connect over names
    // alone, so refusing here would refuse a pair that works.
    const read = readPairingCode(
      withField('c', ['1f2e3d4c-5b6a-4789-8abc-def012345678.local:50000']),
      'offer',
    );
    expect('code' in read).toBe(true);
  });

  it('reads an IPv6 candidate back without its brackets', () => {
    const read = readPairingCode(withField('c', ['[fd00::5]:6000']), 'offer');
    expect('code' in read && read.code.parameters.candidates).toEqual([host('fd00::5', 6000)]);
  });
});

describe('what a rider is told', () => {
  it('names no address, no credential and no secret in any refusal', () => {
    for (const text of Object.values(PAIRING_REFUSAL_TEXT)) {
      expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(text).not.toContain('ufrag');
      expect(text.length).toBeGreaterThan(20);
    }
  });
});
