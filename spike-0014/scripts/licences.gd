extends SceneTree

# Print Godot's own record of its third-party components and their licences, as JSON.
func _init():
	var out := {"copyright": Engine.get_copyright_info(), "licences": Engine.get_license_info().keys()}
	print("LICENCES " + JSON.stringify(out))
	quit()
