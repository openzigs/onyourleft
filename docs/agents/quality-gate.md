# The quality gate

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds §5: the mutation requirement, compile-time guarantees and the defect shape to hunt, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you write a test, a PR body's mutation list, or a brand / `@ts-expect-error` guarantee.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## 5. The quality gate

`CONTRIBUTING.md` states the pre-PR gate. This section says what each bullet means concretely.

### Coverage: a mutation requirement, not a percentage

> **Every new code path is covered by a test proven to fail without the change.**

Concretely, for each meaningful test you add:

1. **Mutate the implementation** — invert a condition, delete a write, return a constant, skip the
   persist.
2. **Watch the test go red.** Note which test, and why.
3. **Restore the implementation.**
4. **List the mutations in the PR body**, with what went red.

**There is no percentage floor and you must not invent one.** A percentage measures lines executed,
not behaviour asserted: a test that calls a function and asserts nothing scores the same as one that
pins the contract. And a floor set against a repository with no code is red on arrival, which means
it gets routed around rather than met. Coverage is still *reported*, because an untested branch is
worth seeing in review. It is a signal, not a gate. **The mutation list is the gate.**

What the report covers (which trees, and which files run outside it and so read as untested) is
[`docs/agents/coverage.md`](coverage.md).

### Verifying a *compile-time* guarantee

A brand, a nominal type or a `@ts-expect-error` is only a guarantee while its absence breaks the
build. So it is mutation-tested like everything else, and the mutation is specific:

> **Remove the brand from the signature and confirm the suite goes red with
> `TS2578: Unused '@ts-expect-error' directive`.**

That error is the whole mechanism. It means the guard cannot rot silently: if someone later widens
the parameter back to `number`, the directive that documented the guarantee becomes the thing that
fails the build.

**Two ways of "verifying" that do not work, both of which have produced a wrong answer in this
repository:**

1. **Grepping for the type name.** A brand can exist in a file and not be reachable from the
   signature you care about. Presence is not enforcement.
2. **Probing against the working tree.** A guarantee observed in a dirty tree may be supplied by
   uncommitted changes. This is not hypothetical: during #25 an agent died mid-edit leaving branded
   types uncommitted, a probe run in that tree reported type safety, the safety was credited to the
   committed code, and the uncommitted changes were then discarded — closing a correct,
   twice-raised blocking finding as a false positive. **Run `git status` before you probe, and read
   the committed file with `git show HEAD:<path>` whenever a previous review round has been wrong
   about it.**

The same rule binds a *review*: if a fix commit claims a review finding was mistaken, that claim is
unverified until you have re-run it yourself. A dismissal closes the loop, so a wrong dismissal is
never raised again.

### The defect shape to hunt

The dominant failure in this program's persistence work is **a write that reports success while the
read cannot see it**, from four causes: *wrong storage* (it landed in a cache or a different key
prefix), *wrong layer* (acknowledged at the edge, nothing below persisted), *wrong time* (written
after the read, or in a transaction that never committed), *wrong harness* (the test asserted against
the object it just constructed rather than a fresh read).

**Always assert by reading back through the same path a real consumer uses.** Line coverage cannot
see any of these, which is part of why §5 has no percentage in it.

#### The round-trip harness

Use `@onyourleft/store/testing` rather than writing the naive round trip: how, and the four
things to know before you do, are in [`docs/agents/store-harness.md`](store-harness.md).
