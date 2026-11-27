# ADR 0096: The open world names its streets, on the road and in the junction prompt

- **Status**: **Accepted**, 2026-11-23, by the owner on #3052's pull request (#3093), with every D-6
  answer as recommended: Q1 accept; Q2 no switch to hide names now; Q3 the painted size as built,
  to be judged on the tablet ride. Written on the owner's request of 2026-11-22 (#3052) and the
  ruling of 2026-11-23 on #3051
- **Date**: 2026-11-23
- **Deciders**: **the owner**, who asked for this. The author drafted the ADR, and every bound in it
  is the author's choice
- **Issue**: [#3052](https://github.com/openzigs/onyourleft/issues/3052), under the open-world epic
  [#2880](https://github.com/openzigs/onyourleft/issues/2880). It sits beside
  [#3051](https://github.com/openzigs/onyourleft/issues/3051) (turns at real junctions) and
  [#2903](https://github.com/openzigs/onyourleft/issues/2903) (side streets drawn as roads)
- **Number**: **0096**. On 2026-11-23, `docs/agents/conventions.md` §7 gives 0096 as the next free
  number, and no open pull request or issue claims it
- **Supersedes, in part, for the open-world ride only**:
  - [ADR 0054](0054-towns-from-real-map-data.md) **D-2.2**'s rule that no name is read, for the
    `name` of a `roads` street. Its **D-5.7**, *"Nothing names a place. No street name … reaches the
    world"*, is superseded for street names alone;
  - [ADR 0091](0091-the-open-world-street-graph-is-built-from-our-z15-tiles.md) **D-2**'s *"Never
    read: `name`"*, for `name` alone.

  Each gains one dated `## Amendments` entry that points here (ADR 0013). Neither body is edited
- **Leaves standing**, word for word:
  - for every route ride, ADR 0054 D-2.2 and D-5.7 in full. Its corridor read asks for no name
    (D-1), so it decodes none;
  - in the open world, `name:*`, `ref`, `network*`, `shield_text*`, a house number, a shop name, a
    brand, a place's name and every OSM identifier, all still unread;
  - ADR 0055 D-3, under which `places` names are never decoded;
  - ADR 0004 D, under which no message formats a coordinate;
  - ADR 0036 D-3's four invariants;
  - ADR 0088 in full. The prompt's ways are still named first by their turn (D-4)

---

## Context

The owner rode build 1122 in the open world on 2026-11-22 and asked: *"Can street names show up on
the roads when in open world? Can put them on the pavement."* On 2026-11-23 the owner added: *"Natural
turns and the actual junctions on roads with road names."* #3052 asks for three things. The name is
painted on the surface of the ridden street and of each side street near a junction. The junction
prompt says the name ("Right onto Third Avenue"). An unnamed way shows nothing.

Two accepted ADRs say the opposite. ADR 0054 D-2.2 reads no name from any layer, and its D-5.7 says
*"Nothing names a place. No street name … reaches the world, and a signpost still carries no
words."* ADR 0091 D-2 builds the open world's street graph and leaves `name` unread. The reason given
in ADR 0054 is that *"the world names no place"*. A route ride's world is stylised from map data, and
a name would bring nothing to it while adding a store field that never leaves the device. The open
world is different. The rider chose a real place on a map (ADR 0090), and at a junction the rider
chooses between real streets. A street's name is how a rider tells two of them apart.

## Decision

### D-1: What is read, and where

1. The decoder (`@onyourleft/map-features` §`decodeTile`) reads a `roads` street's **`name`** only
   when its caller passes `streetNames: true`. The default is off. A footway, a railway, a path and
   every other layer read no name.
2. **Only the open world's area reader asks for names** (`apps/web` §`world-data/area.ts`). A route
   ride's corridor read, the store and the export never carry a name.
3. **Bounded and cleaned** (#3052's hostile-tile row). The name must be strict UTF-8 of at most 256
   bytes. Every control, bidirectional-override, isolate and zero-width character is dropped, runs
   of space become one, and the result is trimmed and cut at the last whole word within 48
   characters. A value that is not a string, is malformed, or is empty after cleaning is **no
   name**. None of these cases refuses the tile.
4. The name travels on the decoded street, then the street graph's edge, then the rolling route's
   way (`RollingEdge.name`). It is held in memory with the block the reader holds and dropped with
   that block. It is **never stored, logged or sent**.

### D-2: What is drawn

1. A named street's name is painted on its own surface. One copy sits at each mouth, clear of the
   junction, and further copies repeat every 200 m along a long street. A copy is painted only
   where the whole name fits.
2. Names are drawn from **one glyph atlas**: printable ASCII, the Latin-1 letters and a few
   typographic marks, drawn once at run time. **A name with a character outside the atlas is not
   painted.** The junction prompt still names that way (#3052's i18n row). Names are shown as
   mapped, with no translation.
3. Every name in view is drawn in **one draw call**: one mesh, one material and one texture. At
   most 24 names and 720 letters are drawn, nearest the rider first, within 160 m. The set is
   chosen again every 20 m ridden. The paint is warm white, alpha-tested and unlit, and it fades with
   the fog as the road does.
4. **An unnamed street has no label, and nothing invents a name.**

### D-3: What is said

1. The junction prompt shows each way's street under its turn word: "Right" over "onto Third
   Avenue", and "Straight on" over "along Main Street". The accessible name reads "Right onto Third
   Avenue". A way with no name shows its turn word alone.
2. The prompt's sentences (ADR 0088 D-3) name the street too: *"Junction ahead: left onto Oak
   Street, straight on along Main Street or right. The default is straight on along Main Street."*

### D-4: Privacy

1. **A street name is map data, not the rider's place.** It is derived from tile bytes already
   fetched under ADR 0054 D-6, so no new request is made and nothing new leaves the device.
2. A name is shown on screen and said in the HUD's live region, and that is all. It is not
   formatted into an error, a log line, a crash report or an instance request. ADR 0004 D is
   unchanged: no message carries a coordinate.
3. ⚠️ **On screen, a name does say where the rider is.** A screenshot or a stream of an open-world
   ride near home now shows the home street's name. The ride already showed the real streets, and
   anyone who knows the place could recognise them, but a name makes that explicit. D-6 Q2 asks
   the owner whether this needs a switch.

### D-5: Cost

The atlas is one texture of 1024 × 768 pixels, drawn once. The belt is built on the first frame
that names a street, so a ride that names none never makes it. The draw adds one call and at most
1440 triangles. Labels are placed again only when the street graph changes, and the set in view is
chosen again every 20 m.

### D-6: For the owner

- **Q1. Accept this ADR?** Recommended: yes. You asked for it. **Owner, 2026-11-23: accepted.**
- **Q2. A switch to hide street names**, for riders who stream or share screenshots? Recommended:
  not now. Ask again if a rider asks for one. **Owner, 2026-11-23: not now.**
- **Q3. The painted size**: letters 2.6 m tall across the street and 1.5 m apart along it.
  Recommended: as built, then judged on the tablet ride. **Owner, 2026-11-23: as built, judged on the
  ride.**

## Consequences

- The open world's streets are named on the road and in the prompt, and a route ride is unchanged.
- `decode.test.ts`'s sentinel, *"no name, address, pmap:* field or id survives"*, still holds for the
  default decode. `decode-street-names.test.ts` holds the bounded read when names are asked for.
- Names come from OpenStreetMap under the ODbL attribution the open world already shows.

## What would make this ADR wrong

- A rider is identified from a shared screenshot's street name. If so, add D-6 Q2's switch.
- A tile's name breaks the drawn text despite D-1.3's cleaning. If so, tighten the cleaning.
- The owner wants names on route rides. That would need a new ADR on ADR 0054 D-2.2's store.

## Sources

- #3052 (the owner's request of 2026-11-22), #3051 (the ruling of 2026-11-23).
- ADR 0054 D-2.2 and D-5.7; ADR 0091 D-2; ADR 0088 D-3; ADR 0004 D.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-26** — **Superseded in part, for the saved route ride only, by
  [ADR 0100](0100-a-saved-route-ride-names-the-street-it-is-on.md)**
  ([#3245](https://github.com/openzigs/onyourleft/issues/3245)). D-1.2's *"A route ride's corridor
  read, the store and the export never carry a name"* no longer holds for the corridor read and the
  store: a route's corridor read asks for names, and the store keeps the ones the atlas can paint.
  The export still carries none. The open world is unchanged. **Status: proposed**, in force only
  once the owner accepts ADR 0100.
