# The project's own basemap archive (#1557)

This directory builds the US basemap with **Planetiler** and the **Protomaps
basemaps profile**, the shape ADR 0010 D-1 names for the day this project
builds its own archive: _"If we ever generate: planetiler (Apache-2.0) with the
`protomaps/basemaps` profile"_. The output is a PMTiles archive in the
Protomaps v4 schema. On the z15 `buildings` features, and nowhere else, it also
carries the fields below (owner ruling D4, 2026-10-27).

Every layer the ride map and the world read is upstream's, unchanged. The
profile is upstream's at a pinned commit, plus a two-line hook
(`profile/protomaps-basemaps.patch`) that calls `BuildingTags.apply` from
upstream's `Buildings.processOsm`. The fields are written with
`setAttrWithMinzoom(…, 15)`, so no feature below z15 carries them, and the
lower zooms' merging (`FeatureMerge.mergeNearbyPolygons`, which merges only
features whose tags are equal) is upstream's.

| Path                                          | What                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.sh`                                    | The build. It pins every tool, downloads into `~/.cache/onyourleft/basemap` (never into the repository), runs both test suites through `mvn package`, and writes a build record of every input's SHA-256. |
| `profile/`                                    | `BuildingTags.java` (the fields), `BuildingPalette.java` (the colour palette), their JUnit suite, and the patch. Compiled inside upstream's Maven project by `build.sh`.                                  |
| `run-compare.mjs`, `compare-archives.ts`, `compare.ts`, `mvt.ts` | `pnpm --filter @onyourleft/web basemap:compare -- ours.pmtiles theirs.pmtiles [--strict]` walks two archives tile by tile and reads every z15 tile through the client's own `decodeTile`.                 |
| `building-fields.ts`                          | The fields' rules, for the comparison. `building-fields.test.ts` holds them to the Java source, list for list.                                                                                            |

## Building

```bash
apps/web/tools/basemap/build.sh --region north-america/us/delaware --compare
pnpm --filter @onyourleft/web basemap:compare -- \
  ~/.cache/onyourleft/basemap/out/delaware.pmtiles \
  ~/.cache/onyourleft/basemap/out/delaware.upstream.pmtiles --strict --build-year 2026
```

`--compare` also runs upstream's profile, unmodified, on the same extract.
`--strict` then fails unless the two archives are identical, feature for
feature and byte for byte of geometry, once the fields are removed from the z15
buildings, and unless every field's value is one its rule admits.

For the US: `build.sh --region north-america/us --xmx 24g`. **This builds and
uploads nothing anywhere.** Per the owner's ruling of 2026-10-31, the US archive
is built on the owner's Mac. It is uploaded under a separate name beside the
live Protomaps file, and only on the owner's word. The ride map switches to it
only after the owner's check on the tablet.

`--build-year` is the latest `start_year` written. Give the value from the
build record to rebuild the same extract byte for byte.

## Tools, data and licences

| Item                                                                                           | Pin                                                           | Licence                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Planetiler                                                                                     | 0.10.2, pinned by upstream's `pom.xml`                        | Apache-2.0                                                                                                                                     |
| `protomaps/basemaps` (the profile)                                                             | `42ffaaa4a85a41bfcb23e43cc0f5b492a5eca123`, tiles 4.15.2      | BSD-3-Clause code, CC0 visual design (ADR 0010's table)                                                                                        |
| Apache Maven                                                                                   | 3.9.16, SHA-512 checked                                       | Apache-2.0                                                                                                                                     |
| A JDK, 21 or later                                                                             | not pinned: the machine's own                                 | a build tool only, never distributed                                                                                                           |
| OpenStreetMap, via Geofabrik                                                                   | the extract's SHA-256 is in the build record                  | ODbL 1.0                                                                                                                                       |
| Natural Earth, OSMCoastline land and water polygons, Daylight landcover, QRank, `pgf-encoding` | downloaded by upstream's `run()`, SHA-256 in the build record | The live Protomaps archive uses the same inputs. ⚠️ This build does not re-verify each licence, and should before the US archive is published. |

The archive's attribution is upstream's own, `© OpenStreetMap`, and this
profile does not change it. So the ODbL attribution the app shows
(`src/map/`, ADR 0010) is unchanged. This directory's Java files are this
project's code, `AGPL-3.0-or-later`. They are compiled into a jar that is never
distributed. Only the tiles are published, and those are an ODbL Produced Work.

## The fields

Each field is read from the building feature's **own** tags. Each value is
whitelisted, clamped or mapped to a palette index. No raw tag string reaches a
tile, and a value longer than 32 characters is never parsed. Names, addresses,
OSM ids, `building:architecture` and `building:facade` are not read.

| Key                          | From                             | Value                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `building_type`              | `building`                       | one of `house` `detached` `semidetached_house` `terrace` `bungalow` `farm` `apartments` `residential` `garage` `garages` `carport` `shed` `barn` `farm_auxiliary` `cowshed` `stable` `commercial` `retail` `office` `supermarket` `industrial` `warehouse` `church` `chapel` `cathedral` `school` `civic` `government` `townhall`. `yes` and anything else are absent |
| `levels`                     | `building:levels`                | integer, rounded down, clamped to 1–100                                                                                                                                                                                                                                                                                                                               |
| `roof_levels`                | `roof:levels`                    | integer, rounded down, clamped to 0–5                                                                                                                                                                                                                                                                                                                                 |
| `roof_shape`                 | `roof:shape`                     | one of `flat` `gabled` `hipped` `pyramidal` `skillion` `half-hipped` `gambrel` `side_hipped` `mansard` `saltbox`                                                                                                                                                                                                                                                      |
| `roof_orientation`           | `roof:orientation`               | `along` or `across`                                                                                                                                                                                                                                                                                                                                                   |
| `roof_direction`             | `roof:direction`                 | degrees from a number or from one of the 16 compass words, quantised to 15°, in 0–345                                                                                                                                                                                                                                                                                 |
| `wall_colour`, `roof_colour` | `building:colour`, `roof:colour` | a named CSS colour or `#rrggbb` becomes the index of the nearest palette entry (CIELAB), 0–19. `BuildingPalette.ENTRIES` lists the entries, which are only ever appended to                                                                                                                                                                                           |
| `wall_material`              | `building:material`              | one of `brick` `wood` `stone` `concrete` `glass` `metal` `plaster`                                                                                                                                                                                                                                                                                                    |
| `roof_material`              | `roof:material`                  | one of `roof_tiles` `slate` `metal` `asphalt` `concrete`                                                                                                                                                                                                                                                                                                              |
| `start_year`                 | `start_date`                     | the year of `YYYY`, `YYYY-MM` or `YYYY-MM-DD` only, clamped to 1600 up to the build year                                                                                                                                                                                                                                                                              |
| `landmark`                   | `amenity`, else the type         | `worship` (`place_of_worship`, or the type `church` `chapel` `cathedral`), `townhall`, `school`. There is no spatial join                                                                                                                                                                                                                                             |

Matching ignores case and surrounding spaces. A colour name also ignores spaces,
hyphens and underscores (`light grey` is `lightgrey`). #1789's decoder repeats
every rule on read, because a self-hoster's archive was not built by this
profile.

## Time, size and refresh

- **Refresh**: quarterly, as ADR 0010 D-1 sets for the archive. Each rebuild is
  a new file under a new dated name. A PMTiles archive cannot be patched.
- **Size**: the live Protomaps US archive is 19,155,814,749 bytes. The research
  of 2026-10-27 estimated growth of 0.2–0.5 % for these fields, and about 2–3 KB
  raw for a 2 000-footprint corridor. `BuildingTagsTest` prints the synthetic
  corridor's measured growth (64,670 bytes raw before, 69,060 after: +4,390
  bytes), and the build record holds the archive's size. The US build of
  2026-10-31, from the dated Geofabrik extract of 2026-10-30, is
  18,258,708,801 bytes. That is smaller than the live archive, which was built
  by Protomaps from a different OSM date with its own settings, so the two
  sizes do not isolate the fields' cost.
- **Time**: measured from the build record (`seconds`), per region. The US
  build of 2026-10-31 took 6,670 s on the owner's Mac.
