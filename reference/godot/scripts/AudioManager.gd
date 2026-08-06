extends Node

const SAMPLE_RATE := 22050
const BOOST_ACTIVE_DB := -2.0
const BOOST_FADE_OUT_SPEED := 55.0
const CLICK_STREAM := preload("res://audio/sfx/click.wav")
const LEVEL_START_STREAM := preload("res://audio/sfx/level_start.wav")
const ALARM_STREAM := preload("res://audio/sfx/alarm.wav")
const GOAL_STREAM := preload("res://audio/sfx/bling.wav")
const TELEPORT_STREAM := preload("res://audio/sfx/teleport.wav")
const BRAKE_BUZZ_STREAM := preload("res://audio/sfx/brake_buzz.wav")

var _ambient_player: AudioStreamPlayer
var _boost_player: AudioStreamPlayer
var _alarm_player: AudioStreamPlayer
var _click_player: AudioStreamPlayer
var _level_start_player: AudioStreamPlayer
var _goal_player: AudioStreamPlayer
var _teleport_player: AudioStreamPlayer
var _brake_player: AudioStreamPlayer

var _ambient_stream: AudioStream
var _boost_stream: AudioStream
var _boost_wanted := false
var _alarm_wanted := false
var _brake_wanted := false


func _ready() -> void:
	set_process(true)
	_ensure_master_bus_audible()

	_ambient_player = AudioStreamPlayer.new()
	_ambient_player.bus = &"Master"
	_ambient_player.volume_db = -12.0
	add_child(_ambient_player)

	_boost_player = AudioStreamPlayer.new()
	_boost_player.bus = &"Master"
	_boost_player.volume_db = BOOST_ACTIVE_DB
	add_child(_boost_player)

	_alarm_player = AudioStreamPlayer.new()
	_alarm_player.bus = &"Master"
	_alarm_player.volume_db = -1.0
	add_child(_alarm_player)

	_click_player = AudioStreamPlayer.new()
	_click_player.bus = &"Master"
	_click_player.volume_db = 0.0
	add_child(_click_player)

	_level_start_player = AudioStreamPlayer.new()
	_level_start_player.bus = &"Master"
	_level_start_player.volume_db = 0.0
	add_child(_level_start_player)

	_goal_player = AudioStreamPlayer.new()
	_goal_player.bus = &"Master"
	_goal_player.volume_db = 1.5
	add_child(_goal_player)

	_teleport_player = AudioStreamPlayer.new()
	_teleport_player.bus = &"Master"
	_teleport_player.volume_db = 0.0
	add_child(_teleport_player)

	_brake_player = AudioStreamPlayer.new()
	_brake_player.bus = &"Master"
	_brake_player.volume_db = 4.0
	add_child(_brake_player)

	_ambient_stream = _make_tone([55.0, 82.5, 110.0], 3.8, 0.28, true, 2.0)
	var _wav := load("res://audio/sfx/boost.wav")
	_boost_stream = _wav if _wav != null else _make_rocket_sound()

	_ambient_player.stream = _ambient_stream
	_boost_player.stream = _boost_stream
	_alarm_player.stream = ALARM_STREAM
	_click_player.stream = _make_click_sound()
	_level_start_player.stream = LEVEL_START_STREAM
	_goal_player.stream = GOAL_STREAM
	_teleport_player.stream = TELEPORT_STREAM
	_brake_player.stream = BRAKE_BUZZ_STREAM


func _ensure_master_bus_audible() -> void:
	var master_bus := AudioServer.get_bus_index(&"Master")
	if master_bus == -1:
		return
	AudioServer.set_bus_mute(master_bus, false)
	AudioServer.set_bus_solo(master_bus, false)
	if AudioServer.get_bus_volume_db(master_bus) < -3.0:
		AudioServer.set_bus_volume_db(master_bus, 0.0)


func _exit_tree() -> void:
	if _ambient_player != null:
		_ambient_player.stop()
		_ambient_player.stream = null
	if _boost_player != null:
		_boost_player.stop()
		_boost_player.stream = null
	if _alarm_player != null:
		_alarm_player.stop()
		_alarm_player.stream = null
	if _click_player != null:
		_click_player.stop()
		_click_player.stream = null
	if _level_start_player != null:
		_level_start_player.stop()
		_level_start_player.stream = null
	if _goal_player != null:
		_goal_player.stop()
		_goal_player.stream = null
	if _teleport_player != null:
		_teleport_player.stop()
		_teleport_player.stream = null
	if _brake_player != null:
		_brake_player.stop()
		_brake_player.stream = null
	_ambient_stream = null
	_boost_stream = null


func ensure_ambient() -> void:
	if not _ambient_player.playing:
		_ambient_player.play()


func set_boost_active(active: bool) -> void:
	_boost_wanted = active

func set_alarm_active(active: bool) -> void:
	_alarm_wanted = active

func set_brake_active(active: bool) -> void:
	_brake_wanted = active


func play_ui_click() -> void:
	if _click_player != null:
		_click_player.play(0.0)


func play_level_start() -> void:
	if _level_start_player != null:
		_level_start_player.play(0.0)


func play_goal_fanfare() -> void:
	if _goal_player != null:
		_goal_player.play(0.0)


func play_teleport() -> void:
	if _teleport_player != null:
		_teleport_player.play(0.0)


func _process(delta: float) -> void:
	if _boost_wanted:
		if not _boost_player.playing:
			_boost_player.volume_db = BOOST_ACTIVE_DB
			_boost_player.play(0.0)
		else:
			_boost_player.volume_db = BOOST_ACTIVE_DB
	else:
		if _boost_player.playing:
			_boost_player.volume_db = move_toward(_boost_player.volume_db, -80.0, BOOST_FADE_OUT_SPEED * delta)
			if _boost_player.volume_db <= -75.0:
				_boost_player.stop()

	if _alarm_wanted:
		if not _alarm_player.playing:
			_alarm_player.play(0.0)
	else:
		_alarm_player.stop()

	if _brake_wanted:
		if not _brake_player.playing:
			_brake_player.volume_db = 4.0
			_brake_player.play(0.0)
		else:
			_brake_player.volume_db = 4.0
	else:
		if _brake_player.playing:
			_brake_player.volume_db = move_toward(_brake_player.volume_db, -80.0, BOOST_FADE_OUT_SPEED * delta)
			if _brake_player.volume_db <= -75.0:
				_brake_player.stop()
				_brake_player.volume_db = 4.0


func _make_sequence(chords: Array, lengths: Array, volume: float) -> AudioStreamWAV:
	var total_samples = 0
	for length in lengths:
		total_samples += int(SAMPLE_RATE * float(length))

	var bytes = PackedByteArray()
	bytes.resize(total_samples * 2)

	var cursor = 0
	for chord_index in range(chords.size()):
		var freqs: Array = chords[chord_index]
		var length: float = float(lengths[chord_index])
		var sample_count := int(SAMPLE_RATE * length)
		for i in range(sample_count):
			var t = float(i) / SAMPLE_RATE
			var env = min(1.0, t / 0.015) * min(1.0, (length - t) / 0.08)
			var sample = 0.0
			for freq in freqs:
				sample += sin(TAU * float(freq) * t)
			sample /= max(1, freqs.size())
			_write_16_bit(bytes, cursor * 2, int(clamp(sample * volume * env, -1.0, 1.0) * 32767.0))
			cursor += 1

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.data = bytes
	return stream


func _make_rocket_sound() -> AudioStreamWAV:
	# Layered filtered noise — no pure tones, so no humming
	var duration := 1.5
	var sample_count := int(SAMPLE_RATE * duration)
	var bytes := PackedByteArray()
	bytes.resize(sample_count * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 424242
	# Three noise bands with different filter speeds
	var low := 0.0   # slow-moving low rumble
	var mid := 0.0   # medium exhaust body
	var high := 0.0  # fast hiss/crackle

	for i in range(sample_count):
		var raw := rng.randf_range(-1.0, 1.0)
		low  = lerpf(low,  raw, 0.04)   # heavy low-pass → rumble
		mid  = lerpf(mid,  raw, 0.18)   # mid-pass body
		high = lerpf(high, raw, 0.55)   # less filtered → hiss

		# Mix: emphasise low rumble and mid body, lighter hiss
		var sample := low * 0.55 + mid * 0.35 + (high - mid) * 0.18
		_write_16_bit(bytes, i * 2, int(clamp(sample * 0.82, -1.0, 1.0) * 32767.0))

	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.data = bytes
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = sample_count - 1
	return stream


func _make_tone(freqs: Array, duration: float, volume: float, loop: bool, wobble: float) -> AudioStreamWAV:
	var sample_count = int(SAMPLE_RATE * duration)
	var bytes = PackedByteArray()
	bytes.resize(sample_count * 2)

	for i in range(sample_count):
		var t = float(i) / SAMPLE_RATE
		var env = 1.0
		if not loop:
			env = min(1.0, t / 0.02) * min(1.0, (duration - t) / 0.08)

		var sample = 0.0
		for freq in freqs:
			var value = sin(TAU * float(freq) * t)
			if wobble > 0.0:
				value += 0.45 * sin(TAU * (float(freq) * 0.5) * t + sin(t * wobble))
			sample += value
		sample /= max(1, freqs.size())
		_write_16_bit(bytes, i * 2, int(clamp(sample * volume * env, -1.0, 1.0) * 32767.0))

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.data = bytes
	if loop:
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	return stream


func _make_click_sound() -> AudioStreamWAV:
	# Short sharp transient: no lead-in, immediate full amplitude, fast decay
	var duration := 0.018
	var sample_count := int(SAMPLE_RATE * duration)
	var bytes := PackedByteArray()
	bytes.resize(sample_count * 2)
	for i in range(sample_count):
		var t := float(i) / SAMPLE_RATE
		var env := exp(-t * 260.0)
		var sample := sin(TAU * 1400.0 * t) * 0.55
		sample += sin(TAU * 3200.0 * t) * 0.25
		sample += sin(TAU * 180.0 * t) * 0.45
		sample *= env
		_write_16_bit(bytes, i * 2, int(clamp(sample, -1.0, 1.0) * 32767.0))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.data = bytes
	return stream


func _write_16_bit(buffer: PackedByteArray, index: int, sample: int) -> void:
	buffer[index] = sample & 0xFF
	buffer[index + 1] = (sample >> 8) & 0xFF
