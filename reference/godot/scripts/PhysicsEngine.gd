class_name PhysicsEngine


static func substep_count(target_objects: Array) -> int:
	var required := GameConstants.PHYSICS_SUBSTEPS
	for i in range(target_objects.size()):
		var body: Dictionary = target_objects[i]
		if String(body["type"]) == "sun":
			continue
		var body_speed := Vector2(float(body["x_vel"]), float(body["y_vel"])).length()
		for source_index in range(target_objects.size()):
			if source_index == i:
				continue
			var source: Dictionary = target_objects[source_index]
			if float(source.get("gravity", 0.0)) == 0.0:
				continue
			var dx := float(body["x"]) - float(source["x"])
			var dy := float(body["y"]) - float(source["y"])
			var dist_sq := (dx * dx) + (dy * dy)
			var distance := sqrt(maxf(dist_sq, 0.000001))
			var softening_radius := gravity_softening_radius(body, source)
			var softened_dist_sq := dist_sq + (softening_radius * softening_radius)
			var accel_mag := float(source["gravity"]) * distance / pow(softened_dist_sq, 1.5)
			required = maxi(required, int(ceil((accel_mag * GameConstants.TICK_INTERVAL) / GameConstants.MAX_GRAVITY_DV_PER_SUBSTEP)))
			var travel_budget := maxf(GameConstants.MIN_TRAVEL_RESOLUTION, softening_radius * 0.35)
			required = maxi(required, int(ceil((body_speed * GameConstants.TICK_INTERVAL) / travel_budget)))
	return clampi(required, GameConstants.PHYSICS_SUBSTEPS, GameConstants.PHYSICS_SUBSTEPS_MAX)


static func simulate_substep(
		target_objects: Array,
		allow_player_input: bool,
		step_scale: float,
		thrusting: bool,
		settings: Dictionary,
		touch_boost: bool,
		touch_brake: bool,
		touch_direction: Vector2,
		first_boost_fired: bool) -> Dictionary:
	var first_boost_triggered := false
	for i in range(target_objects.size()):
		var body: Dictionary = target_objects[i]
		if String(body["type"]) == "sun" or bool(body.get("anchored", false)):
			continue

		body["x_acc"] = 0.0
		body["y_acc"] = 0.0

		if String(body["type"]) == "player" and allow_player_input:
			var result := apply_player_input(body, step_scale, settings, touch_boost, touch_brake, touch_direction, first_boost_fired)
			if result["thrusting"]:
				thrusting = true
			if result["first_boost_triggered"]:
				first_boost_triggered = true
				first_boost_fired = true

		for source_index in range(target_objects.size()):
			if source_index == i:
				continue
			var source: Dictionary = target_objects[source_index]
			if float(source.get("gravity", 0.0)) == 0.0:
				continue
			apply_gravity_acceleration(body, source)

		body["x_vel"] = float(body["x_vel"]) + (float(body["x_acc"]) * step_scale)
		body["y_vel"] = float(body["y_vel"]) + (float(body["y_acc"]) * step_scale)
		body["x"] = float(body["x"]) + (float(body["x_vel"]) * step_scale)
		body["y"] = float(body["y"]) + (float(body["y_vel"]) * step_scale)
		if String(body["type"]) == "planet":
			body["angle"] = float(body["angle"]) + (deg_to_rad(float(body["turn_speed"])) * step_scale)

	return {"thrusting": thrusting, "first_boost_triggered": first_boost_triggered}


static func simulate_shadow_substep(target_objects: Array, step_scale: float) -> void:
	for i in range(target_objects.size()):
		var body: Dictionary = target_objects[i]
		if String(body["type"]) == "sun" or bool(body.get("anchored", false)):
			continue

		body["x_acc"] = 0.0
		body["y_acc"] = 0.0
		for source_index in range(target_objects.size()):
			if source_index == i:
				continue
			var source: Dictionary = target_objects[source_index]
			if float(source.get("gravity", 0.0)) == 0.0:
				continue
			apply_gravity_acceleration(body, source)

		body["x_vel"] = float(body["x_vel"]) + (float(body["x_acc"]) * step_scale)
		body["y_vel"] = float(body["y_vel"]) + (float(body["y_acc"]) * step_scale)
		body["x"] = float(body["x"]) + (float(body["x_vel"]) * step_scale)
		body["y"] = float(body["y"]) + (float(body["y_vel"]) * step_scale)


static func apply_player_input(
		player: Dictionary,
		step_scale: float,
		settings: Dictionary,
		touch_boost: bool,
		touch_brake: bool,
		touch_direction: Vector2,
		first_boost_fired: bool) -> Dictionary:
	var boost_pressed := touch_boost or _is_action_pressed("boost", settings) or Input.is_joy_button_pressed(0, JOY_BUTTON_A) or Input.is_joy_button_pressed(0, JOY_BUTTON_RIGHT_SHOULDER)
	var brake_pressed := touch_brake or _is_action_pressed("brake", settings) or Input.is_joy_button_pressed(0, JOY_BUTTON_B) or Input.is_joy_button_pressed(0, JOY_BUTTON_LEFT_SHOULDER)
	var direction := touch_direction
	if direction == Vector2.ZERO:
		direction = Vector2(
			int(_is_action_pressed("thrust_right", settings)) - int(_is_action_pressed("thrust_left", settings)),
			int(_is_action_pressed("thrust_down", settings)) - int(_is_action_pressed("thrust_up", settings))
		)

	player["is_boosting"] = boost_pressed
	player["is_braking"] = brake_pressed

	var velocity := Vector2(float(player["x_vel"]), float(player["y_vel"]))
	var speed := velocity.length()
	var step_boost := GameConstants.BOOST_STRENGTH * step_scale
	var first_boost_triggered := false

	if boost_pressed:
		if speed > 0.0:
			var share := (speed + step_boost) / speed
			player["x_vel"] = float(player["x_vel"]) * share
			player["y_vel"] = float(player["y_vel"]) * share
		else:
			player["x_vel"] = float(player["x_vel"]) + step_boost
		if not first_boost_fired:
			first_boost_triggered = true
	elif brake_pressed and speed > 0.0:
		var brake_share := maxf(0.0, speed - step_boost) / speed
		player["x_vel"] = float(player["x_vel"]) * brake_share
		player["y_vel"] = float(player["y_vel"]) * brake_share

	if direction != Vector2.ZERO:
		direction = direction.normalized()
		player["x_acc"] = float(player["x_acc"]) + direction.x * GameConstants.SIDE_THRUST
		player["y_acc"] = float(player["y_acc"]) + direction.y * GameConstants.SIDE_THRUST

	return {
		"thrusting": boost_pressed or brake_pressed or direction != Vector2.ZERO,
		"first_boost_triggered": first_boost_triggered
	}


static func apply_gravity_acceleration(body: Dictionary, source: Dictionary) -> void:
	var dx := float(body["x"]) - float(source["x"])
	var dy := float(body["y"]) - float(source["y"])
	var dist_sq := (dx * dx) + (dy * dy)
	var softening_radius := gravity_softening_radius(body, source)
	var softened_dist_sq := dist_sq + (softening_radius * softening_radius)
	if softened_dist_sq <= 0.000001:
		return
	var dist_1_5 := pow(softened_dist_sq, 1.5)
	body["x_acc"] = float(body["x_acc"]) - (float(source["gravity"]) * dx / dist_1_5)
	body["y_acc"] = float(body["y_acc"]) - (float(source["gravity"]) * dy / dist_1_5)


static func gravity_softening_radius(body: Dictionary, source: Dictionary) -> float:
	var source_size := float(source.get("size", 10.0))
	var body_size := float(body.get("size", 10.0))
	return maxf(14.0, (source_size * 1.15) + (body_size * 0.55) + 6.0)


static func recalculate_predictions(objects: Array) -> Dictionary:
	var shadow_objects: Array = []
	for obj in objects:
		shadow_objects.append(obj.duplicate(true))

	var prediction_player: Array = []
	var prediction_planets: Array = []

	var moving_count := 0
	var planet_count := 0
	for obj in shadow_objects:
		if String(obj["type"]) != "sun":
			moving_count += 1
		if String(obj["type"]) == "planet":
			planet_count += 1

	var ticks: int = GameConstants.PREDICTION_TICKS
	if moving_count > 4:
		ticks = GameConstants.PREDICTION_TICKS * 2 / 3
	if moving_count > 6:
		ticks = GameConstants.PREDICTION_TICKS / 2

	var planet_stride := GameConstants.PREDICTION_STRIDE * (2 if planet_count > 2 else 1)
	var substeps := substep_count(shadow_objects)
	var substep_scale := 1.0 / float(substeps)

	var planet_tracks := {}
	for i in range(shadow_objects.size()):
		if String(shadow_objects[i]["type"]) == "planet":
			planet_tracks[i] = []

	for tick in range(ticks):
		for _sub in range(substeps):
			simulate_shadow_substep(shadow_objects, substep_scale)

		if tick % GameConstants.PREDICTION_STRIDE == 0:
			for i in range(shadow_objects.size()):
				if String(shadow_objects[i]["type"]) == "player":
					prediction_player.append(Vector2(float(shadow_objects[i]["x"]), float(shadow_objects[i]["y"])))
		if tick % planet_stride == 0:
			for i in planet_tracks.keys():
				planet_tracks[i].append(Vector2(float(shadow_objects[i]["x"]), float(shadow_objects[i]["y"])))

	for key in planet_tracks.keys():
		prediction_planets.append(planet_tracks[key])

	return {"player": prediction_player, "planets": prediction_planets}


static func rocket_angle_from_velocity(velocity: Vector2) -> float:
	if velocity.length_squared() <= 0.000001:
		return 0.0
	return velocity.angle() + PI / 2.0


static func _is_action_pressed(action_name: String, settings: Dictionary) -> bool:
	var controls: Dictionary = settings.get("controls", {})
	var keycode := int(controls.get(action_name, KEY_NONE))
	return keycode != KEY_NONE and Input.is_key_pressed(keycode)
