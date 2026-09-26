# Spike 0013 (#433). Throwaway: not merged, not shipped.
#
# The world, drawn by Godot beneath the Capacitor WebView. Nothing here decides
# WHERE anything is: every vertex and every placement arrives from the product's
# own TypeScript (scene.ts, terrain.ts, landform.ts, scatter.ts, settlements.ts,
# waterways.ts) over the Capacitor bridge, through the WorldBridge plugin. This
# file turns those arrays into Godot meshes, interpolates the camera between the
# simulation's 20 Hz steps, and measures.
extends Node3D

const REPORT_SECONDS := 30.0

var bridge: Object = null
var config := {}

var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var road_mi := MeshInstance3D.new()
var terrain_mi := MeshInstance3D.new()
var water_mi := MeshInstance3D.new()
var bridge_mmi := MultiMeshInstance3D.new()
var rider_nodes: Array[Node3D] = []

# kind -> Array of { mesh: Mesh, xform: Transform3D } (one entry per sub-mesh
# of one model variant), and the variant count.
var kind_parts := {}
# "kind|variant|part" -> MultiMeshInstance3D
var scatter_mmis := {}

var road_mat := StandardMaterial3D.new()
var terrain_mat := StandardMaterial3D.new()
var water_mat := StandardMaterial3D.new()

# The step buffer: dictionaries with t (sentAt, ms), eye, target, markers.
var steps: Array = []
var delay_ms := 50.0
var last_seq := -1

# Measurement.
var frame_ms: Array[float] = []
var gpu_ms: Array[float] = []
var cpu_ms: Array[float] = []
var js_to_java_ms: Array[float] = []
var js_to_godot_ms: Array[float] = []
var arrival_gap_ms: Array[float] = []
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
var total_frames := 0

func _ready() -> void:
	started_us = Time.get_ticks_usec()
	if Engine.has_singleton("WorldBridge"):
		bridge = Engine.get_singleton("WorldBridge")
		var raw: String = bridge.config()
		if raw != "":
			config = JSON.parse_string(raw)
	delay_ms = float(config.get("delayMs", 50.0))
	_build_static()
	_load_models()
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
		"config": config,
	})

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

	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color.WHITE
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
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

	# The road is unlit, as in three-renderer.ts; its vertex colours are LINEAR.
	road_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	road_mat.vertex_color_use_as_albedo = true
	road_mat.vertex_color_is_srgb = false
	road_mat.disable_fog = true
	road_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	road_mi.material_override = road_mat
	road_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(road_mi)

	# The ground is lit (#458): mottle x ground colour.
	terrain_mat.vertex_color_use_as_albedo = true
	terrain_mat.vertex_color_is_srgb = false
	terrain_mat.roughness = 1.0
	terrain_mi.material_override = terrain_mat
	terrain_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(terrain_mi)

	water_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	water_mat.albedo_color = Color(0.36, 0.5, 0.62)
	water_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	water_mi.material_override = water_mat
	water_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(water_mi)

	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var bmat := StandardMaterial3D.new()
	bmat.albedo_color = Color(0.55, 0.52, 0.48)
	box.material = bmat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = box
	bridge_mmi.multimesh = mm
	add_child(bridge_mmi)

	for kind in ["rider", "bot", "ghost"]:
		rider_nodes.append(_rider(kind))

func _rider(kind: String) -> Node3D:
	var colours := {"rider": Color(0.9, 0.3, 0.2), "bot": Color(0.2, 0.45, 0.9), "ghost": Color(0.85, 0.85, 0.9, 0.5)}
	var root := Node3D.new()
	var body := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.28
	capsule.height = 1.1
	var m := StandardMaterial3D.new()
	m.albedo_color = colours[kind]
	if kind == "ghost":
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	capsule.material = m
	body.mesh = capsule
	body.position = Vector3(0, 1.25, 0)
	body.rotation = Vector3(0.6, 0, 0)
	root.add_child(body)
	var bike := MeshInstance3D.new()
	var frame := BoxMesh.new()
	frame.size = Vector3(0.08, 0.7, 1.7)
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.12, 0.12, 0.14)
	frame.material = fm
	bike.mesh = frame
	bike.position = Vector3(0, 0.35, 0)
	root.add_child(bike)
	add_child(root)
	return root

# Kenney CC0 models: the same files the stylised three.js world instances.
# Fit sizes are the largest extent of each kind's three.js primitive
# (three-renderer.ts §SCATTER_STYLE / §sceneryFitMetres), read by hand.
const MODEL_FILES := {
	"tree-broadleaf": ["tree_default", "tree_oak"],
	"tree-conifer": ["tree_pineTallA", "tree_pineRoundD"],
	"shrub": ["plant_bush", "plant_bushLargeTriangle"],
	"rock": ["stone_largeA", "stone_largeC"],
	"building": ["building-type-h", "building-type-i", "building-type-k"],
}
const FIT_METRES := {"tree-broadleaf": 4.4, "tree-conifer": 7.0, "shrub": 1.6, "rock": 1.8, "building": 9.0}
# Kinds three.js builds from numbers (buildings.ts, BOUNDARY_STYLE): drawn here
# as one box of the kind's STRUCTURE_FOOTPRINTS, with a guessed height.
const BOX_KINDS := {
	"barn": [14.6, 7.0, 8.6, Color(0.55, 0.25, 0.2)],
	"church": [7.6, 10.0, 18.8, Color(0.7, 0.68, 0.62)],
	"shop-row": [20.4, 7.0, 7.4, Color(0.75, 0.6, 0.45)],
	"shed": [10.4, 3.5, 8.8, Color(0.5, 0.42, 0.33)],
	"wall": [0.6, 1.1, 8.0, Color(0.62, 0.6, 0.55)],
	"hedge": [1.1, 1.6, 8.0, Color(0.2, 0.4, 0.18)],
	"fence": [0.2, 1.1, 8.0, Color(0.45, 0.35, 0.25)],
	"signpost": [0.2, 2.2, 0.2, Color(0.9, 0.9, 0.85)],
	"post": [0.14, 1.1, 0.14, Color(0.85, 0.85, 0.8)],
}

func _load_models() -> void:
	for kind in MODEL_FILES:
		var variants: Array = []
		for name in MODEL_FILES[kind]:
			var scene: PackedScene = load("res://models/%s.glb" % name)
			var inst := scene.instantiate()
			var parts: Array = []
			_collect(inst, Transform3D.IDENTITY, parts)
			var aabb := AABB()
			var first := true
			for p in parts:
				var box: AABB = p["xform"] * (p["mesh"] as Mesh).get_aabb()
				aabb = box if first else aabb.merge(box)
				first = false
			var extent: float = max(aabb.size.x, max(aabb.size.y, aabb.size.z))
			var k: float = FIT_METRES[kind] / extent
			var fit := Transform3D(Basis.from_scale(Vector3(k, k, k)), Vector3.ZERO) * Transform3D(Basis.IDENTITY, Vector3(-aabb.get_center().x, -aabb.position.y, -aabb.get_center().z))
			for p in parts:
				p["xform"] = fit * p["xform"]
			variants.append(parts)
			inst.free()
		kind_parts[kind] = variants
	for kind in BOX_KINDS:
		var spec: Array = BOX_KINDS[kind]
		var box := BoxMesh.new()
		box.size = Vector3(spec[0], spec[1], spec[2])
		var m := StandardMaterial3D.new()
		m.albedo_color = spec[3]
		box.material = m
		kind_parts[kind] = [[{"mesh": box, "xform": Transform3D(Basis.IDENTITY, Vector3(0, spec[1] / 2.0, 0))}]]

func _collect(node: Node, parent: Transform3D, out: Array) -> void:
	var xf := parent
	if node is Node3D:
		xf = parent * (node as Node3D).transform
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		out.append({"mesh": (node as MeshInstance3D).mesh, "xform": xf})
	for c in node.get_children():
		_collect(c, xf, out)

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
	total_frames += 1
	if frames_in_window > 0:
		frame_ms.append(dt)
	frames_in_window += 1
	var rid := get_viewport().get_viewport_rid()
	gpu_ms.append(RenderingServer.viewport_get_measured_render_time_gpu(rid))
	cpu_ms.append(RenderingServer.viewport_get_measured_render_time_cpu(rid) + RenderingServer.get_frame_setup_time_cpu())
	if not first_frame_logged and steps.size() > 0 and road_mi.mesh != null:
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
	# Render at (now - delay), interpolating between the two steps whose SENT
	# times bracket it. Sender and receiver share one device clock.
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
	var eye := _v(a["eye"]).lerp(_v(b["eye"]), t)
	var target := _v(a["target"]).lerp(_v(b["target"]), t)
	cam.look_at_from_position(eye, target, Vector3.UP)
	var ma: Array = a["markers"]
	var mb: Array = b["markers"]
	for i in range(min(rider_nodes.size(), ma.size())):
		var p := _v(ma[i]).lerp(_v(mb[i]), t)
		var hx: float = lerp(float(ma[i][3]), float(mb[i][3]), t)
		var hz: float = lerp(float(ma[i][4]), float(mb[i][4]), t)
		var lean: float = lerp(float(ma[i][5]), float(mb[i][5]), t)
		var n := rider_nodes[i]
		n.position = p
		n.rotation = Vector3(0, atan2(hx, hz), -lean)

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
	var b := func(name: String) -> PackedByteArray:
		var bytes: PackedByteArray = bridge.worldBytes(name)
		world_bytes += bytes.size()
		return bytes
	cam.fov = float(meta["fovDeg"])
	var sky := Color.hex(int(meta["sky"]) * 256 + 255)
	env.background_color = sky
	env.fog_light_color = Color.hex(int(meta["horizon"]) * 256 + 255)
	env.fog_depth_end = float(meta["viewEnd"])
	env.ambient_light_energy = float(meta["sun"]["ambient"])
	sun.light_energy = float(meta["sun"]["direct"])
	var sd := Vector3(meta["sun"]["x"], meta["sun"]["y"], meta["sun"]["z"]).normalized()
	sun.look_at_from_position(Vector3.ZERO, -sd, Vector3.UP if abs(sd.y) < 0.99 else Vector3.FORWARD)
	terrain_mat.albedo_color = Color.hex(int(meta["ground"]) * 256 + 255)

	road_mi.mesh = _mesh(b.call("roadV").to_vector3_array(), b.call("roadI").to_int32_array(), b.call("roadC").to_color_array(), PackedVector3Array())
	terrain_mi.mesh = _mesh(b.call("terrV").to_vector3_array(), b.call("terrI").to_int32_array(), b.call("terrC").to_color_array(), b.call("terrN").to_vector3_array())
	water_mi.mesh = _mesh(b.call("waterV").to_vector3_array(), b.call("waterI").to_int32_array(), PackedColorArray(), PackedVector3Array())

	var parts: Array = meta["bridges"]
	var mm := bridge_mmi.multimesh
	mm.instance_count = parts.size()
	for i in range(parts.size()):
		var p: Array = parts[i]
		var axis := Vector3(p[3], p[4], p[5]).normalized()
		var side := axis.cross(Vector3.UP).normalized()
		var up := side.cross(axis).normalized()
		mm.set_instance_transform(i, Transform3D(Basis(axis * float(p[6]), up * float(p[8]), side * float(p[7])), Vector3(p[0], p[1], p[2])))

	# Scatter and structures, instanced per (kind, variant, sub-mesh).
	var buckets := {}
	for item in meta["scatter"]:
		var kind: String = item[0]
		if not kind_parts.has(kind):
			continue
		var variants: Array = kind_parts[kind]
		var vi := int(item[6]) % variants.size()
		var place := Transform3D(Basis(Vector3.UP, float(item[4])).scaled(Vector3.ONE * float(item[5])), Vector3(item[1], item[2], item[3]))
		var sub: Array = variants[vi]
		for pi in range(sub.size()):
			var key := "%s|%d|%d" % [kind, vi, pi]
			if not buckets.has(key):
				buckets[key] = []
			buckets[key].append(place * sub[pi]["xform"])
	for key in scatter_mmis:
		(scatter_mmis[key] as MultiMeshInstance3D).multimesh.instance_count = 0
	for key in buckets:
		if not scatter_mmis.has(key):
			var bits: PackedStringArray = key.split("|")
			var mmi := MultiMeshInstance3D.new()
			var m := MultiMesh.new()
			m.transform_format = MultiMesh.TRANSFORM_3D
			m.mesh = kind_parts[bits[0]][int(bits[1])][int(bits[2])]["mesh"]
			mmi.multimesh = m
			add_child(mmi)
			scatter_mmis[key] = mmi
		var list: Array = buckets[key]
		var target_mm: MultiMesh = (scatter_mmis[key] as MultiMeshInstance3D).multimesh
		target_mm.instance_count = list.size()
		for i in range(list.size()):
			target_mm.set_instance_transform(i, list[i])
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
		"drawCalls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"videoMemMiB": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
		"staticMemMiB": Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
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
	frame_ms.clear(); gpu_ms.clear(); cpu_ms.clear()
	js_to_java_ms.clear(); js_to_godot_ms.clear(); arrival_gap_ms.clear()
	world_build_ms.clear()
	starved_frames = 0; late50_godot = 0; late50_java = 0; frames_in_window = 0; steps_in_window = 0
	lost_steps = 0; worlds_in_window = 0; world_bytes = 0

func _log(tag: String, data: Dictionary) -> void:
	var text := JSON.stringify(data)
	print(tag + " " + text)
	if bridge != null:
		bridge.report(tag + " " + text)
