class_name UIBuilder


static func _add_press_scale_anim(btn: Button) -> void:
	btn.button_down.connect(func() -> void:
		btn.pivot_offset = btn.size / 2.0
		var tw := btn.create_tween()
		tw.tween_property(btn, "scale", Vector2(0.94, 0.94), 0.08).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	)
	btn.button_up.connect(func() -> void:
		btn.pivot_offset = btn.size / 2.0
		var tw := btn.create_tween()
		tw.tween_property(btn, "scale", Vector2(1.0, 1.0), 0.22).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	)


static func _limit_scroll_speed(scroll: ScrollContainer, max_px: int) -> void:
	var vsb := scroll.get_v_scroll_bar()
	var state := {"prev": 0.0, "busy": false}
	vsb.value_changed.connect(func(val: float) -> void:
		if state["busy"]:
			state["prev"] = val
			return
		var delta: float = val - float(state["prev"])
		if absf(delta) > float(max_px):
			state["busy"] = true
			scroll.scroll_vertical = int(state["prev"] + sign(delta) * float(max_px))
			state["busy"] = false
		state["prev"] = float(scroll.scroll_vertical)
	)


static func build_theme(settings: Dictionary) -> Theme:
	var app_theme := Theme.new()

	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.04, 0.08, 0.15, 0.88)
	panel_style.border_width_left = 2
	panel_style.border_width_top = 2
	panel_style.border_width_right = 2
	panel_style.border_width_bottom = 2
	panel_style.border_color = Color(0.25, 0.67, 0.86, 0.35)
	panel_style.corner_radius_top_left = 24
	panel_style.corner_radius_top_right = 24
	panel_style.corner_radius_bottom_right = 24
	panel_style.corner_radius_bottom_left = 24
	panel_style.shadow_size = 16
	panel_style.shadow_color = Color(0, 0, 0, 0.35)

	var button_normal := StyleBoxFlat.new()
	button_normal.bg_color = Color(0.08, 0.16, 0.28, 0.96)
	button_normal.border_color = Color(0.41, 0.78, 0.95, 0.28)
	button_normal.border_width_left = 2
	button_normal.border_width_top = 2
	button_normal.border_width_right = 2
	button_normal.border_width_bottom = 2
	button_normal.corner_radius_top_left = 18
	button_normal.corner_radius_top_right = 18
	button_normal.corner_radius_bottom_right = 18
	button_normal.corner_radius_bottom_left = 18
	button_normal.content_margin_left = 20
	button_normal.content_margin_right = 20
	button_normal.content_margin_top = 14
	button_normal.content_margin_bottom = 14

	var button_hover := button_normal.duplicate()
	button_hover.bg_color = Color(0.12, 0.27, 0.42, 1.0)
	button_hover.border_color = Color(0.55, 0.88, 1.0, 0.72)

	var button_pressed := button_normal.duplicate()
	button_pressed.bg_color = Color(0.17, 0.38, 0.55, 1.0)

	var button_focus := button_hover.duplicate()
	button_focus.border_color = Color(0.7, 0.94, 1.0, 0.92)
	button_focus.shadow_size = 18
	button_focus.shadow_color = Color(0.24, 0.7, 0.92, 0.18)

	var input_style := button_normal.duplicate()
	input_style.bg_color = Color(0.06, 0.1, 0.18, 0.96)

	var tab_panel := panel_style.duplicate()
	tab_panel.bg_color = Color(0.04, 0.08, 0.15, 0.72)
	tab_panel.border_color = Color(0.27, 0.62, 0.82, 0.2)

	var tab_unselected := StyleBoxFlat.new()
	tab_unselected.bg_color = Color(0.05, 0.1, 0.17, 0.95)
	tab_unselected.border_width_left = 2
	tab_unselected.border_width_top = 2
	tab_unselected.border_width_right = 2
	tab_unselected.border_width_bottom = 2
	tab_unselected.border_color = Color(0.2, 0.45, 0.62, 0.28)
	tab_unselected.corner_radius_top_left = 16
	tab_unselected.corner_radius_top_right = 16
	tab_unselected.content_margin_left = 18
	tab_unselected.content_margin_right = 18
	tab_unselected.content_margin_top = 10
	tab_unselected.content_margin_bottom = 10

	var tab_selected := tab_unselected.duplicate()
	tab_selected.bg_color = Color(0.09, 0.21, 0.34, 1.0)
	tab_selected.border_color = Color(0.55, 0.88, 1.0, 0.7)

	var tab_hovered := tab_unselected.duplicate()
	tab_hovered.bg_color = Color(0.08, 0.17, 0.28, 1.0)
	tab_hovered.border_color = Color(0.47, 0.82, 0.96, 0.48)

	app_theme.set_stylebox("panel", "PanelContainer", panel_style)
	app_theme.set_stylebox("normal", "Button", button_normal)
	app_theme.set_stylebox("hover", "Button", button_hover)
	app_theme.set_stylebox("pressed", "Button", button_pressed)
	app_theme.set_stylebox("focus", "Button", button_focus)
	app_theme.set_stylebox("normal", "CheckBox", button_normal)
	app_theme.set_stylebox("hover", "CheckBox", button_hover)
	app_theme.set_stylebox("pressed", "CheckBox", button_pressed)
	app_theme.set_stylebox("normal", "LineEdit", input_style)
	app_theme.set_stylebox("focus", "LineEdit", button_hover)
	app_theme.set_stylebox("panel", "TabContainer", tab_panel)
	app_theme.set_stylebox("tab_unselected", "TabBar", tab_unselected)
	app_theme.set_stylebox("tab_selected", "TabBar", tab_selected)
	app_theme.set_stylebox("tab_hovered", "TabBar", tab_hovered)
	app_theme.set_stylebox("tab_focus", "TabBar", tab_selected)
	app_theme.set_color("font_color", "Label", Color(0.9, 0.95, 1.0, 1.0))
	app_theme.set_color("font_color", "Button", Color(0.95, 0.98, 1.0, 1.0))
	app_theme.set_color("font_color_pressed", "Button", Color(1, 1, 1, 1))
	app_theme.set_color("font_color_hover", "Button", Color(1, 1, 1, 1))
	app_theme.set_color("font_color", "LineEdit", Color(0.96, 0.98, 1.0, 1.0))
	app_theme.set_color("font_placeholder_color", "LineEdit", Color(0.72, 0.8, 0.92, 0.6))
	app_theme.set_color("font_selected_color", "TabBar", Color(0.96, 0.99, 1.0, 1.0))
	app_theme.set_color("font_hovered_color", "TabBar", Color(0.94, 0.98, 1.0, 1.0))
	app_theme.set_color("font_unselected_color", "TabBar", Color(0.72, 0.83, 0.95, 0.94))
	app_theme.set_font_size("font_size", "Label", 18)
	app_theme.set_font_size("font_size", "Button", 19)
	app_theme.set_font_size("font_size", "LineEdit", 18)
	app_theme.set_constant("h_separation", "BoxContainer", 14)
	app_theme.set_constant("v_separation", "BoxContainer", 14)

	return app_theme


static func build_menu_screen(parent: Control, settings: Dictionary, audio_mgr: Node, callbacks: Dictionary) -> Control:
	var root := Control.new()
	root.visible = false
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(root)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 56)
	margin.add_theme_constant_override("margin_top", 42)
	margin.add_theme_constant_override("margin_right", 56)
	margin.add_theme_constant_override("margin_bottom", 42)
	root.add_child(margin)

	var center := CenterContainer.new()
	margin.add_child(center)

	var body := VBoxContainer.new()
	body.custom_minimum_size = Vector2(940, 0)
	body.alignment = BoxContainer.ALIGNMENT_CENTER
	body.add_theme_constant_override("separation", 20)
	center.add_child(body)

	var title := Label.new()
	title.text = "SwingBy"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var space_font := SystemFont.new()
	space_font.font_names = PackedStringArray(["Futura", "Gill Sans", "Impact", "Arial Black", "Helvetica Neue"])
	space_font.font_weight = 700
	title.add_theme_font_override("font", space_font)
	title.add_theme_font_size_override("font_size", 82)
	title.add_theme_color_override("font_color", Color(0.72, 0.93, 1.0, 1.0))
	body.add_child(title)

	var subtitle := Label.new()
	subtitle.text = ""
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	subtitle.custom_minimum_size = Vector2(760, 0)
	subtitle.add_theme_font_size_override("font_size", 22)
	subtitle.modulate = Color(0.84, 0.91, 1.0, 0.88)
	body.add_child(subtitle)

	var content_panel := PanelContainer.new()
	content_panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.03, 0.07, 0.14, 0.68)
	panel_style.border_width_left = 1
	panel_style.border_width_top = 1
	panel_style.border_width_right = 1
	panel_style.border_width_bottom = 1
	panel_style.border_color = Color(0.35, 0.6, 1.0, 0.12)
	panel_style.set_corner_radius_all(18)
	panel_style.content_margin_left = 36
	panel_style.content_margin_right = 36
	panel_style.content_margin_top = 22
	panel_style.content_margin_bottom = 26
	content_panel.add_theme_stylebox_override("panel", panel_style)
	body.add_child(content_panel)

	var panel_vbox := VBoxContainer.new()
	panel_vbox.add_theme_constant_override("separation", 16)
	panel_vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	content_panel.add_child(panel_vbox)

	var username_label := Label.new()
	username_label.text = "Player Name"
	username_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	username_label.modulate = Color(0.67, 0.86, 1.0, 0.92)
	panel_vbox.add_child(username_label)

	var username_edit := LineEdit.new()
	username_edit.custom_minimum_size = Vector2(248, 48)
	username_edit.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	username_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	username_edit.placeholder_text = "Guest"
	username_edit.text = String(settings.get("username", "Guest"))
	var on_username: Callable = callbacks.get("set_username", Callable())
	if on_username.is_valid():
		username_edit.text_submitted.connect(func(new_text: String) -> void: on_username.call(new_text))
		username_edit.focus_exited.connect(func() -> void: on_username.call(username_edit.text))
	panel_vbox.add_child(username_edit)
	root.set_meta("username_edit", username_edit)

	var button_layout := GridContainer.new()
	button_layout.columns = 2
	button_layout.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	button_layout.add_theme_constant_override("h_separation", 24)
	button_layout.add_theme_constant_override("v_separation", 16)
	panel_vbox.add_child(button_layout)

	button_layout.add_child(make_menu_button("Start Game", callbacks.get("start_game", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Tutorial", callbacks.get("start_tutorial", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Play Stage", callbacks.get("show_level_select", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Create Stage", callbacks.get("open_editor", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Workshop", callbacks.get("show_workshop", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Settings", callbacks.get("show_settings", Callable()), audio_mgr))
	button_layout.add_child(make_menu_button("Credits", callbacks.get("show_credits", Callable()), audio_mgr))

	var quit_popup := Control.new()
	quit_popup.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	quit_popup.visible = false
	root.add_child(quit_popup)

	var backdrop := ColorRect.new()
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.color = Color(0.0, 0.02, 0.06, 0.72)
	quit_popup.add_child(backdrop)

	var dialog_center := CenterContainer.new()
	dialog_center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	quit_popup.add_child(dialog_center)

	var dialog := PanelContainer.new()
	dialog_center.add_child(dialog)

	var dialog_margin := MarginContainer.new()
	dialog_margin.add_theme_constant_override("margin_left", 36)
	dialog_margin.add_theme_constant_override("margin_top", 32)
	dialog_margin.add_theme_constant_override("margin_right", 36)
	dialog_margin.add_theme_constant_override("margin_bottom", 32)
	dialog.add_child(dialog_margin)

	var dialog_vbox := VBoxContainer.new()
	dialog_vbox.add_theme_constant_override("separation", 20)
	dialog_vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	dialog_margin.add_child(dialog_vbox)

	var confirm_label := Label.new()
	confirm_label.text = "Quit game?"
	confirm_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	confirm_label.add_theme_font_size_override("font_size", 26)
	dialog_vbox.add_child(confirm_label)

	var btn_row := HBoxContainer.new()
	btn_row.add_theme_constant_override("separation", 16)
	btn_row.alignment = BoxContainer.ALIGNMENT_CENTER
	dialog_vbox.add_child(btn_row)

	btn_row.add_child(make_menu_button("Yes, Quit", func() -> void: Engine.get_main_loop().quit(), audio_mgr))
	btn_row.add_child(make_menu_button("Cancel", func() -> void: quit_popup.visible = false, audio_mgr))

	button_layout.add_child(make_menu_button("Quit Game", func() -> void: quit_popup.visible = true, audio_mgr))

	return root


static func build_level_select_screen(parent: Control, audio_mgr: Node, callbacks: Dictionary) -> Control:
	var shell := make_screen_shell(parent, Vector2(1380, 740))
	var body: VBoxContainer = shell.get_meta("body")

	# ── Header row: title left, tab buttons right ──────────────────────────
	var header := HBoxContainer.new()
	body.add_child(header)

	var title_vbox := VBoxContainer.new()
	title_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_vbox.add_theme_constant_override("separation", 2)
	header.add_child(title_vbox)

	var title_lbl := Label.new()
	title_lbl.text = "CHOOSE A STAGE"
	title_lbl.add_theme_font_size_override("font_size", 34)
	title_lbl.add_theme_color_override("font_color", Color(0.88, 0.97, 1.0, 1.0))
	title_vbox.add_child(title_lbl)

	var sub_lbl := Label.new()
	sub_lbl.text = "Select a mission to fly"
	sub_lbl.add_theme_font_size_override("font_size", 13)
	sub_lbl.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.58))
	title_vbox.add_child(sub_lbl)

	var make_tab_style := func(active: bool) -> StyleBoxFlat:
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.12, 0.26, 0.44, 0.95) if active else Color(0.04, 0.09, 0.16, 0.6)
		s.border_width_left = 2
		s.border_width_top = 2
		s.border_width_right = 2
		s.border_width_bottom = 2
		s.border_color = Color(0.38, 0.82, 1.0, 0.72) if active else Color(0.2, 0.42, 0.65, 0.28)
		s.corner_radius_top_left = 16
		s.corner_radius_top_right = 16
		s.corner_radius_bottom_left = 16
		s.corner_radius_bottom_right = 16
		s.content_margin_left = 24
		s.content_margin_right = 24
		s.content_margin_top = 10
		s.content_margin_bottom = 10
		return s

	var tab_bar := HBoxContainer.new()
	tab_bar.add_theme_constant_override("separation", 8)
	tab_bar.alignment = BoxContainer.ALIGNMENT_END
	header.add_child(tab_bar)

	var tab_levels := Button.new()
	tab_levels.text = "PRESET"
	tab_levels.add_theme_font_size_override("font_size", 14)
	tab_levels.add_theme_stylebox_override("normal", make_tab_style.call(true))
	tab_levels.add_theme_stylebox_override("hover", make_tab_style.call(true))
	tab_levels.add_theme_stylebox_override("pressed", make_tab_style.call(true))
	tab_levels.add_theme_stylebox_override("focus", make_tab_style.call(true))
	tab_levels.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0, 1.0))
	tab_levels.add_theme_color_override("font_hover_color", Color(1.0, 1.0, 1.0, 1.0))
	_add_press_scale_anim(tab_levels)
	tab_bar.add_child(tab_levels)

	var tab_custom := Button.new()
	tab_custom.text = "CUSTOM"
	tab_custom.add_theme_font_size_override("font_size", 14)
	tab_custom.add_theme_stylebox_override("normal", make_tab_style.call(false))
	tab_custom.add_theme_stylebox_override("hover", make_tab_style.call(true))
	tab_custom.add_theme_stylebox_override("pressed", make_tab_style.call(true))
	tab_custom.add_theme_stylebox_override("focus", make_tab_style.call(false))
	tab_custom.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.7))
	tab_custom.add_theme_color_override("font_hover_color", Color(1.0, 1.0, 1.0, 1.0))
	_add_press_scale_anim(tab_custom)
	tab_bar.add_child(tab_custom)

	# ── Content areas (overlapping, switched by tabs) ──────────────────────
	var levels_content := Control.new()
	levels_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	levels_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(levels_content)

	var custom_content := Control.new()
	custom_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	custom_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	custom_content.visible = false
	body.add_child(custom_content)

	var scroll_builtin := ScrollContainer.new()
	scroll_builtin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll_builtin.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	levels_content.add_child(scroll_builtin)
	_limit_scroll_speed(scroll_builtin, 20)

	var grid_margin_builtin := MarginContainer.new()
	grid_margin_builtin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid_margin_builtin.add_theme_constant_override("margin_left", 12)
	grid_margin_builtin.add_theme_constant_override("margin_right", 12)
	grid_margin_builtin.add_theme_constant_override("margin_top", 12)
	grid_margin_builtin.add_theme_constant_override("margin_bottom", 12)
	scroll_builtin.add_child(grid_margin_builtin)

	var level_grid_builtin := GridContainer.new()
	level_grid_builtin.columns = 4
	level_grid_builtin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	level_grid_builtin.add_theme_constant_override("h_separation", 8)
	level_grid_builtin.add_theme_constant_override("v_separation", 8)
	grid_margin_builtin.add_child(level_grid_builtin)

	var scroll_custom := ScrollContainer.new()
	scroll_custom.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll_custom.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	custom_content.add_child(scroll_custom)
	_limit_scroll_speed(scroll_custom, 20)

	var grid_margin_custom := MarginContainer.new()
	grid_margin_custom.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid_margin_custom.add_theme_constant_override("margin_left", 12)
	grid_margin_custom.add_theme_constant_override("margin_right", 12)
	grid_margin_custom.add_theme_constant_override("margin_top", 12)
	grid_margin_custom.add_theme_constant_override("margin_bottom", 12)
	scroll_custom.add_child(grid_margin_custom)

	var level_grid_custom := GridContainer.new()
	level_grid_custom.columns = 4
	level_grid_custom.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	level_grid_custom.add_theme_constant_override("h_separation", 8)
	level_grid_custom.add_theme_constant_override("v_separation", 8)
	grid_margin_custom.add_child(level_grid_custom)

	# ── Tab switching ──────────────────────────────────────────────────────
	tab_levels.pressed.connect(func() -> void:
		if audio_mgr: audio_mgr.play_ui_click()
		if levels_content.visible:
			return
		custom_content.visible = false
		levels_content.modulate.a = 0.0
		levels_content.visible = true
		levels_content.create_tween().tween_property(levels_content, "modulate:a", 1.0, 0.15).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
		tab_levels.add_theme_stylebox_override("normal", make_tab_style.call(true))
		tab_levels.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0, 1.0))
		tab_custom.add_theme_stylebox_override("normal", make_tab_style.call(false))
		tab_custom.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.7))
	)
	tab_custom.pressed.connect(func() -> void:
		if audio_mgr: audio_mgr.play_ui_click()
		if custom_content.visible:
			return
		levels_content.visible = false
		custom_content.modulate.a = 0.0
		custom_content.visible = true
		custom_content.create_tween().tween_property(custom_content, "modulate:a", 1.0, 0.15).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
		tab_custom.add_theme_stylebox_override("normal", make_tab_style.call(true))
		tab_custom.add_theme_color_override("font_color", Color(1.0, 1.0, 1.0, 1.0))
		tab_levels.add_theme_stylebox_override("normal", make_tab_style.call(false))
		tab_levels.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.7))
	)

	body.add_child(make_action_button("← Back", callbacks.get("back", Callable()), audio_mgr))

	shell.set_meta("level_grid_builtin", level_grid_builtin)
	shell.set_meta("level_grid_custom", level_grid_custom)
	return shell


static func build_workshop_screen(parent: Control, settings: Dictionary, audio_mgr: Node, callbacks: Dictionary) -> Control:
	var shell := make_screen_shell(parent, Vector2(1060, 650))
	var body: VBoxContainer = shell.get_meta("body")

	# ── Header ────────────────────────────────────────────────────────────────
	var header_box := VBoxContainer.new()
	header_box.add_theme_constant_override("separation", 2)
	body.add_child(header_box)

	var title_lbl := Label.new()
	title_lbl.text = "WORKSHOP"
	title_lbl.add_theme_font_size_override("font_size", 34)
	title_lbl.add_theme_color_override("font_color", Color(0.88, 0.97, 1.0, 1.0))
	header_box.add_child(title_lbl)

	var sub_lbl := Label.new()
	sub_lbl.text = "Choose the rocket you fly with. Each has a distinct silhouette."
	sub_lbl.add_theme_font_size_override("font_size", 13)
	sub_lbl.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.58))
	header_box.add_child(sub_lbl)

	# ── Main content ─────────────────────────────────────────────────────────
	var content := HBoxContainer.new()
	content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 20)
	body.add_child(content)

	# Left: large preview panel
	var preview_style := StyleBoxFlat.new()
	preview_style.bg_color = Color(0.03, 0.07, 0.14, 0.97)
	preview_style.border_width_left = 1
	preview_style.border_width_top = 1
	preview_style.border_width_right = 1
	preview_style.border_width_bottom = 1
	preview_style.border_color = Color(0.24, 0.52, 0.8, 0.22)
	preview_style.corner_radius_top_left = 16
	preview_style.corner_radius_top_right = 16
	preview_style.corner_radius_bottom_left = 16
	preview_style.corner_radius_bottom_right = 16

	var preview_panel := PanelContainer.new()
	preview_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview_panel.add_theme_stylebox_override("panel", preview_style)
	content.add_child(preview_panel)

	var preview_center := CenterContainer.new()
	preview_center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview_center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview_panel.add_child(preview_center)

	var preview_vbox := VBoxContainer.new()
	preview_vbox.custom_minimum_size = Vector2(220, 0)
	preview_vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	preview_vbox.add_theme_constant_override("separation", 18)
	preview_center.add_child(preview_vbox)

	# Rocket container: glow drawn by the node itself, image on top
	var rocket_ctrl := Control.new()
	rocket_ctrl.custom_minimum_size = Vector2(200, 285)
	rocket_ctrl.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	rocket_ctrl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rocket_ctrl.draw.connect(func() -> void:
		var c := rocket_ctrl.size * 0.5
		for i in range(10):
			var r := rocket_ctrl.size.x * 0.74 - i * 11.0
			if r <= 0.0:
				break
			rocket_ctrl.draw_circle(c, r, Color(0.22, 0.62, 1.0, maxf(0.0, 0.068 - i * 0.006)))
	)
	preview_vbox.add_child(rocket_ctrl)

	var workshop_preview := TextureRect.new()
	workshop_preview.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	workshop_preview.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	workshop_preview.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	workshop_preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rocket_ctrl.add_child(workshop_preview)

	# Name + equipped label
	var name_vbox := VBoxContainer.new()
	name_vbox.add_theme_constant_override("separation", 4)
	preview_vbox.add_child(name_vbox)

	var workshop_title := Label.new()
	workshop_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	workshop_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	workshop_title.add_theme_font_size_override("font_size", 28)
	workshop_title.add_theme_color_override("font_color", Color(0.90, 0.97, 1.0, 1.0))
	name_vbox.add_child(workshop_title)

	var equipped_lbl := Label.new()
	equipped_lbl.text = "EQUIPPED"
	equipped_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	equipped_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	equipped_lbl.add_theme_font_size_override("font_size", 11)
	equipped_lbl.add_theme_color_override("font_color", Color(0.38, 0.92, 0.62, 0.65))
	name_vbox.add_child(equipped_lbl)

	# Right: selection panel
	var right_vbox := VBoxContainer.new()
	right_vbox.custom_minimum_size = Vector2(340, 0)
	right_vbox.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right_vbox.add_theme_constant_override("separation", 10)
	content.add_child(right_vbox)

	var pick_lbl := Label.new()
	pick_lbl.text = "SELECT CRAFT"
	pick_lbl.add_theme_font_size_override("font_size", 11)
	pick_lbl.add_theme_color_override("font_color", Color(0.45, 0.68, 1.0, 0.52))
	right_vbox.add_child(pick_lbl)

	var divider := HSeparator.new()
	var div_style := StyleBoxFlat.new()
	div_style.bg_color = Color(0.24, 0.52, 0.8, 0.18)
	div_style.content_margin_top = 1
	div_style.content_margin_bottom = 1
	divider.add_theme_stylebox_override("separator", div_style)
	right_vbox.add_child(divider)

	var cards_vbox := VBoxContainer.new()
	cards_vbox.size_flags_vertical = Control.SIZE_EXPAND_FILL
	cards_vbox.add_theme_constant_override("separation", 10)
	right_vbox.add_child(cards_vbox)

	var rocket_names := ["PIONEER", "ARROW", "DART", "SHUTTLE"]
	var rocket_tags := [
		"Balanced and reliable",
		"Sleek aerodynamic profile",
		"Low profile, agile",
		"Heavy lifter, raw thrust"
	]

	var workshop_buttons: Array = []
	var on_set_boost: Callable = callbacks.get("set_boost_type", Callable())

	for index in range(4):
		var style_normal := StyleBoxFlat.new()
		style_normal.bg_color = Color(0.04, 0.09, 0.17, 0.94)
		style_normal.border_width_left = 1
		style_normal.border_width_top = 1
		style_normal.border_width_right = 1
		style_normal.border_width_bottom = 1
		style_normal.border_color = Color(0.24, 0.52, 0.8, 0.22)
		style_normal.corner_radius_top_left = 12
		style_normal.corner_radius_top_right = 12
		style_normal.corner_radius_bottom_left = 12
		style_normal.corner_radius_bottom_right = 12
		style_normal.content_margin_left = 1
		style_normal.content_margin_top = 1
		style_normal.content_margin_right = 1
		style_normal.content_margin_bottom = 1

		var style_selected := style_normal.duplicate() as StyleBoxFlat
		style_selected.bg_color = Color(0.06, 0.15, 0.28, 0.98)
		style_selected.border_color = Color(0.38, 0.82, 1.0, 0.82)
		style_selected.shadow_size = 8
		style_selected.shadow_color = Color(0.18, 0.62, 1.0, 0.18)

		var style_hover := style_normal.duplicate() as StyleBoxFlat
		style_hover.bg_color = Color(0.07, 0.16, 0.28, 0.98)
		style_hover.border_color = Color(0.38, 0.82, 1.0, 0.5)
		style_hover.shadow_size = 6
		style_hover.shadow_color = Color(0.18, 0.62, 1.0, 0.10)

		var card := Button.new()
		card.custom_minimum_size = Vector2(0, 112)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.clip_contents = false
		card.add_theme_stylebox_override("normal", style_normal)
		card.add_theme_stylebox_override("hover", style_hover)
		card.add_theme_stylebox_override("pressed", style_selected)
		card.add_theme_stylebox_override("focus", style_normal)
		card.set_meta("style_normal", style_normal)
		card.set_meta("style_selected", style_selected)
		card.set_meta("rocket_name", rocket_names[index])

		var local_index := index
		card.pressed.connect(func() -> void:
			if audio_mgr:
				audio_mgr.play_ui_click()
			if on_set_boost.is_valid():
				on_set_boost.call(local_index)
		)
		_add_press_scale_anim(card)

		# Card layout: thumbnail | info
		var hbox := HBoxContainer.new()
		hbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		hbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
		hbox.add_theme_constant_override("separation", 0)
		card.add_child(hbox)

		var thumb_panel := PanelContainer.new()
		thumb_panel.custom_minimum_size = Vector2(88, 0)
		thumb_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
		thumb_panel.clip_contents = true
		var thumb_style := StyleBoxFlat.new()
		thumb_style.bg_color = Color(0.015, 0.04, 0.10, 1.0)
		thumb_style.border_width_right = 1
		thumb_style.border_color = Color(0.22, 0.48, 0.72, 0.22)
		thumb_style.corner_radius_top_left = 12
		thumb_style.corner_radius_bottom_left = 12
		thumb_style.content_margin_left = 0
		thumb_style.content_margin_top = 0
		thumb_style.content_margin_right = 0
		thumb_style.content_margin_bottom = 0
		thumb_panel.add_theme_stylebox_override("panel", thumb_style)
		hbox.add_child(thumb_panel)

		var thumb_img := TextureRect.new()
		thumb_img.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		thumb_img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		thumb_img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		thumb_img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		thumb_img.texture = load_ui_texture("res://images/rocket%d.png" % [index + 1])
		thumb_img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		thumb_panel.add_child(thumb_img)

		var info_margin := MarginContainer.new()
		info_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info_margin.size_flags_vertical = Control.SIZE_FILL
		info_margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
		info_margin.add_theme_constant_override("margin_left", 14)
		info_margin.add_theme_constant_override("margin_right", 12)
		info_margin.add_theme_constant_override("margin_top", 10)
		info_margin.add_theme_constant_override("margin_bottom", 10)
		hbox.add_child(info_margin)

		var info_vbox := VBoxContainer.new()
		info_vbox.alignment = BoxContainer.ALIGNMENT_CENTER
		info_vbox.add_theme_constant_override("separation", 3)
		info_margin.add_child(info_vbox)

		var num_lbl := Label.new()
		num_lbl.text = "%02d" % [index + 1]
		num_lbl.add_theme_font_size_override("font_size", 11)
		num_lbl.add_theme_color_override("font_color", Color(0.42, 0.72, 1.0, 0.55))
		info_vbox.add_child(num_lbl)

		var name_lbl := Label.new()
		name_lbl.text = rocket_names[index]
		name_lbl.add_theme_font_size_override("font_size", 17)
		name_lbl.add_theme_color_override("font_color", Color(0.92, 0.97, 1.0, 1.0))
		info_vbox.add_child(name_lbl)

		var tag_lbl := Label.new()
		tag_lbl.text = rocket_tags[index]
		tag_lbl.add_theme_font_size_override("font_size", 11)
		tag_lbl.add_theme_color_override("font_color", Color(0.55, 0.75, 1.0, 0.52))
		info_vbox.add_child(tag_lbl)

		var badge := Label.new()
		badge.text = "✓  ACTIVE"
		badge.add_theme_font_size_override("font_size", 10)
		badge.add_theme_color_override("font_color", Color(0.38, 0.92, 0.62, 0.88))
		badge.visible = false
		info_vbox.add_child(badge)
		card.set_meta("badge_label", badge)

		cards_vbox.add_child(card)
		workshop_buttons.append(card)

	body.add_child(make_action_button("← Back", callbacks.get("back", Callable()), audio_mgr))

	shell.set_meta("workshop_preview", workshop_preview)
	shell.set_meta("workshop_title", workshop_title)
	shell.set_meta("workshop_buttons", workshop_buttons)
	return shell


static func build_settings_screen(parent: Control, settings: Dictionary, audio_mgr: Node, callbacks: Dictionary) -> Control:
	var shell := make_screen_shell(parent, Vector2(980, 720))
	var body: VBoxContainer = shell.get_meta("body")
	body.add_child(make_screen_title("Settings", "Customize your HUD, prediction, and controls."))

	var tabs := TabContainer.new()
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(tabs)

	var display_tab := MarginContainer.new()
	display_tab.name = "Display"
	display_tab.add_theme_constant_override("margin_left", 4)
	display_tab.add_theme_constant_override("margin_top", 14)
	display_tab.add_theme_constant_override("margin_right", 4)
	display_tab.add_theme_constant_override("margin_bottom", 4)
	tabs.add_child(display_tab)

	var display_scroll := ScrollContainer.new()
	display_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	display_tab.add_child(display_scroll)

	var settings_box := VBoxContainer.new()
	settings_box.add_theme_constant_override("separation", 10)
	settings_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	display_scroll.add_child(settings_box)

	var setting_meta := {
		"trail":             ["Flight Trail",         "Paint your path through space as you fly."],
		"show_future":       ["Trajectory Prediction","See a ghost of where your ship is heading."],
		"show_force_vector": ["Gravity Vector",       "Visualize the gravitational pull on your ship."],
		"show_times":        ["Time Display",         "Track mission time and cumulative thrust burn."],
		"show_highscores":   ["Personal Bests",       "Show your fastest run records mid-flight."],
		"show_fps":          ["Performance Monitor",  "Display FPS and physics tick rate."],
	}

	var settings_toggles: Dictionary = {}
	var on_bool_setting: Callable = callbacks.get("set_bool_setting", Callable())
	for key in ["trail", "show_future", "show_force_vector", "show_times", "show_highscores", "show_fps"]:
		var card := PanelContainer.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.add_theme_stylebox_override("panel", settings_card_style())
		settings_box.add_child(card)

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 18)
		card.add_child(row)

		var indicator := ColorRect.new()
		indicator.custom_minimum_size = Vector2(4, 0)
		indicator.color = Color(0.38, 0.82, 1.0, 0.72) if bool(settings.get(key, true)) else Color(0.38, 0.82, 1.0, 0.18)
		row.add_child(indicator)

		var text_box := VBoxContainer.new()
		text_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		text_box.add_theme_constant_override("separation", 3)
		row.add_child(text_box)

		var name_label := Label.new()
		name_label.text = setting_meta[key][0]
		name_label.add_theme_font_size_override("font_size", 20)
		text_box.add_child(name_label)

		var desc_label := Label.new()
		desc_label.text = setting_meta[key][1]
		desc_label.add_theme_font_size_override("font_size", 15)
		desc_label.modulate = Color(0.72, 0.84, 1.0, 0.72)
		text_box.add_child(desc_label)

		var toggle := CheckButton.new()
		toggle.text = ""
		toggle.button_pressed = bool(settings.get(key, true))
		toggle.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var setting_key: String = key
		var local_indicator := indicator
		toggle.toggled.connect(func(pressed: bool) -> void:
			if on_bool_setting.is_valid():
				on_bool_setting.call(setting_key, pressed)
			local_indicator.color = Color(0.38, 0.82, 1.0, 0.72) if pressed else Color(0.38, 0.82, 1.0, 0.18)
		)
		row.add_child(toggle)
		settings_toggles[key] = toggle

	var controls_tab := MarginContainer.new()
	controls_tab.name = "Controls"
	controls_tab.add_theme_constant_override("margin_left", 4)
	controls_tab.add_theme_constant_override("margin_top", 14)
	controls_tab.add_theme_constant_override("margin_right", 4)
	controls_tab.add_theme_constant_override("margin_bottom", 4)
	tabs.add_child(controls_tab)

	var controls_scroll := ScrollContainer.new()
	controls_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	controls_tab.add_child(controls_scroll)

	var controls_box := VBoxContainer.new()
	controls_box.add_theme_constant_override("separation", 14)
	controls_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	controls_scroll.add_child(controls_box)

	var status_card := PanelContainer.new()
	status_card.add_theme_stylebox_override("panel", settings_card_style())
	controls_box.add_child(status_card)

	var control_status_label := Label.new()
	control_status_label.text = "Select an action below, then press any key to rebind it."
	control_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	control_status_label.modulate = Color(0.82, 0.93, 1.0, 0.9)
	status_card.add_child(control_status_label)

	var control_buttons: Dictionary = {}
	var on_rebind_start: Callable = callbacks.get("start_rebind", Callable())
	controls_box.add_child(make_controls_section("Flight Controls", [
		["boost", "Boost Engine"],
		["brake", "Brake / Decelerate"],
		["thrust_up", "Thrust Up"],
		["thrust_down", "Thrust Down"],
		["thrust_left", "Thrust Left"],
		["thrust_right", "Thrust Right"]
	], settings, control_buttons, control_status_label, on_rebind_start))
	controls_box.add_child(make_controls_section("Session Controls", [
		["restart", "Restart Level"],
		["pause", "Pause / Resume"],
		["menu", "Open Menu"],
		["toggle_fps", "Toggle FPS Counter"],
		["toggle_highscores", "Toggle Personal Bests"]
	], settings, control_buttons, control_status_label, on_rebind_start))

	var on_reset_controls: Callable = callbacks.get("reset_controls", Callable())
	controls_box.add_child(make_action_button("Reset All Controls to Default", func() -> void:
		if audio_mgr:
			audio_mgr.play_ui_click()
		if on_reset_controls.is_valid():
			on_reset_controls.call()
	))

	var on_back: Callable = callbacks.get("back", Callable())
	body.add_child(make_action_button("Back", on_back, audio_mgr))

	shell.set_meta("settings_toggles", settings_toggles)
	shell.set_meta("control_buttons", control_buttons)
	shell.set_meta("control_status_label", control_status_label)
	return shell


static func build_credits_screen(parent: Control, audio_mgr: Node, callbacks: Dictionary) -> Control:
	var overlay := Control.new()
	overlay.visible = false
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(overlay)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(center)

	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 18)
	center.add_child(box)

	var game_lbl := Label.new()
	game_lbl.text = "SwingBy"
	game_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	game_lbl.add_theme_font_size_override("font_size", 52)
	game_lbl.modulate = Color(0.72, 0.93, 1.0, 0.9)
	box.add_child(game_lbl)

	var names_lbl := Label.new()
	names_lbl.text = "Magnus Saurbier\nMirza Polat"
	names_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	names_lbl.add_theme_font_size_override("font_size", 38)
	box.add_child(names_lbl)

	var thanks_lbl := Label.new()
	thanks_lbl.text = "Thank you for playing."
	thanks_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	thanks_lbl.add_theme_font_size_override("font_size", 16)
	thanks_lbl.modulate = Color(0.65, 0.82, 1.0, 0.48)
	box.add_child(thanks_lbl)

	var back_btn := make_action_button("Back", callbacks.get("back", Callable()), audio_mgr)
	back_btn.custom_minimum_size = Vector2(220, 58)
	back_btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(back_btn)

	return overlay


static func build_hud(hud_root: Control) -> Dictionary:
	var hud_title_panel := make_hud_panel(0.0, 0.0, 0.0, 0.0, 24, 20, 372, 114)
	hud_root.add_child(hud_title_panel)

	var title_box := VBoxContainer.new()
	title_box.add_theme_constant_override("separation", 2)
	hud_title_panel.add_child(title_box)

	var title_caption := Label.new()
	title_caption.text = "NAV COMPUTER"
	title_caption.add_theme_font_size_override("font_size", 13)
	title_caption.modulate = Color(0.64, 0.92, 1.0, 0.78)
	title_box.add_child(title_caption)

	var hud_level_name_edit := LineEdit.new()
	hud_level_name_edit.placeholder_text = "Stage"
	hud_level_name_edit.add_theme_font_size_override("font_size", 30)
	hud_level_name_edit.flat = true
	hud_level_name_edit.custom_minimum_size = Vector2(280, 0)
	title_box.add_child(hud_level_name_edit)

	var hud_author_label := Label.new()
	hud_author_label.modulate = Color(0.72, 0.86, 0.98, 0.8)
	title_box.add_child(hud_author_label)

	var hud_stats_panel := make_hud_panel(1.0, 0.0, 1.0, 0.0, -320, 20, -24, 126)
	hud_root.add_child(hud_stats_panel)

	var stats_box := VBoxContainer.new()
	stats_box.add_theme_constant_override("separation", 4)
	hud_stats_panel.add_child(stats_box)

	var stats_caption := Label.new()
	stats_caption.text = "SHIP TELEMETRY"
	stats_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stats_caption.add_theme_font_size_override("font_size", 13)
	stats_caption.modulate = Color(0.64, 0.92, 1.0, 0.78)
	stats_box.add_child(stats_caption)

	var hud_stats_label := Label.new()
	hud_stats_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_stats_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	stats_box.add_child(hud_stats_label)

	var hud_time_panel := make_hud_panel(0.0, 1.0, 0.0, 1.0, 24, -112, 244, -24)
	hud_root.add_child(hud_time_panel)

	var time_box := VBoxContainer.new()
	time_box.add_theme_constant_override("separation", 2)
	hud_time_panel.add_child(time_box)

	var time_caption := Label.new()
	time_caption.text = "MISSION TIME"
	time_caption.add_theme_font_size_override("font_size", 13)
	time_caption.modulate = Color(0.64, 0.92, 1.0, 0.78)
	time_box.add_child(time_caption)

	var hud_timer_label := Label.new()
	hud_timer_label.add_theme_font_size_override("font_size", 28)
	time_box.add_child(hud_timer_label)

	var hud_boost_panel := make_hud_panel(1.0, 1.0, 1.0, 1.0, -244, -112, -24, -24)
	hud_root.add_child(hud_boost_panel)

	var boost_box := VBoxContainer.new()
	boost_box.add_theme_constant_override("separation", 2)
	hud_boost_panel.add_child(boost_box)

	var boost_caption := Label.new()
	boost_caption.text = "THRUST BURN"
	boost_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	boost_caption.add_theme_font_size_override("font_size", 13)
	boost_caption.modulate = Color(0.64, 0.92, 1.0, 0.78)
	boost_box.add_child(boost_caption)

	var hud_boost_label := Label.new()
	hud_boost_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_boost_label.add_theme_font_size_override("font_size", 28)
	boost_box.add_child(hud_boost_label)

	var hud_hint_panel := make_hud_panel(0.5, 1.0, 0.5, 1.0, -260, -126, 260, -24)
	hud_root.add_child(hud_hint_panel)

	var hud_hint_label := Label.new()
	hud_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud_hint_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	hud_hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hud_hint_panel.add_child(hud_hint_label)

	var hud_pause_label := Label.new()
	hud_pause_label.text = "PAUSED"
	hud_pause_label.visible = false
	hud_pause_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	hud_pause_label.add_theme_font_size_override("font_size", 34)
	hud_pause_label.modulate = Color(1.0, 0.96, 0.75, 0.94)
	hud_root.add_child(hud_pause_label)

	return {
		"title_panel": hud_title_panel,
		"stats_panel": hud_stats_panel,
		"time_panel": hud_time_panel,
		"boost_panel": hud_boost_panel,
		"hint_panel": hud_hint_panel,
		"level_name_edit": hud_level_name_edit,
		"author_label": hud_author_label,
		"stats_label": hud_stats_label,
		"timer_label": hud_timer_label,
		"boost_label": hud_boost_label,
		"hint_label": hud_hint_label,
		"pause_label": hud_pause_label,
	}


static func build_ingame_menu(hud_root: Control, audio_mgr: Node, callbacks: Dictionary) -> Dictionary:
	var overlay := Control.new()
	overlay.visible = false
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud_root.add_child(overlay)

	var dim := ColorRect.new()
	dim.color = Color(0.01, 0.02, 0.07, 0.72)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	panel.resized.connect(func() -> void: panel.pivot_offset = panel.size / 2.0)
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.04, 0.09, 0.17, 0.97)
	panel_style.border_width_left = 2
	panel_style.border_width_top = 2
	panel_style.border_width_right = 2
	panel_style.border_width_bottom = 2
	panel_style.border_color = Color(0.38, 0.82, 1.0, 0.45)
	panel_style.corner_radius_top_left = 28
	panel_style.corner_radius_top_right = 28
	panel_style.corner_radius_bottom_right = 28
	panel_style.corner_radius_bottom_left = 28
	panel_style.shadow_size = 32
	panel_style.shadow_color = Color(0.0, 0.0, 0.0, 0.52)
	panel.add_theme_stylebox_override("panel", panel_style)
	center.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 40)
	margin.add_theme_constant_override("margin_top", 40)
	margin.add_theme_constant_override("margin_right", 40)
	margin.add_theme_constant_override("margin_bottom", 40)
	panel.add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	margin.add_child(box)

	var title_label := Label.new()
	title_label.text = "PAUSED"
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_label.add_theme_font_size_override("font_size", 38)
	title_label.add_theme_color_override("font_color", Color(0.72, 0.93, 1.0, 1.0))
	box.add_child(title_label)

	var level_name_label := Label.new()
	level_name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	level_name_label.add_theme_font_size_override("font_size", 16)
	level_name_label.add_theme_color_override("font_color", Color(0.65, 0.82, 1.0, 0.72))
	box.add_child(level_name_label)

	var sep := HSeparator.new()
	var sep_style := StyleBoxFlat.new()
	sep_style.bg_color = Color(0.38, 0.82, 1.0, 0.22)
	sep_style.content_margin_top = 1
	sep_style.content_margin_bottom = 1
	sep.add_theme_stylebox_override("separator", sep_style)
	box.add_child(sep)

	box.add_child(make_ingame_button("Resume", callbacks.get("resume", Callable()), Color(0.38, 0.88, 0.62, 0.9), audio_mgr))

	var grid := GridContainer.new()
	grid.columns = 2
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	box.add_child(grid)

	for btn_def in [
		["Restart Level", "restart", Color(0.38, 0.82, 1.0, 0.7)],
		["Settings",      "settings", Color(0.38, 0.82, 1.0, 0.7)],
		["Choose Level",  "choose_level", Color(0.38, 0.82, 1.0, 0.7)],
		["Main Menu",     "main_menu", Color(1.0, 0.45, 0.45, 0.7)],
	]:
		var gb := make_ingame_button(btn_def[0], callbacks.get(btn_def[1], Callable()), btn_def[2], audio_mgr)
		gb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(gb)

	return {"panel": overlay, "level_name_label": level_name_label, "inner_panel": panel}


static var _editor_action_icon_cache: Dictionary = {}  # String -> Texture2D

## Editor action bar: SVG assets under res://images/
const EDITOR_ACTION_ICON_PATHS: Dictionary = {
	"play": "res://images/play-svgrepo-com.svg",
	"pause": "res://images/pause-alt-svgrepo-com.svg",
	"reset": "res://images/stop-svgrepo-com.svg",
	"undo": "res://images/back-svgrepo-com.svg",
	"clear": "res://images/trash-xmark-alt-svgrepo-com.svg",
	"back": "res://images/leave-svgrepo-com.svg",
	"save": "res://images/save-svgrepo-com.svg",
}


static func editor_action_icon(kind: String) -> Texture2D:
	if _editor_action_icon_cache.has(kind):
		return _editor_action_icon_cache[kind]
	var path: String = String(EDITOR_ACTION_ICON_PATHS.get(kind, ""))
	if path.is_empty():
		push_warning("UIBuilder: unknown editor action icon kind: %s" % kind)
		return _load_editor_action_icon_or_fallback(EDITOR_ACTION_ICON_PATHS["play"])
	var tex := _load_editor_action_icon_or_fallback(path)
	_editor_action_icon_cache[kind] = tex
	return tex


static func _load_editor_action_icon_or_fallback(path: String) -> Texture2D:
	var res: Resource = load(path)
	if res == null:
		push_error("UIBuilder: missing editor icon resource: %s" % path)
		return _blank_editor_action_placeholder_icon()
	if res is Texture2D:
		return res as Texture2D
	push_warning("UIBuilder: expected Texture2D for %s, got %s" % [path, res.get_class()])
	return _blank_editor_action_placeholder_icon()


static func _blank_editor_action_placeholder_icon() -> Texture2D:
	var img := Image.create(24, 24, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.35, 0.45, 0.55, 0.35))
	return ImageTexture.create_from_image(img)


## Icon-only editor actions: global Button theme uses ~20px content margins; use tight margins so icons fill the cell.
static func _editor_action_icon_button_stylebox(bg: Color, border: Color) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.border_width_left = 2
	s.border_width_top = 2
	s.border_width_right = 2
	s.border_width_bottom = 2
	s.corner_radius_top_left = 18
	s.corner_radius_top_right = 18
	s.corner_radius_bottom_right = 18
	s.corner_radius_bottom_left = 18
	s.content_margin_left = 4
	s.content_margin_right = 4
	s.content_margin_top = 4
	s.content_margin_bottom = 4
	return s


static func _make_editor_action_icon_button(kind: String, tooltip: String, audio_mgr: Node) -> Button:
	var button := Button.new()
	button.custom_minimum_size = Vector2(64, 64)
	button.text = ""
	button.tooltip_text = tooltip
	button.focus_mode = Control.FOCUS_NONE
	button.icon = editor_action_icon(kind)
	button.expand_icon = true
	button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	button.vertical_icon_alignment = VERTICAL_ALIGNMENT_CENTER
	button.add_theme_stylebox_override("normal", _editor_action_icon_button_stylebox(
			Color(0.08, 0.16, 0.28, 0.96), Color(0.41, 0.78, 0.95, 0.28)))
	button.add_theme_stylebox_override("hover", _editor_action_icon_button_stylebox(
			Color(0.12, 0.27, 0.42, 1.0), Color(0.55, 0.88, 1.0, 0.72)))
	button.add_theme_stylebox_override("pressed", _editor_action_icon_button_stylebox(
			Color(0.17, 0.38, 0.55, 1.0), Color(0.41, 0.78, 0.95, 0.28)))
	button.add_theme_stylebox_override("focus", _editor_action_icon_button_stylebox(
			Color(0.12, 0.27, 0.42, 1.0), Color(0.7, 0.94, 1.0, 0.92)))
	var disabled_bg := Color(0.08, 0.16, 0.28, 0.55)
	var disabled_border := Color(0.41, 0.78, 0.95, 0.15)
	button.add_theme_stylebox_override("disabled", _editor_action_icon_button_stylebox(disabled_bg, disabled_border))
	if audio_mgr:
		button.pressed.connect(func() -> void: audio_mgr.play_ui_click())
	return button


## Top-right: width/height from content + margin (call after theme + when viewport resizes).
static func fit_editor_place_panel(panel: Control) -> void:
	if panel == null or not panel.is_inside_tree():
		return
	panel.reset_size()
	var sz := panel.get_combined_minimum_size()
	var margin_right := 12.0
	var margin_top := 24.0
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.anchor_top = 0.0
	panel.anchor_bottom = 0.0
	panel.offset_right = -margin_right
	panel.offset_top = margin_top
	panel.offset_left = panel.offset_right - sz.x
	panel.offset_bottom = panel.offset_top + sz.y


## Bottom-right: width/height from content + margin (call after theme + when viewport resizes).
static func fit_editor_actions_bar(panel: Control) -> void:
	if panel == null or not panel.is_inside_tree():
		return
	panel.reset_size()
	var sz := panel.get_combined_minimum_size()
	var margin_right := 12.0
	var margin_bottom := 12.0
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.anchor_top = 1.0
	panel.anchor_bottom = 1.0
	panel.offset_right = -margin_right
	panel.offset_bottom = -margin_bottom
	panel.offset_left = panel.offset_right - sz.x
	panel.offset_top = panel.offset_bottom - sz.y


## Bottom-left: object spec panel (width/height from content + margins).
static func fit_editor_specs_panel(panel: Control) -> void:
	if panel == null or not panel.is_inside_tree():
		return
	panel.reset_size()
	var sz := panel.get_combined_minimum_size()
	var margin_left := 12.0
	var margin_bottom := 12.0
	panel.anchor_left = 0.0
	panel.anchor_right = 0.0
	panel.anchor_top = 1.0
	panel.anchor_bottom = 1.0
	panel.offset_left = margin_left
	panel.offset_right = margin_left + sz.x
	panel.offset_bottom = -margin_bottom
	panel.offset_top = panel.offset_bottom - sz.y


static func build_editor_panel(audio_mgr: Node, callbacks: Dictionary) -> Dictionary:
	var on_start_phantom: Callable = callbacks.get("start_phantom", Callable())
	var on_set_vel: Callable = callbacks.get("set_selected_vel", Callable())
	var on_set_grav: Callable = callbacks.get("set_selected_gravity", Callable())
	var on_size: Callable = callbacks.get("set_selected_size", Callable())
	var on_set_visible: Callable = callbacks.get("set_selected_visible", Callable())
	var on_set_anchored: Callable = callbacks.get("set_selected_anchored", Callable())
	var on_set_goal: Callable = callbacks.get("set_selected_as_goal", Callable())

	var object_icons := {
		"player": _load_icon_texture("res://images/rocket1.png"),
		"planet": _load_icon_texture("res://images/earth.png"),
		"sun": null
	}

	# Top right: place objects only — size from content (fit_editor_place_panel after layout)
	var place_panel := PanelContainer.new()
	place_panel.visible = false
	place_panel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	place_panel.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	place_panel.anchor_left = 1.0
	place_panel.anchor_right = 1.0
	place_panel.anchor_top = 0.0
	place_panel.anchor_bottom = 0.0
	place_panel.offset_left = -200
	place_panel.offset_right = -12
	place_panel.offset_top = 24
	place_panel.offset_bottom = 24
	place_panel.add_theme_stylebox_override("panel", accent_panel_style())
	var place_margin := MarginContainer.new()
	place_margin.add_theme_constant_override("margin_left", 16)
	place_margin.add_theme_constant_override("margin_right", 16)
	place_margin.add_theme_constant_override("margin_top", 12)
	place_margin.add_theme_constant_override("margin_bottom", 12)
	place_panel.add_child(place_margin)
	var place_box := VBoxContainer.new()
	place_box.add_theme_constant_override("separation", 8)
	place_margin.add_child(place_box)
	place_box.add_child(make_editor_section_label("PLACE OBJECT"))
	var object_row := GridContainer.new()
	object_row.columns = 3
	object_row.add_theme_constant_override("h_separation", 8)
	object_row.add_theme_constant_override("v_separation", 8)
	place_box.add_child(object_row)
	var editor_object_buttons: Dictionary = {}
	for object_type in ["player", "planet", "sun"]:
		var button_container := VBoxContainer.new()
		button_container.alignment = BoxContainer.ALIGNMENT_CENTER
		button_container.add_theme_constant_override("separation", 4)
		object_row.add_child(button_container)
		var button = _make_editor_icon_button(object_type, object_icons.get(object_type), audio_mgr)
		var type_name: String = object_type
		button.button_down.connect(func() -> void:
			if on_start_phantom.is_valid():
				on_start_phantom.call(type_name)
		)
		button_container.add_child(button)
		editor_object_buttons[object_type] = button
		var plbl := Label.new()
		plbl.text = object_type.capitalize()
		plbl.add_theme_font_size_override("font_size", 11)
		plbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		plbl.modulate = Color(0.8, 0.9, 1.0, 0.8)
		button_container.add_child(plbl)

	# Left: selected object specs — top-left, height fits content only (visibility from HUDController)
	var specs_panel := PanelContainer.new()
	specs_panel.visible = false
	specs_panel.custom_minimum_size = Vector2(300, 0)
	specs_panel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	specs_panel.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	specs_panel.anchor_left = 0.0
	specs_panel.anchor_right = 0.0
	specs_panel.anchor_top = 1.0
	specs_panel.anchor_bottom = 1.0
	specs_panel.offset_left = 12
	specs_panel.offset_top = -200
	specs_panel.offset_right = 312
	specs_panel.offset_bottom = -12
	specs_panel.add_theme_stylebox_override("panel", accent_panel_style())
	var specs_margin := MarginContainer.new()
	specs_margin.add_theme_constant_override("margin_left", 16)
	specs_margin.add_theme_constant_override("margin_right", 16)
	specs_margin.add_theme_constant_override("margin_top", 12)
	specs_margin.add_theme_constant_override("margin_bottom", 12)
	specs_panel.add_child(specs_margin)
	var editor_selected_section := VBoxContainer.new()
	editor_selected_section.visible = false
	editor_selected_section.add_theme_constant_override("separation", 8)
	specs_margin.add_child(editor_selected_section)

	editor_selected_section.add_child(make_editor_section_label("SELECTED OBJECT"))

	var editor_selected_label := Label.new()
	editor_selected_label.add_theme_font_size_override("font_size", 14)
	editor_selected_label.modulate = Color(0.8, 0.9, 1.0, 0.9)
	editor_selected_section.add_child(editor_selected_label)

	var vx_row := HBoxContainer.new()
	vx_row.add_theme_constant_override("separation", 6)
	editor_selected_section.add_child(vx_row)
	var vx_lbl := Label.new()
	vx_lbl.text = "Vel X"
	vx_lbl.custom_minimum_size = Vector2(48, 0)
	vx_row.add_child(vx_lbl)
	var editor_vx_edit := LineEdit.new()
	editor_vx_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor_vx_edit.placeholder_text = "0.000"
	vx_row.add_child(editor_vx_edit)

	var vy_row := HBoxContainer.new()
	vy_row.add_theme_constant_override("separation", 6)
	editor_selected_section.add_child(vy_row)
	var vy_lbl := Label.new()
	vy_lbl.text = "Vel Y"
	vy_lbl.custom_minimum_size = Vector2(48, 0)
	vy_row.add_child(vy_lbl)
	var editor_vy_edit := LineEdit.new()
	editor_vy_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor_vy_edit.placeholder_text = "0.000"
	vy_row.add_child(editor_vy_edit)

	editor_vx_edit.text_submitted.connect(func(_v: String) -> void:
		if on_set_vel.is_valid():
			on_set_vel.call(float(editor_vx_edit.text), float(editor_vy_edit.text))
	)
	editor_vx_edit.focus_exited.connect(func() -> void:
		if on_set_vel.is_valid():
			on_set_vel.call(float(editor_vx_edit.text), float(editor_vy_edit.text))
	)
	editor_vy_edit.text_submitted.connect(func(_v: String) -> void:
		if on_set_vel.is_valid():
			on_set_vel.call(float(editor_vx_edit.text), float(editor_vy_edit.text))
	)
	editor_vy_edit.focus_exited.connect(func() -> void:
		if on_set_vel.is_valid():
			on_set_vel.call(float(editor_vx_edit.text), float(editor_vy_edit.text))
	)

	var grav_row := HBoxContainer.new()
	grav_row.add_theme_constant_override("separation", 6)
	editor_selected_section.add_child(grav_row)
	var grav_lbl := Label.new()
	grav_lbl.text = "Gravity"
	grav_lbl.custom_minimum_size = Vector2(48, 0)
	grav_row.add_child(grav_lbl)
	var editor_grav_edit := LineEdit.new()
	editor_grav_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor_grav_edit.placeholder_text = "0"
	editor_grav_edit.text_submitted.connect(func(_v: String) -> void:
		if on_set_grav.is_valid():
			on_set_grav.call(float(editor_grav_edit.text))
	)
	editor_grav_edit.focus_exited.connect(func() -> void:
		if on_set_grav.is_valid():
			on_set_grav.call(float(editor_grav_edit.text))
	)
	grav_row.add_child(editor_grav_edit)

	var size_row := HBoxContainer.new()
	size_row.add_theme_constant_override("separation", 6)
	editor_selected_section.add_child(size_row)
	var size_lbl := Label.new()
	size_lbl.text = "Size"
	size_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_row.add_child(size_lbl)
	var size_minus := Button.new()
	size_minus.text = "−"
	size_minus.custom_minimum_size = Vector2(34, 0)
	size_minus.pressed.connect(func() -> void:
		if on_size.is_valid():
			on_size.call(-1)
	)
	size_row.add_child(size_minus)
	var editor_size_value_label := Label.new()
	editor_size_value_label.text = "8"
	editor_size_value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	editor_size_value_label.custom_minimum_size = Vector2(30, 0)
	size_row.add_child(editor_size_value_label)
	var size_plus := Button.new()
	size_plus.text = "+"
	size_plus.custom_minimum_size = Vector2(34, 0)
	size_plus.pressed.connect(func() -> void:
		if on_size.is_valid():
			on_size.call(1)
	)
	size_row.add_child(size_plus)

	var editor_visible_row := HBoxContainer.new()
	editor_visible_row.visible = false
	editor_selected_section.add_child(editor_visible_row)
	var vis_lbl := Label.new()
	vis_lbl.text = "Visible (sun)"
	vis_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor_visible_row.add_child(vis_lbl)
	var editor_visible_btn := CheckButton.new()
	editor_visible_btn.toggled.connect(func(pressed: bool) -> void:
		if on_set_visible.is_valid():
			on_set_visible.call(pressed)
	)
	editor_visible_row.add_child(editor_visible_btn)

	var editor_anchored_row := HBoxContainer.new()
	editor_anchored_row.visible = false
	editor_selected_section.add_child(editor_anchored_row)
	var anch_lbl := Label.new()
	anch_lbl.text = "Anchored"
	anch_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor_anchored_row.add_child(anch_lbl)
	var editor_anchored_btn := CheckButton.new()
	editor_anchored_btn.toggled.connect(func(pressed: bool) -> void:
		if on_set_anchored.is_valid():
			on_set_anchored.call(pressed)
	)
	editor_anchored_row.add_child(editor_anchored_btn)

	var goal_btn := Button.new()
	goal_btn.text = "Set as goal"
	goal_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	goal_btn.pressed.connect(func() -> void:
		if audio_mgr:
			audio_mgr.play_ui_click()
		if on_set_goal.is_valid():
			on_set_goal.call()
	)
	editor_selected_section.add_child(goal_btn)

	# Bottom right: horizontal icon actions — size from content (fit_editor_actions_bar after layout)
	var actions_bar := PanelContainer.new()
	actions_bar.visible = false
	actions_bar.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	actions_bar.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	actions_bar.anchor_left = 1.0
	actions_bar.anchor_right = 1.0
	actions_bar.anchor_top = 1.0
	actions_bar.anchor_bottom = 1.0
	actions_bar.offset_left = -400
	actions_bar.offset_right = -12
	actions_bar.offset_top = -64
	actions_bar.offset_bottom = -12
	actions_bar.add_theme_stylebox_override("panel", accent_panel_style())
	var ab_margin := MarginContainer.new()
	ab_margin.add_theme_constant_override("margin_left", 10)
	ab_margin.add_theme_constant_override("margin_right", 10)
	ab_margin.add_theme_constant_override("margin_top", 8)
	ab_margin.add_theme_constant_override("margin_bottom", 8)
	actions_bar.add_child(ab_margin)
	var ab_row := HBoxContainer.new()
	ab_row.add_theme_constant_override("separation", 6)
	ab_margin.add_child(ab_row)

	var on_play: Callable = callbacks.get("toggle_pause", Callable())
	var on_reset: Callable = callbacks.get("reset_preview", Callable())
	var on_undo: Callable = callbacks.get("undo_last", Callable())
	var on_clear: Callable = callbacks.get("clear", Callable())
	var on_back: Callable = callbacks.get("back", Callable())
	var on_save: Callable = callbacks.get("save", Callable())

	var btn_play := _make_editor_action_icon_button("play", "Play / pause preview", audio_mgr)
	btn_play.pressed.connect(func() -> void:
		if on_play.is_valid():
			on_play.call()
	)
	ab_row.add_child(btn_play)

	var btn_reset := _make_editor_action_icon_button("reset", "Reset preview (align runtime to starts)", audio_mgr)
	btn_reset.pressed.connect(func() -> void:
		if on_reset.is_valid():
			on_reset.call()
	)
	ab_row.add_child(btn_reset)

	var btn_undo := _make_editor_action_icon_button("undo", "Undo last object", audio_mgr)
	btn_undo.pressed.connect(func() -> void:
		if on_undo.is_valid():
			on_undo.call()
	)
	ab_row.add_child(btn_undo)

	var btn_clear := _make_editor_action_icon_button("clear", "Clear stage (confirm dialog TODO)", audio_mgr)
	btn_clear.pressed.connect(func() -> void:
		if on_clear.is_valid():
			on_clear.call()
	)
	ab_row.add_child(btn_clear)

	var btn_back := _make_editor_action_icon_button("back", "Back to menu (confirm dialog TODO)", audio_mgr)
	btn_back.pressed.connect(func() -> void:
		if on_back.is_valid():
			on_back.call()
	)
	ab_row.add_child(btn_back)

	var btn_save := _make_editor_action_icon_button("save", "Save custom stage (confirm dialog TODO)", audio_mgr)
	btn_save.pressed.connect(func() -> void:
		if on_save.is_valid():
			on_save.call()
	)
	ab_row.add_child(btn_save)

	var editor_action_buttons := {
		"play": btn_play,
		"reset": btn_reset,
		"undo": btn_undo,
		"clear": btn_clear,
		"back": btn_back,
		"save": btn_save,
	}

	return {
		"place_panel": place_panel,
		"specs_panel": specs_panel,
		"actions_bar": actions_bar,
		"object_buttons": editor_object_buttons,
		"action_buttons": editor_action_buttons,
		"selected_section": editor_selected_section,
		"selected_label": editor_selected_label,
		"size_value_label": editor_size_value_label,
		"visible_row": editor_visible_row,
		"visible_btn": editor_visible_btn,
		"anchored_row": editor_anchored_row,
		"anchored_btn": editor_anchored_btn,
		"vx_edit": editor_vx_edit,
		"vy_edit": editor_vy_edit,
		"grav_edit": editor_grav_edit,
	}
static func make_screen_shell(parent: Control, min_size: Vector2) -> Control:
	var center := CenterContainer.new()
	center.visible = false
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	parent.add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = min_size
	center.add_child(panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 28)
	margin.add_theme_constant_override("margin_top", 26)
	margin.add_theme_constant_override("margin_right", 28)
	margin.add_theme_constant_override("margin_bottom", 24)
	panel.add_child(margin)

	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 18)
	margin.add_child(body)

	center.set_meta("body", body)
	return center


static func make_screen_title(title: String, subtitle: String) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)

	var title_label := Label.new()
	title_label.text = title
	title_label.add_theme_font_size_override("font_size", 42)
	box.add_child(title_label)

	var subtitle_label := Label.new()
	subtitle_label.text = subtitle
	subtitle_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	subtitle_label.modulate = Color(0.82, 0.9, 1.0, 0.86)
	box.add_child(subtitle_label)
	return box


static func make_action_button(text: String, action: Callable, audio_mgr: Node = null) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 58)
	button.pressed.connect(func() -> void:
		if audio_mgr:
			audio_mgr.play_ui_click()
		if action.is_valid():
			action.call()
	)
	_add_press_scale_anim(button)
	return button


static func make_menu_button(text: String, action: Callable, audio_mgr: Node = null) -> Button:
	var button := make_action_button(text, action, audio_mgr)
	button.custom_minimum_size = Vector2(284, 68)
	button.add_theme_font_size_override("font_size", 20)
	button.add_theme_stylebox_override("normal", menu_button_style(
		Color(0.06, 0.14, 0.24, 0.96), Color(0.4, 0.84, 1.0, 0.24)
	))
	button.add_theme_stylebox_override("hover", menu_button_style(
		Color(0.1, 0.23, 0.38, 1.0), Color(0.67, 0.95, 1.0, 0.76)
	))
	button.add_theme_stylebox_override("pressed", menu_button_style(
		Color(0.16, 0.34, 0.5, 1.0), Color(0.82, 0.98, 1.0, 0.92)
	))
	button.add_theme_stylebox_override("focus", menu_button_style(
		Color(0.11, 0.26, 0.4, 1.0), Color(0.82, 0.98, 1.0, 0.95)
	))
	return button


static func make_ingame_button(text: String, action: Callable, accent: Color, audio_mgr: Node = null) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 58)
	button.add_theme_font_size_override("font_size", 19)

	var style_normal := StyleBoxFlat.new()
	style_normal.bg_color = Color(accent.r, accent.g, accent.b, 0.08)
	style_normal.border_width_left = 2
	style_normal.border_width_top = 2
	style_normal.border_width_right = 2
	style_normal.border_width_bottom = 2
	style_normal.border_color = Color(accent.r, accent.g, accent.b, 0.32)
	style_normal.corner_radius_top_left = 14
	style_normal.corner_radius_top_right = 14
	style_normal.corner_radius_bottom_right = 14
	style_normal.corner_radius_bottom_left = 14
	style_normal.content_margin_left = 20
	style_normal.content_margin_right = 20
	style_normal.content_margin_top = 14
	style_normal.content_margin_bottom = 14

	var style_hover := style_normal.duplicate()
	style_hover.bg_color = Color(accent.r, accent.g, accent.b, 0.22)
	style_hover.border_color = Color(accent.r, accent.g, accent.b, 0.78)

	var style_pressed := style_normal.duplicate()
	style_pressed.bg_color = Color(accent.r, accent.g, accent.b, 0.32)

	button.add_theme_stylebox_override("normal", style_normal)
	button.add_theme_stylebox_override("hover", style_hover)
	button.add_theme_stylebox_override("pressed", style_pressed)
	button.add_theme_stylebox_override("focus", style_hover)
	button.add_theme_color_override("font_color", Color(accent.r * 1.4, accent.g * 1.4, accent.b * 1.4, 1.0).clamp())
	button.add_theme_color_override("font_hover_color", Color(1.0, 1.0, 1.0, 1.0))

	button.pressed.connect(func() -> void:
		if audio_mgr:
			audio_mgr.play_ui_click()
		if action.is_valid():
			action.call()
	)
	_add_press_scale_anim(button)
	return button


static func make_controls_section(title: String, actions: Array, settings: Dictionary, control_buttons: Dictionary, status_label: Label, on_rebind_start: Callable) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", accent_panel_style())

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)

	var title_label := Label.new()
	title_label.text = title
	title_label.add_theme_font_size_override("font_size", 24)
	box.add_child(title_label)

	var controls: Dictionary = settings.get("controls", GameConstants.DEFAULT_CONTROLS)
	for action_data in actions:
		var row := HBoxContainer.new()
		box.add_child(row)

		var label := Label.new()
		label.text = String(action_data[1])
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)

		var action_name := String(action_data[0])
		var button := Button.new()
		button.custom_minimum_size = Vector2(180, 44)
		var keycode := int(controls.get(action_name, GameConstants.DEFAULT_CONTROLS.get(action_name, KEY_NONE)))
		button.text = keycode_label(keycode)
		button.pressed.connect(func() -> void:
			if on_rebind_start.is_valid():
				on_rebind_start.call(action_name, String(action_data[1]), status_label)
		)
		row.add_child(button)
		control_buttons[action_name] = button

	return panel


static func make_level_card(level_data: Dictionary, index: int, is_custom: bool, scores: Dictionary, audio_mgr: Node, on_start: Callable) -> Button:
	var btn := Button.new()
	btn.custom_minimum_size = Vector2(0, 98)
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn.clip_contents = false
	btn.pressed.connect(func() -> void:
		if audio_mgr: audio_mgr.play_ui_click()
		if on_start.is_valid(): on_start.call(index, is_custom)
	)

	var style_normal := StyleBoxFlat.new()
	style_normal.bg_color = Color(0.04, 0.09, 0.17, 0.94)
	style_normal.border_width_left = 1
	style_normal.border_width_top = 1
	style_normal.border_width_right = 1
	style_normal.border_width_bottom = 1
	style_normal.border_color = Color(0.24, 0.52, 0.8, 0.26)
	style_normal.corner_radius_top_left = 12
	style_normal.corner_radius_top_right = 12
	style_normal.corner_radius_bottom_right = 12
	style_normal.corner_radius_bottom_left = 12
	style_normal.content_margin_left = 1
	style_normal.content_margin_top = 1
	style_normal.content_margin_right = 1
	style_normal.content_margin_bottom = 1

	var style_hover := style_normal.duplicate()
	style_hover.bg_color = Color(0.08, 0.18, 0.32, 0.98)
	style_hover.border_color = Color(0.38, 0.82, 1.0, 0.75)
	style_hover.shadow_size = 10
	style_hover.shadow_color = Color(0.18, 0.62, 1.0, 0.18)

	var style_pressed := style_normal.duplicate()
	style_pressed.bg_color = Color(0.12, 0.25, 0.44, 0.99)

	btn.add_theme_stylebox_override("normal", style_normal)
	btn.add_theme_stylebox_override("hover", style_hover)
	btn.add_theme_stylebox_override("pressed", style_pressed)
	btn.add_theme_stylebox_override("focus", style_hover)
	_add_press_scale_anim(btn)

	# ── Layout: minimap | info ─────────────────────────────────────────────
	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 0)
	hbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hbox.mouse_filter = Control.MOUSE_FILTER_IGNORE
	btn.add_child(hbox)

	# Minimap panel
	var mm_panel := PanelContainer.new()
	mm_panel.custom_minimum_size = Vector2(98, 0)
	mm_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mm_style := StyleBoxFlat.new()
	mm_style.bg_color = Color(0.015, 0.04, 0.10, 1.0)
	mm_style.border_width_right = 1
	mm_style.border_color = Color(0.22, 0.48, 0.72, 0.22)
	mm_style.corner_radius_top_left = 12
	mm_style.corner_radius_bottom_left = 12
	mm_style.content_margin_left = 0
	mm_style.content_margin_top = 0
	mm_style.content_margin_right = 0
	mm_style.content_margin_bottom = 0
	mm_panel.add_theme_stylebox_override("panel", mm_style)
	mm_panel.clip_contents = true
	hbox.add_child(mm_panel)

	var minimap := make_level_minimap(level_data, index)
	minimap.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mm_panel.add_child(minimap)

	# Info section
	var info_margin := MarginContainer.new()
	info_margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	info_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info_margin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	info_margin.add_theme_constant_override("margin_left", 13)
	info_margin.add_theme_constant_override("margin_right", 10)
	info_margin.add_theme_constant_override("margin_top", 0)
	info_margin.add_theme_constant_override("margin_bottom", 0)
	hbox.add_child(info_margin)

	var info := VBoxContainer.new()
	info.add_theme_constant_override("separation", 3)
	info_margin.add_child(info)

	var num_lbl := Label.new()
	num_lbl.text = "CUSTOM %d" % [index + 1] if is_custom else "%02d" % [index + 1]
	num_lbl.add_theme_font_size_override("font_size", 11)
	num_lbl.add_theme_color_override("font_color", Color(0.42, 0.72, 1.0, 0.62))
	info.add_child(num_lbl)

	var name_lbl := Label.new()
	name_lbl.text = String(level_data.get("name", "Untitled"))
	name_lbl.add_theme_font_size_override("font_size", 15)
	name_lbl.add_theme_color_override("font_color", Color(0.92, 0.97, 1.0, 1.0))
	name_lbl.clip_text = true
	info.add_child(name_lbl)

	var div := Control.new()
	div.custom_minimum_size = Vector2(0, 4)
	info.add_child(div)

	var score_key_str := DataManager.score_key("custom" if is_custom else "builtin", index)
	var fastest = scores.get("fastest", {}).get(score_key_str, null)
	var efficient = scores.get("efficient", {}).get(score_key_str, null)

	var time_lbl := Label.new()
	time_lbl.text = "\u23f1 %s" % format_score_entry(fastest)
	time_lbl.add_theme_font_size_override("font_size", 11)
	time_lbl.add_theme_color_override("font_color", Color(0.38, 0.88, 1.0, 0.82) if fastest != null else Color(0.4, 0.5, 0.6, 0.45))
	time_lbl.clip_text = true
	info.add_child(time_lbl)

	var boost_lbl := Label.new()
	boost_lbl.text = "\u2191 %s boost" % format_score_entry(efficient)
	boost_lbl.add_theme_font_size_override("font_size", 11)
	boost_lbl.add_theme_color_override("font_color", Color(0.82, 0.52, 1.0, 0.82) if efficient != null else Color(0.4, 0.5, 0.6, 0.45))
	boost_lbl.clip_text = true
	info.add_child(boost_lbl)

	return btn


static func make_level_minimap(level_data: Dictionary, seed_index: int) -> Control:
	var ctrl := Control.new()
	ctrl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var objects: Array = level_data.get("objects", [])
	var goal_index: int = int(level_data.get("goal", {}).get("index", -1))
	var goal_range: float = float(level_data.get("goal", {}).get("range", GameConstants.GOAL_RANGE_DEFAULT))

	ctrl.draw.connect(func() -> void:
		var sz := ctrl.size
		if sz.x < 4.0 or sz.y < 4.0:
			return

		# Background stars
		var rng := RandomNumberGenerator.new()
		rng.seed = seed_index * 1337 + 7
		for _i in range(14):
			var sx := rng.randf() * sz.x
			var sy := rng.randf() * sz.y
			var sr := rng.randf_range(0.4, 1.1)
			ctrl.draw_circle(Vector2(sx, sy), sr, Color(1.0, 1.0, 1.0, rng.randf_range(0.08, 0.32)))

		if objects.is_empty():
			return

		# Bounding box of all objects
		var min_x := INF;  var max_x := -INF
		var min_y := INF;  var max_y := -INF
		for obj in objects:
			var ox := float(obj.get("x", 960.0))
			var oy := float(obj.get("y", 540.0))
			min_x = minf(min_x, ox);  max_x = maxf(max_x, ox)
			min_y = minf(min_y, oy);  max_y = maxf(max_y, oy)

		var pad := 90.0
		min_x -= pad;  max_x += pad
		min_y -= pad;  max_y += pad

		var world_w := maxf(max_x - min_x, 1.0)
		var world_h := maxf(max_y - min_y, 1.0)
		var margin := 7.0
		var scale := minf((sz.x - margin * 2.0) / world_w, (sz.y - margin * 2.0) / world_h)
		var off := Vector2(
			margin + (sz.x - margin * 2.0 - world_w * scale) * 0.5,
			margin + (sz.y - margin * 2.0 - world_h * scale) * 0.5
		)

		# Orbital trajectory rings for moving planets
		for obj in objects:
			if String(obj.get("type", "")) != "planet":
				continue
			if bool(obj.get("anchored", false)):
				continue
			var pvel := Vector2(float(obj.get("x_vel", 0.0)), float(obj.get("y_vel", 0.0)))
			if pvel.length_squared() < 0.00001:
				continue
			var px := float(obj.get("x", 0.0))
			var py := float(obj.get("y", 0.0))
			# Find nearest sun (gravity source)
			var best_grav_src := {}
			var best_grav_dist := INF
			for src in objects:
				if String(src.get("type", "")) != "sun":
					continue
				var ddx := px - float(src.get("x", 0.0))
				var ddy := py - float(src.get("y", 0.0))
				var dd := sqrt(ddx * ddx + ddy * ddy)
				if dd < best_grav_dist:
					best_grav_dist = dd
					best_grav_src = src
			if best_grav_src.is_empty():
				continue
			var sun_screen := Vector2(
				(float(best_grav_src.get("x", 0.0)) - min_x) * scale + off.x,
				(float(best_grav_src.get("y", 0.0)) - min_y) * scale + off.y
			)
			ctrl.draw_arc(sun_screen, best_grav_dist * scale, 0.0, TAU, 52, Color(0.38, 0.65, 1.0, 0.2), 0.9, true)

		for i in range(objects.size()):
			var obj: Dictionary = objects[i]
			var pos := Vector2(
				(float(obj.get("x", 0.0)) - min_x) * scale + off.x,
				(float(obj.get("y", 0.0)) - min_y) * scale + off.y
			)
			var obj_size := float(obj.get("size", 12.0))

			match String(obj.get("type", "")):
				"sun":
					if bool(obj.get("visible", true)):
						ctrl.draw_circle(pos, maxf(9.0, obj_size * scale * 1.8), Color(1.0, 0.62, 0.12, 0.2))
						ctrl.draw_circle(pos, maxf(5.5, obj_size * scale * 0.95), Color(1.0, 0.84, 0.38, 0.9))
					else:
						ctrl.draw_arc(pos, maxf(6.0, obj_size * scale * 0.95), 0.0, TAU, 20, Color(1.0, 0.7, 0.2, 0.22), 1.0)
				"planet":
					ctrl.draw_circle(pos, maxf(6.5, obj_size * scale * 2.3 * 0.55), Color(0.2, 0.48, 0.9, 0.28))
					ctrl.draw_circle(pos, maxf(4.0, obj_size * scale * 2.3 * 0.38), Color(0.42, 0.72, 1.0, 0.85))
				"player":
					ctrl.draw_circle(pos, 4.5, Color(0.72, 0.92, 1.0, 0.28))
					ctrl.draw_circle(pos, 2.8, Color(0.92, 0.98, 1.0, 0.95))

			# Goal ring on the goal object
			if i == goal_index:
				var ring_r := maxf(9.0, goal_range * scale * 0.9)
				ctrl.draw_arc(pos, ring_r, 0.0, TAU, 36, Color(0.38, 0.92, 1.0, 0.72), 1.2, true)
				ctrl.draw_arc(pos, ring_r * 0.55, 0.0, TAU, 24, Color(0.38, 0.92, 1.0, 0.28), 0.8, true)
	)
	return ctrl


static func make_hud_panel(anchor_left: float, anchor_top: float, anchor_right: float, anchor_bottom: float, offset_left: int, offset_top: int, offset_right: int, offset_bottom: int) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.anchor_left = anchor_left
	panel.anchor_top = anchor_top
	panel.anchor_right = anchor_right
	panel.anchor_bottom = anchor_bottom
	panel.offset_left = offset_left
	panel.offset_top = offset_top
	panel.offset_right = offset_right
	panel.offset_bottom = offset_bottom
	panel.add_theme_stylebox_override("panel", hud_panel_style())
	return panel


static func make_editor_section_label(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.modulate = Color(0.66, 0.86, 1.0, 0.94)
	return label


static func make_kicker(text: String) -> Label:
	var label := Label.new()
	label.text = "• %s" % [text]
	label.modulate = Color(0.82, 0.94, 1.0, 0.92)
	return label


static func make_info_row(label_text: String, value_text: String) -> HBoxContainer:
	var row := HBoxContainer.new()

	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size = Vector2(110, 0)
	label.modulate = Color(0.78, 0.88, 1.0, 0.76)
	row.add_child(label)

	var value := Label.new()
	value.text = value_text
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	row.add_child(value)

	return row


static func accent_panel_style(bg: Color = Color(0.04, 0.11, 0.19, 0.92)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = bg
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = Color(0.39, 0.88, 1.0, 0.36)
	style.corner_radius_top_left = 22
	style.corner_radius_top_right = 22
	style.corner_radius_bottom_right = 22
	style.corner_radius_bottom_left = 22
	style.content_margin_left = 18
	style.content_margin_top = 18
	style.content_margin_right = 18
	style.content_margin_bottom = 18
	style.shadow_size = 12
	style.shadow_color = Color(0, 0, 0, 0.32)
	return style


static func menu_button_style(background: Color, border: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = border
	style.corner_radius_top_left = 12
	style.corner_radius_top_right = 28
	style.corner_radius_bottom_right = 12
	style.corner_radius_bottom_left = 28
	style.content_margin_left = 24
	style.content_margin_top = 18
	style.content_margin_right = 24
	style.content_margin_bottom = 18
	style.shadow_size = 18
	style.shadow_color = Color(0.0, 0.0, 0.0, 0.24)
	return style


static func hud_panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.03, 0.09, 0.16, 0.86)
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = Color(0.37, 0.87, 1.0, 0.34)
	style.corner_radius_top_left = 14
	style.corner_radius_top_right = 24
	style.corner_radius_bottom_right = 14
	style.corner_radius_bottom_left = 24
	style.content_margin_left = 16
	style.content_margin_top = 14
	style.content_margin_right = 16
	style.content_margin_bottom = 14
	style.shadow_size = 18
	style.shadow_color = Color(0, 0, 0, 0.28)
	return style


static func settings_card_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.12, 0.21, 0.94)
	style.border_width_left = 0
	style.border_width_top = 1
	style.border_width_right = 0
	style.border_width_bottom = 1
	style.border_color = Color(0.28, 0.65, 0.88, 0.22)
	style.corner_radius_top_left = 14
	style.corner_radius_top_right = 14
	style.corner_radius_bottom_right = 14
	style.corner_radius_bottom_left = 14
	style.content_margin_left = 18
	style.content_margin_top = 16
	style.content_margin_right = 18
	style.content_margin_bottom = 16
	style.shadow_size = 8
	style.shadow_color = Color(0, 0, 0, 0.22)
	return style


static func format_time(value: float) -> String:
	return "%.2fs" % [value]


static func format_score_entry(entry: Variant) -> String:
	if entry == null:
		return "--"
	return "%s by %s" % [format_time(float(entry.get("time", 0.0))), String(entry.get("name", "Guest"))]


static func keycode_label(keycode: int) -> String:
	if keycode == KEY_NONE:
		return "Unbound"
	return OS.get_keycode_string(keycode)


static func _load_icon_texture(path: String) -> Texture2D:
	return load(path) as Texture2D


static func _make_editor_icon_button(object_type: String, texture: Variant, audio_mgr: Node) -> Button:
	var button := Button.new()
	button.custom_minimum_size = Vector2(48, 48)
	button.text = ""
	button.mouse_filter = Control.MOUSE_FILTER_STOP
	button.focus_mode = Control.FOCUS_NONE

	if texture != null:
		var icon_texture := texture as Texture2D
		button.icon = icon_texture
		button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		button.expand_icon = true
	else:
		button.icon = _create_sun_icon_texture()
		button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		button.expand_icon = true

	button.pressed.connect(func() -> void:
		if audio_mgr:
			audio_mgr.play_ui_click()
	)

	button.set_meta("object_type", object_type)

	return button


static func _create_sun_icon_texture() -> Texture2D:
	var image := Image.create(64, 64, false, Image.FORMAT_RGBA8)

	var sun_color := Color(1.0, 0.85, 0.45, 1.0)
	var halo_color := Color(1.0, 0.78, 0.28, 0.6)
	var center := Vector2(32, 32)

	for x in range(64):
		for y in range(64):
			var pos := Vector2(x, y)
			var dist := pos.distance_to(center)

			if dist <= 12:
				image.set_pixel(x, y, sun_color)
			elif dist <= 20:
				var blend := (dist - 12.0) / 8.0
				image.set_pixel(x, y, sun_color.lerp(halo_color, blend))
			elif dist <= 26:
				var blend := (dist - 20.0) / 6.0
				image.set_pixel(x, y, halo_color.lerp(Color.TRANSPARENT, blend))

	return ImageTexture.create_from_image(image)


static func load_ui_texture(path: String) -> Texture2D:
	return load(path) as Texture2D
