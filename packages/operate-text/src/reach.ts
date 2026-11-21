// SPDX-License-Identifier: Apache-2.0

/**
 * **What a tablet or phone needs before it can reach the server** (#2855):
 * the sentences the first-run setup says before it shows a claim code or an
 * invite, and the one rule for which of them applies, shared with the app so
 * its "did not answer" hint reads an address the same way.
 *
 * The trial of 2026-11-18 found that nothing said this: a new owner scanned
 * the claim code with a tablet that was not on the server's Tailscale network,
 * and the app could only say that the instance did not answer. Plain `http://`
 * on the home network is refused by both sides (ADR 0079 D-6), so the tablet
 * must already reach the server's `https://` address.
 *
 * Plain words first, as `setup.ts`: a sentence on a page names no environment
 * variable and no command. Nothing here is a code, a key or a secret; an
 * address is put into a page by the page, escaped.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** How a rider's device gets to the server: over the owner's Tailscale network, or over the internet. */
export type ReachPath = 'tailnet' | 'internet';

/** The remote path the operator named, as `apps/instance` reads `OYL_INSTANCE_REMOTE_PATH`. */
export type NamedRemotePath = 'tailnet' | 'funnel' | 'cloudflare';

/**
 * Whether `origin` is a Tailscale name, `https://<machine>.<tailnet>.ts.net`.
 * Read from the text alone (this package names no platform API, so no `URL`):
 * the scheme, a host that ends `.ts.net`, an optional port, and nothing after.
 */
export function isTailscaleOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9.-]+\.ts\.net\.?(?::[0-9]+)?$/i.test(origin);
}

/**
 * Which sentences apply. The operator's own word wins: `tailnet` is the
 * tailnet, while `funnel` and `cloudflare` are both reached over the internet
 * (Funnel serves a `ts.net` name publicly, ADR 0079 D-3). With none named, the
 * address says: a `ts.net` name is taken for a tailnet.
 */
export function reachPathOf(remotePath: NamedRemotePath | null, origin: string): ReachPath {
  if (remotePath !== null) return remotePath === 'tailnet' ? 'tailnet' : 'internet';
  return isTailscaleOrigin(origin) ? 'tailnet' : 'internet';
}

// --- the claim step

/** Before the address the tablet will use, which the page draws after it. */
export const CLAIM_ADDRESS_LEAD = 'Your tablet will reach this server at this address:';

/** What the owner's tablet needs before it scans the claim code. */
export const CLAIM_REACH_TEXT: Readonly<Record<ReachPath, string>> = {
  tailnet:
    'Before you scan, your tablet must be on the same Tailscale network as this computer: install the Tailscale app on the tablet, sign in with your own Tailscale account, and leave it switched on. Without that, the app on the tablet says the server did not answer.',
  internet:
    'Before you scan, your tablet must be online, on Wi-Fi or mobile data: it reaches this server over the internet. Without that, the app on the tablet says the server did not answer.',
};

/** Before the address to open on the tablet, which the page draws after it. */
export const CLAIM_TABLET_CHECK_LEAD =
  'To check, open this address in the tablet’s web browser. It should show a short line of text that says ok:';

/**
 * What this computer could check by itself, when it can check anything: on
 * the tunnel path, whether the tunnel is connected. It cannot see the owner's
 * Tailscale network, so on that path the page says nothing here.
 */
export const REACH_CHECKED_TEXT: Readonly<Record<'connected' | 'not-connected', string>> = {
  connected: 'Checked from this computer: this server’s tunnel is connected.',
  'not-connected':
    'Checked from this computer: this server’s tunnel is not connected, so no tablet or phone can reach it yet. Check that the tunnel is running, then load this page again.',
};

// --- the invite step

/** What a rider's device needs before it scans an invite. */
export const INVITE_REACH_TEXT: Readonly<Record<ReachPath, string>> = {
  tailnet:
    'Before the rider scans it, their phone or tablet must be on your Tailscale network too: the Tailscale app, signed in with the rider’s own account, never yours. Without that, the app says the server did not answer.',
  internet:
    'Before the rider scans it, their phone or tablet must be online, on Wi-Fi or mobile data.',
};

// --- an address that was never set

/** The heading of the page the setup answers with while the address is the template's example. */
export const SETUP_EXAMPLE_ADDRESS_HEADING = 'Set this server’s address first';

/** The one plain sentence: why the setup has not opened, and what to set. */
export const SETUP_EXAMPLE_ADDRESS_TEXT =
  'The setup has not opened, because this server’s address is still the example from the settings template: no tablet or phone can reach that address, so set it to your own in the settings file, start the server again and open this page again.';

/** The same, for whoever wants the setting's name and the command. */
export const SETUP_EXAMPLE_ADDRESS_EXPERT_LINES: readonly string[] = [
  'Set OYL_INSTANCE_ORIGIN in .env to https:// and this machine’s own name: its Tailscale name, or your tunnel’s public hostname.',
  'Then run docker compose up -d instance, and open this page again.',
];
