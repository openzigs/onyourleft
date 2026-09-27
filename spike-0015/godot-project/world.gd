# Spike 0015 (#433). Throwaway: not merged, not shipped.
#
# The REALISTIC world, drawn by Godot beneath the Capacitor WebView. As in spike 0014, nothing here
# decides WHERE anything is: the road, the ground, the water, every scenery and structure placement
# and the structures' and bicycle's geometry arrive from the product's own TypeScript. What this
# file adds over 0014's is the realistic set itself, loaded from Godot's import of the committed
# CC0 files in apps/web/public/realistic/ (spike-0015/scripts/convert.sh): the HDR sky as the
# background and the image-based light, the photographed road, ground and structure surfaces, the
# vegetation .glb files as near meshes with the same nearest-N counts as realistic-budget.ts, the
# far trees as the pipeline's impostor strips, and the MakeHuman rider .glb on the product's
# bicycle. How each is drawn follows three-renderer.ts's realistic path where a number is written
# there (roughness 0.85, alpha cut at 0.5, the road's sheen, the structure finishes); where it is
# not followed, the write-up says so.
extends Node3D

const REPORT_SECONDS := 30.0
const R := "res://realistic/"

var bridge: Object = null
var config := {}

var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var sky_material: PanoramaSkyMaterial
var road_mi := MeshInstance3D.new()
var terrain_mi := MeshInstance3D.new()
var water_mi := MeshInstance3D.new()
var bridge_mmi := MultiMeshInstance3D.new()
var ring_mi := MeshInstance3D.new()

var road_mat := ShaderMaterial.new()
var ground_mat := ShaderMaterial.new()
var water_mat := StandardMaterial3D.new()

# kind -> { variants: [ { parts: [ {mesh, mmi} ], extent, impostor_mmi } ], cap, fit }
var vegetation := {}
# "kind|variant" -> [ MultiMeshInstance3D ] (one per surface the shape wears)
var structure_mmis := {}
var structure_models_ready := false
var post_mmi := MultiMeshInstance3D.new()
var riders: Array = []   # [{ root, body_mi, bike: [MeshInstance3D], helmet }]
var bike_meshes := {}
var rider_scale := 1.0

# The latest window's placements, and the pose they were last placed for.
var scatter_items: Array = []
var placed_for_seq := -1
var reach_from := -60.0
var reach_step := 5.0
var reach_values: PackedFloat32Array = PackedFloat32Array()
var view_ahead := 400.0
var view_behind := 60.0

var steps: Array = []
var delay_ms := 100.0
var last_seq := -1

# Measurement, as spike 0014's world.gd.
var frame_ms: Array[float] = []
var gpu_ms: Array[float] = []
var cpu_ms: Array[float] = []
var js_to_java_ms: Array[float] = []
var js_to_godot_ms: Array[float] = []
var arrival_gap_ms: Array[float] = []
var place_ms: Array[float] = []
var prims: Array[float] = []
var draws: Array[float] = []
var starved_frames := 0
var late50_godot := 0
var late50_java := 0
var frames_in_window := 0
var steps_in_window := 0
var lost_steps := 0
var worlds_in_window := 0
var world_build_ms: Array[float] = []
var world_bytes := 0
var last_tick_us := 0
var window_started_us := 0
var window_index := 0
var started_us := 0
var last_java_arrival := -1.0
var first_frame_logged := false
var drawn_near := 0
var drawn_far := 0
var drawn_structures := 0

const STRUCTURE_FINISH := {
	"brick": [0.9, 0.0, Color8(0xff, 0xff, 0xff)],
	"roof-tiles": [0.8, 0.0, Color8(0xff, 0xff, 0xff)],
	"slate": [0.7, 0.0, Color8(0xff, 0xff, 0xff)],
	"stone": [0.95, 0.0, Color8(0xff, 0xff, 0xff)],
	"planks": [0.85, 0.0, Color8(0xff, 0xff, 0xff)],
	"corrugated": [0.5, 0.5, Color8(0xff, 0xff, 0xff)],
	"hedge": [0.95, 0.0, Color8(0x8f, 0xcf, 0x66)],
	"painted": [0.6, 0.2, Color8(0x5a, 0x5a, 0x5a)],
	"glass": [0.08, 0.35, Color8(0x2a, 0x36, 0x40)],
}
const STRUCTURE_MAPS := {
	"brick": "brick_wall_02", "roof-tiles": "clay_roof_tiles_02", "slate": "grey_roof_tiles_02",
	"stone": "old_stone_wall", "planks": "dark_planks", "corrugated": "corrugated_iron",
	"hedge": "forest_leaves_02",
}
const VEGETATION_FILES := {
	"tree-broadleaf": [["island_tree_02", true], ["tree_small_02", true]],
	"tree-conifer": [["fir_sapling_medium_a", true], ["fir_sapling_medium_b", true]],
	"shrub": [["shrub_02_a", false], ["shrub_02_c", false]],
	"rock": [["boulder_01", false]],
}
const RIDER_TINT := {"rider": Color(0.85, 0.25, 0.2), "bot": Color(0.2, 0.45, 0.9), "ghost": Color(0.8, 0.8, 0.85)}

const PLANAR_SHADER := """
shader_type spatial;
render_mode cull_disabled;
uniform sampler2D colour_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tile_metres = 3.0;
uniform float normal_scale = 0.6;
uniform float roughness_value = 0.9;
uniform float specular_value = 0.5;
uniform float grain = -1.0; // < 0: the photograph colours the surface; >= 0: only its luminance, clamped
uniform bool face_up = false;
uniform bool ground_mode = false;
uniform vec3 ground_tint = vec3(1.0);
varying vec3 world_pos;
varying vec3 world_normal;
void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = face_up ? vec3(0.0, 1.0, 0.0) : normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}
void fragment() {
	vec2 uv = world_pos.xz / tile_metres;
	vec3 texel = texture(colour_map, uv).rgb;
	vec3 base = COLOR.rgb;
	if (ground_mode) {
		// three-renderer.ts §photographicGroundMaterial: the landform colour times the photograph over
		// its own mean, blended toward a second, larger sample with distance.
		vec3 near_t = texel;
		vec3 far_t = texture(colour_map, uv * 0.111 + vec2(0.37, 0.61)).rgb;
		float far_share = smoothstep(8.0, 120.0, -VERTEX.z);
		vec3 t2 = mix(near_t, mix(near_t, far_t, 0.5) * 0.55 + far_t * 0.45, far_share);
		vec3 mean_c = max(textureLod(colour_map, vec2(0.5), 16.0).rgb, vec3(1e-3));
		base = ground_tint * COLOR.rgb * t2 / mean_c;
	} else if (grain >= 0.0) {
		const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
		float mean_l = max(dot(textureLod(colour_map, vec2(0.5), 16.0).rgb, luma), 1e-3);
		base *= clamp(dot(texel, luma) / mean_l, 1.0 - grain, 1.0 + grain);
	} else {
		base *= texel;
	}
	ALBEDO = base;
	ROUGHNESS = roughness_value;
	SPECULAR = specular_value;
	vec3 n = normalize(world_normal);
	vec3 t = normalize(vec3(1.0, 0.0, 0.0) - n * n.x);
	vec3 b = cross(n, t);
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	TANGENT = normalize((VIEW_MATRIX * vec4(t, 0.0)).xyz);
	BINORMAL = normalize((VIEW_MATRIX * vec4(b, 0.0)).xyz);
	NORMAL_MAP = texture(normal_map, uv).rgb;
	NORMAL_MAP_DEPTH = normal_scale;
}
"""

const IMPOSTOR_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled;
uniform sampler2D strip : source_color, filter_linear_mipmap, repeat_disable;
uniform float frames = 8.0;
uniform float quad_w = 1.0;
uniform float quad_h = 1.0;
uniform float quad_bottom = 0.0;
varying vec2 strip_uv;
void vertex() {
	vec3 centre = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 across = (MODEL_MATRIX * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
	vec3 along = (MODEL_MATRIX * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
	float size = length(across);
	vec3 cam = (INV_VIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 to_cam = cam - centre;
	vec2 facing = normalize(to_cam.xz + vec2(1e-5));
	float lx = dot(to_cam.xz, across.xz / size);
	float lz = dot(to_cam.xz, along.xz / size);
	float frame = mod(floor(atan(lx, lz) / (2.0 * PI) * frames + 0.5), frames);
	vec3 right = vec3(facing.y, 0.0, -facing.x);
	vec3 world = centre + right * VERTEX.x * quad_w * size + vec3(0.0, quad_bottom + VERTEX.y * quad_h, 0.0) * size;
	strip_uv = vec2((frame + UV.x) / frames, UV.y);
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(world, 1.0);
}
void fragment() {
	vec4 texel = texture(strip, strip_uv);
	if (texel.a < 0.5) { discard; }
	ALBEDO = texel.rgb;
}
"""

func _ready() -> void:
	started_us = Time.get_ticks_usec()
	if Engine.has_singleton("WorldBridge"):
		bridge = Engine.get_singleton("WorldBridge")
		var raw: String = bridge.config()
		if raw != "":
			config = JSON.parse_string(raw)
	delay_ms = float(config.get("delayMs", 100.0))
	var reach: Dictionary = config.get("reach", {})
	if reach.has("values"):
		reach_from = float(reach["from"])
		reach_step = float(reach["step"])
		reach_values = PackedFloat32Array(reach["values"])
	view_ahead = float(config.get("viewAhead", 400.0))
	view_behind = float(config.get("viewBehind", 60.0))
	_build_static()
	_load_vegetation()
	_load_riders()
	_capacities()
	var vp := get_viewport()
	RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
	vp.msaa_3d = int(config.get("msaa", 0)) as Viewport.MSAA
	vp.scaling_3d_scale = float(config.get("scale", 1.0))
	window_started_us = Time.get_ticks_usec()
	last_tick_us = window_started_us
	_log("OYL-GODOT-READY", {
		"version": Engine.get_version_info()["string"],
		"renderer": RenderingServer.get_current_rendering_method(),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"size": [vp.get_visible_rect().size.x, vp.get_visible_rect().size.y],
		"msSinceStart": (Time.get_ticks_usec() - started_us) / 1000.0,
		"world": "realistic",
	})

func _tex(name: String) -> Texture2D:
	return load(R + name) as Texture2D

func _build_static() -> void:
	cam = Camera3D.new()
	cam.near = 0.1
	cam.far = 2000.0
	cam.fov = 70.0
	add_child(cam)
	cam.make_current()

	sun = DirectionalLight3D.new()
	sun.shadow_enabled = bool(config.get("shadows", false))
	sun.directional_shadow_max_distance = 120.0
	add_child(sun)

	# ADR 0026 D-9's sky: the committed HDR as the background AND the image-based light.
	sky_material = PanoramaSkyMaterial.new()
	sky_material.panorama = _tex("farm_field_2k.hdr")
	var sky := Sky.new()
	sky.sky_material = sky_material
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = float(config.get("exposure", 1.0))
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_depth_begin = 30.0
	env.fog_depth_end = 420.0
	env.fog_depth_curve = 1.5
	env.fog_density = 1.0
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var planar := Shader.new()
	planar.code = PLANAR_SHADER
	# The road: the gradient tint (vertex colour, linear) is the colour; the photograph is a grain on
	# it, clamped to ±15 % (PHOTOGRAPHIC_ROAD_GRAIN); lit as facing up; a quarter of the sheen.
	road_mat.shader = planar
	road_mat.set_shader_parameter("colour_map", _tex("asphalt_02_diff_1k.jpg"))
	road_mat.set_shader_parameter("normal_map", _tex("asphalt_02_nor_gl_1k.jpg"))
	road_mat.set_shader_parameter("tile_metres", 3.0)
	road_mat.set_shader_parameter("normal_scale", 0.6)
	road_mat.set_shader_parameter("roughness_value", 0.9)
	road_mat.set_shader_parameter("specular_value", 0.5 * 0.25)
	road_mat.set_shader_parameter("grain", 0.15)
	road_mat.set_shader_parameter("face_up", true)
	road_mi.material_override = road_mat
	road_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(road_mi)
	# The ground: the photograph times the landform's vertex colour, lit, every 4 m.
	ground_mat.shader = planar
	ground_mat.set_shader_parameter("colour_map", _tex("sparse_grass_diff_1k.jpg"))
	ground_mat.set_shader_parameter("normal_map", _tex("sparse_grass_nor_gl_1k.jpg"))
	ground_mat.set_shader_parameter("tile_metres", 4.0)
	ground_mat.set_shader_parameter("normal_scale", 0.8)
	ground_mat.set_shader_parameter("roughness_value", 0.95)
	ground_mat.set_shader_parameter("ground_mode", true)
	ground_mat.set_shader_parameter("specular_value", 0.5)
	ground_mat.set_shader_parameter("grain", -1.0)
	terrain_mi.material_override = ground_mat
	terrain_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(terrain_mi)

	water_mat.albedo_color = Color(0.11, 0.29, 0.33)
	water_mat.roughness = 0.08
	water_mat.metallic = 0.2
	water_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	water_mi.material_override = water_mat
	water_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(water_mi)

	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.vertex_color_use_as_albedo = true
	rm.vertex_color_is_srgb = false
	rm.disable_fog = true
	rm.cull_mode = BaseMaterial3D.CULL_DISABLED
	ring_mi.material_override = rm
	ring_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ring_mi.custom_aabb = AABB(Vector3(-2000, -500, -2000), Vector3(4000, 2000, 4000))
	add_child(ring_mi)

	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var stone_mat := _structure_material("stone")
	box.material = stone_mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = box
	bridge_mmi.multimesh = mm
	add_child(bridge_mmi)

	var post := BoxMesh.new()
	post.size = Vector3(0.14, 1.1, 0.14)
	var pm := StandardMaterial3D.new()
	pm.albedo_color = Color(0.85, 0.85, 0.8)
	pm.roughness = 0.6
	post.material = pm
	var pmm := MultiMesh.new()
	pmm.transform_format = MultiMesh.TRANSFORM_3D
	pmm.mesh = post
	pmm.instance_count = 256
	pmm.visible_instance_count = 0
	post_mmi.multimesh = pmm
	post_mmi.custom_aabb = AABB(Vector3(-5000, -500, -5000), Vector3(10000, 1000, 10000))
	add_child(post_mmi)

var structure_materials := {}
func _structure_material(surface: String) -> StandardMaterial3D:
	if structure_materials.has(surface):
		return structure_materials[surface]
	var f: Array = STRUCTURE_FINISH[surface]
	var m := StandardMaterial3D.new()
	m.roughness = f[0]
	m.metallic = f[1]
	m.albedo_color = f[2]
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = false
	if STRUCTURE_MAPS.has(surface):
		m.albedo_texture = _tex(STRUCTURE_MAPS[surface] + "_diff_512.jpg")
		m.normal_enabled = true
		m.normal_texture = _tex(STRUCTURE_MAPS[surface] + "_nor_gl_512.jpg")
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	structure_materials[surface] = m
	return m

# ---- the vegetation: near meshes by count, far trees as impostors -------------------------------

func _load_vegetation() -> void:
	var near_caps: Dictionary = config.get("nearMeshes", {"tree-broadleaf": 3, "tree-conifer": 3, "shrub": 8, "rock": 12})
	var fits: Dictionary = config.get("fit", {})
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.center_offset = Vector3(0, 0.5, 0)
	var impostor_shader := Shader.new()
	impostor_shader.code = IMPOSTOR_SHADER
	for kind in VEGETATION_FILES:
		var variants: Array = []
		var cap := int(near_caps.get(kind, 3))
		for spec in VEGETATION_FILES[kind]:
			var name: String = spec[0]
			var scene: PackedScene = load(R + name + ".glb")
			var inst := scene.instantiate()
			var extras := {}
			var parts: Array = []
			_collect(inst, Transform3D.IDENTITY, parts, extras)
			inst.free()
			var extent: float = max(float(extras.get("oyl_scan_height", 1.0)), float(extras.get("oyl_scan_width", 1.0)))
			var v := {"parts": [], "extent": extent, "impostor": null}
			for p in parts:
				var mmi := MultiMeshInstance3D.new()
				var mm := MultiMesh.new()
				mm.transform_format = MultiMesh.TRANSFORM_3D
				mm.mesh = p["mesh"]
				mm.instance_count = cap
				mm.visible_instance_count = 0
				mmi.multimesh = mm
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
				add_child(mmi)
				v["parts"].append({"mmi": mmi, "xform": p["xform"]})
			if spec[1]:
				var strip := _tex(name + "-impostor.png")
				var frames := float(extras.get("oyl_impostor_frames", 8))
				var ortho := float(extras.get("oyl_impostor_scale", 1.0))
				var height := float(extras.get("oyl_scan_height", 1.0))
				var aspect := float(strip.get_width()) / frames / float(strip.get_height())
				var mat := ShaderMaterial.new()
				mat.shader = impostor_shader
				mat.set_shader_parameter("strip", strip)
				mat.set_shader_parameter("frames", frames)
				mat.set_shader_parameter("quad_w", ortho * aspect)
				mat.set_shader_parameter("quad_h", ortho)
				mat.set_shader_parameter("quad_bottom", height / 2.0 - ortho / 2.0)
				var qm := quad.duplicate() as QuadMesh
				qm.material = mat
				var mmi := MultiMeshInstance3D.new()
				var mm := MultiMesh.new()
				mm.transform_format = MultiMesh.TRANSFORM_3D
				mm.mesh = qm
				mm.instance_count = 1200
				mm.visible_instance_count = 0
				mmi.multimesh = mm
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				# The quads are placed in the shader; a culling box around the origin would hide them.
				mmi.custom_aabb = AABB(Vector3(-5000, -500, -5000), Vector3(10000, 1000, 10000))
				add_child(mmi)
				v["impostor"] = mmi
			variants.append(v)
		vegetation[kind] = {"variants": variants, "cap": cap, "fit": float(fits.get(kind, 4.0))}

# Every mesh in a loaded model, in the model's own frame, with its materials rebuilt the way
# three-renderer.ts §prepareRealisticShape rebuilds them: the file's colour, colour map and normal
# map kept; roughness 0.85, metalness 0; both faces; foliage alpha-TESTED at 0.5.
func _collect(node: Node, parent: Transform3D, out: Array, extras: Dictionary) -> void:
	var xf := parent
	if node is Node3D:
		xf = parent * (node as Node3D).transform
	if node.has_meta("extras"):
		var e = node.get_meta("extras")
		if e is Dictionary and e.has("oyl_scan_height"):
			for k in e:
				extras[k] = e[k]
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		var mesh: ArrayMesh = ((node as MeshInstance3D).mesh as ArrayMesh).duplicate()
		for s in range(mesh.get_surface_count()):
			var loaded := mesh.surface_get_material(s) as StandardMaterial3D
			if loaded == null:
				continue
			var m := StandardMaterial3D.new()
			m.albedo_color = loaded.albedo_color
			m.albedo_texture = loaded.albedo_texture
			m.normal_enabled = loaded.normal_enabled
			m.normal_texture = loaded.normal_texture
			m.normal_scale = loaded.normal_scale
			m.vertex_color_use_as_albedo = (mesh.surface_get_format(s) & Mesh.ARRAY_FORMAT_COLOR) != 0
			m.roughness = 0.85
			m.metallic = 0.0
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
			if loaded.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				m.alpha_scissor_threshold = 0.5
			mesh.surface_set_material(s, m)
		out.append({"mesh": mesh, "xform": xf})
	for c in node.get_children():
		_collect(c, xf, out, extras)

# ---- the riders: the MakeHuman .glb on the product's bicycle ------------------------------------

func _load_riders() -> void:
	var scene: PackedScene = load(R + "rider.glb")
	for kind in ["rider", "bot", "ghost"]:
		var root := Node3D.new()
		var body := scene.instantiate() as Node3D
		root.add_child(body)
		add_child(root)
		var skeleton := _find(body, "Skeleton3D") as Skeleton3D
		var body_mi := _find(body, "MeshInstance3D") as MeshInstance3D
		if skeleton != null and riders.is_empty():
			var a := skeleton.get_bone_global_rest(skeleton.find_bone("upperleg01.L")).origin
			var b := skeleton.get_bone_global_rest(skeleton.find_bone("lowerleg01.L")).origin
			var c := skeleton.get_bone_global_rest(skeleton.find_bone("foot.L")).origin
			var rest_leg := a.distance_to(b) + b.distance_to(c)
			rider_scale = float(config.get("bikeLeg", 0.8)) / rest_leg
		body.scale = Vector3.ONE * rider_scale
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.albedo_color = RIDER_TINT[kind]
		m.roughness = 0.65
		if body_mi != null:
			body_mi.material_override = m
		var helmet := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = 0.13
		sphere.height = 0.26
		sphere.is_hemisphere = true
		var hm := StandardMaterial3D.new()
		hm.albedo_color = Color(0.94, 0.94, 0.94)
		hm.roughness = 0.4
		sphere.material = hm
		helmet.mesh = sphere
		root.add_child(helmet)
		if skeleton != null:
			var head := skeleton.get_bone_global_rest(skeleton.find_bone("head")).origin * rider_scale
			helmet.position = head + Vector3(0, 0.06, 0.01)
		riders.append({"root": root, "kind": kind, "bike": [], "tint": RIDER_TINT[kind]})

func _find(node: Node, cls: String) -> Node:
	if node.get_class() == cls:
		return node
	for c in node.get_children():
		var f := _find(c, cls)
		if f != null:
			return f
	return null

func _bike_parts(meta: Dictionary) -> void:
	var specs := {
		"bikeFrame": [Color(0.75, 0.75, 0.78), 0.35, 0.3, true],
		"bikeRubber": [Color(0.08, 0.08, 0.08), 0.85, 0.0, false],
		"bikeMetal": [Color(0.72, 0.72, 0.74), 0.3, 0.9, false],
		"bikeCrank": [Color(0.72, 0.72, 0.74), 0.3, 0.9, false],
	}
	for rider in riders:
		for name in specs:
			var spec: Array = specs[name]
			var mesh := _mesh_from(name)
			if mesh == null:
				continue
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			var m := StandardMaterial3D.new()
			m.albedo_color = (spec[0] as Color) * ((rider["tint"] as Color) if spec[3] else Color.WHITE)
			m.roughness = spec[1]
			m.metallic = spec[2]
			mi.material_override = m
			if name == "bikeCrank":
				mi.position = Vector3(0, float(meta.get("crankAxisY", 0.27)), float(meta.get("crankAxisZ", -0.06)))
			(rider["root"] as Node3D).add_child(mi)
			rider["bike"].append(mi)

func _mesh_from(prefix: String, generate_tangents: bool = false) -> ArrayMesh:
	var p: PackedByteArray = bridge.worldBytes(prefix + "P")
	if p.is_empty():
		return null
	world_bytes += p.size()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = p.to_vector3_array()
	var n: PackedByteArray = bridge.worldBytes(prefix + "N")
	if not n.is_empty():
		arr[Mesh.ARRAY_NORMAL] = n.to_vector3_array()
	var u: PackedByteArray = bridge.worldBytes(prefix + "U")
	if not u.is_empty():
		arr[Mesh.ARRAY_TEX_UV] = u.to_vector2_array()
	var c: PackedByteArray = bridge.worldBytes(prefix + "C")
	if not c.is_empty():
		arr[Mesh.ARRAY_COLOR] = c.to_color_array()
	arr[Mesh.ARRAY_INDEX] = (bridge.worldBytes(prefix + "I") as PackedByteArray).to_int32_array()
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	if generate_tangents and not u.is_empty():
		var st := SurfaceTool.new()
		st.create_from(mesh, 0)
		st.generate_tangents()
		mesh = st.commit()
	return mesh

func _take_models(meta: Dictionary) -> void:
	var t0 := Time.get_ticks_usec()
	var parts: Array = meta["structureParts"]
	for part in parts:
		var mesh := _mesh_from("s%d" % int(part["i"]), true)
		if mesh == null:
			continue
		mesh.surface_set_material(0, _structure_material(part["surface"]))
		var key := "%s|%d" % [part["kind"], int(part["variant"])]
		if not structure_mmis.has(key):
			structure_mmis[key] = []
		var mmi := MultiMeshInstance3D.new()
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = STRUCTURE_CAPACITY
		mm.visible_instance_count = 0
		mmi.multimesh = mm
		mmi.custom_aabb = AABB(Vector3(-5000, -500, -5000), Vector3(10000, 1000, 10000))
		add_child(mmi)
		structure_mmis[key].append(mmi)
	_bike_parts(meta)
	structure_models_ready = true
	_capacities()
	_log("OYL-GODOT-MODELS-OK", {"parts": parts.size(), "ms": (Time.get_ticks_usec() - t0) / 1000.0})

# ---- the frame loop -----------------------------------------------------------------------------

func _process(_delta: float) -> void:
	var now_us := Time.get_ticks_usec()
	var dt := (now_us - last_tick_us) / 1000.0
	last_tick_us = now_us
	if bridge == null:
		return
	if bridge.hasWorld():
		_take_world()
	_take_steps()
	_pose()
	if frames_in_window > 0:
		frame_ms.append(dt)
	frames_in_window += 1
	var rid := get_viewport().get_viewport_rid()
	gpu_ms.append(RenderingServer.viewport_get_measured_render_time_gpu(rid))
	cpu_ms.append(RenderingServer.viewport_get_measured_render_time_cpu(rid) + RenderingServer.get_frame_setup_time_cpu())
	prims.append(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME))
	draws.append(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	if not first_frame_logged and steps.size() > 0 and road_mi.mesh != null and structure_models_ready:
		first_frame_logged = true
		_log("OYL-GODOT-FIRST", {"msSinceReady": (now_us - started_us) / 1000.0, "epochMs": Time.get_unix_time_from_system() * 1000.0})
	if (now_us - window_started_us) / 1_000_000.0 >= REPORT_SECONDS:
		_report(now_us)

func _take_steps() -> void:
	var raw: String = bridge.takeSteps()
	if raw == "":
		return
	var now_ms := Time.get_unix_time_from_system() * 1000.0
	var parsed = JSON.parse_string(raw)
	for s in parsed:
		var seq := int(s["seq"])
		if last_seq >= 0 and seq > last_seq + 1:
			lost_steps += seq - last_seq - 1
		last_seq = seq
		var sent: float = s["sentAt"]
		var recv: float = s["recvAt"]
		js_to_java_ms.append(recv - sent)
		js_to_godot_ms.append(now_ms - sent)
		if now_ms - sent > 50.0:
			late50_godot += 1
		if recv - sent > 50.0:
			late50_java += 1
		if last_java_arrival > 0.0:
			arrival_gap_ms.append(recv - last_java_arrival)
		last_java_arrival = recv
		steps_in_window += 1
		steps.append(s)

func _v(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])

func _pose() -> void:
	if steps.is_empty():
		return
	var render_at := Time.get_unix_time_from_system() * 1000.0 - delay_ms
	while steps.size() > 2 and float(steps[1]["sentAt"]) <= render_at:
		steps.pop_front()
	var a: Dictionary = steps[0]
	var b: Dictionary = steps[1] if steps.size() > 1 else steps[0]
	var ta: float = a["sentAt"]
	var tb: float = b["sentAt"]
	var t := 1.0
	if tb > ta:
		t = (render_at - ta) / (tb - ta)
	if t > 1.0:
		starved_frames += 1
		t = 1.0
	t = max(t, 0.0)
	cam.look_at_from_position(_v(a["eye"]).lerp(_v(b["eye"]), t), _v(a["target"]).lerp(_v(b["target"]), t), Vector3.UP)
	var pa: Array = a["pose"]
	var pb: Array = b["pose"]
	ring_mi.position = Vector3(lerp(float(pa[0]), float(pb[0]), t), 0.0, lerp(float(pa[1]), float(pb[1]), t))
	var ma: Array = a["markers"]
	var mb: Array = b["markers"]
	for rider in riders:
		(rider["root"] as Node3D).visible = false
	for i in range(min(ma.size(), mb.size())):
		var rider = null
		for r in riders:
			if r["kind"] == str(ma[i][6]):
				rider = r
		if rider == null:
			continue
		var p := _v(ma[i]).lerp(_v(mb[i]), t)
		var hx: float = lerp(float(ma[i][3]), float(mb[i][3]), t)
		var hz: float = lerp(float(ma[i][4]), float(mb[i][4]), t)
		var lean: float = lerp(float(ma[i][5]), float(mb[i][5]), t)
		var n: Node3D = rider["root"]
		n.visible = true
		n.position = p
		n.basis = Basis(Vector3.UP, atan2(hx, hz)) * Basis(Vector3(0, 0, 1), lean)
	# The scenery is placed for the step being drawn towards, once per step (20 Hz), as three.js
	# places it once per frame it draws: the same cull, the same nearest-N.
	if place_task != -1 and WorkerThreadPool.is_task_completed(place_task):
		WorkerThreadPool.wait_for_task_completion(place_task)
		place_task = -1
		if place_result != null:
			_apply_place()
	if int(b["seq"]) != placed_for_seq and place_task == -1:
		placed_for_seq = int(b["seq"])
		place_task = WorkerThreadPool.add_task(_place_job.bind(b["pose"], veg_items, structure_items, post_items))

func _reach(along: float) -> float:
	if reach_values.is_empty():
		return 1e9
	var f := (along - reach_from) / reach_step
	var i := clampi(int(floor(f)), 0, reach_values.size() - 2)
	var w := clampf(f - i, 0.0, 1.0)
	return lerp(reach_values[i], reach_values[i + 1], w)

func _in_view(x: float, z: float, pose: Array) -> bool:
	var dx := x - float(pose[0])
	var dz := z - float(pose[1])
	var hx := float(pose[2])
	var hz := float(pose[3])
	var along := dx * hx + dz * hz
	if along > view_ahead or along < -view_behind:
		return false
	var across := dx * hz - dz * hx
	return abs(across) <= _reach(along)

func _xform(item: Array, size: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, float(item[4])).scaled(Vector3.ONE * size), Vector3(item[1], item[2], item[3]))

# The window's placements, sorted once per window into flat arrays per destination, so the per-step
# placement below is arithmetic over packed arrays rather than dictionaries.
# vegetation: kind -> PackedFloat32Array of [x, y, z, rot, size, variant, index]
var veg_items := {}
# structure key "kind|variant" -> PackedFloat32Array of [x, y, z, rot, scale]
var structure_items := {}
var post_items := PackedFloat32Array()
var buffers := {}  # MultiMeshInstance3D -> PackedFloat32Array (capacity * 12)
const STRUCTURE_CAPACITY := 64

func _sort_window() -> void:
	veg_items = {}
	structure_items = {}
	post_items = PackedFloat32Array()
	for kind in vegetation:
		veg_items[kind] = PackedFloat32Array()
	for item in scatter_items:
		var kind: String = item[0]
		if vegetation.has(kind):
			var veg: Dictionary = vegetation[kind]
			var vi := posmod(int(item[6]), (veg["variants"] as Array).size())
			var size: float = veg["fit"] * float(item[5]) / float(veg["variants"][vi]["extent"])
			var va: PackedFloat32Array = veg_items[kind]
			va.append_array([item[1], item[2], item[3], item[4], size, vi])
			veg_items[kind] = va
		elif kind == "post":
			post_items.append_array([item[1], item[2], item[3], item[4], item[5]])
		else:
			var built := structure_mmis.has("%s|1" % kind)
			var key := "%s|%d" % [kind, posmod(int(item[6]), 2) if built else 0]
			var sa: PackedFloat32Array = structure_items.get(key, PackedFloat32Array())
			sa.append_array([item[1], item[2], item[3], item[4], item[5]])
			structure_items[key] = sa

func _buffer(mmi: MultiMeshInstance3D) -> PackedFloat32Array:
	if not buffers.has(mmi):
		var b := PackedFloat32Array()
		b.resize(mmi.multimesh.instance_count * 12)
		buffers[mmi] = b
	return buffers[mmi]

# One instance's 12 floats: a turn about +Y, a uniform scale, a position (MultiMesh's row layout).
static func _put(b: PackedFloat32Array, at: int, x: float, y: float, z: float, rot: float, size: float) -> void:
	var c := cos(rot) * size
	var s := sin(rot) * size
	var o := at * 12
	b[o] = c; b[o + 1] = 0.0; b[o + 2] = s; b[o + 3] = x
	b[o + 4] = 0.0; b[o + 5] = size; b[o + 6] = 0.0; b[o + 7] = y
	b[o + 8] = -s; b[o + 9] = 0.0; b[o + 10] = c; b[o + 11] = z

static func _put_xform(b: PackedFloat32Array, at: int, t: Transform3D) -> void:
	var o := at * 12
	b[o] = t.basis.x.x; b[o + 1] = t.basis.y.x; b[o + 2] = t.basis.z.x; b[o + 3] = t.origin.x
	b[o + 4] = t.basis.x.y; b[o + 5] = t.basis.y.y; b[o + 6] = t.basis.z.y; b[o + 7] = t.origin.y
	b[o + 8] = t.basis.x.z; b[o + 9] = t.basis.y.z; b[o + 10] = t.basis.z.z; b[o + 11] = t.origin.z

# Runs on a WorkerThreadPool thread: arithmetic over the window's arrays into fresh buffers, and
# no scene access. The main thread hands the buffers to the MultiMeshes (_apply_place).
func _place_job(pose: Array, veg_items: Dictionary, structure_items: Dictionary, post_items: PackedFloat32Array) -> void:
	var t0 := Time.get_ticks_usec()
	var out := {}  # MultiMeshInstance3D -> [PackedFloat32Array, visible count]
	var dn := 0
	var df := 0
	var ds := 0
	var px := float(pose[0])
	var pz := float(pose[1])
	var hx := float(pose[2])
	var hz := float(pose[3])
	# Vegetation: of the items in view, the nearest N of each kind are meshes; the other trees are
	# impostors; the other shrubs and rocks are not drawn (three-renderer.ts §RealisticVegetationBelt).
	for kind in vegetation:
		var veg: Dictionary = vegetation[kind]
		var items: PackedFloat32Array = veg_items.get(kind, PackedFloat32Array())
		var n := items.size() / 6
		var cap: int = veg["cap"]
		var best_d := PackedFloat32Array()
		var best_i := PackedInt32Array()
		var inview := PackedByteArray()
		inview.resize(n)
		for i in range(n):
			var o := i * 6
			var dx := items[o] - px
			var dz := items[o + 2] - pz
			var along := dx * hx + dz * hz
			if along > view_ahead or along < -view_behind or absf(dx * hz - dz * hx) > _reach(along):
				continue
			inview[i] = 1
			var d := dx * dx + dz * dz
			if best_i.size() < cap:
				best_d.append(d); best_i.append(i)
			else:
				var worst := 0
				for j in range(1, cap):
					if best_d[j] > best_d[worst]:
						worst = j
				if d < best_d[worst]:
					best_d[worst] = d; best_i[worst] = i
		var is_near := PackedByteArray()
		is_near.resize(n)
		for i in best_i:
			is_near[i] = 1
		var variants: Array = veg["variants"]
		var near_count := PackedInt32Array(); near_count.resize(variants.size())
		var far_count := PackedInt32Array(); far_count.resize(variants.size())
		for i in range(n):
			if inview[i] == 0:
				continue
			var o := i * 6
			var vi := int(items[o + 5])
			var v: Dictionary = variants[vi]
			if is_near[i] == 1:
				var place := Transform3D(Basis(Vector3.UP, items[o + 3]).scaled(Vector3.ONE * items[o + 4]), Vector3(items[o], items[o + 1], items[o + 2]))
				for part in v["parts"]:
					var mmi: MultiMeshInstance3D = part["mmi"]
					_put_xform(_fresh(mmi, out), near_count[vi], place * (part["xform"] as Transform3D))
				near_count[vi] += 1
				dn += 1
			elif v["impostor"] != null:
				var imm: MultiMeshInstance3D = v["impostor"]
				if far_count[vi] < int(capacity[imm]):
					_put(_fresh(imm, out), far_count[vi], items[o], items[o + 1], items[o + 2], items[o + 3], items[o + 4])
					far_count[vi] += 1
					df += 1
		for vi in range(variants.size()):
			var v: Dictionary = variants[vi]
			for part in v["parts"]:
				var mmi: MultiMeshInstance3D = part["mmi"]
				_fresh(mmi, out)
				out[mmi][1] = near_count[vi]
			if v["impostor"] != null:
				var imm: MultiMeshInstance3D = v["impostor"]
				_fresh(imm, out)
				out[imm][1] = far_count[vi]
	for key in structure_mmis:
		var items: PackedFloat32Array = structure_items.get(key, PackedFloat32Array())
		var count := 0
		var first: MultiMeshInstance3D = structure_mmis[key][0]
		var b := _fresh(first, out)
		for i in range(items.size() / 5):
			var o := i * 5
			var dx := items[o] - px
			var dz := items[o + 2] - pz
			var along := dx * hx + dz * hz
			if along > view_ahead or along < -view_behind or absf(dx * hz - dz * hx) > _reach(along):
				continue
			if count < STRUCTURE_CAPACITY:
				_put(b, count, items[o], items[o + 1], items[o + 2], items[o + 3], items[o + 4])
				count += 1
		for mmi in structure_mmis[key]:
			out[mmi] = [b, count]
		ds += count
	var pb := _fresh(post_mmi, out)
	var pc := 0
	for i in range(post_items.size() / 5):
		var o := i * 5
		var dx := post_items[o] - px
		var dz := post_items[o + 2] - pz
		var along := dx * hx + dz * hz
		if along > view_ahead or along < -view_behind or absf(dx * hz - dz * hx) > _reach(along):
			continue
		if pc < int(capacity[post_mmi]):
			_put(pb, pc, post_items[o], post_items[o + 1], post_items[o + 2], post_items[o + 3], post_items[o + 4])
			pc += 1
	out[post_mmi][1] = pc
	place_result = {"out": out, "near": dn, "far": df, "structures": ds, "ms": (Time.get_ticks_usec() - t0) / 1000.0}

var capacity := {}  # MultiMeshInstance3D -> instance_count, read on the main thread once
var place_task := -1
var place_result = null

func _fresh(mmi: MultiMeshInstance3D, out: Dictionary) -> PackedFloat32Array:
	if not out.has(mmi):
		var b := PackedFloat32Array()
		b.resize(int(capacity[mmi]) * 12)
		out[mmi] = [b, 0]
	return out[mmi][0]

func _apply_place() -> void:
	var r: Dictionary = place_result
	place_result = null
	for mmi in r["out"]:
		var e: Array = r["out"][mmi]
		(mmi as MultiMeshInstance3D).multimesh.buffer = e[0]
		(mmi as MultiMeshInstance3D).multimesh.visible_instance_count = e[1]
	drawn_near = r["near"]
	drawn_far = r["far"]
	drawn_structures = r["structures"]
	place_ms.append(r["ms"])

func _capacities() -> void:
	for kind in vegetation:
		for v in vegetation[kind]["variants"]:
			for part in v["parts"]:
				capacity[part["mmi"]] = (part["mmi"] as MultiMeshInstance3D).multimesh.instance_count
			if v["impostor"] != null:
				capacity[v["impostor"]] = (v["impostor"] as MultiMeshInstance3D).multimesh.instance_count
	for key in structure_mmis:
		for mmi in structure_mmis[key]:
			capacity[mmi] = (mmi as MultiMeshInstance3D).multimesh.instance_count
	capacity[post_mmi] = post_mmi.multimesh.instance_count

func _build_ring(r: Dictionary, horizon: Color, ground: Color) -> void:
	var n := int(r["segments"])
	var radius := float(r["radius"])
	var tops: Array = r["tops"]
	var haze := ground.lerp(horizon, float(r["hazeShare"]))
	var v := PackedVector3Array()
	var c := PackedColorArray()
	var idx := PackedInt32Array()
	for seg in range(n + 1):
		var ang := float(seg) / n * TAU
		var x := cos(ang) * radius
		var z := sin(ang) * radius
		var heights := [float(r["base"]), float(r["foot"]), float(tops[seg % n]) + float(r["lift"])]
		for row in range(3):
			v.append(Vector3(x, heights[row], z))
			c.append(haze if row == 2 else horizon)
	for seg in range(n):
		for row in range(2):
			var a0 := seg * 3 + row
			var b0 := (seg + 1) * 3 + row
			idx.append_array([a0, a0 + 1, b0, b0, a0 + 1, b0 + 1])
	ring_mi.mesh = _mesh(v, idx, c, PackedVector3Array())

func _mesh(v: PackedVector3Array, idx: PackedInt32Array, colours: PackedColorArray, normals: PackedVector3Array) -> ArrayMesh:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_INDEX] = idx
	if colours.size() > 0:
		arr[Mesh.ARRAY_COLOR] = colours
	if normals.size() > 0:
		arr[Mesh.ARRAY_NORMAL] = normals
	var m := ArrayMesh.new()
	if v.size() > 0 and idx.size() > 0:
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

func _take_world() -> void:
	var t0 := Time.get_ticks_usec()
	var meta = JSON.parse_string(bridge.takeWorldMeta())
	if meta.has("models") and not structure_models_ready:
		_take_models(meta)
	var b := func(name: String) -> PackedByteArray:
		var bytes: PackedByteArray = bridge.worldBytes(name)
		world_bytes += bytes.size()
		return bytes
	cam.fov = float(meta["fovDeg"])
	var intensity := float(meta["envIntensity"])
	env.background_energy_multiplier = intensity
	env.ambient_light_energy = intensity
	var h: Array = meta["horizonLinear"]
	env.fog_light_color = Color(float(h[0]), float(h[1]), float(h[2])).linear_to_srgb()
	env.fog_depth_end = float(meta["viewEnd"])
	var g := Color.hex(int(meta["ground"]) * 256 + 255).srgb_to_linear()
	ground_mat.set_shader_parameter("ground_tint", Vector3(g.r, g.g, g.b))
	var s: Dictionary = meta["sun"]
	sun.light_energy = float(s["direct"])
	var sd := Vector3(s["x"], s["y"], s["z"]).normalized()
	sun.look_at_from_position(Vector3.ZERO, -sd, Vector3.UP if abs(sd.y) < 0.99 else Vector3.FORWARD)
	# Turn the sky so the photograph's sun stands at the world's sun's azimuth (skyRotation's idea;
	# the panorama's own azimuth convention is Godot's, not three's).
	var picture := (float(config.get("sunU", 0.5)) - 0.5) * TAU
	env.sky_rotation = Vector3(0, -(picture - atan2(sd.z, sd.x)) - PI / 2.0, 0)

	road_mi.mesh = _mesh(b.call("roadV").to_vector3_array(), b.call("roadI").to_int32_array(), b.call("roadC").to_color_array(), PackedVector3Array())
	terrain_mi.mesh = _mesh(b.call("terrV").to_vector3_array(), b.call("terrI").to_int32_array(), b.call("terrC").to_color_array(), b.call("terrN").to_vector3_array())
	water_mi.mesh = _mesh(b.call("waterV").to_vector3_array(), b.call("waterI").to_int32_array(), PackedColorArray(), PackedVector3Array())

	_build_ring(meta["horizonRing"], Color(float(h[0]), float(h[1]), float(h[2])), g)

	var parts: Array = meta["bridges"]
	var mm := bridge_mmi.multimesh
	mm.instance_count = parts.size()
	for i in range(parts.size()):
		var p: Array = parts[i]
		var axis := Vector3(p[3], p[4], p[5]).normalized()
		var side := axis.cross(Vector3.UP).normalized()
		var up := side.cross(axis).normalized()
		mm.set_instance_transform(i, Transform3D(Basis(axis * float(p[6]), up * float(p[8]), side * float(p[7])), Vector3(p[0], p[1], p[2])))
	scatter_items = meta["scatter"]
	_sort_window()
	placed_for_seq = -1
	worlds_in_window += 1
	world_build_ms.append((Time.get_ticks_usec() - t0) / 1000.0)

static func _pct(values: Array, p: float) -> float:
	if values.is_empty():
		return NAN
	var s := values.duplicate()
	s.sort()
	var rank := int(ceil(p / 100.0 * s.size())) - 1
	return s[clamp(rank, 0, s.size() - 1)]

static func _stats(values: Array) -> Dictionary:
	return {"p50": _pct(values, 50), "p90": _pct(values, 90), "p95": _pct(values, 95), "p99": _pct(values, 99), "max": _pct(values, 100), "count": values.size()}

func _report(now_us: int) -> void:
	var over20 := 0
	for f in frame_ms:
		if f > 20.0:
			over20 += 1
	var line := {
		"window": window_index,
		"minute": (now_us - started_us) / 60_000_000.0,
		"frameMs": _stats(frame_ms),
		"over20": over20,
		"gpuMs": _stats(gpu_ms),
		"cpuMs": _stats(cpu_ms),
		"placeMs": _stats(place_ms),
		"drawCalls": _pct(draws, 50),
		"primitives": _pct(prims, 50),
		"primitivesP90": _pct(prims, 90),
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"videoMemMiB": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
		"textureMemMiB": Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0,
		"bufferMemMiB": Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0,
		"staticMemMiB": Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		"drawnNear": drawn_near,
		"drawnFar": drawn_far,
		"drawnStructures": drawn_structures,
		"steps": steps_in_window,
		"lostSteps": lost_steps,
		"jsToJavaMs": _stats(js_to_java_ms),
		"jsToGodotMs": _stats(js_to_godot_ms),
		"arrivalGapMs": _stats(arrival_gap_ms),
		"starvedFrames": starved_frames,
		"late50Godot": late50_godot,
		"late50Java": late50_java,
		"frames": frames_in_window,
		"delayMs": delay_ms,
		"worlds": worlds_in_window,
		"worldBuildMs": _stats(world_build_ms),
		"worldBytes": world_bytes,
	}
	_log("OYL-GODOT", line)
	window_index += 1
	window_started_us = now_us
	frame_ms.clear(); gpu_ms.clear(); cpu_ms.clear(); place_ms.clear(); prims.clear(); draws.clear()
	js_to_java_ms.clear(); js_to_godot_ms.clear(); arrival_gap_ms.clear()
	world_build_ms.clear()
	starved_frames = 0; late50_godot = 0; late50_java = 0; frames_in_window = 0; steps_in_window = 0
	lost_steps = 0; worlds_in_window = 0; world_bytes = 0

func _log(tag: String, data: Dictionary) -> void:
	var text := JSON.stringify(data)
	print(tag + " " + text)
	if bridge != null:
		bridge.report(tag + " " + text)
