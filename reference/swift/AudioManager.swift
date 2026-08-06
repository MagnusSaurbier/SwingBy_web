import AVFoundation
import Foundation

// MARK: - AudioManager

final class AudioManager {
    static let shared = AudioManager()

    private let engine = AVAudioEngine()
    private let masterMixer = AVAudioMixerNode()

    // Voices
    private var ambientNode: AVAudioSourceNode?
    private var boostNode:   AVAudioSourceNode?
    private var brakeNode:   AVAudioSourceNode?
    private var alarmNode:   AVAudioSourceNode?

    // Thread-safe gain state (accessed from audio thread)
    nonisolated(unsafe) private var ambientGain: Float = 0.04
    nonisolated(unsafe) private var boostGain:   Float = 0
    nonisolated(unsafe) private var brakeGain:   Float = 0
    nonisolated(unsafe) private var alarmGain:   Float = 0

    // Target gains for ramping (audio thread)
    nonisolated(unsafe) private var boostTargetGain: Float = 0
    nonisolated(unsafe) private var brakeTargetGain: Float = 0
    nonisolated(unsafe) private var alarmTargetGain: Float = 0

    // Phase accumulators (audio thread only)
    nonisolated(unsafe) private var ambientPhase: Double = 0
    nonisolated(unsafe) private var boostPhase:   Double = 0
    nonisolated(unsafe) private var brakePhase:   Double = 0
    nonisolated(unsafe) private var alarmPhase:   Double = 0
    nonisolated(unsafe) private var alarmLFOPhase: Double = 0

    private var isSetUp = false
    private var sampleRate: Double = 44100

    private init() { setup() }

    private func setup() {
        do {
            engine.attach(masterMixer)
            engine.connect(masterMixer, to: engine.mainMixerNode, format: nil)

            let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
            sampleRate = format.sampleRate

            ambientNode = makeNode(format: format) { [weak self] frameCount in
                self?.ambientSamples(count: frameCount) ?? []
            }
            boostNode = makeNode(format: format) { [weak self] frameCount in
                self?.boostSamples(count: frameCount) ?? []
            }
            brakeNode = makeNode(format: format) { [weak self] frameCount in
                self?.brakeSamples(count: frameCount) ?? []
            }
            alarmNode = makeNode(format: format) { [weak self] frameCount in
                self?.alarmSamples(count: frameCount) ?? []
            }

            for node in [ambientNode, boostNode, brakeNode, alarmNode].compactMap({ $0 }) {
                engine.attach(node)
                engine.connect(node, to: masterMixer, format: format)
            }

            try engine.start()
            isSetUp = true
        } catch {
            // Audio is non-critical; fail silently
        }
    }

    // MARK: - Sample generators (called on audio thread)

    private func ambientSamples(count: AVAudioFrameCount) -> [Float] {
        let inc = 2.0 * Double.pi * 60.0 / sampleRate
        return (0 ..< Int(count)).map { _ in
            let s = Float(sin(ambientPhase)) * ambientGain
            ambientPhase += inc
            return s
        }
    }

    private func boostSamples(count: AVAudioFrameCount) -> [Float] {
        let ramp: Float = 0.0005
        let inc = 2.0 * Double.pi * 220.0 / sampleRate
        return (0 ..< Int(count)).map { _ in
            boostGain += (boostTargetGain - boostGain) * ramp
            let s = Float(sin(boostPhase)) * boostGain
            boostPhase += inc
            return s
        }
    }

    private func brakeSamples(count: AVAudioFrameCount) -> [Float] {
        let ramp: Float = 0.0005
        let inc = 2.0 * Double.pi * 140.0 / sampleRate
        return (0 ..< Int(count)).map { _ in
            brakeGain += (brakeTargetGain - brakeGain) * ramp
            let s = Float(sin(brakePhase)) * brakeGain
            brakePhase += inc
            return s
        }
    }

    private func alarmSamples(count: AVAudioFrameCount) -> [Float] {
        let ramp: Float = 0.001
        let toneInc = 2.0 * Double.pi * 680.0 / sampleRate
        let lfoInc  = 2.0 * Double.pi * 3.0  / sampleRate
        return (0 ..< Int(count)).map { _ in
            alarmGain += (alarmTargetGain - alarmGain) * ramp
            let lfo = Float((sin(alarmLFOPhase) + 1.0) * 0.5)
            let s = Float(sin(alarmPhase)) * alarmGain * lfo
            alarmPhase    += toneInc
            alarmLFOPhase += lfoInc
            return s
        }
    }

    private func makeNode(format: AVAudioFormat, generator: @escaping (AVAudioFrameCount) -> [Float]) -> AVAudioSourceNode {
        AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList in
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let samples = generator(frameCount)
            for buffer in ablPointer {
                let buf = buffer.mData!.bindMemory(to: Float.self, capacity: Int(frameCount))
                for i in 0 ..< min(Int(frameCount), samples.count) { buf[i] = samples[i] }
            }
            return noErr
        }
    }

    // MARK: - Public API (call from main thread)

    func setMasterVolume(_ v: Double) {
        masterMixer.outputVolume = Float(v.clamped(to: 0...1))
    }

    func setMuted(_ muted: Bool) {
        masterMixer.outputVolume = muted ? 0 : masterMixer.outputVolume
    }

    func setBoostActive(_ on: Bool) {
        boostTargetGain = on ? 0.25 : 0
    }

    func setBrakeActive(_ on: Bool) {
        brakeTargetGain = on ? 0.25 : 0
    }

    func setBoundsWarning(proximity: Double) {
        alarmTargetGain = Float(proximity.clamped(to: 0...1)) * 0.3
    }

    func playChime(frequency: Double, duration: Double) {
        guard isSetUp else { return }
        let sr = sampleRate
        var phase = 0.0
        let inc = 2.0 * Double.pi * frequency / sr
        let totalFrames = Int(duration * sr)
        var rendered = 0

        let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(totalFrames))!
        pcm.frameLength = pcm.frameCapacity

        let buf = pcm.floatChannelData![0]
        for i in 0 ..< totalFrames {
            let env = Float(1.0 - Double(i) / Double(totalFrames))
            buf[i] = Float(sin(phase)) * env * 0.3
            phase += inc
            rendered += 1
        }

        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: masterMixer, format: format)
        player.scheduleBuffer(pcm, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                self?.engine.detach(player)
            }
        }
        player.play()
    }

    func playLevelStart() {
        playChime(frequency: 880, duration: 0.15)
    }

    func playGoalReached() {
        for (i, freq) in [523.0, 659.0, 784.0].enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.14) { [weak self] in
                self?.playChime(frequency: freq, duration: 0.12)
            }
        }
    }

    func playAutoReset() {
        guard isSetUp else { return }
        let sr = sampleRate
        let duration = 0.4
        let totalFrames = Int(duration * sr)
        var phase = 0.0
        let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!
        let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(totalFrames))!
        pcm.frameLength = pcm.frameCapacity
        let buf = pcm.floatChannelData![0]
        for i in 0 ..< totalFrames {
            let t = Double(i) / sr
            let freq = 300.0 - (150.0 * t / duration)
            let inc = 2.0 * Double.pi * freq / sr
            phase += inc
            buf[i] = Float(sin(phase)) * 0.25
        }
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: masterMixer, format: format)
        player.scheduleBuffer(pcm, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.engine.detach(player) }
        }
        player.play()
    }

    func playUITap() {
        playChime(frequency: 1200, duration: 0.03)
    }
}
