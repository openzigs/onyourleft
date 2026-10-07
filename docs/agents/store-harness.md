# The round-trip harness

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the "round-trip harness" part of §5, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you write or test anything that persists data — a store write path, a migration, a fake.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

#### The round-trip harness — use it rather than writing the naive version

[`@onyourleft/store/testing`](../../packages/store/src/testing/index.ts) (#28) exists so that no later
issue has to remember all four causes. Its primitive is **write through the public path → close
every connection → open a fresh one → read through the public path → compare**, and its `read()`
*cannot* be served by the handle that wrote: it discards every open handle before it opens another.

```ts
import {
  createStoreHarness, seedAthletes, seedRide, streamSetFor, assertStreamSetRoundTrip, ATHLETE_A,
} from '@onyourleft/store/testing';

const harness = createStoreHarness();          // its own database, per test
await seedAthletes(harness);                   // three athletes, always — see below
const ride = await seedRide(harness, ATHLETE_A);

// The whole round trip in one call:
await assertStreamSetRoundTrip(harness, streamSetFor(ride));

// Or the two halves, for anything else:
const read = await harness.roundTrip(
  async (store) => store.putActivity(ride),
  async (store) => store.getActivity(ATHLETE_A, ride.id),
);

await harness.destroy();                       // in afterEach
```

Four things to know before you use it:

- **The fixtures carry three athletes, not two.** Two cannot distinguish "scoped correctly" from
  "returns everything the requester is connected to". ⚠️ **The scoping assertions that need the
  third now exist, and this bullet used to say they were waiting for Phase 3** — a reviewer who
  remembers that is reading the old file. `activity-store.scoping.test.ts` derives every
  `owner`-taking member from `ActivityStore.prototype` and requires a probe for each, and
  `activity-store.erasure.test.ts` derives the table list from `SCHEMA_VERSIONS`. Both fail closed,
  and both use all three athletes.
- **`seedRide` and `streamSetFor` take an owner**, so the write-path scoping case is as short to
  write as the read-path one. #26's review found that a two-athlete *read* fixture is blind to a
  write-path hole entirely.
- **The assertions throw `RoundTripFailure`; they are not `expect` calls.** That is what lets the
  same assertion body run green against the real store and red against a fake, which is the only
  honest proof that a harness works.
- **`fakes.ts` holds thirteen deliberately broken stores**, and the first five are the ones worth
  knowing by heart — one that writes to memory, one that commits to the real database under a key
  the reader does not use, one that fills every gap with a zero, one whose every second flush is
  acknowledged and never written, and one that **tidies a signed claim on its way in**. The same
  round trip is run against each and required to
  go red. **If you add a write path to `packages/store`, the `PersistentStore` type fails to compile
  until the fakes account for it.** That is deliberate: it is what stops a write path shipping with
  nothing proving the harness catches its failure — and it is how the fourth fake arrived, with
  #46's checkpoint write, and the fifth with #61's signed record. The fifth one's red/green pair is
  in `identity-store.test.ts` rather than `harness.test.ts`, because it needs WebCrypto and that
  file imports no platform primitive. ⚠️ **That is a count and it ages**: this paragraph said
  *five* from #61 until #325's `roundedMassStoreFactory` made it thirteen, because every write path
  added since brought one. Count the `StoreFactory` exports rather than reading a number here.
- **A round trip over a *signed* artefact ends in a verification, not a comparison.**
  `assertSignedRecordRoundTrip` verifies the signature on what came back, using only the public key
  inside the record. The rounding fake is why: the record comes back complete, well-formed and
  parseable, and only the signature check notices.
