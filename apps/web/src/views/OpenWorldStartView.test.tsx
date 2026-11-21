// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The open-world start picker — #2889.
 *
 * Every start is read back through the session's entry (`entry.ts` §`take`),
 * the one path the open-world session reads, never from the picker's own
 * state. The port is the real `openWorldStartPort` over an in-memory store
 * that scopes on the owner as the real one does (the real store's scoping is
 * `start-port.test.ts`'s). The map is the recording port (`map/testing.ts`),
 * whose gestures a test fires the way the adapter reports them.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import type { ActivityId, AthleteId } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpenWorldEntry, type OpenWorldEntry } from '../game/open-world/entry';
import { describeStartRefusal, startCoverage } from '../game/open-world/start';
import { openWorldStartPort, type OpenWorldStartStore } from '../game/open-world/start-port';
import {
  BOULDER,
  DENVER,
  GOLDEN,
  LONDON,
  ME,
  tilesPreference,
  twoAthletesStore,
} from '../game/open-world/start-testing';
import { OSM_ATTRIBUTION, PUBLISHED_BASEMAP_URL, type BasemapConfig } from '../map/basemap';
import { STUB_MAP_CENTRE, stubMapPort, type StubMapPort } from '../map/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  OpenWorldStartView,
  PIN_NAME,
  START_NEEDS_TILES_TEXT,
  START_NO_MAP_TEXT,
  START_RIDE_UNREAD_TEXT,
} from './OpenWorldStartView';

/** The archive a build draws with nothing configured: its streets are the US's. */
const BASEMAP: BasemapConfig = {
  archiveUrl: PUBLISHED_BASEMAP_URL,
  attribution: OSM_ATTRIBUTION,
};

/** A self-hoster's own archive (ADR 0090 D-8), whose coverage this build cannot know. */
const OWN_BASEMAP: BasemapConfig = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

interface Picker {
  readonly view: Mounted;
  readonly engine: StubMapPort;
  readonly entry: OpenWorldEntry;
  readonly opened: { count: number };
}

async function open(
  options: {
    tiles?: boolean;
    map?: boolean;
    store?: OpenWorldStartStore;
    basemap?: BasemapConfig;
  } = {},
): Promise<Picker> {
  const basemap = options.basemap ?? BASEMAP;
  const engine = stubMapPort();
  const entry = createOpenWorldEntry();
  const opened = { count: 0 };
  const port = openWorldStartPort({
    store: options.store ?? twoAthletesStore(),
    owner: ME,
    entry,
    opened: () => {
      opened.count += 1;
    },
    // As `main.tsx` builds it: the coverage of the archive the map draws.
    coverage: startCoverage(basemap),
  });
  mounted = await mount(
    <main>
      <h1>Open world: choose a start</h1>
      <OpenWorldStartView
        port={port}
        map={options.map === false ? undefined : () => Promise.resolve(engine)}
        basemap={basemap}
        preferences={tilesPreference(options.tiles ?? true)}
      />
    </main>,
  );
  await settle();
  await settle();
  return { view: mounted, engine, entry, opened };
}

function button(view: Mounted, label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(view.container, 'button').find(
    (each) => each.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}"`);
  return found;
}

function hasButton(view: Mounted, label: string): boolean {
  return queryAll(view.container, 'button').some((each) => each.textContent?.trim() === label);
}

/** What the pin's live region last said (#2889): the region in the pin's own section. */
function pinSaid(view: Mounted): string {
  return (
    view.container.querySelector('section[aria-labelledby="oyl-open-world-pin"] [role="status"]')
      ?.textContent ?? ''
  );
}

/** A focused pin's arrow key, as the adapter reports it (`maplibre.ts` §`PIN_KEYS`). */
async function nudge(
  picker: Picker,
  direction: 'north' | 'south' | 'east' | 'west',
): Promise<void> {
  const handlers = picker.engine.created.at(-1)?.handlers;
  if (handlers?.nudgeWaypoint === undefined) throw new Error('the picker hears no pin keys');
  await act(async () => {
    handlers.nudgeWaypoint?.('open-world-pin', direction);
    await Promise.resolve();
  });
  await settle();
}

async function tap(picker: Picker, position: GeographicPosition): Promise<void> {
  const handlers = picker.engine.created.at(-1)?.handlers;
  if (handlers === undefined) throw new Error('the picker is not listening to its map');
  await act(async () => {
    handlers.tap(position);
    await Promise.resolve();
  });
  await settle();
}

describe('a pin on the map — #2889', () => {
  it('drops the pin where the map is tapped, and the session takes that start', async () => {
    const picker = await open();
    await tap(picker, DENVER);
    expect(picker.engine.created.at(-1)?.waypoints.at(-1)).toEqual([
      { id: 'open-world-pin', position: DENVER, label: PIN_NAME, kind: 'pin' },
    ]);
    expect(pinSaid(picker.view)).toBe('Pin dropped.');
    expect(picker.entry.take(), 'nothing is handed before the press').toBeUndefined();
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()).toEqual({ position: DENVER, source: 'pin' });
    expect(picker.opened.count).toBe(1);
  });

  it('moves the pin where it is dragged to', async () => {
    const picker = await open();
    await tap(picker, DENVER);
    const handlers = picker.engine.created.at(-1)?.handlers;
    await act(async () => {
      handlers?.moveWaypoint('open-world-pin', GOLDEN);
      await Promise.resolve();
    });
    await settle();
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()).toEqual({ position: GOLDEN, source: 'pin' });
  });

  it('places the pin by keyboard, and moves it by the focused pin’s arrow keys', async () => {
    const picker = await open();
    await activateWithKeyboard(button(picker.view, 'Put the pin at the map’s centre'));
    expect(pinSaid(picker.view)).toBe('Pin put at the map’s centre.');
    await nudge(picker, 'north');
    expect(pinSaid(picker.view)).toBe('Pin moved north.');
    await nudge(picker, 'east');
    expect(pinSaid(picker.view)).toBe('Pin moved east.');
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    const taken = picker.entry.take();
    expect(taken?.source).toBe('pin');
    expect(taken?.position.latitude).toBeCloseTo(STUB_MAP_CENTRE.latitude + 0.0005, 6);
    expect(taken?.position.longitude).toBeGreaterThan(STUB_MAP_CENTRE.longitude);
  });

  it('refuses a pin outside the map, in words with no digit of it, and offers no start', async () => {
    const picker = await open();
    await tap(picker, LONDON);
    const text = picker.view.container.textContent ?? '';
    expect(text).toContain(describeStartRefusal('outside-coverage', 'pin'));
    const status = queryAll(picker.view.container, '[role="status"]')
      .map((each) => each.textContent ?? '')
      .join(' ');
    expect(status).not.toMatch(/\d/u);
    expect(hasButton(picker.view, 'Start the ride')).toBe(false);
  });

  it('starts from a pin outside the US on a self-hoster’s own archive — #2985', async () => {
    const picker = await open({ basemap: OWN_BASEMAP });
    await tap(picker, LONDON);
    expect(picker.view.container.textContent).not.toContain(
      describeStartRefusal('outside-coverage', 'pin'),
    );
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()).toEqual({ position: LONDON, source: 'pin' });
  });

  it('nudges the pin from where it stands at a chosen route’s start, not from an earlier drop — #2985', async () => {
    const picker = await open();
    await tap(picker, DENVER);
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    await nudge(picker, 'north');
    expect(pinSaid(picker.view)).toBe('Pin moved north.');
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    const taken = picker.entry.take();
    expect(taken?.source).toBe('pin');
    expect(taken?.position.latitude).toBeCloseTo(GOLDEN.latitude + 0.0005, 6);
    expect(taken?.position.longitude).toBeCloseTo(GOLDEN.longitude, 6);
  });
});

describe('the map is moved by hand, with no rows of buttons — #2889, 2026-11-20', () => {
  it('asks for a map moved by hand, named and described for the keyboard', async () => {
    const picker = await open();
    const direct = picker.engine.created.at(-1)?.options.direct;
    expect(direct?.label).toBe('Map for placing the start of an open-world ride.');
    const help = direct === undefined ? null : document.getElementById(direct.describedBy);
    expect(help?.textContent).toContain('Arrow keys move the map');
  });

  it('has no text button rows: zoom, pin and recentre are the map’s own icon buttons', async () => {
    const picker = await open();
    for (const gone of [
      'Move north',
      'Move south',
      'Move east',
      'Move west',
      'Whole route',
      'Move the pin north',
      'Move the pin south',
      'Move the pin east',
      'Move the pin west',
    ]) {
      expect(hasButton(picker.view, gone), gone).toBe(false);
    }
    expect(picker.view.container.querySelector('.oyl-map__moves')).toBeNull();
    const cluster = picker.view.container.querySelector(
      '[role="group"][aria-label="Map controls"]',
    );
    expect(
      queryAll(cluster ?? picker.view.container, 'button').map((each) => each.textContent?.trim()),
    ).toEqual(['Zoom in', 'Zoom out', 'Put the pin at the map’s centre', 'Recentre the map']);
    for (const each of queryAll(cluster ?? picker.view.container, 'button')) {
      expect(each.querySelector('svg[aria-hidden="true"]'), 'an icon').not.toBeNull();
    }
  });

  it('zooms by its buttons, and recentres on the whole map or on the pin', async () => {
    const picker = await open();
    const record = picker.engine.created.at(-1);
    await activateWithKeyboard(button(picker.view, 'Zoom in'));
    await activateWithKeyboard(button(picker.view, 'Zoom out'));
    await activateWithKeyboard(button(picker.view, 'Recentre the map'));
    expect(record?.moves).toEqual(['zoom in', 'zoom out', 'fit']);
    await tap(picker, DENVER);
    await activateWithKeyboard(button(picker.view, 'Recentre the map'));
    expect(record?.moves.at(-1)).toBe('show');
    expect(record?.shown.at(-1)).toEqual(DENVER);
  });

  it('flies to a chosen route’s start, and puts the pin there', async () => {
    const picker = await open();
    const record = picker.engine.created.at(-1);
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    const shown = record?.shown.at(-1);
    expect(shown?.latitude).toBeCloseTo(GOLDEN.latitude, 6);
    expect(shown?.longitude).toBeCloseTo(GOLDEN.longitude, 6);
    expect(record?.waypoints.at(-1)?.[0]?.position).toEqual(shown);
  });

  it('flies to a chosen ride’s start', async () => {
    const picker = await open();
    const record = picker.engine.created.at(-1);
    const spin = queryAll<HTMLButtonElement>(picker.view.container, 'button').find((each) =>
      each.textContent?.startsWith('Morning spin,'),
    );
    if (spin === undefined) throw new Error('no past ride listed');
    await activateWithKeyboard(spin);
    await settle();
    expect(record?.shown.at(-1)).toEqual(BOULDER);
  });

  it('says each pin move by direction, never by a number', async () => {
    const picker = await open();
    await tap(picker, DENVER);
    const said: string[] = [pinSaid(picker.view)];
    for (const direction of ['north', 'south', 'east', 'west'] as const) {
      await nudge(picker, direction);
      said.push(pinSaid(picker.view));
    }
    const handlers = picker.engine.created.at(-1)?.handlers;
    await act(async () => {
      handlers?.moveWaypoint('open-world-pin', GOLDEN);
      await Promise.resolve();
    });
    await settle();
    said.push(pinSaid(picker.view));
    expect(said).toEqual([
      'Pin dropped.',
      'Pin moved north.',
      'Pin moved south.',
      'Pin moved east.',
      'Pin moved west.',
      'Pin moved.',
    ]);
    expect(said.join(' ')).not.toMatch(/\d/u);
  });
});

describe('a saved route’s start — #2889', () => {
  it('lists only the rider’s routes, and the session takes the chosen one’s first point', async () => {
    const picker = await open();
    expect(hasButton(picker.view, 'Their loop')).toBe(false);
    const chosen = button(picker.view, 'Lookout loop');
    await activateWithKeyboard(chosen);
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(picker.view.container.textContent).toContain(
      'Starting where your route “Lookout loop” starts.',
    );
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    const taken = picker.entry.take();
    expect(taken?.source).toBe('route');
    expect(taken?.position.latitude).toBeCloseTo(GOLDEN.latitude, 6);
    expect(taken?.position.longitude).toBeCloseTo(GOLDEN.longitude, 6);
  });
});

describe('a past ride’s start — #2889', () => {
  function rideButton(view: Mounted, name: string): HTMLButtonElement {
    const found = queryAll<HTMLButtonElement>(view.container, 'button').find((each) =>
      each.textContent?.startsWith(`${name},`),
    );
    if (found === undefined) throw new Error(`no ride named "${name}"`);
    return found;
  }

  it('lists only the rider’s rides, and the session takes the chosen one’s first position', async () => {
    const picker = await open();
    expect(picker.view.container.textContent).not.toContain('Their ride');
    await activateWithKeyboard(rideButton(picker.view, 'Morning spin'));
    await settle();
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()).toEqual({ position: BOULDER, source: 'ride' });
  });

  it('refuses a ride that started outside the map', async () => {
    const picker = await open();
    await activateWithKeyboard(rideButton(picker.view, 'Thames path'));
    await settle();
    expect(picker.view.container.textContent).toContain(
      describeStartRefusal('outside-coverage', 'ride'),
    );
    expect(hasButton(picker.view, 'Start the ride')).toBe(false);
  });

  it('a later choice wins over a slower earlier read', async () => {
    // The ride's track is held back until the rider has chosen a route instead.
    const store = twoAthletesStore();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: OpenWorldStartStore = {
      ...store,
      getStreamChannel: async <C extends 'latitude' | 'longitude'>(
        owner: AthleteId,
        activity: ActivityId,
        channel: C,
      ) => {
        await held;
        return store.getStreamChannel(owner, activity, channel);
      },
    };
    const picker = await open({ store: slow });
    await activateWithKeyboard(rideButton(picker.view, 'Morning spin'));
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    await act(async () => {
      release();
      await held;
    });
    await settle();
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()?.source).toBe('route');
  });

  it('a pin dropped while a ride’s start is read is not overwritten by the read — #2985', async () => {
    const store = twoAthletesStore();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: OpenWorldStartStore = {
      ...store,
      getStreamChannel: async <C extends 'latitude' | 'longitude'>(
        owner: AthleteId,
        activity: ActivityId,
        channel: C,
      ) => {
        await held;
        return store.getStreamChannel(owner, activity, channel);
      },
    };
    const picker = await open({ store: slow });
    await activateWithKeyboard(rideButton(picker.view, 'Morning spin'));
    await tap(picker, DENVER);
    await act(async () => {
      release();
      await held;
    });
    await settle();
    expect(rideButton(picker.view, 'Morning spin').getAttribute('aria-pressed')).toBe('false');
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()).toEqual({ position: DENVER, source: 'pin' });
  });

  it('says a ride that could not be read is unread, not ridden indoors — #2985', async () => {
    const store = twoAthletesStore();
    const failing: OpenWorldStartStore = {
      ...store,
      getStreamChannel: () => Promise.reject(new Error('QuotaExceededError')),
    };
    const picker = await open({ store: failing });
    await activateWithKeyboard(rideButton(picker.view, 'Morning spin'));
    await settle();
    const text = picker.view.container.textContent ?? '';
    expect(text).toContain(START_RIDE_UNREAD_TEXT);
    expect(text).not.toContain(describeStartRefusal('no-position', 'ride'));
    expect(text).not.toContain('QuotaExceededError');
    expect(hasButton(picker.view, 'Start the ride')).toBe(false);
  });
});

describe('map tiles off — ADR 0090 D-7.2', () => {
  it('says the ride needs map tiles, and offers nothing that would request', async () => {
    const picker = await open({ tiles: false });
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    expect(picker.view.container.textContent).toContain(START_NEEDS_TILES_TEXT);
    expect(hasButton(picker.view, 'Start the ride')).toBe(false);
  });
});

describe('the picker makes no request of its own — #2889', () => {
  beforeEach(() => {
    const refuse = (name: string) => (): never => {
      throw new Error(`the open-world picker must not reach the network — it called ${name}`);
    };
    vi.stubGlobal('fetch', refuse('fetch'));
    vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', refuse('WebSocket'));
    vi.stubGlobal('EventSource', refuse('EventSource'));
    vi.stubGlobal('Image', refuse('Image'));
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: refuse('navigator.sendBeacon') });
  });

  it('chooses from each source and starts with the network refused: the map’s basemap is all', async () => {
    const picker = await open();
    await tap(picker, DENVER);
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    const spin = queryAll<HTMLButtonElement>(picker.view.container, 'button').find((each) =>
      each.textContent?.startsWith('Morning spin,'),
    );
    if (spin === undefined) throw new Error('no past ride listed');
    await activateWithKeyboard(spin);
    await settle();
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()?.source).toBe('ride');
    // The map's own reads are the basemap protocol, registered once, and nothing else.
    expect(picker.engine.added).toEqual(['pmtiles']);
  });
});

describe('with no map — #2889', () => {
  it('still starts from a saved route, and offers no pin button with no map to centre on', async () => {
    const picker = await open({ map: false });
    expect(hasButton(picker.view, 'Put the pin at the map’s centre')).toBe(false);
    // #2985: the pin's section says why it holds no map, not only its heading.
    expect(
      picker.view.container.querySelector('section[aria-labelledby="oyl-open-world-pin"]')
        ?.textContent,
    ).toContain(START_NO_MAP_TEXT);
    await activateWithKeyboard(button(picker.view, 'Lookout loop'));
    await activateWithKeyboard(button(picker.view, 'Start the ride'));
    expect(picker.entry.take()?.source).toBe('route');
  });
});
