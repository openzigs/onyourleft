// SPDX-License-Identifier: AGPL-3.0-or-later
package dev.openzigs.onyourleft.basemap;

import static com.onthegomap.planetiler.TestUtils.newPolygon;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.PlanetilerConfig;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.stats.Stats;
import com.protomaps.basemap.Basemap;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The fields {@link BuildingTags} adds, on synthetic OSM features only (no extract is committed),
 * read back through upstream's own {@code Basemap.processFeature} — the call Planetiler makes —
 * so a hook the patch fails to install is a red test here, not a silent archive without fields.
 */
class BuildingTagsTest {

  private static final int BUILD_YEAR = 2026;

  private final FeatureCollector.Factory factory =
    new FeatureCollector.Factory(PlanetilerConfig.defaults(), Stats.inMemory());

  /** Upstream's profile, buildings layer only: the qrank, country and clip inputs are other layers'. */
  private final Basemap profile = new Basemap(null, null, null, "buildings");

  private List<FeatureCollector.Feature> process(Map<String, Object> tags) {
    var source = SimpleFeature.create(newPolygon(0, 0, 0, 1, 1, 1, 0, 0), new HashMap<>(tags), "osm", null, 1);
    var collector = factory.get(source);
    profile.processFeature(source, collector);
    return StreamSupport.stream(collector.spliterator(), false).toList();
  }

  private Map<String, Object> onlyFeatureAt(Map<String, Object> tags, int zoom) {
    var features = process(tags);
    assertEquals(1, features.size(), () -> "features: " + features);
    return features.get(0).getAttrsAtZoom(zoom);
  }

  private static Map<String, Object> ours(Map<String, Object> attrs) {
    Map<String, Object> result = new HashMap<>(attrs);
    result.keySet().retainAll(BuildingTags.KEYS);
    return result;
  }

  private static Map<String, Object> fields(Map<String, String> tags) {
    return BuildingTags.attributes(tags::get, BUILD_YEAR);
  }

  private static Map<String, String> tags(String... keyValues) {
    Map<String, String> result = new HashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) {
      result.put(keyValues[i], keyValues[i + 1]);
    }
    return result;
  }

  @Test
  void writesEveryFieldAtZ15ThroughUpstreamsProfile() {
    var attrs = onlyFeatureAt(Map.ofEntries(
      Map.entry("building", "church"),
      Map.entry("building:levels", "2"),
      Map.entry("roof:levels", "1"),
      Map.entry("roof:shape", "gabled"),
      Map.entry("roof:orientation", "across"),
      Map.entry("roof:direction", "NE"),
      Map.entry("building:colour", "white"),
      Map.entry("roof:colour", "#7a5230"),
      Map.entry("building:material", "brick"),
      Map.entry("roof:material", "slate"),
      Map.entry("start_date", "1887-05"),
      Map.entry("height", 12)
    ), 15);

    assertEquals(Map.ofEntries(
      Map.entry("building_type", "church"),
      Map.entry("levels", 2),
      Map.entry("roof_levels", 1),
      Map.entry("roof_shape", "gabled"),
      Map.entry("roof_orientation", "across"),
      Map.entry("roof_direction", 45),
      Map.entry("wall_colour", 0),
      Map.entry("roof_colour", 8),
      Map.entry("wall_material", "brick"),
      Map.entry("roof_material", "slate"),
      Map.entry("start_year", 1887),
      Map.entry("landmark", "worship")
    ), ours(attrs));
    // Upstream's own fields are still there and unchanged.
    assertEquals("building", attrs.get("kind"));
    assertEquals(12.0, attrs.get("height"));
  }

  @Test
  void writesNothingBelowZ15SoLowerZoomMergingIsUpstreams() {
    Map<String, Object> tags = Map.of("building", "house", "building:levels", "2", "roof:shape", "hipped");
    for (int zoom = 11; zoom <= 14; zoom++) {
      var attrs = onlyFeatureAt(tags, zoom);
      assertEquals(Map.of(), ours(attrs), "zoom " + zoom);
    }
    // Upstream turns two levels into a height of 2 × 3 + 2 m, so the same height given directly is
    // the feature with none of this project's tags: the two must be equal, key for key, at z14.
    var upstreamOnly = onlyFeatureAt(Map.of("building", "house", "height", "8"), 14);
    assertEquals(upstreamOnly, onlyFeatureAt(tags, 14));
  }

  @Test
  void aBuildingPartCarriesItsOwnTags() {
    var attrs = onlyFeatureAt(Map.of("building:part", "yes", "building:levels", "7", "roof:shape", "flat"), 15);
    assertEquals("building_part", attrs.get("kind"));
    assertEquals(Map.of("levels", 7, "roof_shape", "flat"), ours(attrs));
  }

  @Test
  void readsNoNameAddressIdArchitectureOrFacade() {
    var features = process(Map.of(
      "building", "yes",
      "name", "Somebody's House",
      "addr:street", "Elm Street",
      "building:architecture", "victorian",
      "building:facade", "brick",
      "osm_id", "123456"
    ));
    for (var feature : features) {
      for (int zoom = 11; zoom <= 15; zoom++) {
        var attrs = feature.getAttrsAtZoom(zoom);
        assertEquals(Map.of(), ours(attrs));
        for (Object value : attrs.values()) {
          assertFalse(Set.of("Somebody's House", "victorian", "123456").contains(value), () -> "leaked " + value);
        }
      }
    }
  }

  @Test
  void buildingTypeIsWhitelistedAndYesIsAbsent() {
    for (String type : BuildingTags.BUILDING_TYPES) {
      assertEquals(type, fields(tags("building", type)).get("building_type"), type);
    }
    assertEquals("house", fields(tags("building", "  House ")).get("building_type"));
    for (String absent : List.of("yes", "no", "hut", "houses", "", "house;garage", "домик")) {
      assertNull(fields(tags("building", absent)).get("building_type"), absent);
    }
  }

  @Test
  void levelsAreClampedIntegers() {
    assertEquals(3, fields(tags("building:levels", "3")).get("levels"));
    assertEquals(1, fields(tags("building:levels", "1.5")).get("levels"));
    assertEquals(1, fields(tags("building:levels", "0")).get("levels"));
    assertEquals(1, fields(tags("building:levels", "-4")).get("levels"));
    assertEquals(100, fields(tags("building:levels", "100")).get("levels"));
    assertEquals(100, fields(tags("building:levels", "999999999999")).get("levels"));
    assertEquals(0, fields(tags("roof:levels", "-1")).get("roof_levels"));
    assertEquals(0, fields(tags("roof:levels", "0")).get("roof_levels"));
    assertEquals(2, fields(tags("roof:levels", "2")).get("roof_levels"));
    assertEquals(5, fields(tags("roof:levels", "40")).get("roof_levels"));
    for (String malformed : List.of("two", "3;4", "1e9", "NaN", "Infinity", "3 floors", "", "1,5", "9999999999999")) {
      assertNull(fields(tags("building:levels", malformed)).get("levels"), malformed);
      assertNull(fields(tags("roof:levels", malformed)).get("roof_levels"), malformed);
    }
  }

  @Test
  void roofShapeAndOrientationAreWhitelisted() {
    for (String shape : BuildingTags.ROOF_SHAPES) {
      assertEquals(shape, fields(tags("roof:shape", shape)).get("roof_shape"), shape);
    }
    for (String absent : List.of("dome", "onion", "round", "gabled;hipped", "half_hipped")) {
      assertNull(fields(tags("roof:shape", absent)).get("roof_shape"), absent);
    }
    assertEquals("along", fields(tags("roof:orientation", "Along")).get("roof_orientation"));
    assertEquals("across", fields(tags("roof:orientation", "across")).get("roof_orientation"));
    assertNull(fields(tags("roof:orientation", "sideways")).get("roof_orientation"));
  }

  @Test
  void roofDirectionIsQuantisedToFifteenDegrees() {
    assertEquals(0, fields(tags("roof:direction", "0")).get("roof_direction"));
    assertEquals(45, fields(tags("roof:direction", "44")).get("roof_direction"));
    assertEquals(90, fields(tags("roof:direction", "97.4")).get("roof_direction"));
    assertEquals(0, fields(tags("roof:direction", "359")).get("roof_direction"));
    assertEquals(345, fields(tags("roof:direction", "-15")).get("roof_direction"));
    assertEquals(0, fields(tags("roof:direction", "720")).get("roof_direction"));
    assertEquals(0, fields(tags("roof:direction", "N")).get("roof_direction"));
    assertEquals(30, fields(tags("roof:direction", "NNE")).get("roof_direction"));
    assertEquals(90, fields(tags("roof:direction", "e")).get("roof_direction"));
    assertEquals(225, fields(tags("roof:direction", "SW")).get("roof_direction"));
    assertEquals(345, fields(tags("roof:direction", "NNW")).get("roof_direction"));
    for (String malformed : List.of("north", "NE;SW", "45°", "", "NNNE", "1e3")) {
      assertNull(fields(tags("roof:direction", malformed)).get("roof_direction"), malformed);
    }
  }

  @Test
  void coloursAreAPaletteIndexNeverTheTagsString() {
    assertEquals(0, fields(tags("building:colour", "white")).get("wall_colour"));
    assertEquals(4, fields(tags("building:colour", "black")).get("wall_colour"));
    assertEquals(11, fields(tags("building:colour", "#ff0000")).get("wall_colour"));
    assertEquals(1, fields(tags("building:colour", "light grey")).get("wall_colour"));
    assertEquals(1, fields(tags("building:colour", "LightGray")).get("wall_colour"));
    assertEquals(10, fields(tags("roof:colour", "#9C3B2A")).get("roof_colour"));
    for (String malformed : List.of("#fff", "#12345", "#gggggg", "rgb(1,2,3)", "whiteish", "", "#ff0000ff")) {
      assertNull(fields(tags("building:colour", malformed)).get("wall_colour"), malformed);
      assertNull(fields(tags("roof:colour", malformed)).get("roof_colour"), malformed);
    }
  }

  @Test
  void everyPaletteEntryIsItsOwnNearest() {
    for (int i = 0; i < BuildingPalette.ENTRIES.size(); i++) {
      assertEquals(i, BuildingPalette.nearest(BuildingPalette.ENTRIES.get(i).rgb()), BuildingPalette.ENTRIES.get(i).name());
    }
  }

  @Test
  void materialsAreWhitelisted() {
    for (String material : BuildingTags.WALL_MATERIALS) {
      assertEquals(material, fields(tags("building:material", material)).get("wall_material"), material);
    }
    for (String material : BuildingTags.ROOF_MATERIALS) {
      assertEquals(material, fields(tags("roof:material", material)).get("roof_material"), material);
    }
    assertNull(fields(tags("building:material", "timber_framing")).get("wall_material"));
    assertNull(fields(tags("building:material", "slate")).get("wall_material"));
    assertNull(fields(tags("roof:material", "brick")).get("roof_material"));
  }

  @Test
  void startYearReadsOnlyThreeFormsAndIsClamped() {
    assertEquals(1890, fields(tags("start_date", "1890")).get("start_year"));
    assertEquals(1890, fields(tags("start_date", "1890-04")).get("start_year"));
    assertEquals(1890, fields(tags("start_date", "1890-04-30")).get("start_year"));
    assertEquals(1600, fields(tags("start_date", "1066")).get("start_year"));
    assertEquals(BUILD_YEAR, fields(tags("start_date", "2999")).get("start_year"));
    for (String malformed : List.of(
      "~1890", "1890s", "c. 1890", "C19", "1890-13", "1890-00", "1890-04-32", "1890/04/30", "890", "18900",
      "1890..1895", "before 1900", "")) {
      assertNull(fields(tags("start_date", malformed)).get("start_year"), malformed);
    }
  }

  @Test
  void landmarkComesFromTheFeaturesOwnAmenityOrType() {
    assertEquals("worship", fields(tags("building", "yes", "amenity", "place_of_worship")).get("landmark"));
    assertEquals("townhall", fields(tags("building", "civic", "amenity", "townhall")).get("landmark"));
    assertEquals("school", fields(tags("building", "yes", "amenity", "school")).get("landmark"));
    assertEquals("worship", fields(tags("building", "chapel")).get("landmark"));
    assertEquals("worship", fields(tags("building", "cathedral")).get("landmark"));
    assertEquals("townhall", fields(tags("building", "townhall")).get("landmark"));
    assertEquals("school", fields(tags("building", "school")).get("landmark"));
    assertNull(fields(tags("building", "civic")).get("landmark"));
    assertNull(fields(tags("building", "yes", "amenity", "restaurant")).get("landmark"));
    assertNull(fields(tags("building", "house")).get("landmark"));
  }

  @ParameterizedTest
  @ValueSource(strings = {
    "building", "building:levels", "roof:levels", "roof:shape", "roof:orientation", "roof:direction",
    "building:colour", "roof:colour", "building:material", "roof:material", "start_date", "amenity"
  })
  void aSixtyFourKibibyteValueIsNeverRead(String key) {
    String huge = "house".repeat(64 * 1024 / 5) + "-1";
    assertEquals(Map.of(), fields(tags(key, huge)));
    assertEquals(Map.of(), fields(tags(key, "1".repeat(64 * 1024))));
    // A value the field would accept, padded past the length limit with whitespace that trimming
    // would remove: only the length guard keeps it out, so this line is what holds the guard.
    String valid = VALID_VALUE.get(key);
    assertFalse(fields(tags(key, valid)).isEmpty(), key + "=" + valid + " is read unpadded");
    assertEquals(Map.of(), fields(tags(key, " ".repeat(64 * 1024) + valid)));
  }

  private static final Map<String, String> VALID_VALUE = Map.ofEntries(
    Map.entry("building", "house"), Map.entry("building:levels", "3"), Map.entry("roof:levels", "1"),
    Map.entry("roof:shape", "gabled"), Map.entry("roof:orientation", "along"),
    Map.entry("roof:direction", "90"), Map.entry("building:colour", "white"),
    Map.entry("roof:colour", "red"), Map.entry("building:material", "brick"),
    Map.entry("roof:material", "slate"), Map.entry("start_date", "1900"),
    Map.entry("amenity", "school")
  );

  @Test
  void noRawTagStringIsEverWritten() {
    Map<String, Set<String>> allowedStrings = Map.of(
      "building_type", Set.copyOf(BuildingTags.BUILDING_TYPES),
      "roof_shape", Set.copyOf(BuildingTags.ROOF_SHAPES),
      "roof_orientation", Set.copyOf(BuildingTags.ROOF_ORIENTATIONS),
      "wall_material", Set.copyOf(BuildingTags.WALL_MATERIALS),
      "roof_material", Set.copyOf(BuildingTags.ROOF_MATERIALS),
      "landmark", Set.copyOf(BuildingTags.LANDMARKS)
    );
    Map<String, int[]> ranges = Map.of(
      "levels", new int[]{1, 100},
      "roof_levels", new int[]{0, 5},
      "roof_direction", new int[]{0, 345},
      "wall_colour", new int[]{0, BuildingPalette.ENTRIES.size() - 1},
      "roof_colour", new int[]{0, BuildingPalette.ENTRIES.size() - 1},
      "start_year", new int[]{1600, BUILD_YEAR}
    );
    String[] keys = {
      "building", "building:levels", "roof:levels", "roof:shape", "roof:orientation", "roof:direction",
      "building:colour", "roof:colour", "building:material", "roof:material", "start_date", "amenity"
    };
    String[] fragments = {
      "house", "House ", "gabled", "#", "ff", "0", "9", "-", ".", ";", " ", "NE", "brick", "\u0000", "é",
      "<script>", "1890", "-0", "school", "place_of_worship", "white", "e", "999999999999"
    };
    Random random = new Random(1557);
    for (int run = 0; run < 20_000; run++) {
      Map<String, String> input = new HashMap<>();
      Set<String> inputValues = new java.util.HashSet<>();
      for (String key : keys) {
        StringBuilder value = new StringBuilder();
        int parts = random.nextInt(4);
        for (int i = 0; i < parts; i++) {
          value.append(fragments[random.nextInt(fragments.length)]);
        }
        input.put(key, value.toString());
        inputValues.add(value.toString());
      }
      for (var entry : fields(input).entrySet()) {
        Object value = entry.getValue();
        if (value instanceof String text) {
          assertTrue(allowedStrings.get(entry.getKey()).contains(text), () -> entry + " from " + input);
          // The written string is the whitelist's constant, not the tag's own object.
          assertTrue(allowedStrings.get(entry.getKey()).stream().anyMatch(constant -> constant == text),
            () -> entry + " is not a whitelist constant");
        } else {
          int[] range = ranges.get(entry.getKey());
          assertTrue(value instanceof Integer, () -> entry + " is not an integer");
          int number = (Integer) value;
          assertTrue(number >= range[0] && number <= range[1], () -> entry + " out of range, from " + input);
        }
      }
    }
  }

  /**
   * The bytes this adds to a synthetic 2 000-footprint corridor (#1557's last criterion): twenty z15
   * tiles of a hundred footprints, with the fields at the US fill rates the 2026-10-27 research
   * measured (type 34 %, levels 3.1 %, roof shape 1 %, colours and materials under 0.2 %, and an
   * assumed 1 % for the start year, which the research did not measure). The estimate was about
   * 2–3 KB raw; this prints the measurement, and fails only if it is an order of magnitude out.
   */
  @Test
  void aSyntheticCorridorGrowsByAFewKilobytes() {
    String[] types = {"house", "detached", "garage", "shed", "apartments", "commercial", "retail"};
    String[] shapes = {"gabled", "hipped", "flat"};
    long before = 0;
    long after = 0;
    int footprint = 0;
    for (int tile = 0; tile < 20; tile++) {
      List<VectorTile.Feature> upstream = new ArrayList<>();
      List<VectorTile.Feature> widened = new ArrayList<>();
      for (int i = 0; i < 100; i++, footprint++) {
        double x = (i % 10) * 25 + 2;
        double y = (i / 10) * 25 + 2;
        var geometry = VectorTile.encodeGeometry(newPolygon(x, y, x + 12, y, x + 12, y + 9, x, y + 9, x, y));
        Map<String, Object> base = new HashMap<>(Map.of("kind", "building", "sort_rank", 400));
        if (footprint % 100 < 11) {
          base.put("height", 6.0 + footprint % 7);
        }
        Map<String, String> tags = new HashMap<>();
        if (footprint % 100 < 34) {
          tags.put("building", types[footprint % types.length]);
        }
        if (footprint % 1000 < 31) {
          tags.put("building:levels", Integer.toString(1 + footprint % 3));
        }
        if (footprint % 100 == 50) {
          tags.put("roof:shape", shapes[footprint % shapes.length]);
        }
        if (footprint % 500 == 7) {
          tags.put("building:colour", "white");
          tags.put("building:material", "brick");
        }
        if (footprint % 100 == 77) {
          tags.put("start_date", Integer.toString(1900 + footprint % 100));
        }
        Map<String, Object> widenedTags = new HashMap<>(base);
        widenedTags.putAll(fields(tags));
        upstream.add(new VectorTile.Feature("buildings", footprint, geometry, base));
        widened.add(new VectorTile.Feature("buildings", footprint, geometry, widenedTags));
      }
      before += new VectorTile().addLayerFeatures("buildings", upstream).encode().length;
      after += new VectorTile().addLayerFeatures("buildings", widened).encode().length;
    }
    long growth = after - before;
    System.out.printf("synthetic 2000-footprint corridor: %d bytes raw before, %d after, +%d bytes%n",
      before, after, growth);
    assertTrue(growth > 0, "the fields add bytes");
    assertTrue(growth < 30_000, () -> "growth " + growth + " bytes is an order of magnitude over the estimate");
  }
}
