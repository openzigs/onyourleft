// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CLIMB_PRESET, GROUP_PRESET, SPRINT_PRESET } from './presets';
import { parseDemoQuery } from './query';

describe("the demo page's query — #1647", () => {
  it.each([
    ['?preset=climb', CLIMB_PRESET],
    ['?preset=sprint', SPRINT_PRESET],
    ['?preset=group', GROUP_PRESET],
    ['preset=group', GROUP_PRESET],
    ['', CLIMB_PRESET],
    ['?', CLIMB_PRESET],
  ])('%j rides its preset', (search, preset) => {
    expect(parseDemoQuery(search)).toEqual({ ok: true, preset });
  });

  it.each([
    ['?preset=climb&route=upstate-climb', CLIMB_PRESET, 'upstate-climb'],
    ['?route=fixture&preset=group', GROUP_PRESET, 'fixture'],
    ['?route=fixture', CLIMB_PRESET, 'fixture'],
  ])('%j rides its preset on the baked route it names — #1652', (search, preset, route) => {
    expect(parseDemoQuery(search)).toEqual({ ok: true, preset, route });
  });

  it.each([
    ['?showcase', { ok: true, preset: GROUP_PRESET, showcase: true }],
    ['?showcase=&preset=group', { ok: true, preset: GROUP_PRESET, showcase: true }],
    [
      '?showcase&route=upstate-climb',
      { ok: true, preset: GROUP_PRESET, route: 'upstate-climb', showcase: true },
    ],
  ])('%j runs the showcase on the group preset — #1653', (search, expected) => {
    expect(parseDemoQuery(search)).toEqual(expected);
  });

  it.each([
    ['?render', { ok: true, preset: CLIMB_PRESET, render: true }],
    [
      '?preset=group&route=fixture&render=',
      { ok: true, preset: GROUP_PRESET, route: 'fixture', render: true },
    ],
  ])('%j is the video render’s page — #1655', (search, expected) => {
    expect(parseDemoQuery(search)).toEqual(expected);
  });

  it.each([
    ['?speed=2', 'This demo has no setting called “speed”.'],
    ['?preset=climb&world=stylised', 'This demo has no setting called “world”.'],
    ['?preset=sprnt', 'This demo’s preset is one of climb, sprint, group, not “sprnt”.'],
    ['?preset=', 'This demo’s preset is one of climb, sprint, group, not “”.'],
    ['?preset=Climb', 'This demo’s preset is one of climb, sprint, group, not “Climb”.'],
    ['?preset=climb&preset=sprint', 'This demo’s “preset” setting is given more than once.'],
    ['?route=../secret', 'This demo has no route called “../secret”.'],
    ['?route=', 'This demo has no route called “”.'],
    ['?route=Upstate', 'This demo has no route called “Upstate”.'],
    ['?route=a&route=b', 'This demo’s “route” setting is given more than once.'],
    ['?showcase=on', 'This demo’s “showcase” setting takes no value, not “on”.'],
    ['?showcase&preset=climb', 'This demo’s showcase is ridden by the group preset.'],
    ['?render=1', 'This demo’s “render” setting takes no value, not “1”.'],
  ])('refuses %j, saying why, rather than riding the default', (search, message) => {
    expect(parseDemoQuery(search)).toEqual({ ok: false, message });
  });
});
