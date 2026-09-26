// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the one permitted peer connection is pointed at** — ADR 0033 D-9
 * step 3.
 *
 * `privacy/no-network.test.ts` counts the constructor and cannot see its
 * configuration, so this is where *"no ICE server of any kind"* is a test:
 * the configuration object, and what the constructor is actually handed.
 * D-4's candidate rule — which refuses a server-reflexive, relay and public
 * candidate — is asserted in `side-link-code.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { createSidePeer, SIDE_LINK_CONFIGURATION, sideLinkAvailable } from './side-link-transport';

describe('the side link’s configuration', () => {
  it('has an empty list of ICE servers — no STUN, no TURN, no ICE service', () => {
    expect(SIDE_LINK_CONFIGURATION.iceServers).toEqual([]);
  });

  it('sets nothing else, so no relay-only policy and no pooled candidates', () => {
    expect(Object.keys(SIDE_LINK_CONFIGURATION)).toEqual(['iceServers']);
    expect(SIDE_LINK_CONFIGURATION).not.toHaveProperty('iceTransportPolicy');
  });

  it('cannot be widened at run time', () => {
    expect(Object.isFrozen(SIDE_LINK_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(SIDE_LINK_CONFIGURATION.iceServers)).toBe(true);
  });
});

describe('the constructor', () => {
  it('is handed exactly that configuration', () => {
    const given: unknown[] = [];
    const platform = {
      RTCPeerConnection: class {
        constructor(configuration: unknown) {
          given.push(configuration);
        }
      },
    };
    expect(createSidePeer(platform)).toBeDefined();
    expect(given).toEqual([{ iceServers: [] }]);
    expect(given[0]).toBe(SIDE_LINK_CONFIGURATION);
  });

  it('is absent on a platform with no WebRTC, which is jsdom', () => {
    expect(createSidePeer({})).toBeUndefined();
    expect(createSidePeer()).toBeUndefined();
    expect(createSidePeer({ RTCPeerConnection: 'not a constructor' })).toBeUndefined();
    expect(sideLinkAvailable()).toBe(false);
    expect(sideLinkAvailable({ RTCPeerConnection: class {} })).toBe(true);
  });
});
