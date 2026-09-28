// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #368's measure, for #623's palette: whether a rider in a given kit can still
 * be told from the pacer and the ghost. Test support, never shipped — the
 * suffix is what `check-wiring.mjs` §`isTestSupport` reads.
 *
 * ⚠️ **Hue, in both directions, and not a single channel ordering.** #742's
 * review found a multiplier over the teal house kit had wiped out the pacer's
 * orange while "red leads blue" stayed true, because the one ordering the
 * suite asserted was the one that survived. So each rider's hue is held to a
 * BAND — the pacer's red over its green AND over its blue, the ghost's blue
 * over its green AND over its red, the rider's own hue within a few degrees of
 * the colour the palette gave it — and the rider is held a stated number of
 * degrees of hue from both of the others, because a rider in the pacer's own
 * orange is darker or lighter than the pacer and still reads as the pacer at a
 * glance. The byte distance #368's browser case uses is kept beside it, and on
 * its own it is the measure the control shows is not enough: a jersey in the
 * bot's own tint is 161 bytes from the bot.
 *
 * Every colour here is 8-bit sRGB, the space the browser gate reads a pixel
 * back in; {@link albedoBytes} takes the LINEAR product the shader takes and
 * encodes it, so the arithmetic is the renderer's.
 *
 * No `three` is imported (`three-seam.test.ts`): the transfer functions are
 * the sRGB standard's own, as `design/contrast.ts` writes them.
 */

/** Three 8-bit sRGB channels. */
export type Bytes = readonly [number, number, number];

/** A colour's three channels, linear, from `0xrrggbb`. */
export function linearOf(hex: number): readonly [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff].map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as unknown as readonly [number, number, number];
}

/** One linear channel as an 8-bit sRGB byte. */
export function byteOf(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

/** A tint times a kit, per channel in linear light, as bytes — what the shader draws. */
export function albedoBytes(kitLinear: readonly number[], tintLinear: readonly number[]): Bytes {
  return [0, 1, 2].map((c) =>
    byteOf((kitLinear[c] ?? 0) * (tintLinear[c] ?? 0)),
  ) as unknown as Bytes;
}

/** Hue in degrees, HSV's; `NaN` for a grey, which has none. */
export function hueOf([r, g, b]: Bytes): number {
  const top = Math.max(r, g, b);
  const spread = top - Math.min(r, g, b);
  if (spread === 0) return Number.NaN;
  const sector =
    top === r
      ? ((g - b) / spread + 6) % 6
      : top === g
        ? (b - r) / spread + 2
        : (r - g) / spread + 4;
  return sector * 60;
}

/** HSV saturation, 0 for a grey. */
export function saturationOf([r, g, b]: Bytes): number {
  const top = Math.max(r, g, b);
  return top === 0 ? 0 : (top - Math.min(r, g, b)) / top;
}

/** How far apart two hues are round the wheel, 0–180; `NaN` if either has none. */
export function hueApart(a: Bytes, b: Bytes): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return Math.min(d, 360 - d);
}

/** #368's browser measure: the furthest channel apart, in bytes. */
export function channelsApart(a: Bytes, b: Bytes): number {
  return Math.max(...[0, 1, 2].map((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0))));
}

/**
 * The bounds, each stated with what it was measured against.
 *
 * - `HUE_APART_DEGREES`, 40: the house kit's teal sits 47.7 of hue from the
 *   ghost (the closest any entry comes), and a jersey in the bot's own tint
 *   `0xc2410c` sits 16.4 from the bot — the control. 40 separates them with
 *   room either side.
 * - `BYTES_APART`, 30: `realistic-textures.test.ts`' #368 floor on the jersey.
 * - `MINIMUM_SATURATION`, 0.35: a rider must HAVE a hue for the one above to
 *   mean anything; the least saturated entry is green's 0.63.
 * - `OWN_HUE_DEGREES`, 12: the rider's drawn hue from the hue the palette
 *   gave it. The rider's tint is white, so this is a few degrees of 8-bit
 *   rounding; a renderer that drew another entry's colour is tens of degrees
 *   out.
 * - The pacer's and the ghost's ratios are `game.browser.spec.ts`' silhouette
 *   bands, which are #368's hues on the screen.
 */
export const TOLD_APART = {
  HUE_APART_DEGREES: 40,
  BYTES_APART: 30,
  MINIMUM_SATURATION: 0.35,
  OWN_HUE_DEGREES: 12,
  BOT_RED_OVER_GREEN: { floor: 1.3, ceiling: 4 },
  GHOST_BLUE_OVER_GREEN: { floor: 1.5, ceiling: 6 },
} as const;

/** The three jerseys as drawn, and the colour the palette gave the rider. */
export interface ThreeJerseys {
  readonly rider: Bytes;
  readonly bot: Bytes;
  readonly ghost: Bytes;
  /** The palette entry's own jersey, `0xrrggbb`. */
  readonly chosen: number;
}

/**
 * Every way these three fail #368 — empty when a rider glancing at them could
 * tell them apart by colour. Each fault names the rider, the measure and the
 * figure, so a red run says which entry and why.
 */
export function toldApartFaults({ rider, bot, ghost, chosen }: ThreeJerseys): string[] {
  const faults: string[] = [];
  const t = TOLD_APART;
  const figure = (n: number): string => n.toFixed(1);
  for (const [name, a, b] of [
    ['rider and bot', rider, bot],
    ['rider and ghost', rider, ghost],
    ['bot and ghost', bot, ghost],
  ] as const) {
    const bytes = channelsApart(a, b);
    if (!(bytes > t.BYTES_APART)) faults.push(`${name} ${String(bytes)} bytes apart`);
  }
  for (const [name, other] of [
    ['bot', bot],
    ['ghost', ghost],
  ] as const) {
    const degrees = hueApart(rider, other);
    if (!(degrees >= t.HUE_APART_DEGREES)) {
      faults.push(`rider ${figure(degrees)} of hue from the ${name}`);
    }
  }
  if (!(saturationOf(rider) >= t.MINIMUM_SATURATION)) {
    faults.push(`rider saturation ${saturationOf(rider).toFixed(2)}`);
  }
  // The rider's own hue, both ways: the colour it chose, and no other.
  const own = [(chosen >> 16) & 0xff, (chosen >> 8) & 0xff, chosen & 0xff] as unknown as Bytes;
  const drift = hueApart(rider, own);
  if (!(drift <= t.OWN_HUE_DEGREES)) faults.push(`rider ${figure(drift)} off its own hue`);
  // The pacer's orange: red over green within a band, AND red over blue.
  const [botRed, botGreen, botBlue] = bot;
  const botRatio = botRed / Math.max(1, botGreen);
  if (!(botRatio > t.BOT_RED_OVER_GREEN.floor && botRatio < t.BOT_RED_OVER_GREEN.ceiling)) {
    faults.push(`bot red over green ${botRatio.toFixed(2)}`);
  }
  if (!(botRed > botBlue))
    faults.push(`bot red ${String(botRed)} not over blue ${String(botBlue)}`);
  // The ghost's slate: blue over green within a band, AND blue over red.
  const [ghostRed, ghostGreen, ghostBlue] = ghost;
  const ghostRatio = ghostBlue / Math.max(1, ghostGreen);
  if (!(
    ghostRatio > t.GHOST_BLUE_OVER_GREEN.floor && ghostRatio < t.GHOST_BLUE_OVER_GREEN.ceiling
  )) {
    faults.push(`ghost blue over green ${ghostRatio.toFixed(2)}`);
  }
  if (!(ghostBlue > ghostRed)) {
    faults.push(`ghost blue ${String(ghostBlue)} not over red ${String(ghostRed)}`);
  }
  return faults;
}

/**
 * The figures a run prints: each pair's hue gap and byte gap, and the rider's
 * own drift. Hues are in degrees round the colour wheel, printed with no sign
 * because `camera/no-absolute-angles.test.ts` rightly reads a degree sign in
 * any string of this client as a body angle.
 */
export function toldApartFigures({ rider, bot, ghost, chosen }: ThreeJerseys): string {
  const own = [(chosen >> 16) & 0xff, (chosen >> 8) & 0xff, chosen & 0xff] as unknown as Bytes;
  return (
    `rider ${rider.join(',')} (hue ${hueOf(rider).toFixed(1)}, ${hueApart(rider, own).toFixed(1)} off its own), ` +
    `bot ${bot.join(',')} (hue ${hueOf(bot).toFixed(1)}), ghost ${ghost.join(',')} (hue ${hueOf(ghost).toFixed(1)}); ` +
    `rider–bot ${hueApart(rider, bot).toFixed(1)} / ${String(channelsApart(rider, bot))} B, ` +
    `rider–ghost ${hueApart(rider, ghost).toFixed(1)} / ${String(channelsApart(rider, ghost))} B`
  );
}
