// SPDX-License-Identifier: AGPL-3.0-or-later
package dev.openzigs.onyourleft.basemap;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.SourceFeature;
import java.time.Year;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The building fields this project's archive adds to the Protomaps v4 {@code buildings} layer
 * (#1557, owner ruling D4 of 2026-10-27).
 *
 * <p>Every field is taken from the building feature's <b>own</b> tags, at <b>z15 only</b>, so the
 * lower zooms' merging is exactly upstream's. No raw tag string is ever written: an enumerated value
 * is compared with its whitelist and the whitelist's own constant is written, a number is parsed and
 * clamped, a colour becomes a {@link BuildingPalette} index, and anything else is absent. A value
 * longer than {@link #MAX_VALUE_LENGTH} is not read at all. Names, addresses, OSM ids,
 * {@code building:architecture} and {@code building:facade} are never read.
 *
 * <p>The key names and whitelists are the archive's schema: #1789 decodes them, and repeats every
 * whitelist and clamp on read because a self-hoster's archive was not built by this profile.
 */
public final class BuildingTags {

  private BuildingTags() {}

  /** The zoom the fields are written at; below it, no feature carries them. */
  public static final int ZOOM = 15;

  /** No whitelisted value, number or date is longer; a longer value is never parsed. */
  static final int MAX_VALUE_LENGTH = 32;

  public static final String KEY_BUILDING_TYPE = "building_type";
  public static final String KEY_LEVELS = "levels";
  public static final String KEY_ROOF_LEVELS = "roof_levels";
  public static final String KEY_ROOF_SHAPE = "roof_shape";
  public static final String KEY_ROOF_ORIENTATION = "roof_orientation";
  public static final String KEY_ROOF_DIRECTION = "roof_direction";
  public static final String KEY_WALL_COLOUR = "wall_colour";
  public static final String KEY_ROOF_COLOUR = "roof_colour";
  public static final String KEY_WALL_MATERIAL = "wall_material";
  public static final String KEY_ROOF_MATERIAL = "roof_material";
  public static final String KEY_START_YEAR = "start_year";
  public static final String KEY_LANDMARK = "landmark";

  /** Every key this class may write, in the order it writes them. */
  public static final List<String> KEYS = List.of(
    KEY_BUILDING_TYPE, KEY_LEVELS, KEY_ROOF_LEVELS, KEY_ROOF_SHAPE, KEY_ROOF_ORIENTATION,
    KEY_ROOF_DIRECTION, KEY_WALL_COLOUR, KEY_ROOF_COLOUR, KEY_WALL_MATERIAL, KEY_ROOF_MATERIAL,
    KEY_START_YEAR, KEY_LANDMARK
  );

  /** From {@code building=*}. {@code yes}, and anything not here, is absent. */
  public static final List<String> BUILDING_TYPES = List.of(
    "house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "apartments",
    "residential", "garage", "garages", "carport", "shed", "barn", "farm_auxiliary", "cowshed",
    "stable", "commercial", "retail", "office", "supermarket", "industrial", "warehouse", "church",
    "chapel", "cathedral", "school", "civic", "government", "townhall"
  );

  /** From {@code roof:shape}: the 2026-10-24 table on #1557, plus {@code saltbox}. */
  public static final List<String> ROOF_SHAPES = List.of(
    "flat", "gabled", "hipped", "pyramidal", "skillion", "half-hipped", "gambrel", "side_hipped",
    "mansard", "saltbox"
  );

  public static final List<String> ROOF_ORIENTATIONS = List.of("along", "across");

  public static final List<String> WALL_MATERIALS = List.of(
    "brick", "wood", "stone", "concrete", "glass", "metal", "plaster"
  );

  public static final List<String> ROOF_MATERIALS = List.of(
    "roof_tiles", "slate", "metal", "asphalt", "concrete"
  );

  public static final String LANDMARK_WORSHIP = "worship";
  public static final String LANDMARK_TOWNHALL = "townhall";
  public static final String LANDMARK_SCHOOL = "school";
  public static final List<String> LANDMARKS = List.of(LANDMARK_WORSHIP, LANDMARK_TOWNHALL, LANDMARK_SCHOOL);

  public static final int MIN_LEVELS = 1;
  public static final int MAX_LEVELS = 100;
  public static final int MIN_ROOF_LEVELS = 0;
  public static final int MAX_ROOF_LEVELS = 5;
  public static final int DIRECTION_STEP = 15;
  public static final int MIN_START_YEAR = 1600;

  /**
   * The latest start year written: the build's year, not the OSM extract's. {@code build.sh} passes
   * it as {@code -Doyl.build_year}, by default the current UTC year, or {@code --build-year}'s value
   * when given; the build record carries it, so a rebuild of the same extract with that value writes
   * the same bytes. Without the property it is the current UTC year.
   */
  static final int BUILD_YEAR = Integer.getInteger("oyl.build_year", Year.now(ZoneOffset.UTC).getValue());

  /** Each whitelist keyed by its own values, so a lookup returns this class's constant. */
  private static final Map<String, String> TYPE_SET = constants(BUILDING_TYPES);
  private static final Map<String, String> ROOF_SHAPE_SET = constants(ROOF_SHAPES);
  private static final Map<String, String> ORIENTATION_SET = constants(ROOF_ORIENTATIONS);
  private static final Map<String, String> WALL_MATERIAL_SET = constants(WALL_MATERIALS);
  private static final Map<String, String> ROOF_MATERIAL_SET = constants(ROOF_MATERIALS);

  /** A plain decimal number: an optional sign, at most 12 digits, an optional fraction. */
  private static final Pattern NUMBER = Pattern.compile("^-?\\d{1,12}(\\.\\d{1,6})?$");

  /** {@code YYYY}, {@code YYYY-MM} or {@code YYYY-MM-DD}, and no other form. */
  private static final Pattern DATE = Pattern.compile(
    "^(\\d{4})(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$"
  );

  /** The sixteen compass points, clockwise from north, 22.5° apart. */
  private static final List<String> COMPASS = List.of(
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  );

  /**
   * Writes this project's fields onto one upstream building feature, at {@link #ZOOM} only. Called
   * from upstream's {@code Buildings.processOsm} by {@code protomaps-basemaps.patch}.
   */
  public static void apply(SourceFeature source, FeatureCollector.Feature feature) {
    for (var entry : attributes(source::getString, BUILD_YEAR).entrySet()) {
      feature.setAttrWithMinzoom(entry.getKey(), entry.getValue(), ZOOM);
    }
  }

  /**
   * The fields for one feature, from a lookup of its own tags. Pure: every value is a whitelist
   * constant, an {@link Integer} in its range, or the entry is absent.
   */
  public static Map<String, Object> attributes(Function<String, String> tag, int buildYear) {
    Map<String, Object> out = new LinkedHashMap<>();
    String type = whitelisted(tag.apply("building"), TYPE_SET);
    put(out, KEY_BUILDING_TYPE, type);
    put(out, KEY_LEVELS, clampedInteger(tag.apply("building:levels"), MIN_LEVELS, MAX_LEVELS));
    put(out, KEY_ROOF_LEVELS, clampedInteger(tag.apply("roof:levels"), MIN_ROOF_LEVELS, MAX_ROOF_LEVELS));
    put(out, KEY_ROOF_SHAPE, whitelisted(tag.apply("roof:shape"), ROOF_SHAPE_SET));
    put(out, KEY_ROOF_ORIENTATION, whitelisted(tag.apply("roof:orientation"), ORIENTATION_SET));
    put(out, KEY_ROOF_DIRECTION, direction(tag.apply("roof:direction")));
    put(out, KEY_WALL_COLOUR, BuildingPalette.index(tag.apply("building:colour")));
    put(out, KEY_ROOF_COLOUR, BuildingPalette.index(tag.apply("roof:colour")));
    put(out, KEY_WALL_MATERIAL, whitelisted(tag.apply("building:material"), WALL_MATERIAL_SET));
    put(out, KEY_ROOF_MATERIAL, whitelisted(tag.apply("roof:material"), ROOF_MATERIAL_SET));
    put(out, KEY_START_YEAR, startYear(tag.apply("start_date"), buildYear));
    put(out, KEY_LANDMARK, landmark(tag.apply("amenity"), type));
    return out;
  }

  private static void put(Map<String, Object> out, String key, Object value) {
    if (value != null) {
      out.put(key, value);
    }
  }

  /** The value's normalised form, or {@code null} when it is absent or too long to be a value. */
  static String normalised(String raw) {
    if (raw == null || raw.length() > MAX_VALUE_LENGTH) {
      return null;
    }
    String value = raw.trim().toLowerCase(Locale.ROOT);
    return value.isEmpty() ? null : value;
  }

  /**
   * The whitelist's own constant equal to the normalised value, or {@code null}. Returning the
   * set's element rather than the input is what keeps the tag's string out of the tile.
   */
  static String whitelisted(String raw, Map<String, String> allowed) {
    String value = normalised(raw);
    return value == null ? null : allowed.get(value);
  }

  private static Map<String, String> constants(List<String> values) {
    Map<String, String> result = new LinkedHashMap<>();
    for (String value : values) {
      result.put(value, value);
    }
    return Map.copyOf(result);
  }

  /** A plain decimal number, rounded down and clamped to {@code [min, max]}, or {@code null}. */
  static Integer clampedInteger(String raw, int min, int max) {
    String value = normalised(raw);
    if (value == null || !NUMBER.matcher(value).matches()) {
      return null;
    }
    double parsed = Double.parseDouble(value);
    if (parsed <= min) {
      return min;
    }
    if (parsed >= max) {
      return max;
    }
    return (int) Math.floor(parsed);
  }

  /**
   * {@code roof:direction} in degrees clockwise from north, quantised to {@link #DIRECTION_STEP}
   * and in {@code [0, 360)}: from a plain number, or from one of the sixteen compass words.
   */
  static Integer direction(String raw) {
    String value = normalised(raw);
    if (value == null) {
      return null;
    }
    double degrees;
    if (NUMBER.matcher(value).matches()) {
      degrees = Double.parseDouble(value);
    } else {
      int point = COMPASS.indexOf(value.toUpperCase(Locale.ROOT));
      if (point < 0) {
        return null;
      }
      degrees = point * 22.5;
    }
    long steps = Math.round(degrees / DIRECTION_STEP);
    long quantised = Math.floorMod(steps * DIRECTION_STEP, 360L);
    return (int) quantised;
  }

  /**
   * The year of {@code start_date} when it is {@code YYYY}, {@code YYYY-MM} or {@code YYYY-MM-DD},
   * clamped to {@code [1600, buildYear]}. {@code ~1890}, {@code 1890s}, {@code c. 1890},
   * {@code C19} and every other form are {@code null}.
   */
  static Integer startYear(String raw, int buildYear) {
    String value = normalised(raw);
    if (value == null) {
      return null;
    }
    Matcher match = DATE.matcher(value);
    if (!match.matches()) {
      return null;
    }
    int year = Integer.parseInt(match.group(1));
    return Math.max(MIN_START_YEAR, Math.min(buildYear, year));
  }

  /**
   * {@code worship}, {@code townhall} or {@code school}: from the feature's own {@code amenity},
   * else from its already whitelisted type. There is no spatial join: a POI node beside the
   * building is in {@code pois}, which is never read (ADR 0054 D-2.2).
   */
  static String landmark(String amenity, String type) {
    String value = normalised(amenity);
    if ("place_of_worship".equals(value)) {
      return LANDMARK_WORSHIP;
    }
    if ("townhall".equals(value)) {
      return LANDMARK_TOWNHALL;
    }
    if ("school".equals(value)) {
      return LANDMARK_SCHOOL;
    }
    if (type == null) {
      return null;
    }
    return switch (type) {
      case "church", "chapel", "cathedral" -> LANDMARK_WORSHIP;
      case "townhall" -> LANDMARK_TOWNHALL;
      case "school" -> LANDMARK_SCHOOL;
      default -> null;
    };
  }
}
