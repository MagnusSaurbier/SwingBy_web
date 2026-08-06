extends Node
class_name LevelEditor

var _tool := "place"
var _object_type := "planet"
var _selected_index := -1
var _dragging := false
var _drag_world := Vector2.ZERO
var _hover_index := -1
var _phantom_type := ""
var _phantom_pos := Vector2.ZERO
var _button_drag_active := false

# Phantom placement state machine
# "idle"        → no phantom active
# "wait_press"  → phantom active, waiting for user to press mouse (click-to-place mode)
# "holding"     → mouse held down, counting time toward 0.5s drag threshold
var _phantom_state := "idle"
var _phantom_hold_time := 0.0
const PHANTOM_DRAG_THRESHOLD := 0.5

var _hovered_button := ""  # "" | "move" | "velocity" | "size" | "delete"
var _specs_open := false  # object spec panel (HUD) visible after click in hover ring
const BTN_RADIUS    := 16.0
const BTN_SPACING   := 44.0
const BTN_HIT_PAD   := 4.0  # extra screen px so side buttons stay "hovered" while aiming
const SIZE_TO_GRAVITY_SCALE := 1000.0 / (18.0 * 18.0 * 18.0)  # size=18 → gravity=1000
# Size (radius) drag: r = r_at_grab + sens * (d_now - d_grab); sens dulls pointer motion
const SIZE_DRAG_SENSITIVITY := 0.1
const WEIGHT_BUTTON_DISTANCE_SCALE := 0.5  # rim offset & hover ring vs sz/sens
var _size_drag_grab_dist := -1.0  # world units; <0 = not in a size drag
var _size_drag_start_size := 0.0
# handle_drag stores vel as (world_delta) * 0.01, so world_delta = vel * 100
const VEL_DISPLAY_SCALE := 100.0
const BG_PAN_THRESHOLD_PX := 5.0

# Background pan: left-drag on empty canvas moves world_origin (placement deferred to release if not panning)
var _bg_pan_captured := false
var _bg_panning := false
var _bg_pan_start_screen := Vector2.ZERO
var _bg_pan_last_screen := Vector2.ZERO


func _editor_manipulation_gated(gw: GameWorld) -> bool:
	return gw.editor_overlay_requires_reset()


func _reset_size_drag_state() -> void:
	_size_drag_grab_dist = -1.0


func _ready() -> void:
	set_process(true)


func enter_editor_mode() -> void:
	_selected_index = -1
	_dragging = false
	_reset_size_drag_state()
	_phantom_type = ""
	_hover_index = -1
	_hovered_button = ""
	_specs_open = false
	_button_drag_active = false
	_phantom_state = "idle"
	_phantom_hold_time = 0.0
	_bg_pan_captured = false
	_bg_panning = false


func set_tool(tool_name: String) -> void:
	_tool = tool_name
	_phantom_type = ""
	_phantom_state = "idle"
	if tool_name == "place":
		_selected_index = -1


func set_object_type(object_type: String) -> void:
	_object_type = object_type


func start_phantom(object_type: String) -> void:
	_phantom_type = object_type
	_selected_index = -1
	_button_drag_active = true
	_phantom_hold_time = 0.0
	# button_down fires while the mouse is still held, so start in "holding".
	_phantom_state = "holding"


func cancel_phantom() -> void:
	_phantom_type = ""
	_button_drag_active = false
	_phantom_state = "idle"
	_phantom_hold_time = 0.0


func _process(delta: float) -> void:
	var game_world := get_parent() as GameWorld
	if game_world == null or game_world.mode != GameConstants.MODE_EDITOR:
		return

	var viewport := get_viewport()
	if viewport == null:
		return

	var mouse_screen := viewport.get_mouse_position()
	var mouse_world  := game_world.screen_to_world(mouse_screen)

	# ── Background pan (left drag on empty space) ─────────────────────
	if _bg_pan_captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		if mouse_screen.distance_to(_bg_pan_start_screen) > BG_PAN_THRESHOLD_PX:
			_bg_panning = true
		if _bg_panning:
			var d_screen := mouse_screen - _bg_pan_last_screen
			_bg_pan_last_screen = mouse_screen
			if d_screen != Vector2.ZERO:
				game_world.editor_apply_pan_screen_delta(d_screen)

	# ── Drag polling (bypass GUI event consumption) ──────────────────
	if _dragging:
		if _editor_manipulation_gated(game_world):
			_dragging = false
			_reset_size_drag_state()
			_sync_selected_start_state(game_world)
			game_world.editor_selection_changed.emit()
		else:
			_drag_world = mouse_world
			handle_drag(mouse_world, game_world)
			if not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
				_dragging = false
				_reset_size_drag_state()
				_sync_selected_start_state(game_world)
				game_world.editor_selection_changed.emit()

	# ── Hover state (always, every frame) ────────────────────────────
	if not _dragging:
		_hover_index    = pick_object_index(mouse_world, game_world, mouse_screen)
		_hovered_button = _get_hovered_button_screen(mouse_screen, game_world)

	# ── Phantom placement state machine ──────────────────────────────
	if _phantom_type.is_empty() or not _button_drag_active:
		return

	_phantom_pos = mouse_world

	var mouse_held := Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)

	match _phantom_state:
		"holding":
			_phantom_hold_time += delta
			if not mouse_held:
				if _phantom_hold_time >= PHANTOM_DRAG_THRESHOLD:
					_do_place(game_world)
				else:
					_phantom_state = "wait_press"
		"wait_press":
			if mouse_held:
				_do_place(game_world)

	if Input.is_action_just_pressed("ui_cancel"):
		cancel_phantom()


func _do_place(game_world: GameWorld) -> void:
	_object_type = _phantom_type
	_phantom_type = ""
	_button_drag_active = false
	_phantom_state = "idle"
	_phantom_hold_time = 0.0
	place_object(_phantom_pos, game_world)
	_selected_index = game_world.objects.size() - 1
	game_world.editor_selection_changed.emit()


func get_tool() -> String:
	return _tool


func get_object_type() -> String:
	return _object_type


func get_phantom_type() -> String:
	return _phantom_type


func get_selected_index() -> int:
	return _selected_index


func get_hover_index() -> int:
	return _hover_index


func get_specs_open() -> bool:
	return _specs_open


func get_phantom_pos() -> Vector2:
	return _phantom_pos


func is_dragging() -> bool:
	return _dragging


func get_drag_world() -> Vector2:
	return _drag_world


# ──────────────────────────────────────────────
# Contextual button helpers
# ──────────────────────────────────────────────

func _hover_ring_radius_px_for_obj(obj: Dictionary, index: int, gw: GameWorld) -> float:
	var center_screen := gw.world_to_screen(Vector2(float(obj["x"]), float(obj["y"])))
	var max_d := WEIGHT_BUTTON_DISTANCE_SCALE * maxf(
			maxf(18.0, 28.0 * gw.zoom_factor), float(BTN_SPACING) + BTN_RADIUS + 10.0)
	for btn_name: String in _contextual_circle_button_names(obj):
		var pos := _button_screen_pos(btn_name, obj, index, gw)
		max_d = maxf(max_d, center_screen.distance_to(pos) + BTN_RADIUS + 10.0)
	return max_d


func _contextual_circle_button_names(obj: Dictionary) -> Array[String]:
	var names: Array[String]
	if String(obj.get("type", "")) == "sun":
		names = ["move", "size"] as Array[String]
	else:
		names = ["move", "velocity", "size"] as Array[String]
	names.append("delete")
	return names


func _button_screen_pos(btn_name: String, obj: Dictionary, index: int, gw: GameWorld) -> Vector2:
	var center_world := Vector2(float(obj["x"]), float(obj["y"]))
	var center_screen := gw.world_to_screen(center_world)
	match btn_name:
		"move":
			return center_screen
		"size":
			var sz := maxf(4.0, float(obj.get("size", 8.0)))
			var rim_radius := WEIGHT_BUTTON_DISTANCE_SCALE * sz / SIZE_DRAG_SENSITIVITY
			var rim_world := center_world + Vector2(-rim_radius, 0.0)
			return gw.world_to_screen(rim_world)
		"velocity":
			if String(obj.get("type", "")) == "sun":
				return center_screen
			var start_world := Vector2(float(obj["start_x"]), float(obj["start_y"]))
			var vx := float(obj.get("start_x_vel", 0.0))
			var vy := float(obj.get("start_y_vel", 0.0))
			var is_active := _dragging and _selected_index == index and _tool == "velocity"
			if is_active:
				return gw.world_to_screen(_drag_world)
			if vx == 0.0 and vy == 0.0:
				return center_screen + Vector2(BTN_SPACING, 0.0)
			return gw.world_to_screen(start_world + Vector2(vx, vy) * VEL_DISPLAY_SCALE)
		"delete":
			return center_screen + Vector2(0.0, BTN_SPACING)
	return center_screen


func _get_hovered_button_screen(mouse_screen: Vector2, gw: GameWorld) -> String:
	if _hover_index < 0 or _hover_index >= gw.objects.size():
		return ""
	var obj: Dictionary = gw.objects[_hover_index]
	var hit_r := BTN_RADIUS + BTN_HIT_PAD
	for btn_name: String in _contextual_circle_button_names(obj):
		if mouse_screen.distance_to(_button_screen_pos(btn_name, obj, _hover_index, gw)) <= hit_r:
			return btn_name
	return ""


func _editor_wheel_zoom_suppressed(gw: GameWorld, screen_pos: Vector2) -> bool:
	var cb := gw.editor_wheel_zoom_suppressed_at
	return cb.is_valid() and bool(cb.call(screen_pos))


func handle_mouse_event(event: InputEvent, gw: GameWorld) -> void:
	if event is InputEventMouseButton:
		var mouse_button := event as InputEventMouseButton

		if mouse_button.button_index == MOUSE_BUTTON_WHEEL_UP:
			if mouse_button.pressed and not _editor_wheel_zoom_suppressed(gw, mouse_button.position):
				gw.editor_zoom_at_screen(1, mouse_button.position)
			return
		if mouse_button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if mouse_button.pressed and not _editor_wheel_zoom_suppressed(gw, mouse_button.position):
				gw.editor_zoom_at_screen(-1, mouse_button.position)
			return

		if mouse_button.button_index == MOUSE_BUTTON_LEFT:
			if mouse_button.pressed:
				if not _button_drag_active:
					var world_pos := gw.screen_to_world(mouse_button.position)
					var screen_pos := mouse_button.position
					_hover_index = pick_object_index(world_pos, gw, screen_pos)
					var btn := _get_hovered_button_screen(screen_pos, gw)
					if _phantom_type.is_empty() and btn == "" and _hover_index < 0:
						_bg_pan_captured = true
						_bg_panning = false
						_bg_pan_start_screen = screen_pos
						_bg_pan_last_screen = screen_pos
						return
					handle_left_press(world_pos, screen_pos, gw)
					gw.editor_selection_changed.emit()
			else:
				if not _button_drag_active and _dragging:
					_dragging = false
					_reset_size_drag_state()
					_sync_selected_start_state(gw)

				if _bg_pan_captured:
					if not _bg_panning:
						var release_world := gw.screen_to_world(mouse_button.position)
						handle_left_press(release_world, mouse_button.position, gw)
						gw.editor_selection_changed.emit()
					_bg_pan_captured = false
					_bg_panning = false

		elif mouse_button.button_index == MOUSE_BUTTON_RIGHT and mouse_button.pressed:
			_bg_pan_captured = false
			_bg_panning = false
			_phantom_type = ""
			_button_drag_active = false
			var world_pos := gw.screen_to_world(mouse_button.position)
			var right_hit := pick_object_index(world_pos, gw, mouse_button.position)
			_selected_index = right_hit if right_hit >= 0 else -1
			gw.editor_selection_changed.emit()

	if event is InputEventMouseMotion:
		var motion_event  := event as InputEventMouseMotion
		var motion_screen := motion_event.position
		var motion_world  := gw.screen_to_world(motion_screen)
		_hover_index    = pick_object_index(motion_world, gw, motion_screen)
		_hovered_button = _get_hovered_button_screen(motion_screen, gw)
		if _dragging:
			_drag_world = motion_world
			handle_drag(motion_world, gw)


func handle_left_press(world_pos: Vector2, mouse_screen: Vector2, gw: GameWorld) -> void:
	_drag_world = world_pos
	_hover_index = pick_object_index(world_pos, gw, mouse_screen)

	var btn := _get_hovered_button_screen(mouse_screen, gw)
	if gw.editor_overlay_requires_reset():
		if _hover_index >= 0:
			gw.restart_level()
			return
	if _editor_manipulation_gated(gw):
		if btn != "":
			return
		match _tool:
			"place":
				if _hover_index < 0:
					place_object(world_pos, gw)
				return
			"goal":
				return
			"move", "velocity", "gravity", "size":
				return
			_:
				return

	# Contextual overlay buttons take priority over everything else.
	if btn != "":
		if btn == "delete":
			gw.editor_remove_object_at(_hover_index)
			return
		_selected_index = _hover_index
		_tool = btn
		_dragging = true
		handle_drag(world_pos, gw)
		return

	# Click in hover ring (no contextual tool button): select object, open spec panel, no canvas drag.
	if _hover_index >= 0 and _hover_index < gw.objects.size():
		_selected_index = _hover_index
		_specs_open = true
		gw.editor_selection_changed.emit()
		return

	_specs_open = false
	gw.editor_selection_changed.emit()

	match _tool:
		"place":
			if _hover_index >= 0:
				_selected_index = _hover_index
				_dragging = true
				handle_drag(world_pos, gw)
			else:
				place_object(world_pos, gw)
		"goal":
			if _hover_index >= 0:
				gw.level_goal["index"] = _hover_index
		"move", "velocity", "gravity", "size":
			_selected_index = _hover_index
			if _selected_index >= 0:
				_dragging = true
				handle_drag(world_pos, gw)


func handle_drag(world_pos: Vector2, gw: GameWorld) -> void:
	if _editor_manipulation_gated(gw):
		return
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	match _tool:
		"place", "move":
			obj["x"] = world_pos.x
			obj["y"] = world_pos.y
			obj["start_x"] = world_pos.x
			obj["start_y"] = world_pos.y
		"velocity":
			if String(obj["type"]) != "sun":
				var delta := world_pos - Vector2(float(obj["start_x"]), float(obj["start_y"]))
				obj["x_vel"] = delta.x * 0.01
				obj["y_vel"] = delta.y * 0.01
				obj["start_x_vel"] = obj["x_vel"]
				obj["start_y_vel"] = obj["y_vel"]
		"gravity":
			obj["gravity"] = Vector2(float(obj["start_x"]), float(obj["start_y"])).distance_to(world_pos) * 10.0
		"size":
			var obj_pos := Vector2(float(obj["start_x"]), float(obj["start_y"]))
			var d_now := obj_pos.distance_to(world_pos)
			if _size_drag_grab_dist < 0.0:
				_size_drag_grab_dist = d_now
				_size_drag_start_size = float(obj.get("size", 8.0))
			var new_size := clampf(
					_size_drag_start_size + SIZE_DRAG_SENSITIVITY * (d_now - _size_drag_grab_dist),
					4.0, 40.0)
			obj["size"] = new_size
			obj["gravity"] = new_size * new_size * new_size * SIZE_TO_GRAVITY_SCALE


func place_object(world_pos: Vector2, gw: GameWorld) -> void:
	var new_object := {}
	match _object_type:
		"player":
			new_object = gw._create_runtime_object({
				"type": "player",
				"x": world_pos.x,
				"y": world_pos.y,
				"boost_type": int(DataManager.settings.get("boost_type", 0)) + 1,
				"x_vel": 0.0,
				"y_vel": 0.0,
				"gravity": 0.0
			})
			_tool = "velocity"
		"planet":
			new_object = gw._create_runtime_object({
				"type": "planet",
				"x": world_pos.x,
				"y": world_pos.y,
				"x_vel": 0.0,
				"y_vel": 0.0,
				"gravity": 0.0
			})
			_tool = "velocity"
		"sun":
			new_object = gw._create_runtime_object({
				"type": "sun",
				"x": world_pos.x,
				"y": world_pos.y,
				"gravity": 1000.0,
				"visible": true,
				"size": 18.0
			})
			_tool = "gravity"
	gw.objects.append(new_object)
	_selected_index = gw.objects.size() - 1
	gw.level_goal["index"] = clamp(int(gw.level_goal.get("index", 0)), 0, gw.objects.size() - 1)
	gw._reset_runtime_state()


func pick_object_index(world_pos: Vector2, gw: GameWorld, mouse_screen: Vector2) -> int:
	var hit_r := BTN_RADIUS + BTN_HIT_PAD
	# Prefer screen-space hits on contextual buttons (same stacking order as bodies).
	for index in range(gw.objects.size() - 1, -1, -1):
		var obj: Dictionary = gw.objects[index]
		for btn_name: String in _contextual_circle_button_names(obj):
			if mouse_screen.distance_to(_button_screen_pos(btn_name, obj, index, gw)) <= hit_r:
				return index
	for index in range(gw.objects.size() - 1, -1, -1):
		var obj2: Dictionary = gw.objects[index]
		var obj_scr2 := gw.world_to_screen(Vector2(float(obj2["x"]), float(obj2["y"])))
		var ring_px := _hover_ring_radius_px_for_obj(obj2, index, gw)
		if mouse_screen.distance_to(obj_scr2) <= ring_px + BTN_HIT_PAD:
			return index
	return -1


func get_selected_info(gw: GameWorld) -> Dictionary:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return {}
	var obj: Dictionary = gw.objects[_selected_index]
	return {
		"type": String(obj.get("type", "")),
		"gravity": float(obj.get("gravity", 0.0)),
		"size": float(obj.get("size", 8.0)),
		"visible": bool(obj.get("visible", true)),
		"anchored": bool(obj.get("anchored", false)),
		"x_vel": float(obj.get("x_vel", 0.0)),
		"y_vel": float(obj.get("y_vel", 0.0)),
	}


func set_selected_size(delta: int, gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	obj["size"] = clamp(float(obj.get("size", 8.0)) + float(delta), 4.0, 30.0)
	_sync_selected_start_state(gw)
	gw._reset_runtime_state()


func set_selected_visible(value: bool, gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	if String(obj.get("type", "")) == "sun":
		obj["visible"] = value
		_sync_selected_start_state(gw)


func set_selected_as_goal(gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	gw.level_goal["index"] = _selected_index


func set_selected_anchored(value: bool, gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	if String(obj.get("type", "")) == "planet":
		obj["anchored"] = value
		_sync_selected_start_state(gw)
		gw._reset_runtime_state()


func set_selected_vel(vx: float, vy: float, gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	if String(obj.get("type", "")) == "sun":
		return
	obj["x_vel"] = vx
	obj["start_x_vel"] = vx
	obj["y_vel"] = vy
	obj["start_y_vel"] = vy
	gw._reset_runtime_state()


func set_selected_gravity_value(v: float, gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	obj["gravity"] = maxf(0.0, v)


func _sync_selected_start_state(gw: GameWorld) -> void:
	if _selected_index < 0 or _selected_index >= gw.objects.size():
		return
	var obj: Dictionary = gw.objects[_selected_index]
	obj["start_x"] = float(obj["x"])
	obj["start_y"] = float(obj["y"])
	obj["start_x_vel"] = float(obj["x_vel"])
	obj["start_y_vel"] = float(obj["y_vel"])


func draw_editor_overlay(gw: GameWorld) -> void:
	# ── Hover highlight ring + locked hint per object ─────────────────
	if _hover_index >= 0 and _hover_index < gw.objects.size() and _phantom_type.is_empty():
		var hobj: Dictionary = gw.objects[_hover_index]
		var hscreen := gw.world_to_screen(Vector2(float(hobj["x"]), float(hobj["y"])))
		if not gw.editor_overlay_requires_reset():
			var ring_px := _hover_ring_radius_px_for_obj(hobj, _hover_index, gw)
			gw.draw_arc(hscreen, ring_px,
					0.0, TAU, 40, Color(0.72, 0.94, 1.0, 0.35), 2.0, true)
		if _editor_manipulation_gated(gw):
			var hint := "reset stage"
			var font := ThemeDB.fallback_font
			var fs := 14
			var sz := font.get_string_size(hint, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
			var hint_pos := hscreen + Vector2(-sz.x * 0.5, -44.0)
			gw.draw_string(font, hint_pos, hint, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
					Color(0.96, 0.82, 0.48, 0.96))

	# ── Velocity arrows (from start positions / start velocities; active drag uses live endpoint) ──
	if not gw.editor_overlay_requires_reset():
		for i: int in range(gw.objects.size()):
			var obj: Dictionary = gw.objects[i]
			var obj_type := String(obj["type"])
			if obj_type == "sun":
				continue
			var vx := float(obj["start_x_vel"])
			var vy := float(obj["start_y_vel"])
			var is_active_vel := _dragging and _selected_index == i and _tool == "velocity"
			if vx == 0.0 and vy == 0.0 and not is_active_vel:
				continue
			var start_world := Vector2(float(obj["start_x"]), float(obj["start_y"]))
			var obj_scr := gw.world_to_screen(start_world)
			var vel_end: Vector2
			if is_active_vel:
				vel_end = gw.world_to_screen(_drag_world)
			else:
				vel_end = gw.world_to_screen(start_world + Vector2(vx, vy) * VEL_DISPLAY_SCALE)
			var vcol: Color
			if is_active_vel:
				vcol = Color(1.0, 1.0, 1.0, 0.95)
			elif obj_type == "player":
				vcol = Color(0.98, 0.38, 0.38, 0.80)
			else:
				vcol = Color(0.38, 0.65, 0.98, 0.80)
			gw.draw_line(obj_scr, vel_end, vcol, maxf(1.5, 2.0 * gw.zoom_factor), true)
			gw.draw_circle(vel_end, maxf(3.0, 4.5 * gw.zoom_factor), vcol)

	# ── Gravity influence rings ───────────────────────
	for obj: Dictionary in gw.objects:
		var g := float(obj.get("gravity", 0.0))
		if g <= 0.0:
			continue
		var obj_scr   := gw.world_to_screen(Vector2(float(obj["x"]), float(obj["y"])))
		var vis_radius := sqrt(g) * gw.zoom_factor * 2.2
		gw.draw_arc(obj_scr, vis_radius, 0.0, TAU, 48,
				Color(1.0, 0.82, 0.38, 0.22), maxf(1.0, 1.5 * gw.zoom_factor), true)

	# ── Active drag guide ─────────────────────────────
	if _dragging and _selected_index >= 0 and _selected_index < gw.objects.size():
		var sel: Dictionary = gw.objects[_selected_index]
		var center := gw.world_to_screen(Vector2(float(sel["x"]), float(sel["y"])))
		match _tool:
			"gravity":
				var radius: float = Vector2(float(sel["start_x"]), float(sel["start_y"])) \
						.distance_to(_drag_world) * gw.zoom_factor
				gw.draw_arc(center, radius, 0.0, TAU, 48,
						Color(0.98, 0.78, 0.42, 0.9), 2.0, true)
			"size":
				var sz := float(sel.get("size", 10.0))
				gw.draw_arc(center, sz * gw.zoom_factor, 0.0, TAU, 40,
						Color(0.72, 0.94, 1.0, 0.85), 2.5, true)
			_:
				pass

	# ── Contextual buttons (only after R / Reset Preview unlocks editing) ──
	if _hover_index >= 0 and _hover_index < gw.objects.size() \
			and _phantom_type.is_empty() and not _dragging and not _editor_manipulation_gated(gw):
		_draw_contextual_buttons(gw)

	# ── Phantom ghost ─────────────────────────────────
	if not _phantom_type.is_empty():
		var ghost := gw.world_to_screen(_phantom_pos)
		match _phantom_type:
			"planet":
				gw.draw_circle(ghost, maxf(6.0, 10.0 * gw.zoom_factor), Color(0.22, 0.5,  0.84, 0.30))
				gw.draw_arc(ghost,    maxf(6.0, 10.0 * gw.zoom_factor), 0.0, TAU, 32,
						Color(0.72, 0.94, 1.0, 0.65), 2.0, true)
			"sun":
				gw.draw_circle(ghost, maxf(8.0, 18.0 * gw.zoom_factor), Color(1.0, 0.85, 0.45, 0.22))
				gw.draw_arc(ghost,    maxf(8.0, 18.0 * gw.zoom_factor), 0.0, TAU, 32,
						Color(1.0, 0.85, 0.45, 0.65), 2.0, true)
			"player":
				gw.draw_circle(ghost, maxf(8.0, 14.0 * gw.zoom_factor), Color(0.72, 0.93, 1.0, 0.22))
				gw.draw_arc(ghost,    maxf(8.0, 14.0 * gw.zoom_factor), 0.0, TAU, 32,
						Color(0.72, 0.93, 1.0, 0.65), 2.0, true)


# ── Contextual button drawing ─────────────────
func _draw_contextual_buttons(gw: GameWorld) -> void:
	var obj: Dictionary = gw.objects[_hover_index]
	for btn_name: String in _contextual_circle_button_names(obj):
		var btn_pos   := _button_screen_pos(btn_name, obj, _hover_index, gw)
		var is_hov    := _hovered_button == btn_name
		var col       := Color(0.92, 0.98, 1.0, 0.95) if is_hov else Color(0.65, 0.82, 1.0, 0.65)
		var bg_alpha  := 0.90 if is_hov else 0.72
		gw.draw_circle(btn_pos, BTN_RADIUS, Color(0.06, 0.09, 0.17, bg_alpha))
		gw.draw_arc(btn_pos, BTN_RADIUS, 0.0, TAU, 32, col,
				1.8 if is_hov else 1.1, true)
		match btn_name:
			"move":     _draw_icon_move(gw, btn_pos, col)
			"velocity": _draw_icon_velocity(gw, btn_pos, col)
			"size":     _draw_icon_size(gw, btn_pos, col)
			"delete":   _draw_icon_trash(gw, btn_pos, col)


func _draw_icon_move(gw: GameWorld, pos: Vector2, col: Color) -> void:
	var s  := 7.0
	var ah := 2.8
	for dir: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		var tip  := pos + dir * s
		var base := tip - dir * (ah * 1.5)
		var perp := Vector2(-dir.y, dir.x) * ah
		gw.draw_line(pos, base, col, 1.5, true)
		gw.draw_colored_polygon(
				PackedVector2Array([tip, base + perp, base - perp]), col)


func _draw_icon_velocity(gw: GameWorld, pos: Vector2, col: Color) -> void:
	var s  := 6.5
	var ah := 3.0
	var l  := pos - Vector2(s * 0.55, 0.0)
	var tip := pos + Vector2(s * 0.55, 0.0)
	gw.draw_line(l, tip, col, 1.5, true)
	gw.draw_colored_polygon(
			PackedVector2Array([tip + Vector2(ah, 0.0), tip - Vector2(ah * 0.5, ah),
					tip - Vector2(ah * 0.5, -ah)]), col)


func _draw_icon_size(gw: GameWorld, pos: Vector2, col: Color) -> void:
	gw.draw_arc(pos, 3.0, 0.0, TAU, 16, col, 1.5, true)
	var ah := 2.2
	for dir: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		var inner := pos + dir * 4.0
		var tip   := pos + dir * 7.5
		var perp  := Vector2(-dir.y, dir.x) * ah * 0.75
		gw.draw_line(inner, tip - dir * (ah * 0.8), col, 1.0, true)
		gw.draw_colored_polygon(
				PackedVector2Array([tip, tip - dir * (ah * 1.5) + perp,
						tip - dir * (ah * 1.5) - perp]), col)


func _draw_icon_trash(gw: GameWorld, pos: Vector2, col: Color) -> void:
	var s := 5.0
	gw.draw_line(pos + Vector2(-s, -s), pos + Vector2(s, -s), col, 1.5, true)
	gw.draw_line(pos + Vector2(-s, -s), pos + Vector2(-s + 1.0, s), col, 1.5, true)
	gw.draw_line(pos + Vector2(s, -s), pos + Vector2(s - 1.0, s), col, 1.5, true)
	gw.draw_line(pos + Vector2(-s + 1.0, s), pos + Vector2(s - 1.0, s), col, 1.5, true)
