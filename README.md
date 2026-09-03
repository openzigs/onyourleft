# On Your Left

A free, open alternative to Strava + Zwift for cycling: ride tracking, indoor smart-trainer control,
and live sensor capture over Bluetooth Low Energy.

## Status

Planning. No application code yet — see the [open epics and issues](https://github.com/openzigs/onyourleft/issues).

The first milestone is deliberately small and entirely local: pair a Bluetooth trainer, record a
ride, store it and view it, with **no server, no account and no hosting bill**. Everything else
sequences after that.

## Scope

- Web app first, then mobile and desktop clients
- Smart trainer control (Wahoo KICKR and other FTMS trainers), including ERG mode
- Sensors: power meter pedals, heart rate monitors, cadence and speed
- Activity recording, FIT/GPX/TCX import and export, analysis
- Route planning, segments and leaderboards
- Local-first, with a self-hostable instance for anything that needs to be shared

## Licence

Two licences, split along a deliberate boundary:

| What | Licence |
|---|---|
| The application — instance server, web app, deployed product | [`AGPL-3.0-or-later`](LICENSE) |
| Reusable leaf packages — domain types, FIT/GPX/TCX codec, BLE sensor layer | [`Apache-2.0`](LICENSES/Apache-2.0.txt) |

Anything not explicitly marked Apache-2.0 is AGPL-3.0-or-later.

The AGPL means **nobody can run a closed hosted fork of this service** — including us. Anyone
running a modified instance owes its users the source. The permissive leaf packages mean the parts
worth reusing (a FIT codec, a BLE sensor abstraction) can be adopted by anyone, and carry an express
patent grant.

Reasoning, and what the choice forecloses: [`docs/adr/0001-licence.md`](docs/adr/0001-licence.md).

## Self-hosting

Self-hosting is a first-class, supported goal, not an afterthought — the architecture is one small
self-hostable instance rather than a single central service.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Commits are signed off under the DCO; there is no CLA, and
you keep your copyright.

## Relationship to Strava and Zwift

This project is not affiliated with, endorsed by, or derived from Strava or Zwift. It does not use
their APIs, code, assets or data, and it reimplements product concepts independently. You can bring
your own history in via standard FIT, GPX and TCX file import.
