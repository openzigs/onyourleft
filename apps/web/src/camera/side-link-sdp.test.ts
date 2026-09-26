// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { sdpFromSidePeerParameters, sidePeerParametersFrom, SideSdpError } from './side-link-sdp';

/**
 * A data-channel offer in the shape Chromium 153 writes one — the fields and
 * their order are what spike 0011's probe printed; the credentials, the
 * fingerprint and the addresses are made up.
 */
const CHROME_OFFER = [
  'v=0',
  'o=- 8124785412342349101 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3907215063 1 udp 2113937151 192.168.68.69 50123 typ host generation 0 network-cost 999',
  'a=candidate:1150468787 1 tcp 1518157055 192.168.68.69 9 typ host tcptype active generation 0 network-cost 999',
  'a=candidate:2211111111 1 udp 1677729535 203.0.113.9 50123 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=candidate:2211111112 2 udp 2113937150 192.168.68.69 50124 typ host generation 0',
  'a=ice-ufrag:Zq8h',
  'a=ice-pwd:Qm3v0f8y1Jc9dZ2kL5nH7tRp',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, index) => index.toString(16).toUpperCase().padStart(2, '0')).join(':')}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

describe('reading the link’s fields out of a description', () => {
  it('reads the credentials, the fingerprint, the role and every component-1 candidate', () => {
    const read = sidePeerParametersFrom(CHROME_OFFER);
    expect(read.ufrag).toBe('Zq8h');
    expect(read.password).toBe('Qm3v0f8y1Jc9dZ2kL5nH7tRp');
    expect([...read.fingerprint]).toEqual(Array.from({ length: 32 }, (_, index) => index));
    expect(read.setup).toBe('actpass');
    // The component-2 line is not the link's; the TCP and srflx ones ARE
    // returned, because the decision about them is side-link-code.ts'.
    expect(read.candidates).toEqual([
      { address: '192.168.68.69', port: 50_123, transport: 'udp', type: 'host' },
      { address: '192.168.68.69', port: 9, transport: 'tcp', type: 'host' },
      { address: '203.0.113.9', port: 50_123, transport: 'udp', type: 'srflx' },
    ]);
  });

  it('refuses a description the link could not be built from', () => {
    const without = (prefix: string): string =>
      CHROME_OFFER.split('\r\n')
        .filter((line) => !line.startsWith(prefix))
        .join('\r\n');
    expect(() => sidePeerParametersFrom(without('a=ice-pwd'))).toThrow(SideSdpError);
    expect(() => sidePeerParametersFrom(without('a=fingerprint'))).toThrow(SideSdpError);
    expect(() => sidePeerParametersFrom(without('a=setup'))).toThrow(SideSdpError);
    expect(() => sidePeerParametersFrom(CHROME_OFFER.replace('a=mid:0', 'a=mid:data'))).toThrow(
      SideSdpError,
    );
    expect(() =>
      sidePeerParametersFrom(CHROME_OFFER.replace('a=sctp-port:5000', 'a=sctp-port:5001')),
    ).toThrow(SideSdpError);
    expect(() => sidePeerParametersFrom(CHROME_OFFER.replace('sha-256', 'sha-1'))).toThrow(
      SideSdpError,
    );
    expect(() =>
      sidePeerParametersFrom(`${CHROME_OFFER}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n`),
    ).toThrow(SideSdpError);
  });

  it('names no value from the description in its refusal', () => {
    // ADR 0004 decision D: an address on the rider's own network is a
    // location, and a message about it names the field and never the value.
    try {
      sidePeerParametersFrom(CHROME_OFFER.replace('a=setup:actpass', 'a=setup:holdconn'));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('192.168');
      expect(String(error)).not.toContain('Zq8h');
    }
  });
});

describe('writing the other end’s description back', () => {
  it('round-trips through the reader', () => {
    const read = sidePeerParametersFrom(CHROME_OFFER);
    const kept = { ...read, candidates: read.candidates.slice(0, 1) };
    const again = sidePeerParametersFrom(sdpFromSidePeerParameters(kept));
    expect(again).toEqual(kept);
  });

  it('declares every candidate a UDP host candidate, whatever it was handed', () => {
    const read = sidePeerParametersFrom(CHROME_OFFER);
    const written = sdpFromSidePeerParameters(read);
    const candidates = written.split('\r\n').filter((line) => line.startsWith('a=candidate:'));
    expect(candidates).toHaveLength(3);
    for (const line of candidates) {
      expect(line).toMatch(/^a=candidate:\d+ 1 udp \d+ \S+ \d+ typ host$/);
    }
  });

  it('writes an IPv6 address bare, as ICE carries one', () => {
    const read = sidePeerParametersFrom(CHROME_OFFER);
    const written = sdpFromSidePeerParameters({
      ...read,
      candidates: [{ address: 'fe80::1', port: 5000, transport: 'udp', type: 'host' }],
    });
    expect(written).toContain(' fe80::1 5000 typ host');
    expect(written).not.toContain('[fe80');
  });

  it('writes one data-channel section and nothing a peer did not need', () => {
    const written = sdpFromSidePeerParameters(sidePeerParametersFrom(CHROME_OFFER));
    expect(written.match(/^m=/gm)).toHaveLength(1);
    expect(written).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(written).not.toContain('extmap');
    expect(written.endsWith('\r\n')).toBe(true);
  });
});
