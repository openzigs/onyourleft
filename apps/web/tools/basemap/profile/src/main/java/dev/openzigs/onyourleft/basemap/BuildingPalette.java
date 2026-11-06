// SPDX-License-Identifier: AGPL-3.0-or-later
package dev.openzigs.onyourleft.basemap;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The palette a building's {@code building:colour} and {@code roof:colour} are reduced to (#1557).
 *
 * <p>A colour tag is free text. It is never written to a tile: a named colour or a {@code #rrggbb}
 * value is turned into an RGB triple here, and only the index of the nearest palette entry (CIELAB
 * distance, D65) is kept. Anything else — {@code #rgb}, {@code rgb(…)}, a misspelling, 64 KiB of
 * text — is absent. The palette is part of the archive's schema: #1789 decodes an index against
 * this same list, so an entry is appended, never reordered or removed.
 */
public final class BuildingPalette {

  private BuildingPalette() {}

  /** One entry: what it is called in the docs, and its sRGB value. */
  public record Entry(String name, int rgb) {}

  /** Index order is the schema. Append only. */
  public static final List<Entry> ENTRIES = List.of(
    new Entry("white", 0xF4F4EF),
    new Entry("light_grey", 0xC6C6C2),
    new Entry("grey", 0x8C8C8A),
    new Entry("dark_grey", 0x4A4A4A),
    new Entry("black", 0x1E1E1E),
    new Entry("cream", 0xEDE3C8),
    new Entry("beige", 0xD8C49A),
    new Entry("tan", 0xB8956A),
    new Entry("brown", 0x7A5230),
    new Entry("dark_brown", 0x45301E),
    new Entry("brick_red", 0x9C3B2A),
    new Entry("red", 0xC8382E),
    new Entry("pink", 0xE6A9A4),
    new Entry("orange", 0xDE7A2E),
    new Entry("yellow", 0xE9CF5A),
    new Entry("green", 0x5E8C4E),
    new Entry("dark_green", 0x2F4F31),
    new Entry("light_blue", 0xA9C6DF),
    new Entry("blue", 0x4A6EA8),
    new Entry("dark_blue", 0x23345A)
  );

  /** Longer than any CSS colour name or {@code #rrggbb}; a longer value is not read at all. */
  static final int MAX_LENGTH = 24;

  private static final Pattern HEX = Pattern.compile("^#[0-9a-f]{6}$");

  /**
   * The CSS Color Module Level 4 named colours (W3C), the vocabulary OSM's colour keys document.
   * Spaces, hyphens and underscores are dropped before lookup, so {@code light grey} reads as
   * {@code lightgrey}.
   */
  private static final Map<String, Integer> NAMED = named();

  /**
   * The palette index for one colour tag value, or {@code null} when it is absent or not a named
   * colour or {@code #rrggbb}.
   */
  public static Integer index(String raw) {
    Integer rgb = parse(raw);
    return rgb == null ? null : nearest(rgb);
  }

  static Integer parse(String raw) {
    if (raw == null || raw.isEmpty() || raw.length() > MAX_LENGTH) {
      return null;
    }
    String value = raw.trim().toLowerCase(Locale.ROOT);
    if (HEX.matcher(value).matches()) {
      return Integer.parseInt(value.substring(1), 16);
    }
    return NAMED.get(value.replace(" ", "").replace("-", "").replace("_", ""));
  }

  /** The index of the entry nearest {@code rgb} in CIELAB (ΔE*76). Ties go to the lower index. */
  static int nearest(int rgb) {
    double[] lab = lab(rgb);
    int best = 0;
    double bestDistance = Double.MAX_VALUE;
    for (int i = 0; i < ENTRIES.size(); i++) {
      double[] other = lab(ENTRIES.get(i).rgb());
      double dl = lab[0] - other[0];
      double da = lab[1] - other[1];
      double db = lab[2] - other[2];
      double distance = dl * dl + da * da + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  static double[] lab(int rgb) {
    double r = linear((rgb >> 16) & 0xFF);
    double g = linear((rgb >> 8) & 0xFF);
    double b = linear(rgb & 0xFF);
    // sRGB to XYZ (D65), then normalised by the D65 white point.
    double x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    double y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    double z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    double fx = f(x);
    double fy = f(y);
    double fz = f(z);
    return new double[]{116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)};
  }

  private static double linear(int channel) {
    double c = channel / 255.0;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  private static double f(double t) {
    return t > 216.0 / 24389.0 ? Math.cbrt(t) : (24389.0 / 27.0 * t + 16) / 116;
  }

  private static Map<String, Integer> named() {
    String table = """
      aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc
      bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a
      burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50
      cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b
      darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b
      darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000
      darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f
      darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff
      dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0
      forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520
      gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4
      indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5
      lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff
      lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1
      lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899
      lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32
      linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd
      mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee
      mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970
      mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6
      olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa
      palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9
      peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399
      red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460
      seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd
      slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c
      teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3
      white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32
      """;
    String[] words = table.trim().split("\\s+");
    Map<String, Integer> result = new HashMap<>();
    for (int i = 0; i + 1 < words.length; i += 2) {
      result.put(words[i], Integer.parseInt(words[i + 1], 16));
    }
    return Map.copyOf(result);
  }
}
