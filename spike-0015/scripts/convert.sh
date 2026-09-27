#!/bin/bash
# Spike 0015 (#433): put the committed CC0 realistic set into the Godot project, byte for byte,
# with the import settings written down here, and import it with the pinned editor, headless.
# Nothing is re-authored: every file is copied from apps/web/public/realistic/ unchanged, and
# what Godot makes of it (.godot/imported/) is the engine's own importer's output.
#
# $REPO = the worktree, $GODOT_PROJECT = the Godot project directory, $GODOT = the editor binary.
# LODS=1 lets Godot's importer generate mesh LODs (its default); the primary runs use LODS=0 so the
# triangles Godot draws are the triangles the files hold, as three.js draws them.
set -eu
REPO="${REPO:-$REPO}"
GODOT_PROJECT="${GODOT_PROJECT:-$SPIKE_DIR/godot-project}"
GODOT="${GODOT:-$SPIKE_DIR/bin/godot}"
SRC="$REPO/apps/web/public/realistic"
DST="$GODOT_PROJECT/realistic"
LODS="${LODS:-0}"
mkdir -p "$DST"
count=0
for f in "$SRC"/*; do
  name=$(basename "$f")
  cp "$f" "$DST/$name"
  count=$((count + 1))
  case "$name" in
    *.glb)
      lods=$([ "$LODS" = 1 ] && echo true || echo false)
      cat > "$DST/$name.import" <<EOF
[remap]

importer="scene"
importer_version=1
type="PackedScene"

[deps]

source_file="res://realistic/$name"

[params]

meshes/ensure_tangents=true
meshes/generate_lods=$lods
meshes/create_shadow_meshes=false
gltf/embedded_image_handling=1
EOF
      ;;
    *.hdr)
      # The sky: kept at full precision (half float), as three.js uploads it. compress/mode=0 is
      # Lossless, which for an HDR source keeps RGBAH.
      cat > "$DST/$name.import" <<EOF
[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://realistic/$name"

[params]

compress/mode=0
mipmaps/generate=false
detect_3d/compress_to=0
EOF
      ;;
    *_nor_gl_*.jpg)
      # A normal map: VRAM-compressed (ASTC on this tablet) with the normal-map flag, mipmapped.
      cat > "$DST/$name.import" <<EOF
[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://realistic/$name"

[params]

compress/mode=2
compress/normal_map=1
mipmaps/generate=true
detect_3d/compress_to=0
EOF
      ;;
    *.jpg|*.png)
      # A colour map or an impostor strip: VRAM-compressed, mipmapped — what Godot's own
      # "detect 3D" would choose for a texture a 3D material uses.
      cat > "$DST/$name.import" <<EOF
[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://realistic/$name"

[params]

compress/mode=2
compress/normal_map=2
mipmaps/generate=true
detect_3d/compress_to=0
EOF
      ;;
  esac
done
echo "copied $count files"
# The scan sizes and impostor framing each .glb records in its node extras (the pipeline's own
# numbers, read the way three-renderer.ts §prepareRealisticShape reads them), as one JSON file,
# so GDScript need not parse glTF. Read, not re-authored.
python3 - "$SRC" "$DST/manifest.json" <<'PY'
import json, struct, sys, os
src, out = sys.argv[1], sys.argv[2]
result = {}
for name in sorted(os.listdir(src)):
    if not name.endswith('.glb'):
        continue
    b = open(os.path.join(src, name), 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    for node in j.get('nodes', []):
        if 'oyl_scan_height' in node.get('extras', {}):
            result[name] = node['extras']
json.dump(result, open(out, 'w'), indent=1, sort_keys=True)
print('manifest', len(result), 'models')
PY
"$GODOT" --headless --path "$GODOT_PROJECT" --import 2>&1 | grep -v "^$" | tail -20
# The textures the glTF importer extracted from each .glb are imported "Lossless" (uncompressed in
# VRAM) because "detect 3D" only fires when the editor sees a 3D material use them, which a headless
# import never does. Give them the same VRAM compression as every other photograph here, and import
# again. (The .glb's own bytes are unchanged; only the extracted copies' import settings move.)
for imp in "$DST"/*.import; do
  src_name=$(basename "$imp" .import)
  [ -f "$SRC/$src_name" ] && continue   # a committed file: already set above
  case "$src_name" in *.jpg|*.png) ;; *) continue ;; esac
  sed -i '' -e 's#^compress/mode=0#compress/mode=2#' "$imp"
  case "$src_name" in *_nor_gl_*) sed -i '' -e 's#^compress/normal_map=0#compress/normal_map=1#' "$imp" ;; esac
done
# Import again from nothing, so no file from the first pass's settings is left behind to be packed.
rm -rf "$GODOT_PROJECT/.godot/imported"
"$GODOT" --headless --path "$GODOT_PROJECT" --import 2>&1 | grep -v "^$" | tail -3
