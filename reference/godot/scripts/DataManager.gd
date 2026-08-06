extends Node

var settings: Dictionary = {}
var scores := {"fastest": {}, "efficient": {}}
var builtin_levels: Array = []
var custom_levels: Array = []


func _ready() -> void:
	settings = GameConstants.DEFAULT_SETTINGS.duplicate(true)
	builtin_levels = _load_builtin_levels()
	custom_levels = _read_json(GameConstants.CUSTOM_LEVELS_PATH, [])
	_load_settings()
	_load_scores()


func persist_settings() -> void:
	_write_json(GameConstants.SETTINGS_PATH, settings)


func submit_score(score_key: String, time_elapsed: float, boost_elapsed: float) -> void:
	var username := String(settings.get("username", "Guest"))

	var fastest_bucket: Dictionary = scores.get("fastest", {})
	var fastest_existing = fastest_bucket.get(score_key, null)
	if fastest_existing == null or float(fastest_existing.get("time", INF)) > time_elapsed:
		fastest_bucket[score_key] = {"time": time_elapsed, "name": username}

	var efficient_bucket: Dictionary = scores.get("efficient", {})
	var efficient_existing = efficient_bucket.get(score_key, null)
	if efficient_existing == null or float(efficient_existing.get("time", INF)) > boost_elapsed:
		efficient_bucket[score_key] = {"time": boost_elapsed, "name": username}

	scores["fastest"] = fastest_bucket
	scores["efficient"] = efficient_bucket
	_write_json(GameConstants.SCORES_PATH, scores)


func set_username(value: String) -> void:
	var cleaned := value.strip_edges()
	settings["username"] = cleaned if not cleaned.is_empty() else "Guest"
	persist_settings()


func set_boost_type(value: int) -> void:
	settings["boost_type"] = clamp(value, 0, 3)
	persist_settings()


func set_bool_setting(key: String, value: bool) -> void:
	settings[key] = value
	persist_settings()


func set_control_binding(action_name: String, keycode: int) -> void:
	var controls: Dictionary = settings.get("controls", GameConstants.DEFAULT_CONTROLS.duplicate(true))
	controls[action_name] = keycode
	settings["controls"] = controls
	persist_settings()


func score_key(category: String, level_index: int) -> String:
	if category == "tutorial":
		return ""
	return "%s_%d" % [category, level_index]


func build_tutorial_level() -> Dictionary:
	var tutorial_level: Dictionary = GameConstants.TUTORIAL_TEMPLATE.duplicate(true)
	var tutorial_objects: Array = tutorial_level.get("objects", [])
	if not tutorial_objects.is_empty():
		var player_data: Dictionary = tutorial_objects[0]
		player_data["boost_type"] = int(settings.get("boost_type", 0)) + 1
	return tutorial_level


func save_custom_level(level_data: Dictionary) -> void:
	custom_levels.append(level_data)
	_write_json(GameConstants.CUSTOM_LEVELS_PATH, custom_levels)


func _load_builtin_levels() -> Array:
	var file := FileAccess.open("res://data/levels_builtin.json", FileAccess.READ)
	if file == null:
		return []
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Array else []


func _load_settings() -> void:
	var persisted = _read_json(GameConstants.SETTINGS_PATH, {})
	if persisted is Dictionary:
		for key in GameConstants.DEFAULT_SETTINGS.keys():
			if persisted.has(key):
				settings[key] = persisted[key]
	var loaded_controls = settings.get("controls", {})
	if loaded_controls is Dictionary:
		var merged_controls := GameConstants.DEFAULT_CONTROLS.duplicate(true)
		for action_name in loaded_controls.keys():
			merged_controls[action_name] = loaded_controls[action_name]
		settings["controls"] = merged_controls
	else:
		settings["controls"] = GameConstants.DEFAULT_CONTROLS.duplicate(true)


func _load_scores() -> void:
	var persisted = _read_json(GameConstants.SCORES_PATH, {})
	if persisted is Dictionary:
		scores["fastest"] = persisted.get("fastest", {})
		scores["efficient"] = persisted.get("efficient", {})


func _read_json(path: String, fallback: Variant) -> Variant:
	if not FileAccess.file_exists(path):
		return fallback
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return fallback
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if parsed != null else fallback


func _write_json(path: String, value: Variant) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(value, "\t"))
