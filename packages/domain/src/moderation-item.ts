// SPDX-License-Identifier: Apache-2.0

/**
 * **The identifier of one item a notice can name** (#907, #913).
 *
 * DSA Art. 16(2)(b) asks that a notice can carry *"the exact electronic
 * location"* of the information it is about, and recital 50 that one notice
 * may name several. On an instance the items another rider can see are few,
 * and each is written here as ONE line of text a notifier can copy from the
 * app and paste into the instance's notice page:
 *
 * | Identifier | The item |
 * | --- | --- |
 * | `rider:<athlete id>` | a rider's display name |
 * | `room:<room id>` | a room's listing |
 * | `route:<room id>` | the route a room is ridden on, shown to its riders |
 * | `result:<room id>:<row>` | one row of a race's published result, counted from 1 in the order the instance publishes it |
 *
 * ⚠️ **A result is named by its ROW, not by the rider in it.** A race's
 * published result carries a name and never an athlete id (`apps/instance`
 * §`publication.ts`), so an identifier the app can show must not either. The
 * order is the room's finish order, final once the race is over, which is
 * the only time a result is shown.
 *
 * Pure: no platform API, so the instance that reads a notice and the app that
 * shows the identifier parse it with the same function.
 */

/** An athlete id as the instance mints and accepts one. */
const ATHLETE_ID = '[A-Za-z0-9_-]{1,128}';
/** A room id as the instance mints one: 16 random bytes, hex. */
const ROOM_ID = '[0-9a-f]{32}';

export type ModerationItem =
  | { readonly kind: 'rider'; readonly athleteId: string }
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'route'; readonly roomId: string }
  | { readonly kind: 'result'; readonly roomId: string; readonly row: number };

const RIDER = new RegExp(`^rider:(${ATHLETE_ID})$`);
const ROOM = new RegExp(`^room:(${ROOM_ID})$`);
const ROUTE = new RegExp(`^route:(${ROOM_ID})$`);
const RESULT = new RegExp(`^result:(${ROOM_ID}):([1-9][0-9]{0,3})$`);

/** One identifier, read; `undefined` for anything that is not one. Surrounding spaces are ignored. */
export function parseModerationItem(text: string): ModerationItem | undefined {
  const value = text.trim();
  const rider = RIDER.exec(value);
  if (rider !== null) return { kind: 'rider', athleteId: rider[1] as string };
  const room = ROOM.exec(value);
  if (room !== null) return { kind: 'room', roomId: room[1] as string };
  const route = ROUTE.exec(value);
  if (route !== null) return { kind: 'route', roomId: route[1] as string };
  const result = RESULT.exec(value);
  if (result !== null) {
    return { kind: 'result', roomId: result[1] as string, row: Number(result[2]) };
  }
  return undefined;
}

/** The identifier of an item, as the app shows it and {@link parseModerationItem} reads it back. */
export function formatModerationItem(item: ModerationItem): string {
  switch (item.kind) {
    case 'rider':
      return `rider:${item.athleteId}`;
    case 'room':
      return `room:${item.roomId}`;
    case 'route':
      return `route:${item.roomId}`;
    case 'result':
      return `result:${item.roomId}:${String(item.row)}`;
  }
}
