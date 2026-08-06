import Foundation
import GameController

struct InputState {
    var boostPressed: Bool = false
    var brakePressed: Bool = false
    var restartPressed: Bool = false
    var pausePressed: Bool = false
    var menuPressed: Bool = false
}

/// Identifies a touch or mouse button press by object identity.
typealias TouchID = ObjectIdentifier

@MainActor
final class InputManager {
    // Fully settable so GameScene can write keyboard state directly
    var state = InputState()

    // Touch zone tracking (iOS/iPadOS multi-touch)
    private var boostTouchId: TouchID? = nil
    private var brakeTouchId: TouchID? = nil

    // Gamepad
    private var gamepad: GCController? = nil

    init() { setupGamepadObservers() }

    // MARK: - Touch zones

    func touchBegan(id: TouchID, inBoostZone: Bool) {
        if inBoostZone, boostTouchId == nil {
            boostTouchId = id
            state.boostPressed = true
        } else if !inBoostZone, brakeTouchId == nil {
            brakeTouchId = id
            state.brakePressed = true
        }
    }

    func touchEnded(id: TouchID) {
        if id == boostTouchId { boostTouchId = nil; state.boostPressed = false }
        if id == brakeTouchId { brakeTouchId = nil; state.brakePressed = false }
    }

    func cancelAllTouches() {
        boostTouchId = nil; brakeTouchId = nil
        state.boostPressed = false; state.brakePressed = false
    }

    /// Call each frame after consuming one-shot events.
    func clearOneShots() {
        state.restartPressed = false
        state.pausePressed   = false
        state.menuPressed    = false
    }

    // MARK: - Gamepad (MFi / Bluetooth)

    private func setupGamepadObservers() {
        NotificationCenter.default.addObserver(
            forName: .GCControllerDidConnect, object: nil, queue: .main
        ) { [weak self] note in
            self?.gamepad = note.object as? GCController
            self?.configureGamepad()
        }
        NotificationCenter.default.addObserver(
            forName: .GCControllerDidDisconnect, object: nil, queue: .main
        ) { [weak self] _ in self?.gamepad = nil }

        if let first = GCController.controllers().first {
            gamepad = first
            configureGamepad()
        }
    }

    private func configureGamepad() {
        guard let pad = gamepad?.extendedGamepad else { return }
        pad.rightTrigger.valueChangedHandler = { [weak self] _, _, pressed in
            DispatchQueue.main.async { self?.state.boostPressed = pressed }
        }
        pad.leftTrigger.valueChangedHandler = { [weak self] _, _, pressed in
            DispatchQueue.main.async { self?.state.brakePressed = pressed }
        }
        pad.buttonMenu.pressedChangedHandler = { [weak self] _, _, pressed in
            if pressed { DispatchQueue.main.async { self?.state.pausePressed = true } }
        }
    }
}
