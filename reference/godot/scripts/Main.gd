extends Node

@onready var world: GameWorld = $GameWorld
@onready var audio_manager: Node = $AudioManager
@onready var ui_root: Control = $CanvasLayer/UIRoot

var _scene_controller: SceneController
var _hud_controller: HUDController
var _editor_place_panel: Control
var _editor_specs_panel: Control
var _editor_actions_bar: Control


func _ready() -> void:
	_hud_controller = HUDController.new()
	_hud_controller.name = "HUDController"
	add_child(_hud_controller)

	_scene_controller = SceneController.new()
	_scene_controller.name = "SceneController"
	add_child(_scene_controller)

	_build_ui()

	_scene_controller.setup(world, audio_manager, _hud_controller, ui_root)

	world.set_levels(DataManager.builtin_levels, DataManager.custom_levels)
	world.set_settings(DataManager.settings)
	world.level_completed.connect(_scene_controller.on_world_level_completed)
	world.exit_requested.connect(_scene_controller.on_exit_requested)
	world.quick_setting_toggled.connect(_scene_controller.on_quick_setting_toggled)
	world.editor_selection_changed.connect(func() -> void: _hud_controller.refresh_editor_selected(world))
	world.editor_wheel_zoom_suppressed_at = func(screen_pos: Vector2) -> bool:
		return _hud_controller.editor_panel_blocks_editor_zoom(screen_pos)
	world.bounds_reset.connect(audio_manager.play_teleport)
	world.input_handler.control_rebound.connect(_scene_controller.on_control_rebound)
	world.input_handler.rebind_cancelled.connect(_scene_controller.on_rebind_cancelled)

	audio_manager.ensure_ambient()
	_scene_controller.show_menu()

func _process(_delta: float) -> void:
	var in_play := _scene_controller.current_screen == "play"
	audio_manager.set_boost_active(in_play and world.is_player_boosting())
	audio_manager.set_alarm_active(in_play and world.is_bounds_warning())
	audio_manager.set_brake_active(in_play and world.is_player_braking())
	_hud_controller.update_hud(world)


func _build_ui() -> void:
	ui_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var overlay := ColorRect.new()
	overlay.color = Color(0.01, 0.02, 0.05, 0.12)
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui_root.add_child(overlay)

	var screen_root := Control.new()
	screen_root.name = "ScreenRoot"
	screen_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui_root.add_child(screen_root)

	var on_rebind_start := func(action_name: String, action_label: String, status_label: Label) -> void:
		_scene_controller.on_rebind_start(action_name, action_label, status_label)

	var menu_screen := UIBuilder.build_menu_screen(screen_root, DataManager.settings, audio_manager, {
		"start_game": func() -> void: _scene_controller.start_builtin_level(0),
		"start_tutorial": func() -> void: _scene_controller.start_tutorial(),
		"show_level_select": func() -> void: _scene_controller.show_level_select(),
		"open_editor": func() -> void: _scene_controller.open_editor(),
		"show_workshop": func() -> void: _scene_controller.show_workshop(),
		"show_settings": func() -> void: _scene_controller.show_settings_screen(),
		"show_credits": func() -> void: _scene_controller.show_credits(),
		"set_username": func(v: String) -> void:
			DataManager.set_username(v)
			world.set_settings(DataManager.settings)
			_hud_controller.refresh_settings_ui()
	})
	_hud_controller.menu_username_edit = menu_screen.get_meta("username_edit") as LineEdit

	var level_select_screen := UIBuilder.build_level_select_screen(screen_root, audio_manager, {
		"back": func() -> void: _scene_controller.show_menu()
	})
	_hud_controller.level_grid_builtin = level_select_screen.get_meta("level_grid_builtin") as GridContainer
	_hud_controller.level_grid_custom = level_select_screen.get_meta("level_grid_custom") as GridContainer

	var workshop_screen := UIBuilder.build_workshop_screen(screen_root, DataManager.settings, audio_manager, {
		"back": func() -> void: _scene_controller.show_menu(),
		"set_boost_type": func(v: int) -> void:
			DataManager.set_boost_type(v)
			world.set_settings(DataManager.settings)
			_hud_controller.refresh_workshop()
	})
	_hud_controller.workshop_preview = workshop_screen.get_meta("workshop_preview") as TextureRect
	_hud_controller.workshop_title = workshop_screen.get_meta("workshop_title") as Label
	_hud_controller.workshop_buttons = workshop_screen.get_meta("workshop_buttons")

	var settings_screen := UIBuilder.build_settings_screen(screen_root, DataManager.settings, audio_manager, {
		"back": func() -> void:
			if _scene_controller._settings_from_ingame:
				_scene_controller._settings_from_ingame = false
				_scene_controller.current_screen = "play"
				_scene_controller._set_screen_visibility("play")
				_hud_controller.set_current_screen("play")
				if _hud_controller.ingame_menu_panel != null:
					_hud_controller.ingame_menu_panel.visible = true
			else:
				_scene_controller.show_menu(),
		"set_bool_setting": func(key: String, value: bool) -> void:
			DataManager.set_bool_setting(key, value)
			world.set_settings(DataManager.settings),
		"start_rebind": on_rebind_start,
		"reset_controls": func() -> void:
			DataManager.settings["controls"] = GameConstants.DEFAULT_CONTROLS.duplicate(true)
			DataManager.persist_settings()
			world.set_settings(DataManager.settings)
			world.input_handler.awaiting_control_action = ""
			_hud_controller.set_awaiting_control_action("")
			_hud_controller.refresh_control_buttons()
	})
	_hud_controller.settings_toggles = settings_screen.get_meta("settings_toggles")
	_hud_controller.control_buttons = settings_screen.get_meta("control_buttons")
	_hud_controller.control_status_label = settings_screen.get_meta("control_status_label") as Label

	var credits_screen := UIBuilder.build_credits_screen(screen_root, audio_manager, {
		"back": func() -> void: _scene_controller.show_menu()
	})

	var hud_root_node := Control.new()
	hud_root_node.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui_root.add_child(hud_root_node)
	_hud_controller.hud_root = hud_root_node

	var hud_refs := UIBuilder.build_hud(hud_root_node)
	_hud_controller.hud_title_panel = hud_refs["title_panel"]
	_hud_controller.hud_stats_panel = hud_refs["stats_panel"]
	_hud_controller.hud_time_panel = hud_refs["time_panel"]
	_hud_controller.hud_boost_panel = hud_refs["boost_panel"]
	_hud_controller.hud_hint_panel = hud_refs["hint_panel"]
	_hud_controller.hud_level_name_edit = hud_refs["level_name_edit"]
	_hud_controller.hud_level_name_edit.text_submitted.connect(func(_t: String) -> void:
		if _scene_controller.current_screen == "editor":
			world.editor_set_level_name(_hud_controller.hud_level_name_edit.text)
	)
	_hud_controller.hud_level_name_edit.focus_exited.connect(func() -> void:
		if _scene_controller.current_screen == "editor":
			world.editor_set_level_name(_hud_controller.hud_level_name_edit.text)
	)
	_hud_controller.hud_author_label = hud_refs["author_label"]
	_hud_controller.hud_stats_label = hud_refs["stats_label"]
	_hud_controller.hud_timer_label = hud_refs["timer_label"]
	_hud_controller.hud_boost_label = hud_refs["boost_label"]
	_hud_controller.hud_hint_label = hud_refs["hint_label"]
	_hud_controller.hud_pause_label = hud_refs["pause_label"]

	var ingame_refs := UIBuilder.build_ingame_menu(hud_root_node, audio_manager, {
		"resume": func() -> void: _scene_controller.close_ingame_menu(),
		"restart": func() -> void:
			_scene_controller.close_ingame_menu()
			world.restart_level(),
		"settings": func() -> void:
			_scene_controller._settings_from_ingame = true
			_hud_controller.ingame_menu_panel.visible = false
			_scene_controller.show_settings_screen(),
		"choose_level": func() -> void:
			_hud_controller.ingame_menu_panel.visible = false
			if world.paused:
				world.toggle_pause()
			_scene_controller.show_level_select(),
		"main_menu": func() -> void:
			_hud_controller.ingame_menu_panel.visible = false
			if world.paused:
				world.toggle_pause()
			_scene_controller.show_menu()
	})
	_hud_controller.ingame_menu_panel = ingame_refs["panel"]
	_hud_controller.ingame_level_name_label = ingame_refs["level_name_label"]
	_hud_controller.ingame_panel_inner = ingame_refs["inner_panel"] as PanelContainer

	var editor_refs := UIBuilder.build_editor_panel(audio_manager, {
		"start_phantom": func(t: String) -> void:
			world.editor_start_phantom(t)
			_hud_controller.update_editor_buttons(world),
		"set_selected_vel": func(vx: float, vy: float) -> void: world.editor_set_selected_vel(vx, vy),
		"set_selected_gravity": func(v: float) -> void: world.editor_set_selected_gravity_value(v),
		"set_selected_size": func(d: int) -> void: world.editor_set_selected_size(d),
		"set_selected_visible": func(v: bool) -> void: world.editor_set_selected_visible(v),
		"set_selected_anchored": func(v: bool) -> void: world.editor_set_selected_anchored(v),
		"set_selected_as_goal": func() -> void: world.editor_set_selected_as_goal(),
		"toggle_pause": func() -> void: world.toggle_pause(),
		"reset_preview": func() -> void: world.editor_reset_preview(),
		"undo_last": func() -> void: world.editor_undo_last(),
		"clear": func() -> void: world.editor_clear(),
		"save": func() -> void:
			_scene_controller.save_editor_level(_hud_controller.hud_level_name_edit.text),
		"back": func() -> void: _scene_controller.show_menu()
	})
	_hud_controller.editor_place_panel = editor_refs["place_panel"]
	_hud_controller.editor_specs_panel = editor_refs["specs_panel"]
	_hud_controller.editor_actions_bar = editor_refs["actions_bar"]
	_hud_controller.editor_object_buttons = editor_refs["object_buttons"]
	_hud_controller.editor_action_buttons = editor_refs["action_buttons"]
	_hud_controller.editor_selected_section = editor_refs["selected_section"]
	_hud_controller.editor_selected_label = editor_refs["selected_label"]
	_hud_controller.editor_size_value_label = editor_refs["size_value_label"]
	_hud_controller.editor_visible_row = editor_refs["visible_row"]
	_hud_controller.editor_visible_btn = editor_refs["visible_btn"]
	_hud_controller.editor_anchored_row = editor_refs["anchored_row"]
	_hud_controller.editor_anchored_btn = editor_refs["anchored_btn"]
	_hud_controller.editor_vx_edit = editor_refs["vx_edit"]
	_hud_controller.editor_vy_edit = editor_refs["vy_edit"]
	_hud_controller.editor_grav_edit = editor_refs["grav_edit"]
	_editor_place_panel = editor_refs["place_panel"]
	_editor_specs_panel = editor_refs["specs_panel"]
	_editor_actions_bar = editor_refs["actions_bar"]
	ui_root.add_child(editor_refs["place_panel"])
	ui_root.add_child(editor_refs["specs_panel"])
	ui_root.add_child(editor_refs["actions_bar"])

	var toast_lbl := Label.new()
	toast_lbl.visible = false
	toast_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	toast_lbl.text = ""
	toast_lbl.add_theme_font_size_override("font_size", 22)
	toast_lbl.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	toast_lbl.position = Vector2(0, 28)
	hud_root_node.add_child(toast_lbl)
	_hud_controller.toast_label = toast_lbl

	_scene_controller.screens = {
		"menu": menu_screen,
		"level_select": level_select_screen,
		"workshop": workshop_screen,
		"settings": settings_screen,
		"credits": credits_screen
	}

	ui_root.theme = UIBuilder.build_theme(DataManager.settings)

	get_viewport().size_changed.connect(refit_editor_overlay_panels)
	call_deferred("_deferred_refit_editor_overlay_panels")

	_hud_controller.refresh_level_buttons(audio_manager, func(idx: int, is_custom: bool) -> void:
		if is_custom:
			_scene_controller.start_custom_level(idx)
		else:
			_scene_controller.start_builtin_level(idx)
	)
	_hud_controller.refresh_workshop()
	_hud_controller.refresh_settings_ui()


func refit_editor_overlay_panels() -> void:
	if _editor_place_panel == null or _editor_actions_bar == null:
		return
	if not _editor_place_panel.is_inside_tree():
		return
	UIBuilder.fit_editor_place_panel(_editor_place_panel)
	UIBuilder.fit_editor_actions_bar(_editor_actions_bar)
	if _editor_specs_panel != null and _editor_specs_panel.visible:
		UIBuilder.fit_editor_specs_panel(_editor_specs_panel)


func _deferred_refit_editor_overlay_panels() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	refit_editor_overlay_panels()
