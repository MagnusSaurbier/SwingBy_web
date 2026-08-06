extends Node
class_name HUDController

var hud_root: Control
var hud_title_panel: PanelContainer
var hud_stats_panel: PanelContainer
var hud_time_panel: PanelContainer
var hud_boost_panel: PanelContainer
var hud_hint_panel: PanelContainer
var hud_level_name_edit: LineEdit
var hud_author_label: Label
var hud_timer_label: Label
var hud_boost_label: Label
var hud_stats_label: Label
var hud_hint_label: Label
var hud_pause_label: Label
var toast_label: Label
var ingame_menu_panel: Control = null
var ingame_level_name_label: Label = null
var ingame_panel_inner: PanelContainer = null

var editor_place_panel: PanelContainer
var editor_specs_panel: PanelContainer
var editor_actions_bar: PanelContainer
var editor_object_buttons: Dictionary = {}
var editor_action_buttons: Dictionary = {}
var editor_selected_section: Control = null
var editor_selected_label: Label = null
var editor_size_value_label: Label = null
var editor_visible_row: Control = null
var editor_visible_btn: CheckButton = null
var editor_anchored_row: Control = null
var editor_anchored_btn: CheckButton = null
var editor_vx_edit: LineEdit = null
var editor_vy_edit: LineEdit = null
var editor_grav_edit: LineEdit = null

var settings_toggles: Dictionary = {}
var control_buttons: Dictionary = {}
var control_status_label: Label
var workshop_preview: TextureRect
var workshop_title: Label
var workshop_buttons: Array = []
var level_grid_builtin: GridContainer
var level_grid_custom: GridContainer
var menu_username_edit: LineEdit

var _current_screen := "menu"
var _toast_timer := 0.0


func _process(delta: float) -> void:
	if _toast_timer > 0.0:
		_toast_timer = max(0.0, _toast_timer - delta)
		if _toast_timer <= 0.0:
			toast_label.visible = false
			toast_label.modulate.a = 1.0


func set_current_screen(screen_name: String) -> void:
	var entering_game := (screen_name == "play" or screen_name == "editor") and _current_screen != "play" and _current_screen != "editor"
	_current_screen = screen_name
	if entering_game and hud_root != null:
		hud_root.modulate.a = 0.0
		hud_root.create_tween().tween_property(hud_root, "modulate:a", 1.0, 0.4).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)


func show_toast(message: String) -> void:
	toast_label.text = message
	toast_label.visible = true
	toast_label.modulate.a = 1.0
	toast_label.position = Vector2(0.0, 4.0)
	_toast_timer = 1.9
	var tw := toast_label.create_tween()
	tw.tween_property(toast_label, "position:y", 28.0, 0.2).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	tw.tween_interval(1.3)
	tw.tween_property(toast_label, "modulate:a", 0.0, 0.4).set_ease(Tween.EASE_IN)


func update_hud(world: GameWorld) -> void:
	hud_root.visible = _current_screen == "play" or _current_screen == "editor"
	var ed := _current_screen == "editor"
	if editor_place_panel != null:
		editor_place_panel.visible = ed
	if editor_specs_panel != null and not ed:
		editor_specs_panel.visible = false
	if editor_actions_bar != null:
		editor_actions_bar.visible = ed
	if not hud_root.visible:
		return

	var status := world.get_status()
	var prefix := String(status.get("level_label", "Stage"))
	if _current_screen == "editor":
		hud_level_name_edit.editable = true
		if not hud_level_name_edit.has_focus():
			hud_level_name_edit.text = String(status.get("level_name", "Untitled"))
	else:
		hud_level_name_edit.editable = false
		hud_level_name_edit.text = "%s  •  %s" % [prefix, String(status.get("level_name", "Untitled"))]
	hud_author_label.text = "Created by %s" % [String(status.get("author", "Unknown"))]
	hud_pause_label.visible = bool(status.get("paused", false)) and (ingame_menu_panel == null or not ingame_menu_panel.visible)

	var settings := DataManager.settings
	if bool(settings.get("show_times", true)):
		hud_timer_label.text = UIBuilder.format_time(float(status.get("elapsed_time", 0.0)))
		hud_boost_label.text = UIBuilder.format_time(float(status.get("boost_time", 0.0)))
	else:
		hud_timer_label.text = ""
		hud_boost_label.text = ""

	var is_tutorial := String(status.get("category", "")) == "tutorial"
	hud_hint_panel.visible = _current_screen == "play" and is_tutorial
	hud_hint_label.text = String(status.get("hint", "")) if is_tutorial else ""

	var stats_lines: Array = []
	if bool(settings.get("show_highscores", true)):
		var score_key = String(status.get("score_key", ""))
		if not score_key.is_empty():
			var fastest = DataManager.scores.get("fastest", {}).get(score_key, null)
			var efficient = DataManager.scores.get("efficient", {}).get(score_key, null)
			stats_lines.append("Fastest: %s" % [UIBuilder.format_score_entry(fastest)])
			stats_lines.append("Least Boost: %s" % [UIBuilder.format_score_entry(efficient)])
	if bool(settings.get("show_fps", true)):
		stats_lines.append("FPS %.0f / TPS %.0f" % [float(status.get("fps", 0.0)), float(status.get("tps", 0.0))])
	hud_stats_label.text = "\n".join(stats_lines)
	hud_stats_panel.visible = not stats_lines.is_empty() and _current_screen != "editor"
	hud_time_panel.visible = bool(settings.get("show_times", true)) and _current_screen != "editor"
	hud_boost_panel.visible = bool(settings.get("show_times", true)) and _current_screen != "editor"

	if _current_screen == "editor":
		update_editor_buttons(world)
		refresh_editor_selected(world)


func refresh_level_buttons(audio_mgr: Node, on_start: Callable) -> void:
	if level_grid_builtin == null:
		return
	for child in level_grid_builtin.get_children():
		child.queue_free()
	for child in level_grid_custom.get_children():
		child.queue_free()

	for index in range(DataManager.builtin_levels.size()):
		level_grid_builtin.add_child(UIBuilder.make_level_card(
			DataManager.builtin_levels[index], index, false, DataManager.scores, audio_mgr, on_start
		))

	if DataManager.custom_levels.is_empty():
		var empty := Label.new()
		empty.text = "No custom levels yet. Build one from Create Stage."
		level_grid_custom.add_child(empty)
	else:
		for index in range(DataManager.custom_levels.size()):
			level_grid_custom.add_child(UIBuilder.make_level_card(
				DataManager.custom_levels[index], index, true, DataManager.scores, audio_mgr, on_start
			))


func refresh_workshop() -> void:
	if workshop_preview == null:
		return
	var boost_type := int(DataManager.settings.get("boost_type", 0))
	var new_texture := UIBuilder.load_ui_texture("res://images/rocket%d.png" % [boost_type + 1])

	if workshop_preview.texture != null and workshop_preview.texture != new_texture:
		var tw := workshop_preview.create_tween()
		tw.tween_property(workshop_preview, "modulate:a", 0.0, 0.1).set_ease(Tween.EASE_IN)
		tw.tween_callback(func() -> void: workshop_preview.texture = new_texture)
		tw.tween_property(workshop_preview, "modulate:a", 1.0, 0.16).set_ease(Tween.EASE_OUT)
	else:
		workshop_preview.texture = new_texture

	if workshop_title != null and boost_type < workshop_buttons.size():
		workshop_title.text = str(workshop_buttons[boost_type].get_meta("rocket_name", "Rocket %d" % [boost_type + 1]))

	for index in range(workshop_buttons.size()):
		var button: Button = workshop_buttons[index]
		var is_selected := index == boost_type
		if button.has_meta("style_normal") and button.has_meta("style_selected"):
			var s := button.get_meta("style_selected" if is_selected else "style_normal") as StyleBoxFlat
			button.add_theme_stylebox_override("normal", s)
			button.add_theme_stylebox_override("focus", s)
		else:
			button.modulate = Color(1, 1, 1, 1) if is_selected else Color(0.75, 0.82, 0.95, 0.9)
		if button.has_meta("badge_label"):
			(button.get_meta("badge_label") as Label).visible = is_selected


func refresh_settings_ui() -> void:
	var settings := DataManager.settings
	if menu_username_edit != null:
		menu_username_edit.text = String(settings.get("username", "Guest"))
	for key in settings_toggles.keys():
		var toggle: BaseButton = settings_toggles[key]
		toggle.button_pressed = bool(settings.get(key, true))
	refresh_control_buttons()


var _awaiting_control_action := ""

func set_awaiting_control_action(action_name: String) -> void:
	_awaiting_control_action = action_name


func refresh_control_buttons() -> void:
	if control_buttons.is_empty():
		return
	var controls: Dictionary = DataManager.settings.get("controls", GameConstants.DEFAULT_CONTROLS)
	for action_name in control_buttons.keys():
		var button: Button = control_buttons[action_name]
		var keycode := int(controls.get(action_name, GameConstants.DEFAULT_CONTROLS.get(action_name, KEY_NONE)))
		button.text = UIBuilder.keycode_label(keycode)
		button.modulate = Color(0.8, 0.94, 1.0, 1.0) if action_name == _awaiting_control_action else Color(1, 1, 1, 1)


func update_editor_buttons(world: GameWorld) -> void:
	var status := world.get_status()
	var phantom_type := String(status.get("editor_phantom_type", ""))
	for key in editor_object_buttons.keys():
		var is_active: bool = not phantom_type.is_empty() and key == phantom_type
		(editor_object_buttons[key] as Button).modulate = Color(1, 1, 1, 1) if is_active else Color(0.78, 0.85, 0.96, 0.85)
	if editor_action_buttons.has("play"):
		var paused := bool(status.get("paused", true))
		(editor_action_buttons["play"] as Button).icon = UIBuilder.editor_action_icon("play" if paused else "pause")
	if editor_action_buttons.has("reset"):
		var aligned := world.editor_runtime_matches_start_state()
		(editor_action_buttons["reset"] as Button).disabled = aligned


func refresh_editor_selected(world: GameWorld) -> void:
	if editor_selected_section == null:
		return
	var status := world.get_status()
	var specs_open := bool(status.get("editor_specs_open", false))
	var info: Dictionary = world.editor_get_selected_info()
	if info.is_empty() or not specs_open:
		editor_selected_section.visible = false
		if editor_specs_panel != null:
			editor_specs_panel.visible = false
		return
	editor_selected_section.visible = true
	var t := String(info.get("type", ""))
	var grav := float(info.get("gravity", 0.0))
	var size := float(info.get("size", 8.0))
	var x_vel := float(info.get("x_vel", 0.0))
	var y_vel := float(info.get("y_vel", 0.0))
	editor_selected_label.text = t.capitalize()
	editor_size_value_label.text = str(int(size))
	var is_movable := t == "player" or t == "planet"
	if editor_vx_edit != null:
		editor_vx_edit.get_parent().visible = is_movable
		if not editor_vx_edit.has_focus():
			editor_vx_edit.text = "%.3f" % x_vel
	if editor_vy_edit != null:
		editor_vy_edit.get_parent().visible = is_movable
		if not editor_vy_edit.has_focus():
			editor_vy_edit.text = "%.3f" % y_vel
	if editor_grav_edit != null:
		if not editor_grav_edit.has_focus():
			editor_grav_edit.text = "%d" % int(grav)
	if editor_visible_row != null:
		editor_visible_row.visible = t == "sun"
	if t == "sun" and editor_visible_btn != null:
		editor_visible_btn.set_pressed_no_signal(bool(info.get("visible", true)))
	if editor_anchored_row != null:
		editor_anchored_row.visible = t == "planet"
	if t == "planet" and editor_anchored_btn != null:
		editor_anchored_btn.set_pressed_no_signal(bool(info.get("anchored", false)))

	if editor_specs_panel != null:
		editor_specs_panel.visible = true
		call_deferred("_fit_specs_panel_bottom_left")


func _fit_specs_panel_bottom_left() -> void:
	if editor_specs_panel == null or not editor_specs_panel.visible:
		return
	editor_specs_panel.reset_size()
	UIBuilder.fit_editor_specs_panel(editor_specs_panel)


func editor_panel_blocks_editor_zoom(screen_pos: Vector2) -> bool:
	if editor_place_panel != null and editor_place_panel.visible \
			and editor_place_panel.get_global_rect().has_point(screen_pos):
		return true
	if editor_specs_panel != null and editor_specs_panel.visible \
			and editor_specs_panel.get_global_rect().has_point(screen_pos):
		return true
	if editor_actions_bar != null and editor_actions_bar.visible \
			and editor_actions_bar.get_global_rect().has_point(screen_pos):
		return true
	return false


func focus_editor_properties_fields(world: GameWorld) -> void:
	refresh_editor_selected(world)
	if editor_selected_section == null or not editor_selected_section.visible:
		return
	if editor_specs_panel == null:
		return
	call_deferred("_deferred_grab_first_numeric_editor_field")


func _deferred_grab_first_numeric_editor_field() -> void:
	if editor_vx_edit != null and editor_vx_edit.get_parent().visible:
		editor_vx_edit.grab_focus()
	elif editor_grav_edit != null:
		editor_grav_edit.grab_focus()
