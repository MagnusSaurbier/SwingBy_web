class_name GameConstants

const TPS := 144.0
const TICK_INTERVAL := 1.0 / TPS
const PHYSICS_SUBSTEPS := 4
const PHYSICS_SUBSTEPS_MAX := 12
const ZOOM_SMOOTHING := 8.0
const ZOOM_IN_SMOOTHING := 20.0
const ZOOM_MARGIN := 0.72
const BOOST_STRENGTH := 0.005
const SIDE_THRUST := 0.0
const MAX_GRAVITY_DV_PER_SUBSTEP := 0.045
const MIN_TRAVEL_RESOLUTION := 10.0
const MAX_WORLD_BOUNDS := Vector2(2600.0, 1800.0)
const BOUNDS_WARNING_START_RATIO := 0.8
const BOUNDS_WARNING_DURATION := 0.65
const BOUNDS_WARNING_BORDER := 24.0
const RESET_FLASH_DURATION := 0.24
const PREDICTION_TICKS := 1000
const PREDICTION_STRIDE := 5
const GOAL_RANGE_DEFAULT := 50.0
const TRAIL_LENGTH := 5000
const ROCKET_SCALE := 0.17

const MODE_MENU := "menu"
const MODE_PLAY := "play"
const MODE_EDITOR := "editor"

const SUN_CORE := Color(1.0, 0.85, 0.45, 1.0)
const SUN_HALO := Color(1.0, 0.68, 0.21, 0.18)
const GOAL_COLOR := Color(0.48, 0.96, 1.0, 0.82)
const TRAIL_COLOR := Color(0.58, 0.86, 1.0, 0.78)
const PREDICTION_PLAYER := Color(0.97, 0.98, 1.0, 0.72)
const PREDICTION_PLANET := Color(0.48, 0.84, 1.0, 0.42)
const HUD_GLOW := Color(0.62, 0.92, 1.0, 0.18)

const SETTINGS_PATH := "user://settings.json"
const SCORES_PATH := "user://scores.json"
const CUSTOM_LEVELS_PATH := "user://custom_levels.json"

const DEFAULT_CONTROLS := {
	"boost": KEY_SPACE,
	"brake": KEY_SHIFT,
	"thrust_up": KEY_W,
	"thrust_down": KEY_S,
	"thrust_left": KEY_A,
	"thrust_right": KEY_D,
	"restart": KEY_R,
	"pause": KEY_BACKSPACE,
	"menu": KEY_ESCAPE,
	"toggle_fps": KEY_F1,
	"toggle_highscores": KEY_H
}

const DEFAULT_SETTINGS := {
	"username": "Guest",
	"boost_type": 0,
	"trail": false,
	"show_fps": false,
	"show_highscores": true,
	"show_times": true,
	"show_future": false,
	"show_force_vector": false,
	"controls": DEFAULT_CONTROLS
}

const TUTORIAL_TEMPLATE := {
	"name": "Flight Basics",
	"author": "OpenAI",
	"goal": {"index": 2, "range": 122},
	"objects": [
		{
			"type": "player",
			"x": 520.0,
			"y": 690.0,
			"boost_type": 1,
			"x_vel": 1.18,
			"y_vel": -0.1,
			"gravity": 0.0
		},
		{
			"type": "sun",
			"x": 980.0,
			"y": 560.0,
			"gravity": 440.0,
			"visible": true,
			"size": 19.0
		},
		{
			"type": "planet",
			"x": 1435.0,
			"y": 435.0,
			"x_vel": 0.0,
			"y_vel": 0.0,
			"gravity": 0.0,
			"size": 11.0
		}
	]
}
