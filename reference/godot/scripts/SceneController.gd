extends Node
class_name SceneController

var current_screen := "menu"
var screens: Dictionary = {}
var _settings_from_ingame := false
var _screen_tween: Tween = null

var _world: GameWorld
var _audio_manager: Node
var _hud_controller: HUDController
var _ui_root: Control


func setup(world: GameWorld, audio_manager: Node, hud_controller: HUDController, ui_root: Control) -> void:
	_world = world
	_audio_manager = audio_manager
	_hud_controller = hud_controller
	_ui_root = ui_root


func _request_editor_overlay_layout() -> void:
	var main := get_parent()
	if main != null and main.has_method("refit_editor_overlay_panels"):
		main.refit_editor_overlay_panels()


func show_menu() -> void:
	current_screen = "menu"
	_world.set_settings(DataManager.settings)
	_world.enter_menu_mode()
	_set_screen_visibility("menu")
	_hud_controller.set_current_screen("menu")
	if _hud_controller.menu_username_edit != null:
		_hud_controller.menu_username_edit.text = String(DataManager.settings.get("username", "Guest"))


func show_level_select() -> void:
	current_screen = "level_select"
	_set_screen_visibility("level_select")
	_hud_controller.set_current_screen("level_select")
	_hud_controller.refresh_level_buttons(_audio_manager, _on_level_card_pressed)


func show_workshop() -> void:
	current_screen = "workshop"
	_set_screen_visibility("workshop")
	_hud_controller.set_current_screen("workshop")
	_hud_controller.refresh_workshop()


func show_settings_screen() -> void:
	current_screen = "settings"
	_set_screen_visibility("settings")
	_hud_controller.set_current_screen("settings")
	_hud_controller.refresh_settings_ui()


func show_credits() -> void:
	current_screen = "credits"
	_set_screen_visibility("credits")
	_hud_controller.set_current_screen("credits")


func start_builtin_level(level_index: int, play_start_sound: bool = true) -> void:
	current_screen = "play"
	_world.set_settings(DataManager.settings)
	_world.start_builtin_level(level_index)
	_set_screen_visibility("play")
	_hud_controller.set_current_screen("play")
	if play_start_sound:
		_audio_manager.play_level_start()


func start_custom_level(level_index: int) -> void:
	current_screen = "play"
	_world.set_settings(DataManager.settings)
	_world.start_custom_level(level_index)
	_set_screen_visibility("play")
	_hud_controller.set_current_screen("play")
	_audio_manager.play_level_start()


func start_tutorial() -> void:
	current_screen = "play"
	_world.set_settings(DataManager.settings)
	_world.start_tutorial_level(DataManager.build_tutorial_level())
	_set_screen_visibility("play")
	_hud_controller.set_current_screen("play")
	_audio_manager.play_level_start()


func open_editor() -> void:
	current_screen = "editor"
	_world.set_settings(DataManager.settings)
	_world.enter_editor_mode()
	if _hud_controller.hud_level_name_edit != null:
		_hud_controller.hud_level_name_edit.text = "Custom Stage"
	_set_screen_visibility("editor")
	_hud_controller.set_current_screen("editor")
	call_deferred("_request_editor_overlay_layout")


func return_to_menu() -> void:
	show_menu()


func on_exit_requested() -> void:
	if current_screen != "play":
		return
	if _hud_controller.ingame_menu_panel != null and _hud_controller.ingame_menu_panel.visible:
		close_ingame_menu()
	else:
		show_ingame_menu()


func show_ingame_menu() -> void:
	if not _world.paused:
		_world.toggle_pause()
	var status := _world.get_status()
	if _hud_controller.ingame_level_name_label != null:
		_hud_controller.ingame_level_name_label.text = "%s  ·  %s" % [
			String(status.get("level_label", "Stage")),
			String(status.get("level_name", "Untitled"))
		]
	if _hud_controller.ingame_menu_panel != null:
		var overlay := _hud_controller.ingame_menu_panel
		overlay.modulate.a = 0.0
		overlay.visible = true
		var tw := create_tween().set_parallel(true)
		tw.tween_property(overlay, "modulate:a", 1.0, 0.18).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
		if _hud_controller.ingame_panel_inner != null:
			_hud_controller.ingame_panel_inner.scale = Vector2(0.88, 0.88)
			tw.tween_property(_hud_controller.ingame_panel_inner, "scale", Vector2(1.0, 1.0), 0.26).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)


func close_ingame_menu() -> void:
	if _world.paused:
		_world.toggle_pause()
	if _hud_controller.ingame_menu_panel != null:
		var overlay := _hud_controller.ingame_menu_panel
		var ip: PanelContainer = _hud_controller.ingame_panel_inner
		var tw := create_tween().set_parallel(true)
		tw.tween_property(overlay, "modulate:a", 0.0, 0.14).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		if ip != null:
			tw.tween_property(ip, "scale", Vector2(0.9, 0.9), 0.14).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		tw.tween_callback(func() -> void:
			overlay.visible = false
			overlay.modulate.a = 1.0
			if ip != null:
				ip.scale = Vector2(1.0, 1.0)
		).set_delay(0.14)


func on_world_level_completed(level_index: int, category: String, time_elapsed: float, boost_elapsed: float) -> void:
	if category != "tutorial":
		var sk := DataManager.score_key(category, level_index)
		DataManager.submit_score(sk, time_elapsed, boost_elapsed)
	_audio_manager.play_goal_fanfare()
	_hud_controller.show_toast("Tutorial complete" if category == "tutorial" else "Target reached")
	_hud_controller.refresh_level_buttons(_audio_manager, _on_level_card_pressed)
	call_deferred("_advance_after_completion", level_index, category)


func on_quick_setting_toggled(setting_name: String, value: bool) -> void:
	DataManager.settings[setting_name] = value
	DataManager.persist_settings()
	_world.set_settings(DataManager.settings)
	_hud_controller.refresh_settings_ui()


func on_rebind_start(action_name: String, action_label: String, status_label: Label) -> void:
	_world.input_handler.awaiting_control_action = action_name
	_hud_controller.set_awaiting_control_action(action_name)
	status_label.text = "Press a key for %s. Press Escape to cancel." % [action_label]
	_hud_controller.refresh_control_buttons()


func on_control_rebound(action_name: String, keycode: int) -> void:
	DataManager.set_control_binding(action_name, keycode)
	_world.set_settings(DataManager.settings)
	_hud_controller.set_awaiting_control_action("")
	var cl: Label = _get_control_status_label()
	if cl:
		cl.text = "Binding updated."
	_hud_controller.refresh_control_buttons()


func on_rebind_cancelled() -> void:
	_hud_controller.set_awaiting_control_action("")
	var cl: Label = _get_control_status_label()
	if cl:
		cl.text = "Select an action, then press a key to rebind it."
	_hud_controller.refresh_control_buttons()


func save_editor_level(editor_name: String) -> void:
	var exported := _world.editor_export_level(editor_name, String(DataManager.settings.get("username", "Guest")))
	if exported.is_empty():
		_hud_controller.show_toast("Add a player and goal before saving")
		return
	DataManager.save_custom_level(exported)
	_world.set_levels(DataManager.builtin_levels, DataManager.custom_levels)
	_hud_controller.refresh_level_buttons(_audio_manager, _on_level_card_pressed)
	_hud_controller.show_toast("Saved custom stage")


func _advance_after_completion(level_index: int, category: String) -> void:
	if category == "tutorial":
		show_menu()
		return
	if category == "custom":
		if level_index + 1 < DataManager.custom_levels.size():
			start_custom_level(level_index + 1)
		else:
			show_level_select()
		return
	if level_index + 1 < DataManager.builtin_levels.size():
		start_builtin_level(level_index + 1, false)
	else:
		show_menu()


func _on_level_card_pressed(index: int, is_custom: bool) -> void:
	if is_custom:
		start_custom_level(index)
	else:
		start_builtin_level(index)


func _set_screen_visibility(screen_name: String) -> void:
	if _screen_tween != null and _screen_tween.is_running():
		_screen_tween.kill()

	var outgoing: Control = null
	for key in screens.keys():
		var scr := screens[key] as Control
		if scr.visible:
			outgoing = scr
			break

	for key in screens.keys():
		var scr := screens[key] as Control
		if key != screen_name and scr != outgoing:
			scr.visible = false
			scr.modulate.a = 1.0

	var incoming: Control = screens.get(screen_name, null) as Control

	_screen_tween = create_tween().set_parallel(true)
	if incoming != null:
		incoming.modulate.a = 0.0
		incoming.visible = true
		_screen_tween.tween_property(incoming, "modulate:a", 1.0, 0.22).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	if outgoing != null and outgoing != incoming:
		_screen_tween.tween_property(outgoing, "modulate:a", 0.0, 0.15).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		_screen_tween.tween_callback(func() -> void:
			outgoing.visible = false
			outgoing.modulate.a = 1.0
		).set_delay(0.15)

	if _hud_controller.hud_root != null:
		_hud_controller.hud_root.visible = screen_name == "play" or screen_name == "editor"
	if _hud_controller.ingame_menu_panel != null and screen_name != "play":
		_hud_controller.ingame_menu_panel.visible = false
	_update_ui_mouse_passthrough_for_editor(screen_name == "editor")


## Full-screen UI layers (overlay, screen root, HUD shell) use MOUSE_FILTER_STOP by default, which
## consumes clicks before they reach GameWorld._unhandled_input. In the stage editor, canvas tools
## (contextual buttons, place, drag) must receive mouse events on the playfield; child controls
## (editor panel, HUD panels) keep their own STOP and still receive hits.
func _update_ui_mouse_passthrough_for_editor(editor: bool) -> void:
	if _ui_root == null:
		return
	var mf := Control.MOUSE_FILTER_IGNORE if editor else Control.MOUSE_FILTER_STOP
	if _ui_root.get_child_count() >= 3:
		var overlay := _ui_root.get_child(0) as Control
		var screen_root := _ui_root.get_child(1) as Control
		var hud := _ui_root.get_child(2) as Control
		if overlay != null:
			overlay.mouse_filter = mf
		if screen_root != null:
			screen_root.mouse_filter = mf
		if hud != null:
			hud.mouse_filter = mf


func _get_control_status_label() -> Label:
	if screens.has("settings"):
		var settings_screen: Control = screens["settings"]
		if settings_screen.has_meta("control_status_label"):
			return settings_screen.get_meta("control_status_label") as Label
	return null
