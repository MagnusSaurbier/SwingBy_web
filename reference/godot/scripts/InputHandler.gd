extends Node
class_name InputHandler

signal restart_requested
signal pause_requested
signal menu_requested
signal quick_toggle(setting_name: String, value: bool)
signal control_rebound(action_name: String, keycode: int)
signal rebind_cancelled

var touch_direction := Vector2.ZERO
var touch_boost := false
var touch_brake := false
var awaiting_control_action := ""


func set_touch_state(direction: Vector2, boost: bool, brake: bool) -> void:
	touch_direction = direction
	touch_boost = boost
	touch_brake = brake


func is_action_pressed(action_name: String, settings: Dictionary) -> bool:
	var controls: Dictionary = settings.get("controls", {})
	var keycode := int(controls.get(action_name, KEY_NONE))
	return keycode != KEY_NONE and Input.is_key_pressed(keycode)


func matches_action_keycode(keycode: int, action_name: String, settings: Dictionary) -> bool:
	var controls: Dictionary = settings.get("controls", {})
	return keycode == int(controls.get(action_name, KEY_NONE))


func control_key_label(action_name: String, fallback: String, settings: Dictionary) -> String:
	var controls: Dictionary = settings.get("controls", {})
	var keycode := int(controls.get(action_name, KEY_NONE))
	if keycode == KEY_NONE:
		return fallback
	var key_label := OS.get_keycode_string(keycode)
	return fallback if key_label.is_empty() else key_label


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo):
		return
	var key_event := event as InputEventKey
	if not awaiting_control_action.is_empty():
		_handle_rebind(key_event)
		get_viewport().set_input_as_handled()
		return
	_handle_game_keys(key_event)


func _handle_game_keys(key_event: InputEventKey) -> void:
	var settings: Dictionary = DataManager.settings
	var gw := get_parent() as GameWorld
	if gw == null:
		return
	var mode := gw.mode

	if matches_action_keycode(key_event.keycode, "restart", settings):
		if mode == GameConstants.MODE_PLAY or mode == GameConstants.MODE_EDITOR:
			restart_requested.emit()
			get_viewport().set_input_as_handled()
	elif matches_action_keycode(key_event.keycode, "pause", settings):
		if mode == GameConstants.MODE_PLAY or mode == GameConstants.MODE_EDITOR:
			pause_requested.emit()
			get_viewport().set_input_as_handled()
	elif matches_action_keycode(key_event.keycode, "menu", settings):
		if mode == GameConstants.MODE_PLAY or mode == GameConstants.MODE_EDITOR:
			menu_requested.emit()
			get_viewport().set_input_as_handled()
	elif matches_action_keycode(key_event.keycode, "toggle_fps", settings):
		var next_val := not bool(settings.get("show_fps", true))
		quick_toggle.emit("show_fps", next_val)
		get_viewport().set_input_as_handled()
	elif matches_action_keycode(key_event.keycode, "toggle_highscores", settings):
		var next_val := not bool(settings.get("show_highscores", true))
		quick_toggle.emit("show_highscores", next_val)
		get_viewport().set_input_as_handled()


func _handle_rebind(key_event: InputEventKey) -> void:
	if key_event.keycode == KEY_ESCAPE:
		awaiting_control_action = ""
		rebind_cancelled.emit()
		return
	var action := awaiting_control_action
	awaiting_control_action = ""
	control_rebound.emit(action, key_event.keycode)
