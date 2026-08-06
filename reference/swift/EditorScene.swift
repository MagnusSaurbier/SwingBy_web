import SpriteKit
import Foundation
import Combine

#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import AppKit
#endif

// MARK: - Editor state

enum EditorState { case editing, previewing }

// MARK: - Editor event (scene → SwiftUI)

enum EditorEvent {
    case selectedBody(index: Int?)
    case validationChanged([String])
    case saveRequested(LevelData)
}

// MARK: - EditorViewModel

@MainActor
final class EditorViewModel: ObservableObject {
    @Published var editorState: EditorState = .editing
    @Published var selectedBodyIndex: Int? = nil
    @Published var validationErrors: [String] = []
    @Published var levelName: String = ""
    @Published var activeTool: EditorTool = .ship
    @Published var bodies: [BodyData] = []
    @Published var ship: ShipData = ShipData(position: .zero)

    var onSave: ((LevelData) -> Void)?
    var onDismiss: (() -> Void)?
}

enum EditorTool: String, CaseIterable {
    case ship = "Ship"
    case sun  = "Sun"
    case planet = "Planet"
}

// MARK: - EditorScene

final class EditorScene: SKScene {

    let viewModel: EditorViewModel
    private let settingsManager = AppSettingsManager.shared

    // Authored state (never mutated during preview)
    private var authoredBodies: [BodyData] = []
    private var authoredShip: ShipData = ShipData(position: .zero)

    // Preview simulation state
    private var previewBodies: [PhysicsBody] = []
    private var previewShipIndex = 0
    private var previewAccumulator: Double = 0
    private var previewLastTime: TimeInterval = 0

    // Node tracking (index → SKNode)
    private var bodyNodes: [Int: SKShapeNode] = [:]
    private var shipNode: SKShapeNode?
    private var ghostNode: SKShapeNode?
    private var velocityArrowNode: SKShapeNode?

    // Camera / pan state
    private let cameraNode = SKCameraNode()
    private var cameraZoom: CGFloat = 1.0
    private var isDraggingBody = false
    private var draggingBodyIndex: Int? = nil
    private var isDrawingVelocity = false
    private var velocityDragStart: CGPoint = .zero

    // Undo stack
    private var undoStack: [(bodies: [BodyData], ship: ShipData)] = []

    #if os(macOS)
    private var keyMonitor: Any?
    #endif

    init(viewModel: EditorViewModel) {
        self.viewModel = viewModel
        super.init(size: CGSize(width: 1, height: 1))
        scaleMode = .resizeFill
    }
    required init?(coder: NSCoder) { fatalError() }

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.02, green: 0.02, blue: 0.07, alpha: 1)
        addStarfield()
        addChild(cameraNode)
        camera = cameraNode
        addGrid()

        #if os(macOS)
        setupMacKeyMonitor()
        #endif

        rebuildAllNodes()
    }

    override func willMove(from view: SKView) {
        #if os(macOS)
        if let m = keyMonitor { NSEvent.removeMonitor(m); keyMonitor = nil }
        #endif
    }

    // MARK: - Grid

    private func addGrid() {
        let spacing: CGFloat = 100
        let count = 20
        let gridNode = SKNode()
        let color = SKColor(white: 0.15, alpha: 1)
        for i in -count ... count {
            let v = SKShapeNode()
            let vp = CGMutablePath()
            let x = CGFloat(i) * spacing
            vp.move(to: CGPoint(x: x, y: -CGFloat(count) * spacing))
            vp.addLine(to: CGPoint(x: x, y:  CGFloat(count) * spacing))
            v.path = vp; v.strokeColor = color; v.lineWidth = 0.5
            gridNode.addChild(v)

            let h = SKShapeNode()
            let hp = CGMutablePath()
            let y = CGFloat(i) * spacing
            hp.move(to: CGPoint(x: -CGFloat(count) * spacing, y: y))
            hp.addLine(to: CGPoint(x:  CGFloat(count) * spacing, y: y))
            h.path = hp; h.strokeColor = color; h.lineWidth = 0.5
            gridNode.addChild(h)
        }
        // Origin crosshair
        let origin = SKShapeNode(circleOfRadius: 4)
        origin.fillColor = SKColor(white: 0.3, alpha: 1); origin.strokeColor = .clear
        gridNode.addChild(origin)
        gridNode.zPosition = -5
        addChild(gridNode)
    }

    private func addStarfield() {
        for _ in 0 ..< 120 {
            let d = SKShapeNode(circleOfRadius: .random(in: 0.5...1.5))
            d.fillColor = .white; d.strokeColor = .clear
            d.alpha = .random(in: 0.2...0.6)
            d.position = CGPoint(x: .random(in: -2000...2000), y: .random(in: -2000...2000))
            d.zPosition = -10; addChild(d)
        }
    }

    // MARK: - Node building

    private func rebuildAllNodes() {
        bodyNodes.values.forEach { $0.removeFromParent() }
        bodyNodes = [:]
        shipNode?.removeFromParent()
        shipNode = nil

        for (i, body) in authoredBodies.enumerated() {
            bodyNodes[i] = makeBodyNode(body, index: i)
        }
        shipNode = makeShipNode(at: authoredShip.position.cgPoint,
                                vel: authoredShip.velocity.cgVector)
    }

    private func makeBodyNode(_ body: BodyData, index: Int) -> SKShapeNode {
        let r = CGFloat(body.radius)
        let node = SKShapeNode(circleOfRadius: r)
        node.position = body.position.cgPoint
        node.zPosition = 8
        node.name = "body_\(index)"

        if body.invisible {
            node.strokeColor = SKColor(red: 0.6, green: 0.4, blue: 1.0, alpha: 0.6)
            node.fillColor   = SKColor(red: 0.3, green: 0.0, blue: 0.6, alpha: 0.15)
            node.lineWidth = 2
            if let dashed = node.path?.copy(dashingWithPhase: 0, lengths: [6, 4]) {
                node.path = dashed
            }
        } else if body.type == .sun {
            node.fillColor   = SKColor(red: 1.0, green: 0.82, blue: 0.3, alpha: 1)
            node.strokeColor = SKColor(red: 1.0, green: 0.95, blue: 0.5, alpha: 0.6)
            node.lineWidth = 2; node.glowWidth = 6
        } else if body.isGoal {
            node.fillColor   = SKColor(red: 0.25, green: 1.0, blue: 0.5, alpha: 1)
            node.strokeColor = .white; node.lineWidth = 1.5
        } else {
            node.fillColor   = SKColor(red: 0.5, green: 0.6, blue: 0.85, alpha: 1)
            node.strokeColor = SKColor(red: 0.7, green: 0.8, blue: 1.0, alpha: 0.5)
            node.lineWidth = 1
        }
        addChild(node)
        return node
    }

    private func makeShipNode(at pos: CGPoint, vel: CGVector) -> SKShapeNode {
        let r: CGFloat = 10
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 0, y: r * 1.2))
        path.addLine(to: CGPoint(x: -r * 0.8, y: -r * 0.8))
        path.addLine(to: CGPoint(x:  r * 0.8, y: -r * 0.8))
        path.closeSubpath()
        let n = SKShapeNode(path: path, centered: true)
        n.fillColor = SKColor(red: 0.45, green: 0.85, blue: 1.0, alpha: 1)
        n.strokeColor = .white; n.lineWidth = 1.5
        n.position = pos
        if vel.magnitude > 0.1 {
            n.zRotation = CGFloat(atan2(vel.dy, vel.dx) - .pi / 2)
        }
        n.zPosition = 15; n.name = "body_ship"
        addChild(n)
        return n
    }

    // MARK: - Public API

    func placeTool(at worldPos: CGPoint) {
        guard viewModel.editorState == .editing else { return }
        pushUndo()

        switch viewModel.activeTool {
        case .ship:
            authoredShip = ShipData(position: worldPos, velocity: .zero)
            shipNode?.removeFromParent()
            shipNode = makeShipNode(at: worldPos, vel: .zero)
            viewModel.ship = authoredShip

        case .sun:
            let body = BodyData(type: .sun, position: worldPos, mass: 200, radius: 35, anchored: true)
            let idx = authoredBodies.count
            authoredBodies.append(body)
            bodyNodes[idx] = makeBodyNode(body, index: idx)
            syncViewModel()

        case .planet:
            let body = BodyData(type: .planet, position: worldPos, mass: 1, radius: 22, anchored: true)
            let idx = authoredBodies.count
            authoredBodies.append(body)
            bodyNodes[idx] = makeBodyNode(body, index: idx)
            syncViewModel()
        }
    }

    func deleteBody(at index: Int) {
        guard index < authoredBodies.count else { return }
        pushUndo()
        bodyNodes[index]?.removeFromParent()
        bodyNodes.removeValue(forKey: index)
        authoredBodies.remove(at: index)
        rebuildAllNodes()
        syncViewModel()
    }

    func updateBody(at index: Int, with data: BodyData) {
        guard index < authoredBodies.count else { return }
        authoredBodies[index] = data
        bodyNodes[index]?.removeFromParent()
        bodyNodes[index] = makeBodyNode(data, index: index)
        syncViewModel()
    }

    func undo() {
        guard let prev = undoStack.popLast() else { return }
        authoredBodies = prev.bodies
        authoredShip = prev.ship
        rebuildAllNodes()
        syncViewModel()
    }

    func clearAll() {
        pushUndo()
        authoredBodies = []
        authoredShip = ShipData(position: .zero)
        rebuildAllNodes()
        syncViewModel()
    }

    func startPreview() {
        guard viewModel.editorState == .editing else { return }
        viewModel.editorState = .previewing
        buildPreviewState()
    }

    func stopPreview() {
        viewModel.editorState = .editing
        rebuildAllNodes()
    }

    func saveLevel() {
        guard let level = buildLevelData() else { return }
        let errors = validate()
        guard errors.isEmpty else { viewModel.validationErrors = errors; return }
        CustomLevelsStore.shared.add(level)
        viewModel.onSave?(level)
    }

    func validate() -> [String] {
        var errors: [String] = []
        if viewModel.levelName.trimmingCharacters(in: .whitespaces).isEmpty {
            errors.append("Level name is required")
        }
        if authoredBodies.isEmpty {
            errors.append("Add at least one body")
        }
        if authoredBodies.filter(\.isGoal).count != 1 {
            errors.append("Exactly one goal body required")
        }
        viewModel.validationErrors = errors
        return errors
    }

    // MARK: - Preview simulation

    private func buildPreviewState() {
        previewBodies = [PhysicsBody(fromShip: authoredShip)]
        previewShipIndex = 0
        for body in authoredBodies {
            let kind: PhysicsBodyKind = body.type == .sun ? .sun : .planet
            previewBodies.append(PhysicsBody(from: body, kind: kind))
        }
        previewAccumulator = 0
        previewLastTime = 0
    }

    override func update(_ currentTime: TimeInterval) {
        guard viewModel.editorState == .previewing else { return }
        if previewLastTime == 0 { previewLastTime = currentTime; return }
        let dt = min(currentTime - previewLastTime, 0.1)
        previewLastTime = currentTime
        previewAccumulator += dt
        while previewAccumulator >= PHYSICS_DT {
            physicsStep(bodies: &previewBodies, shipIndex: previewShipIndex,
                        boostActive: false, brakeActive: false)
            previewAccumulator -= PHYSICS_DT
        }
        for i in 0 ..< previewBodies.count {
            if i == previewShipIndex {
                shipNode?.position = previewBodies[i].position
            } else if i - 1 < authoredBodies.count {
                bodyNodes[i - 1]?.position = previewBodies[i].position
            }
        }
    }

    // MARK: - Helpers

    private func pushUndo() {
        undoStack.append((authoredBodies, authoredShip))
        if undoStack.count > 50 { undoStack.removeFirst() }
    }

    private func syncViewModel() {
        viewModel.bodies = authoredBodies
        viewModel.ship = authoredShip
        _ = validate()
    }

    private func buildLevelData() -> LevelData? {
        LevelData(
            id: "custom_\(UUID().uuidString.prefix(8).lowercased())",
            name: viewModel.levelName,
            author: "Player",
            boundsRadius: 600,
            ship: authoredShip,
            bodies: authoredBodies
        )
    }

    // MARK: - Touch / mouse for canvas interaction

    private func worldPoint(from viewPoint: CGPoint) -> CGPoint {
        convertPoint(fromView: viewPoint)
    }

    #if canImport(UIKit)
    private var lastTouchId: TouchID? = nil
    private var panStartCameraPos: CGPoint = .zero
    private var panStartTouchPos: CGPoint = .zero

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, let v = self.view else { return }
        let viewPos = touch.location(in: v)
        let worldPos = worldPoint(from: viewPos)
        lastTouchId = TouchID(touch)

        if viewModel.editorState == .editing {
            // Check if touching an existing body
            if let hitIdx = bodyIndexAt(worldPos) {
                draggingBodyIndex = hitIdx
                isDraggingBody = true
                viewModel.selectedBodyIndex = hitIdx
            } else {
                isDraggingBody = false
                draggingBodyIndex = nil
                viewModel.selectedBodyIndex = nil
                showGhost(at: worldPos)
            }
        }
        panStartCameraPos = cameraNode.position
        panStartTouchPos = viewPos
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, let v = self.view else { return }
        let viewPos = touch.location(in: v)
        let worldPos = worldPoint(from: viewPos)

        if viewModel.editorState == .editing {
            if isDraggingBody, let idx = draggingBodyIndex {
                authoredBodies[idx].position = CGPointCodable(worldPos)
                bodyNodes[idx]?.position = worldPos
            } else if ghostNode != nil {
                ghostNode?.position = worldPos
            } else {
                // Pan camera
                let dx = viewPos.x - panStartTouchPos.x
                let dy = viewPos.y - panStartTouchPos.y
                cameraNode.position = CGPoint(
                    x: panStartCameraPos.x - dx / cameraZoom,
                    y: panStartCameraPos.y - dy / cameraZoom
                )
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let v = self.view, let touch = touches.first else { return }
        let worldPos = worldPoint(from: touch.location(in: v))

        if viewModel.editorState == .editing {
            if isDraggingBody {
                isDraggingBody = false
                draggingBodyIndex = nil
            } else if ghostNode != nil {
                removeGhost()
                placeTool(at: worldPos)
            }
        }
    }
    #endif

    #if os(macOS)
    private var panStartCamPos: CGPoint = .zero
    private var panStartMousePos: CGPoint = .zero

    override func mouseDown(with event: NSEvent) {
        guard let v = self.view else { return }
        let worldPos = event.location(in: self)
        if viewModel.editorState == .editing {
            if let hitIdx = bodyIndexAt(worldPos) {
                draggingBodyIndex = hitIdx; isDraggingBody = true
                viewModel.selectedBodyIndex = hitIdx
            } else {
                isDraggingBody = false; draggingBodyIndex = nil
                viewModel.selectedBodyIndex = nil
                showGhost(at: worldPos)
            }
        }
        panStartCamPos = cameraNode.position
        panStartMousePos = v.convert(event.locationInWindow, from: nil)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let v = self.view else { return }
        let viewPos = v.convert(event.locationInWindow, from: nil)
        let worldPos = worldPoint(from: viewPos)
        if viewModel.editorState == .editing {
            if isDraggingBody, let idx = draggingBodyIndex {
                authoredBodies[idx].position = CGPointCodable(worldPos)
                bodyNodes[idx]?.position = worldPos
            } else if ghostNode != nil {
                ghostNode?.position = worldPos
            } else {
                let dx = viewPos.x - panStartMousePos.x
                let dy = viewPos.y - panStartMousePos.y
                cameraNode.position = CGPoint(
                    x: panStartCamPos.x - dx / cameraZoom,
                    y: panStartCamPos.y - dy / cameraZoom
                )
            }
        }
    }

    override func mouseUp(with event: NSEvent) {
        guard let v = self.view else { return }
        let worldPos = worldPoint(from: v.convert(event.locationInWindow, from: nil))
        if viewModel.editorState == .editing {
            if isDraggingBody { isDraggingBody = false; draggingBodyIndex = nil }
            else if ghostNode != nil { removeGhost(); placeTool(at: worldPos) }
        }
    }

    override func scrollWheel(with event: NSEvent) {
        let delta = CGFloat(event.deltaY)
        cameraZoom = (cameraZoom + delta * 0.05).clamped(to: 0.3...3.0)
        cameraNode.xScale = 1.0 / cameraZoom
        cameraNode.yScale = 1.0 / cameraZoom
    }

    private func setupMacKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            if event.modifierFlags.contains(.command) && event.characters == "z" {
                self?.undo()
            }
            return event
        }
    }
    #endif

    // MARK: - Ghost node

    private func showGhost(at pos: CGPoint) {
        ghostNode?.removeFromParent()
        let r: CGFloat = viewModel.activeTool == .sun ? 35 : 22
        let g = SKShapeNode(circleOfRadius: r)
        g.strokeColor = .white; g.fillColor = SKColor(white: 1.0, alpha: 0.1)
        g.lineWidth = 1.5; g.position = pos; g.zPosition = 20
        g.name = "ghost"
        addChild(g)
        ghostNode = g
    }

    private func removeGhost() {
        ghostNode?.removeFromParent(); ghostNode = nil
    }

    private func bodyIndexAt(_ pos: CGPoint) -> Int? {
        for (i, body) in authoredBodies.enumerated() {
            if pos.distance(to: body.position.cgPoint) < CGFloat(body.radius) + 8 { return i }
        }
        return nil
    }
}
