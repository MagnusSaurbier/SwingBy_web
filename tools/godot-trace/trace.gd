## T-01 KEPLER — Godot-side trace exporter.
##
## Runs headless against the REAL `SwingBy2026` project and calls the REAL
## `PhysicsEngine`/`GameConstants` static classes directly (never reimplements them —
## the whole point is an independently-generated ground truth to check
## `packages/core/src/physics.ts` against). Produces one JSON file per built-in level in
## `packages/core/test/parity/traces/`. See that directory's README.md for the exact
## schema this script must produce and the invocation this is meant to be run with.
##
## Usage (run from the SwingBy_web repo root — see README.md for why cwd matters):
##
##   Godot --headless --path <SwingBy2026 checkout> --script tools/godot-trace/trace.gd
##
## Optional: pass a different output directory as the first `--` user arg, e.g.
##   Godot --headless --path <checkout> --script tools/godot-trace/trace.gd -- /tmp/out
##
## Requires Godot 4.3+ for JSON.stringify's `full_precision` parameter — without it,
## floats are truncated to a handful of significant digits and every tolerance in the
## parity suite (1e-6 .. 1e-3 world units) becomes meaningless.

extends SceneTree

const DEFAULT_OUT_DIR := "packages/core/test/parity/traces"
const LEVELS_PATH := "res://data/levels_builtin.json"

# Fixed in place of GameWorld._create_runtime_object's `randf_range(-3.0, -2.0)`.
# turn_speed feeds ONLY body["angle"], which no force calculation reads (see
# PhysicsEngine.apply_gravity_acceleration / simulate_substep / simulate_shadow_substep)
# — so this value is physically inert. It is fixed anyway, as defense in depth, so that
# re-running this exporter is itself deterministic (see README.md's determinism check).
# It is NOT written to the exported JSON regardless (angle/turnSpeed are excluded from
# the schema entirely — see README.md, "Why angle/turnSpeed are excluded").
const FIXED_TURN_SPEED := -2.5

# Canonical scripted boost/brake tape. Keep in exact sync with the copy documented in
# packages/core/test/parity/README.md and reimplemented in parity.test.ts. Deliberately
# NOT shared code with the TS side (T-01 does not import T-02 replay.ts, and this file
# has no TS runtime to share with anyway) — this exact literal is the contract.
const BOOST_TRANSITIONS: Array = [50, 150, 500, 650, 1200, 1350]
const BRAKE_TRANSITIONS: Array = [700, 760, 1500, 1650]

const ZERO_INPUT_TICKS := 2000
const ZERO_INPUT_SAMPLE_EVERY := 10
const SCRIPTED_INPUT_TICKS := 2000
const SCRIPTED_INPUT_SAMPLE_EVERY := 10
const LONG_RUN_TICKS := 10000
const LONG_RUN_SAMPLE_EVERY := 100
const LONG_RUN_LEVEL_INDEX := 0


func _init() -> void:
	_run()
	quit()


func _run() -> void:
	var out_dir := _resolve_out_dir()
	# Relative (non-res://, non-user://) paths resolve against the process's OS
	# current working directory in Godot 4 — see README.md's invocation notes.
	# `traces/.gitkeep` already ships in the repo so this is normally a no-op; the
	# explicit create-plus-verify here is a safety net for a fresh checkout.
	DirAccess.make_dir_recursive_absolute(out_dir)
	if not DirAccess.dir_exists_absolute(out_dir):
		push_error(
			"trace.gd: output dir '%s' does not exist and could not be created. " % out_dir +
			"Run this script with the SwingBy_web repo root as your working directory " +
			"(see packages/core/test/parity/README.md), or pass an explicit output " +
			"directory as the first '--' argument."
		)
		return

	var file := FileAccess.open(LEVELS_PATH, FileAccess.READ)
	if file == null:
		push_error("trace.gd: could not open %s — run with --path pointing at SwingBy2026" % LEVELS_PATH)
		return
	var levels = JSON.parse_string(file.get_as_text())
	if not (levels is Array):
		push_error("trace.gd: %s did not parse as an Array" % LEVELS_PATH)
		return

	print("trace.gd: exporting %d levels to %s" % [levels.size(), out_dir])

	for level_index in range(levels.size()):
		var level_data: Dictionary = levels[level_index]
		var trace := _trace_level(level_index, level_data)
		var out_path := "%s/level-%02d.json" % [out_dir, level_index]
		var out_file := FileAccess.open(out_path, FileAccess.WRITE)
		if out_file == null:
			push_error("trace.gd: could not write %s" % out_path)
			continue
		# indent="\t", sort_keys=true, full_precision=true — see module comment.
		out_file.store_string(JSON.stringify(trace, "\t", true, true))
		print("  wrote %s" % out_path)

	print("trace.gd: done.")


func _resolve_out_dir() -> String:
	var user_args := OS.get_cmdline_user_args()
	if user_args.size() > 0 and not user_args[0].is_empty():
		return user_args[0]
	return DEFAULT_OUT_DIR


func _trace_level(level_index: int, level_data: Dictionary) -> Dictionary:
	var goal: Dictionary = level_data.get("goal", {"index": 0, "range": GameConstants.GOAL_RANGE_DEFAULT})
	var player_index := _find_player_index(level_data.get("objects", []))

	var pristine_objects := _build_runtime_objects(level_data.get("objects", []))

	var trace := {
		"schemaVersion": 1,
		"levelIndex": level_index,
		"levelName": String(level_data.get("name", "")),
		"goalIndex": int(goal.get("index", 0)),
		"goalRange": float(goal.get("range", GameConstants.GOAL_RANGE_DEFAULT)),
		"playerIndex": player_index,
		"initialBodies": _export_bodies(pristine_objects),
	}

	trace["zeroInput"] = _run_zero_input(_deep_copy(pristine_objects), ZERO_INPUT_TICKS, ZERO_INPUT_SAMPLE_EVERY)
	trace["scriptedInput"] = _run_scripted_input(_deep_copy(pristine_objects), SCRIPTED_INPUT_TICKS, SCRIPTED_INPUT_SAMPLE_EVERY)
	trace["prediction"] = _run_prediction(_deep_copy(pristine_objects))

	if level_index == LONG_RUN_LEVEL_INDEX:
		trace["longRun"] = _run_zero_input(_deep_copy(pristine_objects), LONG_RUN_TICKS, LONG_RUN_SAMPLE_EVERY)

	return trace


func _find_player_index(objects: Array) -> int:
	for i in range(objects.size()):
		if String(objects[i].get("type", "")) == "player":
			return i
	return 0


## Mirrors GameWorld._create_runtime_object (see reference/godot/scripts/GameWorld.gd),
## minus the parts that only matter for rendering/editor bookkeeping (start_x etc, which
## PhysicsEngine never reads). `boost_type` is a cosmetic rocket-skin index that no
## PhysicsEngine function ever reads (verified against every static func in
## PhysicsEngine.gd) — carried through only so the exported trace has a value, not
## because it affects any trajectory.
func _build_runtime_objects(raw_objects: Array) -> Array:
	var result: Array = []
	for raw in raw_objects:
		var object_type := String(raw.get("type", "sun"))
		var default_size := 10.0
		if object_type == "sun":
			default_size = 18.0
		elif object_type == "player":
			default_size = 12.0
		var boost_type: int = clampi(int(raw.get("boost_type", 1)) - 1, 0, 3)
		result.append({
			"type": object_type,
			"x": float(raw.get("x", 0.0)),
			"y": float(raw.get("y", 0.0)),
			"x_vel": float(raw.get("x_vel", 0.0)),
			"y_vel": float(raw.get("y_vel", 0.0)),
			"x_acc": 0.0,
			"y_acc": 0.0,
			"gravity": float(raw.get("gravity", 0.0)),
			"anchored": bool(raw.get("anchored", false)),
			"visible": bool(raw.get("visible", true)),
			"size": float(raw.get("size", default_size)),
			"boost_type": boost_type,
			"turn_speed": FIXED_TURN_SPEED,
			"angle": 0.0,
			"is_boosting": false,
			"is_braking": false,
		})
	return result


func _deep_copy(objects: Array) -> Array:
	var out: Array = []
	for obj in objects:
		out.append(obj.duplicate(true))
	return out


## Runtime dict (snake_case, includes angle/turn_speed/start_*) -> exported dict
## (camelCase, Body-shaped, angle/turnSpeed EXCLUDED). See README.md.
func _export_body(obj: Dictionary) -> Dictionary:
	return {
		"type": obj["type"],
		"x": obj["x"],
		"y": obj["y"],
		"xVel": obj["x_vel"],
		"yVel": obj["y_vel"],
		"xAcc": obj["x_acc"],
		"yAcc": obj["y_acc"],
		"gravity": obj["gravity"],
		"size": obj["size"],
		"visible": obj.get("visible", true),
		"anchored": obj.get("anchored", false),
		"isBoosting": obj.get("is_boosting", false),
		"isBraking": obj.get("is_braking", false),
		"boostType": obj.get("boost_type", 0),
	}


func _export_bodies(objects: Array) -> Array:
	var out: Array = []
	for obj in objects:
		out.append(_export_body(obj))
	return out


func _input_at_tick(transitions: Array, tick: int) -> bool:
	var count := 0
	for t in transitions:
		if int(t) <= tick:
			count += 1
		else:
			break
	return (count % 2) == 1


## Zero input for `total_ticks`, sampling every `sample_every` ticks INCLUDING tick 0.
func _run_zero_input(objects: Array, total_ticks: int, sample_every: int) -> Dictionary:
	var samples: Array = []
	samples.append({"tick": 0, "bodies": _export_bodies(objects)})

	for tick in range(1, total_ticks + 1):
		_physics_tick(objects, false, false)
		if tick % sample_every == 0:
			samples.append({"tick": tick, "bodies": _export_bodies(objects)})

	return {
		"totalTicks": total_ticks,
		"sampleEveryTicks": sample_every,
		"samples": samples,
	}


func _run_scripted_input(objects: Array, total_ticks: int, sample_every: int) -> Dictionary:
	var samples: Array = []
	samples.append({"tick": 0, "bodies": _export_bodies(objects)})

	for tick in range(1, total_ticks + 1):
		# Input state is sampled once per TICK, not per substep — matches
		# GameWorld._physics_tick reading input_handler state once and PhysicsEngine.gd
		# receiving the same touch_boost/touch_brake across every substep of the tick.
		var boost := _input_at_tick(BOOST_TRANSITIONS, tick)
		var brake := _input_at_tick(BRAKE_TRANSITIONS, tick)
		_physics_tick(objects, boost, brake)
		if tick % sample_every == 0:
			samples.append({"tick": tick, "bodies": _export_bodies(objects)})

	return {
		"totalTicks": total_ticks,
		"sampleEveryTicks": sample_every,
		"boostTransitions": BOOST_TRANSITIONS,
		"brakeTransitions": BRAKE_TRANSITIONS,
		"samples": samples,
	}


## One full tick: substep_count once (pre-step state), then that many substeps of
## simulate_substep, exactly mirroring GameWorld._physics_tick's physics-only portion
## (trail/camera/audio/win/bounds bookkeeping is deliberately not reproduced here — this
## script's only job is trajectories).
func _physics_tick(objects: Array, boost_pressed: bool, brake_pressed: bool) -> void:
	var substeps := PhysicsEngine.substep_count(objects)
	var substep_scale := 1.0 / float(substeps)
	var thrusting := false
	# This exporter never exercises first-boost tracking (not part of the traced
	# schema); pass an always-false "already fired" flag so boost still applies its
	# rescale every time it is pressed, mirroring an attempt where boost has never
	# fired before this call sequence started being relevant to the trace.
	for _sub in range(substeps):
		var result := PhysicsEngine.simulate_substep(
			objects,
			true,
			substep_scale,
			thrusting,
			{},
			boost_pressed,
			brake_pressed,
			Vector2.ZERO,
			false
		)
		thrusting = result["thrusting"]


func _run_prediction(objects: Array) -> Dictionary:
	var result := PhysicsEngine.recalculate_predictions(objects)
	var player_out: Array = []
	for p in result["player"]:
		player_out.append({"x": p.x, "y": p.y})
	var planets_out: Array = []
	for track in result["planets"]:
		var track_out: Array = []
		for p in track:
			track_out.append({"x": p.x, "y": p.y})
		planets_out.append(track_out)
	return {"player": player_out, "planets": planets_out}
