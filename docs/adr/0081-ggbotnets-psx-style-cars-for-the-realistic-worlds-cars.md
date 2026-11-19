# ADR 0081: GGBotNet's "PSX Style Cars" for the realistic world's cars

- **Status**: **Accepted, 2026-11-19**, on the owner's two rulings quoted in Context: the pack on
  2026-11-18 and its three bodies on 2026-11-19. What the rulings leave open is marked *the
  author's choice*, and D-6 lists those points for the owner to confirm or overrule on the pull
  request
- **Date**: 2026-11-19
- **Deciders**: **the owner**, in the two rulings. **The author** read the pack's own page on
  2026-11-18 and 2026-11-19 and decided the engineering
- **Issue**: [#2847](https://github.com/openzigs/onyourleft/issues/2847)
- **Number**: **0081**, which [`docs/architecture.md`](../architecture.md) gave as the next free
  number on 2026-11-19. The lane note of 2026-11-18 on #2847 named it, and no other issue or pull
  request claims it: 0082 is ADR 0082 (#2794) and 0083 is claimed by the open pull request #2864
- **Supersedes, in part**: [ADR 0049](0049-open-asset-sources-for-the-realistic-world.md) **D-10's
  In table**. D-1 below adds one row to it, and nothing else in D-10 changes. ADR 0049 D-11 says
  adding a source *"is a superseding ADR"*, never an amendment, so this is a new ADR. ADR 0049
  gains one dated `## Amendments` entry pointing here, and its body is not edited
  ([ADR 0013](0013-adr-amendments.md))
- **Leaves standing**: ADR 0049 D-10's **Out** table and every other row of its **In** table, D-11
  (how the list is held and what an adoption owes), and its amendment of 2026-11-12 (Kenney's Car
  Kit), which now records history. [ADR 0026](0026-realistic-game-world.md) D-3 (no rung mixes the
  two worlds), D-5 (a derived asset is reproducible from a recorded input) and D-6 (the budget).
  [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-3 (Delivery's three calls) and
  [ADR 0068](0068-a-delivery-round-holds-the-realistic-worlds-floor.md)
- **Changes no licence rule**: the pack is `CC0-1.0`, which
  [ADR 0015](0015-dependency-licences.md), [ADR 0023](0023-cc-by-assets-and-attribution.md) and the
  asset rules (`ASSET004`) already admit under `apps/`

## Context

On 2026-11-18 the owner asked to *"make the car model better"*. The realistic world drew every
Delivery car as one body, Kenney's CC0 Car Kit `sedan`, under ADR 0049's amendment of 2026-11-12.
Every model in that kit is about 2.5 m by 1.5 m, so stretched to a car's 4.4 m by 1.8 m footprint
it read as a toy. PR #2844 added eight paints, but it was still one car. No better car was on ADR
0049 D-10's **In** list. The candidates PR #2844 read on 2026-11-18 were rgsdev's Free Low Poly
Vehicles Pack, GGBotNet's PSX Style Cars, Quaternius' Cars Pack and a CC-BY-4.0 Sketchfab model
that names two real makes. Each licence was read on its own page.

Asked which pack, the owner ruled on 2026-11-18: **"PSX Style Cars (Recommended)"**.

The pack has no SUV. Its page lists a 5-door station wagon (438 triangles), a 4-door saloon (312),
a 3-door hatchback (448), a minivan (476), a 4-door sedan as police and taxi (440 to 472), a
burned-out car (304), a 1920s car (457) and a step van (376). #2847 asked for a sedan, a hatchback
and an SUV. Asked on 2026-11-19 which three, the owner ruled: **"Saloon, hatchback, station wagon
(Recommended)"** (#2847, comment of 2026-11-19).

**The page, read on 2026-11-18 and again on 2026-11-19** (`https://ggbot.itch.io/psx-style-cars`,
HTTP 200, author GGBotNet): *"This game assets is licensed under a CC0 1.0 Universal."*. Its
metadata reads *"Asset license: Creative Commons Zero v1.0 Universal"* and *"Content: No
generative AI was used"*. It also warns *"The scale unit between cars is not correct. I will fix it
someday."*. The pack carries no licence file of its own.

**The archive cannot be fetched by a script.** The page offers one file,
`PSX_Style_Cars_by_GGBot_(August2023).zip`, through itch.io's own download flow, and a script is
not given that file. The owner had it downloaded through the page in a browser on 2026-11-19 (free,
*"No thanks, just take me to the downloads"*). It was placed unrenamed under
`apps/web/tools/realistic/build/raw/ggbot-psx-style-cars/`: 2 610 303 bytes, SHA-256
`db67b0b0fbaa02454a5d000dc9ec1cc53f360e8f41ab44f3fb1c7e8f71e699e4`. This is the same case as
Kenney's Car Kit (ADR 0049's amendment of 2026-11-12) and #1585's house models.

## Decision

### D-1 — GGBotNet's PSX Style Cars is admitted, for the realistic world's cars

This row is added to ADR 0049 D-10's **In** table. It is the whole of what D-10 gains:

| Source | Licence | Decided by | For |
|---|---|---|---|
| **GGBotNet's PSX Style Cars** | `CC0-1.0` | ADR 0081 D-1 | the realistic world's cars, from an archive the owner placed |

- **The pack, and only the pack.** The row admits the PSX Style Cars pack. The pipeline's address
  for it is the author's own itch.io host, `https://ggbot.itch.io/`, because ADR 0049 D-11's prefix
  rule ends a prefix at a path boundary and the pack's page has none. *The author's choice*: GGBot's
  other packs are not admitted by this ADR, whatever the address admits. Taking one is a new
  ruling.
- **As D-11 requires of an adoption**: the page was read on the day and its sentence recorded
  (`inputs.lock.json`, `evidence`), the archive and every member taken are pinned by digest, the
  output is reproduced by `realistic:process --check`, and the tablet rows come before it stays
  (#733).
- **The stylised world is not touched.** D-10's Kenney row says the stylised world *"stays Kenney's
  alone in its scenery"*, so the stylised world keeps its own code-built car. These cars are drawn
  in the realistic world only.

### D-2 — Three bodies, at the pack's own proportions, inside the parked car's footprint

- **The bodies** are the owner's three: `Car 02` (saloon), `Car 03` (hatchback) and `Car 01`
  (station wagon). Each is read from its OBJ, kept whole, and has its four wheels split off as
  their own parts so that they roll and steer (#2540's pose). No triangle is cut.
- **Scaled evenly, not stretched.** *The author's choice*: each body keeps its own proportions,
  which are a real car's, and is brought to a real length: the saloon and the station wagon to
  4.4 m and the hatchback to 4.2 m. All three are inside `obstacles.ts`' 4.4 m by 1.8 m parked-car
  footprint, so what the rider sees is what the rider hits. The one exception is the door mirrors,
  which stand 0.07 m to 0.09 m past the footprint's side; the report records how far. The bodies
  are 1.68 m to 1.73 m wide and 1.48 m to 1.60 m tall.
- **One level of detail**, as #2540's car had. A second level would add triangles to the roster
  that every obstacle instance submits.

### D-3 — One atlas and one draw call; the paint per texel

- The three pictures (128 px each) and a white cell are laid out two by two in one 256 px atlas,
  `cars_atlas_256.ktx2`. Every obstacle vertex samples it. Each car samples its own cell. Every
  other obstacle, and the indicators, sample the white cell. Delivery's three calls (ADR 0059 D-3)
  stay three.
- **The paint is read from the pack, not drawn.** A texel whose colour differs between the pack's
  own paints of the same body is paint. It is stored as a grey shade with alpha 1, and the renderer
  multiplies it by the instance's paint (PR #2844's eight). Every other texel (glass, lamps, tyres,
  trim) keeps the pack's own colour with alpha 0.
- **A body is chosen per car by its place on the round**, as its paint is, hashed so that bodies
  and paints do not repeat together. It is deterministic, and every view draws the same street.

### D-4 — Inside today's frame ceilings

Every obstacle instance submits every body, and an instance collapses the two bodies it is not. The
three bodies with their wheels and indicators are 1 222 triangles, against Kenney's 1 192: 30 more
an instance, and 600 more on the nightly gate's frame of twenty. Measured on 2026-11-19 in the
pinned Chromium (`realistic-delivery.browser.spec.ts`, nightly), on #2844's branch before and with
this change after:

| Frame | Before | After | Ceiling |
|---|---|---|---|
| Delivery village frame, twenty of each piece | 202 663 | 203 263 | 205 000 (`DELIVERY_VILLAGE_FRAME_TRIANGLES`) |
| The fixture level, in rain at dusk | 188 320 | 188 920 | 205 000 |
| Draw calls, village | 53 | 53 | 53 (`DELIVERY_VILLAGE_DRAW_CALLS`) |

No ceiling is raised. The obstacles' program still uses 14 vertex attribute slots, which is
`DELIVERY_MOST_VERTEX_ATTRIBUTES`. The atlas coordinate and each car's body are packed into spare
components of attributes that are already bound, so neither takes a slot of its own.

### D-5 — What is not taken

- The pack's other five cars, its sound effects, its wheel and its shadow are not taken.
- **Its author's signature.** Two of the three pictures carry a faint "GGBOT" or "2021" in the
  paint, a few texels tall and a few percent off the paint around it. *The author's choice*: it is
  kept. It is the author's name on a CC0 work, not a trade mark (ADR 0049 D-6 bars a trade mark),
  and at ride distance it covers less than a pixel. No body carries a maker's name or badge.

### D-6 — For the owner to confirm or overrule

1. The lengths (4.4 m, 4.2 m, 4.4 m) and the mirrors 0.07 m to 0.09 m past the footprint (D-2).
2. Keeping the faint signature (D-5).
3. The prefix, the author's whole itch.io host (D-1).

## Consequences

### What this enables

- Three real-proportioned bodies in eight paints where there was one toy body: 24 looks, in the
  same call and inside the same ceilings.

### What this costs, stated plainly

- 30 triangles an obstacle instance, 600 on the worst Delivery frame. 203 263 of the 205 000
  leaves 1 737 of room.
- A 21 607-byte atlas, and a GLB of 127 748 bytes where Kenney's was 53 048.
- The tablet frame check (#733) before merge, which this ADR cannot do.

### What would make this ADR wrong

- If the pack's page stopped stating CC0, or the archive's digest no longer matched, the
  `realistic:fetch` step would refuse it and this ADR would need revisiting.
- If the tablet's Delivery frame lost frames to the 600 triangles, the answer is two bodies, which
  #2847 allows, not a raised ceiling.
