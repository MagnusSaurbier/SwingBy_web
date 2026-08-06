extends Node2D
class_name GameWorld

signal level_completed(level_index: int, category: String, time_elapsed: float, boost_elapsed: float)
signal exit_requested
signal pause_changed(paused: bool)
signal quick_setting_toggled(setting_name: String, value: bool)
signal editor_selection_changed
signal bounds_reset

var mode := GameConstants.MODE_MENU
var paused := false
var current_level_index := 0
var current_level_is_custom := false
var current_level_category := "builtin"
var current_level_name := ""
var current_level_author := ""
var level_goal := {"index": 0, "range": GameConstants.GOAL_RANGE_DEFAULT}
var current_level_data := {}
var objects: Array = []

## Set from Main: return true when the cursor is over the stage editor side panel (suppress canvas zoom).
var editor_wheel_zoom_suppressed_at: Callable = Callable()

var elapsed_time := 0.0
var boost_time := 0.0
var zoom_factor := 1.0
var target_zoom_factor := 1.0
var world_origin := Vector2(960, 508)
var trail_points: Array = []

var _prediction_player: Array = []
var _prediction_planets: Array = []
var _accumulator := 0.0
var _fps_timer := 0.0
var _render_frames := 0
var _tick_counter := 0
var fps := 0.0
var tps := 0.0
var shake_strength := 0.0
var shake_decay := 0.0
var _shake_rng := RandomNumberGenerator.new()

var _goal_flash := 0.0
var _is_boosting_now := false
var _prediction_skip := 0
var _first_boost_fired := false
var _bounds_warning_level := 0.0
var _bounds_warning_timer := 0.0
var _reset_flash_timer := 0.0
var _star_layers: Array = []
var _particles: Array = []
var earth_texture: Texture2D
var rocket_textures: Array = []
var rocket_boost_textures: Array = []

var input_handler: InputHandler
var level_editor: LevelEditor


func _ready() -> void:
	_shake_rng.randomize()
	earth_texture = _load_texture_from_image("res://images/earth.png")
	for index in range(4):
		rocket_textures.append(_load_texture_from_image("res://images/rocket%d.png" % [index + 1]))
		rocket_boost_textures.append(_load_texture_from_image("res://images/rocket%d_boost.png" % [index + 1]))
	_build_starfield()

	input_handler = InputHandler.new()
	input_handler.name = "InputHandler"
	add_child(input_handler)
	input_handler.restart_requested.connect(restart_level)
	input_handler.pause_requested.connect(toggle_pause)
	input_handler.menu_requested.connect(func() -> void: exit_requested.emit())
	input_handler.quick_toggle.connect(_on_quick_toggle)

	level_editor = LevelEditor.new()
	level_editor.name = "LevelEditor"
	add_child(level_editor)

	set_process(true)
	set_process_unhandled_input(true)


func set_levels(builtin: Array, custom: Array) -> void:
	DataManager.builtin_levels = builtin.duplicate(true)
	DataManager.custom_levels = custom.duplicate(true)


func set_settings(next_settings: Dictionary) -> void:
	DataManager.settings = next_settings.duplicate(true)
	_sync_player_boost_type()


func set_touch_state(direction: Vector2, boost: bool, brake: bool) -> void:
	input_handler.set_touch_state(direction, boost, brake)


func enter_menu_mode() -> void:
	mode = GameConstants.MODE_MENU
	paused = false
	_goal_flash = 0.0
	_first_boost_fired = false
	if DataManager.builtin_levels.is_empty():
		objects = []
		queue_redraw()
		return
	_load_level(DataManager.builtin_levels[4].duplicate(true), 4, "builtin")
	_prediction_player.clear()
	_prediction_planets.clear()


func start_builtin_level(level_index: int) -> void:
	if DataManager.builtin_levels.is_empty():
		return
	current_level_index = clamp(level_index, 0, DataManager.builtin_levels.size() - 1)
	_load_level(DataManager.builtin_levels[current_level_index].duplicate(true), current_level_index, "builtin")
	mode = GameConstants.MODE_PLAY
	paused = false


func start_custom_level(level_index: int) -> void:
	if DataManager.custom_levels.is_empty():
		return
	current_level_index = clamp(level_index, 0, DataManager.custom_levels.size() - 1)
	_load_level(DataManager.custom_levels[current_level_index].duplicate(true), current_level_index, "custom")
	mode = GameConstants.MODE_PLAY
	paused = false


func start_tutorial_level(level_data: Dictionary) -> void:
	current_level_index = -1
	_load_level(level_data.duplicate(true), -1, "tutorial")
	mode = GameConstants.MODE_PLAY
	paused = false


func enter_editor_mode(level_data: Dictionary = {}) -> void:
	mode = GameConstants.MODE_EDITOR
	paused = true
	pause_changed.emit(paused)
	world_origin = get_viewport_rect().size * 0.5
	current_level_is_custom = false
	current_level_index = 0
	level_editor.enter_editor_mode()
	if level_data.is_empty():
		level_data = {
			"name": "Custom Stage",
			"author": DataManager.settings.get("username", "Guest"),
			"goal": {"index": 0, "range": GameConstants.GOAL_RANGE_DEFAULT},
			"objects": []
		}
	_load_level(level_data.duplicate(true), 0, "builtin")
	_prediction_player.clear()
	_prediction_planets.clear()


func _editor_ensure_paused_after_stage_reset() -> void:
	if mode != GameConstants.MODE_EDITOR or paused:
		return
	paused = true
	pause_changed.emit(paused)


func restart_level() -> void:
	if mode == GameConstants.MODE_EDITOR:
		_reset_runtime_state()
		_editor_ensure_paused_after_stage_reset()
		queue_redraw()
		return
	if current_level_data.is_empty():
		return
	_load_level(current_level_data.duplicate(true), current_level_index, current_level_category)
	paused = false


func toggle_pause() -> void:
	paused = not paused
	pause_changed.emit(paused)


func is_player_boosting() -> bool:
	var player := _get_player()
	if player.is_empty():
		return false
	return bool(player.get("is_boosting", false))


func is_player_braking() -> bool:
	var player := _get_player()
	if player.is_empty():
		return false
	return bool(player.get("is_braking", false))


func is_bounds_warning() -> bool:
	return _bounds_warning_level > 0.0


## True when runtime positions/velocities match edited "start" state (after R / reset preview).
func editor_runtime_matches_start_state() -> bool:
	for obj in objects:
		if absf(float(obj["x"]) - float(obj["start_x"])) > 0.01:
			return false
		if absf(float(obj["y"]) - float(obj["start_y"])) > 0.01:
			return false
		var t := String(obj.get("type", ""))
		if t == "sun":
			continue
		if bool(obj.get("anchored", false)):
			continue
		if absf(float(obj["x_vel"]) - float(obj["start_x_vel"])) > 0.0001:
			return false
		if absf(float(obj["y_vel"]) - float(obj["start_y_vel"])) > 0.0001:
			return false
	return true


## Stage editor: show "reset stage" when runtime state has diverged from saved starts (R / object click / Reset Preview realigns).
func editor_overlay_requires_reset() -> bool:
	if mode != GameConstants.MODE_EDITOR:
		return false
	return not editor_runtime_matches_start_state()


func get_status() -> Dictionary:
	return {
		"mode": mode,
		"paused": paused,
		"level_name": current_level_name,
		"author": current_level_author,
		"level_index": current_level_index,
		"is_custom": current_level_is_custom,
		"category": current_level_category,
		"level_label": _level_label(),
		"elapsed_time": elapsed_time,
		"boost_time": boost_time,
		"fps": fps,
		"tps": tps,
		"hint": _hint_for_level(),
		"score_key": DataManager.score_key(current_level_category, current_level_index),
		"goal_index": int(level_goal.get("index", 0)),
		"editor_tool": level_editor.get_tool(),
		"editor_object_type": level_editor.get_object_type(),
		"editor_phantom_type": level_editor.get_phantom_type(),
		"object_count": objects.size(),
		"editor_overlay_requires_reset": editor_overlay_requires_reset(),
		"editor_specs_open": level_editor.get_specs_open()
	}


func editor_set_tool(tool_name: String) -> void:
	level_editor.set_tool(tool_name)


func editor_set_object_type(object_type: String) -> void:
	level_editor.set_object_type(object_type)


func editor_start_phantom(object_type: String) -> void:
	level_editor.start_phantom(object_type)


func editor_cancel_phantom() -> void:
	level_editor.cancel_phantom()


func editor_undo_last() -> void:
	if objects.is_empty():
		return
	objects.remove_at(objects.size() - 1)
	level_editor._selected_index = clamp(level_editor._selected_index, -1, objects.size() - 1)
	level_goal["index"] = clamp(int(level_goal.get("index", 0)), 0, max(0, objects.size() - 1))
	_reset_runtime_state()


func editor_remove_object_at(index: int) -> void:
	if index < 0 or index >= objects.size():
		return
	objects.remove_at(index)
	var gi := int(level_goal.get("index", 0))
	if gi > index:
		level_goal["index"] = gi - 1
	elif gi == index:
		level_goal["index"] = clamp(gi, 0, max(0, objects.size() - 1))
	var si := level_editor._selected_index
	if si == index:
		level_editor._selected_index = -1
		level_editor._specs_open = false
	elif si > index:
		level_editor._selected_index = si - 1
	_reset_runtime_state()


func editor_clear() -> void:
	objects.clear()
	trail_points.clear()
	level_goal = {"index": 0, "range": GameConstants.GOAL_RANGE_DEFAULT}
	level_editor._selected_index = -1
	_prediction_player.clear()
	_prediction_planets.clear()


func editor_reset_preview() -> void:
	_reset_runtime_state()
	_editor_ensure_paused_after_stage_reset()


func editor_get_selected_info() -> Dictionary:
	return level_editor.get_selected_info(self)


func editor_set_selected_vel(vx: float, vy: float) -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	level_editor.set_selected_vel(vx, vy, self)


func editor_set_selected_gravity_value(v: float) -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	level_editor.set_selected_gravity_value(v, self)


func editor_set_selected_size(delta: int) -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	level_editor.set_selected_size(delta, self)


func editor_set_selected_visible(value: bool) -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	level_editor.set_selected_visible(value, self)


func editor_set_selected_anchored(value: bool) -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	level_editor.set_selected_anchored(value, self)


func editor_set_selected_as_goal() -> void:
	level_editor.set_selected_as_goal(self)


func editor_set_level_name(stage_name: String) -> void:
	var n := stage_name.strip_edges()
	current_level_name = "Custom Stage" if n.is_empty() else n
	current_level_data["name"] = current_level_name
	queue_redraw()


func editor_export_level(level_name: String, author_name: String) -> Dictionary:
	var has_player := false
	if objects.is_empty():
		return {}

	var export_objects: Array = []
	for obj in objects:
		var exported := {
			"type": obj["type"],
			"x": float(obj["start_x"]),
			"y": float(obj["start_y"]),
			"gravity": float(obj["gravity"])
		}
		match String(obj["type"]):
			"player":
				has_player = true
				exported["boost_type"] = int(obj["boost_type"]) + 1
				exported["x_vel"] = float(obj["start_x_vel"])
				exported["y_vel"] = float(obj["start_y_vel"])
			"planet":
				exported["x_vel"] = float(obj["start_x_vel"])
				exported["y_vel"] = float(obj["start_y_vel"])
			"sun":
				exported["visible"] = bool(obj.get("visible", true))
				exported["size"] = float(obj.get("size", 18.0))
		export_objects.append(exported)

	if not has_player:
		return {}
	if int(level_goal.get("index", -1)) < 0 or int(level_goal.get("index", -1)) >= export_objects.size():
		return {}

	return {
		"name": level_name.strip_edges() if not level_name.strip_edges().is_empty() else "Custom Stage",
		"author": author_name.strip_edges() if not author_name.strip_edges().is_empty() else DataManager.settings.get("username", "Guest"),
		"goal": {
			"index": int(level_goal.get("index", 0)),
			"range": float(level_goal.get("range", GameConstants.GOAL_RANGE_DEFAULT))
		},
		"objects": export_objects
	}


func _process(delta: float) -> void:
	_fps_timer += delta
	_render_frames += 1
	if _reset_flash_timer > 0.0:
		_reset_flash_timer = max(0.0, _reset_flash_timer - delta)
	if _bounds_warning_timer > 0.0:
		_bounds_warning_timer = max(0.0, _bounds_warning_timer - delta)
		if _bounds_warning_timer <= 0.0:
			_reset_flash_timer = GameConstants.RESET_FLASH_DURATION
			bounds_reset.emit()
			restart_level()
			return

	if mode != GameConstants.MODE_MENU or not DataManager.builtin_levels.is_empty():
		if mode != GameConstants.MODE_EDITOR:
			world_origin = get_viewport_rect().size * 0.5
		_accumulator += delta
		while _accumulator >= GameConstants.TICK_INTERVAL:
			if not paused:
				_physics_tick()
			_accumulator -= GameConstants.TICK_INTERVAL
			_tick_counter += 1

	if mode != GameConstants.MODE_MENU and DataManager.settings.get("show_future", true) and not paused:
		# Future trajectories assume current runtime matches the edited start state; hide while diverged.
		if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
			_prediction_skip = 0
			_prediction_player.clear()
			_prediction_planets.clear()
		else:
			_prediction_skip += 1
			var moving_bodies := objects.filter(func(o: Dictionary) -> bool: return String(o["type"]) != "sun").size()
			var skip_frames := 2 if moving_bodies > 3 else 1
			if _prediction_skip >= skip_frames:
				_prediction_skip = 0
				var result := PhysicsEngine.recalculate_predictions(objects)
				_prediction_player = result["player"]
				_prediction_planets = result["planets"]
	else:
		_prediction_skip = 0
		_prediction_player.clear()
		_prediction_planets.clear()

	_update_particles(delta)
	_goal_flash += delta
	var zoom_speed := GameConstants.ZOOM_IN_SMOOTHING if target_zoom_factor > zoom_factor else GameConstants.ZOOM_SMOOTHING
	var zoom_blend := 1.0 - exp(-delta * zoom_speed)
	zoom_factor = lerpf(zoom_factor, target_zoom_factor, zoom_blend)
	if absf(zoom_factor - target_zoom_factor) < 0.001:
		zoom_factor = target_zoom_factor
	if shake_strength > 0.0:
		shake_strength = max(0.0, shake_strength - shake_decay * delta)

	if _fps_timer >= 1.0:
		fps = _render_frames / _fps_timer
		tps = _tick_counter / _fps_timer
		_render_frames = 0
		_tick_counter = 0
		_fps_timer = 0.0

	queue_redraw()


func _unhandled_input(event: InputEvent) -> void:
	if mode != GameConstants.MODE_EDITOR:
		return
	if event is InputEventMouseButton or event is InputEventMouseMotion:
		level_editor.handle_mouse_event(event, self)


func _draw() -> void:
	_draw_background()
	_draw_predictions()
	_draw_trail()
	_draw_goal_ring()
	_draw_objects()
	_draw_particles()
	if DataManager.settings.get("show_force_vector", true):
		if mode == GameConstants.MODE_PLAY:
			_draw_force_vector()
		elif mode == GameConstants.MODE_EDITOR and not editor_overlay_requires_reset():
			_draw_force_vector()
	if mode == GameConstants.MODE_EDITOR:
		level_editor.draw_editor_overlay(self)
	_draw_bounds_warning()
	_draw_reset_flash()


func screen_to_world(screen_position: Vector2) -> Vector2:
	var viewport_center := get_viewport_rect().size * 0.5
	return world_origin + ((screen_position - viewport_center) / max(zoom_factor, 0.0001))


func editor_apply_pan_screen_delta(delta_screen: Vector2) -> void:
	world_origin -= delta_screen / maxf(zoom_factor, 0.0001)
	queue_redraw()


## Zoom toward cursor; wheel_steps +1 = zoom in. Clamped for editor usability.
func editor_zoom_at_screen(wheel_steps: int, screen_pos: Vector2) -> void:
	var viewport_center := get_viewport_rect().size * 0.5
	var old_z := zoom_factor
	var factor := pow(1.1, float(wheel_steps))
	var new_z := clampf(target_zoom_factor * factor, 0.12, 5.0)
	target_zoom_factor = new_z
	zoom_factor = new_z
	var world_at_cursor := world_origin + (screen_pos - viewport_center) / maxf(old_z, 0.0001)
	world_origin = world_at_cursor - (screen_pos - viewport_center) / maxf(new_z, 0.0001)
	queue_redraw()


func world_to_screen(world_position: Vector2) -> Vector2:
	var viewport_center := get_viewport_rect().size * 0.5
	var shake_offset := Vector2.ZERO
	if shake_strength > 0.0:
		shake_offset = Vector2(
			_shake_rng.randf_range(-shake_strength, shake_strength),
			_shake_rng.randf_range(-shake_strength, shake_strength)
		)
	return viewport_center + ((world_position - world_origin) * zoom_factor) + shake_offset


func _on_quick_toggle(setting_name: String, value: bool) -> void:
	DataManager.settings[setting_name] = value
	quick_setting_toggled.emit(setting_name, value)


func _physics_tick() -> void:
	if objects.is_empty():
		return

	var thrusting := false
	var substeps := PhysicsEngine.substep_count(objects)
	var substep_scale := 1.0 / float(substeps)

	for _sub in range(substeps):
		var result := PhysicsEngine.simulate_substep(
			objects,
			mode != GameConstants.MODE_MENU,
			substep_scale,
			thrusting,
			DataManager.settings,
			input_handler.touch_boost,
			input_handler.touch_brake,
			input_handler.touch_direction,
			_first_boost_fired
		)
		thrusting = result["thrusting"]
		if not _first_boost_fired and result["first_boost_triggered"]:
			_first_boost_fired = true
			_trigger_shake(5.0, 24.0)

	for body in objects:
		if String(body["type"]) == "player":
			body["angle"] = PhysicsEngine.rocket_angle_from_velocity(Vector2(float(body["x_vel"]), float(body["y_vel"])))
			if DataManager.settings.get("trail", true):
				trail_points.append(Vector2(float(body["x"]), float(body["y"])))
				while trail_points.size() > GameConstants.TRAIL_LENGTH:
					trail_points.remove_at(0)
			if bool(body["is_boosting"]):
				_spawn_exhaust_particle(body)

	_is_boosting_now = thrusting
	if thrusting:
		boost_time += GameConstants.TICK_INTERVAL
	if mode != GameConstants.MODE_MENU:
		elapsed_time += GameConstants.TICK_INTERVAL
	if mode == GameConstants.MODE_PLAY:
		_recalculate_zoom()
	_check_win_condition()
	_check_world_bounds()


func _load_level(level_data: Dictionary, level_index: int, category: String) -> void:
	current_level_index = level_index
	current_level_category = category
	current_level_is_custom = category == "custom"
	current_level_data = level_data.duplicate(true)
	current_level_name = String(level_data.get("name", "Untitled Orbit"))
	current_level_author = String(level_data.get("author", "Unknown"))
	level_goal = level_data.get("goal", {"index": 0, "range": GameConstants.GOAL_RANGE_DEFAULT}).duplicate(true)
	objects.clear()
	trail_points.clear()
	elapsed_time = 0.0
	boost_time = 0.0
	_accumulator = 0.0
	_first_boost_fired = false
	_is_boosting_now = false
	_particles.clear()

	var level_objects: Array = level_data.get("objects", [])
	for object_data in level_objects:
		objects.append(_create_runtime_object(object_data))

	if mode == GameConstants.MODE_MENU and not objects.is_empty():
		trail_points.clear()
	if mode == GameConstants.MODE_EDITOR:
		target_zoom_factor = 1.0
		zoom_factor = 1.0
	else:
		_recalculate_zoom()
		zoom_factor = target_zoom_factor


func _create_runtime_object(raw_data: Dictionary) -> Dictionary:
	var object_type := String(raw_data.get("type", "sun"))
	var x := float(raw_data.get("x", world_origin.x))
	var y := float(raw_data.get("y", world_origin.y))
	var x_vel := float(raw_data.get("x_vel", 0.0))
	var y_vel := float(raw_data.get("y_vel", 0.0))
	var gravity := float(raw_data.get("gravity", 0.0))
	var anchored := bool(raw_data.get("anchored", false))
	var boost_type: int
	if object_type == "player":
		boost_type = clampi(int(DataManager.settings.get("boost_type", 0)), 0, 3)
	else:
		boost_type = clampi(int(raw_data.get("boost_type", int(DataManager.settings.get("boost_type", 0)) + 1)) - 1, 0, 3)
	var default_size := 10.0
	if object_type == "sun":
		default_size = 18.0
	elif object_type == "player":
		default_size = 12.0
	var size := float(raw_data.get("size", default_size))
	return {
		"type": object_type,
		"x": x, "y": y,
		"x_vel": x_vel, "y_vel": y_vel,
		"x_acc": 0.0, "y_acc": 0.0,
		"gravity": gravity,
		"anchored": anchored,
		"visible": bool(raw_data.get("visible", true)),
		"size": size,
		"boost_type": boost_type,
		"turn_speed": randf_range(-3.0, -2.0),
		"angle": 0.0,
		"is_boosting": false,
		"start_x": x, "start_y": y,
		"start_x_vel": x_vel, "start_y_vel": y_vel
	}


func _sync_player_boost_type() -> void:
	var selected_boost_type := clampi(int(DataManager.settings.get("boost_type", 0)), 0, 3)
	for obj in objects:
		if String(obj.get("type", "")) == "player":
			obj["boost_type"] = selected_boost_type


func _reset_runtime_state() -> void:
	trail_points.clear()
	elapsed_time = 0.0
	boost_time = 0.0
	_bounds_warning_level = 0.0
	_bounds_warning_timer = 0.0
	_particles.clear()
	for obj in objects:
		obj["x"] = float(obj["start_x"])
		obj["y"] = float(obj["start_y"])
		obj["x_vel"] = 0.0 if bool(obj.get("anchored", false)) else float(obj["start_x_vel"])
		obj["y_vel"] = 0.0 if bool(obj.get("anchored", false)) else float(obj["start_y_vel"])
		obj["x_acc"] = 0.0
		obj["y_acc"] = 0.0
		obj["is_boosting"] = false


func _recalculate_zoom() -> void:
	var player := _get_player()
	if player.is_empty():
		target_zoom_factor = 1.0
		return
	var viewport_half := get_viewport_rect().size * 0.5 * GameConstants.ZOOM_MARGIN
	var x_dist: float = absf(float(player["x"]) - world_origin.x)
	var y_dist: float = absf(float(player["y"]) - world_origin.y)
	if x_dist <= viewport_half.x and y_dist <= viewport_half.y:
		target_zoom_factor = 1.0
	else:
		var zoom_x := viewport_half.x / x_dist if x_dist > 0.0 else 1.0
		var zoom_y := viewport_half.y / y_dist if y_dist > 0.0 else 1.0
		target_zoom_factor = minf(zoom_x, zoom_y)


func _check_win_condition() -> void:
	if mode != GameConstants.MODE_PLAY or objects.is_empty():
		return
	var player := _get_player()
	if player.is_empty():
		return
	var goal_index := int(level_goal.get("index", 0))
	if goal_index < 0 or goal_index >= objects.size():
		return
	var goal_object: Dictionary = objects[goal_index]
	var distance := Vector2(float(player["x"]), float(player["y"])).distance_to(Vector2(float(goal_object["x"]), float(goal_object["y"])))
	if distance <= float(level_goal.get("range", GameConstants.GOAL_RANGE_DEFAULT)):
		_trigger_shake(10.0, 28.0)
		level_completed.emit(current_level_index, current_level_category, elapsed_time, boost_time)


func _check_world_bounds() -> void:
	if mode != GameConstants.MODE_PLAY:
		_bounds_warning_level = 0.0
		_bounds_warning_timer = 0.0
		return
	var player := _get_player()
	if player.is_empty():
		_bounds_warning_level = 0.0
		_bounds_warning_timer = 0.0
		return
	var delta := Vector2(float(player["x"]) - world_origin.x, float(player["y"]) - world_origin.y)
	var x_ratio := absf(delta.x) / GameConstants.MAX_WORLD_BOUNDS.x
	var y_ratio := absf(delta.y) / GameConstants.MAX_WORLD_BOUNDS.y
	var ratio := maxf(x_ratio, y_ratio)
	if ratio >= GameConstants.BOUNDS_WARNING_START_RATIO:
		_bounds_warning_level = clampf((ratio - GameConstants.BOUNDS_WARNING_START_RATIO) / (1.0 - GameConstants.BOUNDS_WARNING_START_RATIO), 0.0, 1.0)
	else:
		_bounds_warning_level = 0.0
	if ratio > 1.0:
		if _bounds_warning_timer <= 0.0:
			_bounds_warning_timer = GameConstants.BOUNDS_WARNING_DURATION
	else:
		_bounds_warning_timer = 0.0


func _draw_background() -> void:
	var viewport := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, viewport), Color(0.02, 0.03, 0.07, 1.0), true)
	draw_rect(Rect2(Vector2.ZERO, viewport), Color(0.05, 0.11, 0.2, 0.22), true)

	var player := _get_player()
	var player_offset := Vector2.ZERO
	if not player.is_empty():
		player_offset = (Vector2(float(player["x"]), float(player["y"])) - world_origin) * zoom_factor

	for layer in _star_layers:
		var parallax := float(layer["parallax"])
		for star in layer["stars"]:
			var base_pos: Vector2 = star["position"]
			var draw_pos := base_pos - (player_offset * parallax)
			draw_pos.x = wrapf(draw_pos.x, -32.0, viewport.x + 32.0)
			draw_pos.y = wrapf(draw_pos.y, -32.0, viewport.y + 32.0)
			draw_circle(draw_pos, float(star["size"]), star["color"])

	for glow_index in range(3):
		var radius := lerpf(320.0, 820.0, float(glow_index) / 2.0)
		draw_circle(viewport * Vector2(0.18, 0.12), radius, Color(0.16, 0.5, 0.72, 0.04))
		draw_circle(viewport * Vector2(0.82, 0.24), radius * 0.7, Color(0.2, 0.35, 0.66, 0.03))


func _draw_predictions() -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	for point in _prediction_player:
		draw_circle(world_to_screen(point), max(1.25, 1.8 * zoom_factor), GameConstants.PREDICTION_PLAYER)
	for track in _prediction_planets:
		for point in track:
			draw_circle(world_to_screen(point), max(1.0, 1.5 * zoom_factor), GameConstants.PREDICTION_PLANET)


func _draw_trail() -> void:
	if mode == GameConstants.MODE_EDITOR and editor_overlay_requires_reset():
		return
	if not DataManager.settings.get("trail", true) or trail_points.size() < 2:
		return
	var packed := PackedVector2Array()
	for point in trail_points:
		packed.append(world_to_screen(point))
	draw_polyline(packed, GameConstants.TRAIL_COLOR, max(1.0, 2.0 * zoom_factor), true)


func _draw_goal_ring() -> void:
	var goal_index := int(level_goal.get("index", 0))
	if goal_index < 0 or goal_index >= objects.size():
		return
	var goal_object: Dictionary = objects[goal_index]
	var pulse := 1.0 + (sin(_goal_flash * 3.0) * 0.08)
	var center := world_to_screen(Vector2(float(goal_object["x"]), float(goal_object["y"])))
	var radius: float = float(level_goal.get("range", GameConstants.GOAL_RANGE_DEFAULT)) * zoom_factor * pulse
	draw_arc(center, radius, 0.0, TAU, 48, GameConstants.GOAL_COLOR, max(2.0, 3.0 * zoom_factor), true)
	draw_circle(center, radius * 0.14, Color(GameConstants.GOAL_COLOR.r, GameConstants.GOAL_COLOR.g, GameConstants.GOAL_COLOR.b, 0.2))


func _draw_bounds_warning() -> void:
	if _bounds_warning_timer <= 0.0 and _bounds_warning_level <= 0.0:
		return
	var viewport := get_viewport_rect().size
	var countdown_intensity := 0.0
	if _bounds_warning_timer > 0.0:
		var progress := clampf(_bounds_warning_timer / GameConstants.BOUNDS_WARNING_DURATION, 0.0, 1.0)
		countdown_intensity = 1.0 - progress
	var intensity := maxf(_bounds_warning_level, countdown_intensity)
	var pulse_speed := 2.0 + (intensity * 5.0)
	var pulse := 0.55 + 0.45 * sin(_goal_flash * pulse_speed)
	var alpha := 0.08 + (intensity * 0.36) + (pulse * 0.14 * intensity)
	var border_color := Color(1.0, 0.16, 0.12, clampf(alpha, 0.0, 0.78))
	var glow_color := Color(1.0, 0.12, 0.08, clampf(alpha * 0.52, 0.0, 0.36))
	draw_rect(Rect2(Vector2.ZERO, viewport), glow_color, false, GameConstants.BOUNDS_WARNING_BORDER * 2.0)
	draw_rect(Rect2(Vector2.ZERO, viewport), border_color, false, GameConstants.BOUNDS_WARNING_BORDER)


func _draw_reset_flash() -> void:
	if _reset_flash_timer <= 0.0:
		return
	var viewport := get_viewport_rect().size
	var progress := clampf(_reset_flash_timer / GameConstants.RESET_FLASH_DURATION, 0.0, 1.0)
	draw_rect(Rect2(Vector2.ZERO, viewport), Color(1.0, 0.08, 0.06, 0.42 * progress), true)


func _draw_objects() -> void:
	for index in range(objects.size()):
		var obj: Dictionary = objects[index]
		var object_type := String(obj["type"])
		var world_pos := Vector2(float(obj["x"]), float(obj["y"]))
		var screen_pos := world_to_screen(world_pos)
		match object_type:
			"sun":
				if bool(obj.get("visible", true)):
					var radius := float(obj["size"]) * zoom_factor
					draw_circle(screen_pos, radius * 3.0, GameConstants.SUN_HALO)
					draw_circle(screen_pos, radius * 1.8, Color(1.0, 0.78, 0.28, 0.28))
					draw_circle(screen_pos, radius, GameConstants.SUN_CORE)
			"planet":
				var planet_size: float = maxf(6.0, float(obj["size"]) * 2.3 * zoom_factor)
				draw_circle(screen_pos, planet_size * 0.82, Color(0.22, 0.5, 0.84, 0.18))
				if earth_texture != null:
					var texture_scale := Vector2.ONE * ((planet_size * 2.0) / earth_texture.get_size().x)
					draw_set_transform(screen_pos, float(obj["angle"]), texture_scale)
					draw_texture(earth_texture, -earth_texture.get_size() * 0.5)
					draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
			"player":
				var boost_index: int = clampi(int(obj["boost_type"]), 0, 3)
				var texture: Texture2D = rocket_boost_textures[boost_index] if bool(obj["is_boosting"]) else rocket_textures[boost_index]
				var scale_factor := GameConstants.ROCKET_SCALE * zoom_factor
				draw_circle(screen_pos, 44.0 * scale_factor, GameConstants.HUD_GLOW)
				if texture != null:
					draw_set_transform(screen_pos, float(obj["angle"]), Vector2.ONE * scale_factor)
					draw_texture(texture, -texture.get_size() * 0.5)
					draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

		if mode == GameConstants.MODE_EDITOR and index == level_editor.get_selected_index():
			draw_arc(screen_pos, max(18.0, 28.0 * zoom_factor), 0.0, TAU, 40, Color(1.0, 0.94, 0.58, 0.92), 2.0, true)


func _draw_particles() -> void:
	for particle in _particles:
		var life_ratio: float = clampf(float(particle["life"]) / float(particle["ttl"]), 0.0, 1.0)
		var alpha: float = life_ratio * 0.85
		draw_circle(world_to_screen(particle["position"]), max(1.0, 2.0 * zoom_factor * life_ratio), Color(1.0, 0.7, 0.36, alpha))


func _draw_force_vector() -> void:
	var player := _get_player()
	if player.is_empty():
		return
	var origin := world_to_screen(Vector2(float(player["x"]), float(player["y"])))
	var vector := Vector2(float(player["x_acc"]), float(player["y_acc"])) * 2200.0 * zoom_factor
	if vector.length() < 0.5:
		return
	var destination := origin + vector
	draw_line(origin, destination, Color(0.9, 0.98, 1.0, 0.75), max(1.0, 2.0 * zoom_factor), true)
	draw_circle(destination, 3.0, Color(0.9, 0.98, 1.0, 0.9))


func _build_starfield() -> void:
	_star_layers.clear()
	var viewport := get_viewport_rect().size
	for layer_index in range(3):
		var layer := {
			"parallax": 0.06 + (layer_index * 0.08),
			"stars": []
		}
		for star_index in range(46 + (layer_index * 18)):
			layer["stars"].append({
				"position": Vector2(randf_range(0.0, max(1600.0, viewport.x)), randf_range(0.0, max(900.0, viewport.y))),
				"size": randf_range(0.8 + layer_index, 1.8 + layer_index),
				"color": Color(0.72 + randf() * 0.28, 0.82 + randf() * 0.18, 1.0, 0.25 + layer_index * 0.14)
			})
		_star_layers.append(layer)


func _spawn_exhaust_particle(player: Dictionary) -> void:
	var direction := Vector2.UP.rotated(float(player["angle"]))
	var spawn_pos := Vector2(float(player["x"]), float(player["y"])) - (direction * 28.0)
	_particles.append({
		"position": spawn_pos,
		"velocity": -direction * randf_range(0.8, 1.7),
		"life": 0.28,
		"ttl": 0.28
	})


func _update_particles(delta: float) -> void:
	for particle in _particles:
		particle["life"] = float(particle["life"]) - delta
		particle["position"] = particle["position"] + (particle["velocity"] * delta * 60.0)
	while not _particles.is_empty() and float(_particles[0]["life"]) <= 0.0:
		_particles.remove_at(0)
	_particles = _particles.filter(func(particle: Dictionary) -> bool: return float(particle["life"]) > 0.0)


func _get_player() -> Dictionary:
	for obj in objects:
		if String(obj["type"]) == "player":
			return obj
	return {}


func _trigger_shake(amount: float, decay: float) -> void:
	shake_strength = max(shake_strength, amount)
	shake_decay = decay


func _level_label() -> String:
	match current_level_category:
		"tutorial":
			return "Tutorial"
		"custom":
			return "Custom"
		_:
			return "Stage %02d" % [current_level_index + 1]


func _hint_for_level() -> String:
	if current_level_category == "tutorial":
		return _tutorial_hint()
	if current_level_is_custom:
		return "Use the editor tools to place bodies, set velocity, and choose a goal."
	match current_level_name:
		"Orbital Primer":
			return "Press Space to accelerate into the blue planet's orbit."
		"Falling Star":
			return "Let gravity do the first half of the work, then brake if you dive in too hot."
		"Blue Transfer":
			return "Tap Shift to brake if you overcook the transfer."
		"Hidden Pull", "Dark Matter Lesson":
			return "Some suns are invisible. Trust the prediction line, or enable Trajectory Prediction in Settings."
		"Twin Arc":
			return "Twin gravity wells reward a gentle slingshot."
		_:
			return "Reach the glowing target with the least thrust you can manage."


func _tutorial_hint() -> String:
	var settings := DataManager.settings
	var boost_key := input_handler.control_key_label("boost", "Space", settings)
	var brake_key := input_handler.control_key_label("brake", "Shift", settings)
	var restart_key := input_handler.control_key_label("restart", "R", settings)
	var menu_key := input_handler.control_key_label("menu", "Escape", settings)

	if _bounds_warning_level > 0.3:
		return "WARNING: You are flying too far from the system! Steer back or the mission will auto-reset."

	var player := _get_player()
	if player.is_empty():
		return "Reach the glowing ring around the blue planet."

	var goal_index := int(level_goal.get("index", 0))
	if goal_index < 0 or goal_index >= objects.size():
		return "Hold %s to build speed, and press %s if you need a fresh attempt." % [boost_key, restart_key]

	var goal_object: Dictionary = objects[goal_index]
	var distance := Vector2(float(player["x"]), float(player["y"])).distance_to(Vector2(float(goal_object["x"]), float(goal_object["y"])))
	var speed := Vector2(float(player["x_vel"]), float(player["y_vel"])).length()

	if not _first_boost_fired:
		return "Hold %s to build speed, then arc around the sun toward the blue target ring. Flying too far out will auto-reset the level." % [boost_key]
	if distance > float(level_goal.get("range", GameConstants.GOAL_RANGE_DEFAULT)) * 2.2:
		return "Coast through the curve and tap %s if your approach feels too fast." % [brake_key]
	if speed > 2.4:
		return "You are lined up. Feather %s to settle into the ring." % [brake_key]
	return "Ease into the glowing ring. Press %s to retry or %s to open the menu." % [restart_key, menu_key]


func _load_texture_from_image(path: String) -> Texture2D:
	return load(path) as Texture2D
