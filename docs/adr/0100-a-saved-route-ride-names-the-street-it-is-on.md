# ADR 0100: A saved route ride names the street it is on, now and then

- **Status**: **Accepted, 2026-11-26**, by the owner, 2026-11-26: "Accept as proposed". D-6
  Q1 to Q3 are accepted as recommended: the ADR itself; the spacing (nearest letter 30 m after the
  route joins a named street, then at most one label each 1 km); and no hide switch for now. The
  pull request for [#3245](https://github.com/openzigs/onyourleft/issues/3245) merges after the
  maintainer's tablet check of its bend fix
- **Date**: 2026-11-26
- **Deciders**: **the owner**, who asked for this on 2026-11-26. The author drafted the ADR, and every
  bound in it is the author's choice
- **Issue**: [#3245](https://github.com/openzigs/onyourleft/issues/3245), under the epic
  [#2034](https://github.com/openzigs/onyourleft/issues/2034). It follows
  [#3052](https://github.com/openzigs/onyourleft/issues/3052) (the open world's street names)
- **Number**: **0100**. On 2026-11-26 `docs/agents/conventions.md` §7 gives 0098 as the next free
  number, and the open pull requests #2966 and #3256 claim 0098 and 0099; no open issue or pull
  request claims 0100
- **Supersedes, in part, for the saved route ride only**:
  - [ADR 0096](0096-the-open-world-names-its-streets-on-the-road-and-in-the-junction-prompt.md)
    **D-1.2**'s *"Only the open world's area reader asks for names … A route ride's corridor read,
    the store and the export never carry a name"*, for the corridor read and the store. The export
    still carries none;
  - ADR 0096 **D-1.4**'s *"never stored"*, for the saved route ride: a street's name is kept in the
    ODbL corridor store (D-1). It stays never logged or sent;
  - [ADR 0054](0054-towns-from-real-map-data.md) **D-2.2**'s rule that no name is read, for the
    `name` of a `roads` street on a route's corridor; its **D-3.3**'s one sentence of what the store
    holds, which gains a street's name; and its **D-5.7**, *"No street name … reaches the world"*,
    for street names alone.

  Each gains one dated `## Amendments` entry that points here (ADR 0013). No body is edited
- **Leaves standing**, word for word:
  - ADR 0054 **D-3.5**: nothing in the store leaves the device. A street's name is in the store and
    so in no export, sync, shared route or write-up;
  - ADR 0056: the demo's published bundle. Its bake asks for no name (D-1.3), so it carries none;
  - ADR 0096 D-1.3's cleaning, D-2's painting and D-4's privacy, unchanged and applied here;
  - ADR 0054 D-2.4: the corridor is read before the ride, and no request is made while it records;
  - ADR 0055 D-3, under which no place's name is decoded;
  - ADR 0004 D, under which no message formats a coordinate;
  - ADR 0036 D-3's four invariants.

---

## Context

The owner asked on 2026-11-26 for the name of the street being ridden to be painted on the road on
a saved-route ride, *"every once in a while — not that often"*. The open world has done this since
#3052: a name at each junction mouth and every 200 m. A route ride never had one, for two reasons
written down in accepted ADRs.

ADR 0054 D-2.2 says the world names no place, so its corridor read decodes no name. ADR 0096 D-1.2
kept that for route rides when it opened the door for the open world, and its *"What would make this
ADR wrong"* says that names on route rides *"would need a new ADR on ADR 0054 D-2.2's store"*. This
is that ADR.

The store is the question. A route's corridor is read once, when the route is chosen or saved, and
kept on the device in the ODbL store (ADR 0054 D-3), so a second ride of the route asks nothing. A
name read and not kept would show on the first ride after a read and on no ride after it. So to show
names on route rides at all, the name has to be kept.

## Decision

### D-1: What is read, and what is kept

1. **A route's corridor read asks for street names** (`world-data/corridor-port.ts`, through
   `readCorridorTiles`'s `streetNames`). The decoder reads them exactly as ADR 0096 D-1.1 and D-1.3
   say: a `roads` street's `name` alone, strict UTF-8, bounded, cleaned. No footway, path, railway
   or other layer gives a name.
2. **The store keeps a street's name only where the game can paint it whole**: 1 to 48 characters,
   every one in the glyph atlas (`street-names.ts` §`paintable`, which holds no control,
   bidirectional or zero-width character). It is packed as `n` on the street. A name that does not
   pass is not kept, because a route ride never shows it. The same rule is applied again when a
   row is read back, so a blob edited on the device cannot put another string on the road.
3. **The demo's bake asks for no name** (`tools/demo/bake-route.ts`). The bundle it publishes under
   ODbL (ADR 0056) names no street, and `bake-route.test.ts` holds that.
4. The packed version becomes 9 and `CORRIDOR_READER_VERSION` becomes 10. A route kept before this
   change is read again the next time it is chosen, before the ride, and gains its names then. No
   Dexie schema changes, and the previous build reads a version-10 row again rather than trusting it
   (`corridor-rollback-street-names.test.ts`).

### D-2: What is drawn

1. **Only the street the route is on is named.** A side street's name is never painted on a route
   ride, because the rider is not choosing a way and the name would be clutter. A mapped street is
   the route's where it passes within 8 m of the drawn road and runs within 30° of the road's
   heading (`route-street-names.ts`).
2. **One label just after the route joins a named street**: its nearest letter 30 m past where the
   route came onto it. The route's first street counts as joined at the start.
3. **Then at most one label each 1 km** along the same street
   (`ROUTE_STREET_NAME_REPEAT_METRES`). A short unnamed piece of up to 50 m inside one street does
   not make it a new street.
4. A label is painted **only where the whole name fits** on its street, and only where the drawn
   road runs straight under it, within 1 m of the name's line. Otherwise it moves on along the
   street, or is not painted.
5. It is drawn exactly as the open world's are (ADR 0096 D-2.2 and D-2.3): the same glyph atlas,
   the same belt, **one draw call** for every name in view.
6. **An unnamed street has no label, and nothing invents a name.** A route with no map data, a
   built-in circuit and a built-in level have no labels.

### D-3: Privacy

1. A street name is map data, as ADR 0096 D-4.1 says. It is derived from tile bytes already fetched
   under ADR 0054 D-6, so no new request is made.
2. It is kept in the ODbL store, on the device, and **never leaves it** (ADR 0054 D-3.5).
   `transfer/world-corridor-not-exported.test.ts` packs a kept name and holds the account export to
   carrying no trace of it.
3. ⚠️ **On screen, a name says where the rider is**, as ADR 0096 D-4.3 says of the open world. A
   saved route near home now shows its street names in a screenshot or a stream. D-6 Q3 asks whether
   that needs a switch.

### D-4: Cost

The labels are placed once, at the press, from the corridor's named streets. A route ride hands the
scene the same list on every frame, and the set in view is chosen again only every 20 m (ADR 0096
D-2.3). The draw adds one call and at most 1440 triangles, and only on a ride with at least one
label. A ride with none never builds the belt. The tablet frame check is owed before merge.

### D-5: What this does not change

The open world's labels, which keep their mouths and their 200 m repeat. The junction prompt, which a
route ride does not have. The store's other contents.

### D-6: For the owner

- **Q1. Accept this ADR?** Recommended: yes. You asked for names on route rides, and keeping the name
  in the store is the only way a second ride of a route shows them.
- **Q2. The spacing**: one label 30 m after each turn onto a named street, then at most one each
  1 km. Recommended: as built, then judged on the tablet ride.
- **Q3. A switch to hide street names**, for riders who stream or share screenshots? Recommended:
  not now, as ADR 0096 D-6 Q2 ruled for the open world. Ask again if a rider asks for one.

## Consequences

- A saved route ride over mapped streets names the street the rider is on, now and then.
- The ODbL store holds one more field, a street's name. It is still on the device alone.
- Every route kept before this change is read again the first time it is chosen after it: one
  corridor read, before the ride, as when the route was first chosen.

## What would make this ADR wrong

- A rider is identified from a shared screenshot's street name. If so, add D-6 Q3's switch, for both
  rides.
- The 8 m and 30° match takes a street the route is beside for the route's own, so a wrong name is
  painted. If so, tighten the match.
- Labels are still too frequent or too rare once ridden. If so, change the two constants.

## Sources

- #3245 (the owner's request of 2026-11-26), #3052, ADR 0096.
- ADR 0054 D-2.2, D-2.4, D-3.3, D-3.5 and D-5.7; ADR 0056; ADR 0004 D.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-26** — **Placement rules that landed after acceptance**, in
  [#3261](https://github.com/openzigs/onyourleft/pull/3261) after the maintainer's tablet checks of
  that day, and recorded for [#3344](https://github.com/openzigs/onyourleft/issues/3344). D-2.4's
  straight-road rule is stricter than it says: the drawn road's heading also turns no more than 5°
  from the name's line anywhere under it and 10 m past each end. No letter is placed within 100 m,
  along the route, of a turn where the road comes back along itself (more than 120° between its
  heading over the 30 m before a point and the 30 m after it). A label is drawn only while the rider
  is on its pass of the road: no more than 30 m further from the rider along the route than in a
  straight line. Every letter is laid rigid on the road's own height at its route distance, and a
  letter whose drawn edge is longer than 1.5 times its painted size is not drawn at all
  (`route-street-names.ts`, `street-names.ts`).
- **2026-11-26** — **The owner's ruling on
  [#3344](https://github.com/openzigs/onyourleft/issues/3344): a route ride's name reads across the
  lane, like a real road marking.** D-2.5's *"drawn exactly as the open world's are"* no longer holds
  for how the letters are laid. A route ride's name is painted in the rider's own lane, right of the
  centre line and 0.2 m inside its lines: each letter upright to the approaching rider, its up the
  way the route runs; 2.75 times as long along the road as it is wide, as road-marking type is
  stretched; at most 0.7 m wide; reading left to right across the lane. A name too wide for the lane
  is wrapped at a space onto two lines, stacked along the road with the first nearest the rider, and
  what is still too wide is shrunk, never past the lane's lines (`street-names.ts`
  §`routeNameLayout`). Where a name fits (D-2.4) is measured along the road from its first line's
  near edge to its last line's far edge, and the 1.5 times guard is measured against each letter's
  own painted size. The glyph atlas, the belt and the one draw call of D-2.5 stand, and so does every
  rule of the entry above. The open world's labels are unchanged (D-5). **Status: in force when
  #3344's pull request merges**, after the maintainer's tablet flash scan and frame check and the
  owner's look.
