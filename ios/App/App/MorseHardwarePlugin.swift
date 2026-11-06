import AVFoundation
import Capacitor
import CoreHaptics
import UIKit
import WebKit

/// iOS counterpart of android-native/.../MorseHardwarePlugin.java. Same JS name,
/// methods, events, outcomes and session rules, so native-channels.js and
/// native-channel-core.js run unchanged on both platforms.
///
/// Threading: Capacitor delivers calls on its "bridge" queue. Transmitter state
/// lives only on `lightQueue`; receiver and UI state live only on the main queue;
/// AVCaptureSession start/stop runs on `sessionQueue`; frames arrive on `videoQueue`.
@objc(MorseHardwarePlugin)
public class MorseHardwarePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MorseHardwarePlugin"
    public let jsName = "MorseHardware"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepareCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acquireFlashlight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFlashlight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleFlashlight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseFlashlight", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startReceiver", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopReceiver", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "positionPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPreviewHidden", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepScreenOn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSystemBars", returnType: CAPPluginReturnPromise)
    ]

    // MARK: Transmitter state (lightQueue only)
    private let lightQueue = DispatchQueue(label: "MorseFlashlight", qos: .userInteractive)
    private var torch: AVCaptureDevice?
    private var txSession: Int64 = 0
    private var stoppedTx: Int64 = 0
    private var txGeneration = 0
    private var edges: [(at: UInt64, on: Bool)] = []
    private var edgeIndex = 0
    private var edgeTimer: DispatchSourceTimer?

    // MARK: Receiver state (main queue only)
    private let sessionQueue = DispatchQueue(label: "MorseCameraSession", qos: .userInitiated)
    private let videoQueue = DispatchQueue(label: "MorseCameraFrames", qos: .userInitiated)
    private var rxSession: Int64 = 0
    private var stoppedRx: Int64 = 0
    private var capture: AVCaptureSession?
    private var sampler: FrameSampler?
    private var previewView: PreviewView?
    private var previewHidden = false
    private var captureObservers: [NSObjectProtocol] = []

    // MARK: Haptics (main queue only)
    private var haptics: CHHapticEngine?
    private var hapticsNeedStart = true
    private var hapticPlayer: CHHapticPatternPlayer?

    private var lifecycleObservers: [NSObjectProtocol] = []

    override public func load() {
        let center = NotificationCenter.default
        lifecycleObservers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                                     object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.closeReceiver()
            self.lightQueue.async { self.flashlightOff(release: false) }
        })
    }

    deinit {
        lifecycleObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: Helpers

    private func number(_ value: Any?) -> Double? {
        if let value = value as? NSNumber { return value.doubleValue }
        return nil
    }

    private func sessionId(_ call: CAPPluginCall) -> Int64 {
        guard let value = number(call.getValue("session")), value.isFinite, abs(value) < 9e18 else { return 0 }
        return Int64(value)
    }

    private func lost(_ source: String, _ session: Int64, _ detail: String) {
        notifyListeners("hardwareLost", data: ["source": source, "session": NSNumber(value: session), "detail": detail])
    }

    private func rearCamera() -> AVCaptureDevice? {
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }

    // MARK: Permission

    /// The launch-time camera request. iOS shows its prompt at most once per install;
    /// after a denial the app has to send people to Settings.
    @objc func prepareCamera(_ call: CAPPluginCall) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            call.resolve(["ok": true, "outcome": "granted"])
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                call.resolve(["ok": granted, "outcome": granted ? "granted" : "permission-denied"])
            }
        default:
            call.resolve(["ok": false, "outcome": "permission-denied"])
        }
    }

    // MARK: Flashlight

    /// iOS lets an app drive the torch without camera authorization, so unlike
    /// Android a denied camera permission does not force the screen-light fallback.
    @objc func acquireFlashlight(_ call: CAPPluginCall) {
        let session = sessionId(call)
        DispatchQueue.main.async {
            self.closeReceiver()
            self.lightQueue.async { self.armFlashlight(call, session) }
        }
    }

    private func armFlashlight(_ call: CAPPluginCall, _ session: Int64) {
        if session <= stoppedTx {
            call.resolve(["ok": false, "outcome": "cancelled"])
            return
        }
        guard let device = rearCamera(), device.hasTorch, device.isTorchModeSupported(.on) else {
            call.resolve(["ok": false, "outcome": "no-flashlight"])
            return
        }
        do {
            try device.lockForConfiguration()
            device.torchMode = .off
            device.unlockForConfiguration()
            txSession = session
            torch = device
            call.resolve(["ok": true])
        } catch {
            if AVCaptureDevice.authorizationStatus(for: .video) != .authorized {
                call.resolve(["ok": false, "outcome": "permission-denied"])
            } else {
                call.reject(error.localizedDescription)
            }
        }
    }

    private func cancelTimeline() {
        txGeneration += 1
        edgeTimer?.cancel()
        edgeTimer = nil
        edges = []
        edgeIndex = 0
    }

    private func light(_ on: Bool, _ session: Int64, _ generation: Int) {
        guard session == txSession, session > stoppedTx, generation == txGeneration, let device = torch else { return }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if on {
                guard device.isTorchAvailable else {
                    throw NSError(domain: "Morse", code: 1, userInfo: [NSLocalizedDescriptionKey: "Flashlight unavailable (device may be too warm)"])
                }
                try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
            } else {
                device.torchMode = .off
            }
        } catch {
            cancelTimeline()
            lost("flashlight", session, error.localizedDescription)
        }
    }

    private func activeTx(_ session: Int64) -> Bool {
        return session == txSession && session > stoppedTx && torch != nil
    }

    @objc func setFlashlight(_ call: CAPPluginCall) {
        let session = sessionId(call)
        let on = call.getBool("on", false)
        lightQueue.async {
            guard self.activeTx(session) else {
                call.reject("Flashlight session is no longer active")
                return
            }
            self.cancelTimeline()
            self.light(on, session, self.txGeneration)
            call.resolve()
        }
    }

    /// Edges run on a strict, zero-leeway timer re-armed edge by edge. Plain
    /// asyncAfter allows the system up to a tenth of the delay in leeway, which
    /// would smear marks that sit seconds into a message.
    @objc func scheduleFlashlight(_ call: CAPPluginCall) {
        let session = sessionId(call)
        let events = call.getArray("events")
        let position = number(call.getValue("positionMs")) ?? 0
        let delay = number(call.getValue("delayMs")) ?? 0
        lightQueue.async {
            guard self.activeTx(session) else {
                call.reject("Flashlight session is no longer active")
                return
            }
            // Validate the whole timeline before touching the hardware.
            guard let events = events, events.count <= 20000, position.isFinite, position >= 0,
                  delay.isFinite, delay >= 0, delay <= 10000 else {
                call.reject("Invalid timeline")
                return
            }
            var parsed: [(time: Double, on: Bool)] = []
            parsed.reserveCapacity(events.count)
            var previous = -1.0
            for raw in events {
                guard let event = raw as? JSObject, let time = self.number(event["tMs"]),
                      let on = event["on"] as? Bool,
                      time.isFinite, time >= previous, time >= 0, time <= 3_600_000 else {
                    call.reject("Invalid timeline edge")
                    return
                }
                parsed.append((time, on))
                previous = time
            }
            self.cancelTimeline()
            let generation = self.txGeneration
            let anchor = DispatchTime.now().uptimeNanoseconds + UInt64((delay * 1_000_000).rounded())
            let nanos = { (ms: Double) in anchor + UInt64(((ms - position) * 1_000_000).rounded()) }
            var atPosition = false
            var edges: [(at: UInt64, on: Bool)] = []
            for edge in parsed where edge.time <= position { atPosition = edge.on }
            if position > 0 { edges.append((anchor, atPosition)) }
            for edge in parsed where edge.time >= position { edges.append((nanos(edge.time), edge.on)) }
            self.edges = edges
            self.edgeIndex = 0
            let timer = DispatchSource.makeTimerSource(flags: .strict, queue: self.lightQueue)
            timer.setEventHandler { [weak self] in self?.runEdges(session, generation) }
            self.edgeTimer = timer
            timer.resume()
            self.armNextEdge()
            call.resolve()
        }
    }

    private func armNextEdge() {
        guard edgeIndex < edges.count else { return }
        edgeTimer?.schedule(deadline: DispatchTime(uptimeNanoseconds: edges[edgeIndex].at),
                            repeating: .never, leeway: .nanoseconds(0))
    }

    private func runEdges(_ session: Int64, _ generation: Int) {
        guard generation == txGeneration else { return }
        // Fire every edge that is due (or within 0.2 ms), in order, then re-arm.
        let due = DispatchTime.now().uptimeNanoseconds + 200_000
        while edgeIndex < edges.count, edges[edgeIndex].at <= due {
            let edge = edges[edgeIndex]
            edgeIndex += 1
            light(edge.on, session, generation)
            if generation != txGeneration { return }
        }
        armNextEdge()
    }

    private func flashlightOff(release: Bool) {
        cancelTimeline()
        let device = torch
        if release {
            stoppedTx = max(stoppedTx, txSession)
            torch = nil
        }
        guard let device = device else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = .off
            device.unlockForConfiguration()
        } catch {
            lost("flashlight", txSession, error.localizedDescription)
        }
    }

    @objc func releaseFlashlight(_ call: CAPPluginCall) {
        let session = sessionId(call)
        lightQueue.async {
            self.stoppedTx = max(self.stoppedTx, session)
            if self.txSession == session { self.flashlightOff(release: true) }
            call.resolve()
        }
    }

    // MARK: Receiver

    @objc func startReceiver(_ call: CAPPluginCall) {
        let session = sessionId(call)
        DispatchQueue.main.async { self.openReceiver(call, session) }
    }

    private func openReceiver(_ call: CAPPluginCall, _ session: Int64) {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            call.resolve(["ok": false, "outcome": "permission-denied"])
            return
        }
        if session <= stoppedRx {
            call.resolve(["ok": false, "outcome": "cancelled"])
            return
        }
        closeReceiver()
        lightQueue.async { self.flashlightOff(release: true) }
        guard let device = rearCamera(), let host = bridge?.viewController?.view, let webView = bridge?.webView else {
            call.reject("No rear camera found")
            return
        }
        rxSession = session
        let capture = AVCaptureSession()
        let sampler = FrameSampler(plugin: self, session: session)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(sampler, queue: videoQueue)
        do {
            let input = try AVCaptureDeviceInput(device: device)
            capture.beginConfiguration()
            if capture.canSetSessionPreset(.vga640x480) { capture.sessionPreset = .vga640x480 }
            guard capture.canAddInput(input), capture.canAddOutput(output) else {
                capture.commitConfiguration()
                throw NSError(domain: "Morse", code: 2, userInfo: [NSLocalizedDescriptionKey: "Camera cannot be configured"])
            }
            capture.addInput(input)
            capture.addOutput(output)
            capture.commitConfiguration()
        } catch {
            rxSession = 0
            call.reject(error.localizedDescription)
            return
        }

        let preview = PreviewView(session: capture)
        preview.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        host.insertSubview(preview, aboveSubview: webView)
        self.capture = capture
        self.sampler = sampler
        self.previewView = preview
        placePreview(call)

        let center = NotificationCenter.default
        let report: (Notification) -> Void = { [weak self] note in
            guard let self = self, self.rxSession == session else { return }
            let detail = (note.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription
                ?? "Camera interrupted"
            self.lost("camera", session, detail)
        }
        captureObservers = [
            center.addObserver(forName: .AVCaptureSessionRuntimeError, object: capture, queue: .main, using: report),
            center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: capture, queue: .main, using: report)
        ]

        sessionQueue.async {
            capture.startRunning()
            MorseHardwarePlugin.configureExposure(device)
            DispatchQueue.main.async {
                if self.rxSession == session, capture.isRunning {
                    call.resolve(["ok": true])
                } else if self.rxSession == session {
                    self.closeReceiver()
                    call.reject("Camera did not start")
                } else {
                    call.resolve(["ok": false, "outcome": "cancelled"])
                }
            }
        }
    }

    /// Short fixed exposure and ISO (as on Android) so a distant flashlight stands
    /// out against a dim background instead of being averaged away by auto-exposure.
    private static func configureExposure(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            let format = device.activeFormat
            let frame = CMTime(value: 1, timescale: 30)
            if format.videoSupportedFrameRateRanges.contains(where: { $0.minFrameDuration <= frame && frame <= $0.maxFrameDuration }) {
                device.activeVideoMinFrameDuration = frame
                device.activeVideoMaxFrameDuration = frame
            }
            if device.isExposureModeSupported(.custom) {
                let wanted = CMTime(value: 5, timescale: 1000)
                let duration = CMTimeMaximum(format.minExposureDuration, CMTimeMinimum(format.maxExposureDuration, wanted))
                let iso = max(format.minISO, min(format.maxISO, 200))
                device.setExposureModeCustom(duration: duration, iso: iso, completionHandler: nil)
            }
        } catch {
            CAPLog.print("Morse: exposure lock failed: \(error.localizedDescription)")
        }
    }

    fileprivate func deliver(frame: [String: Any], session: Int64) {
        notifyListeners("cameraFrame", data: frame)
    }

    fileprivate func frameFailed(_ session: Int64, _ detail: String) {
        lost("camera", session, detail)
    }

    private func placePreview(_ call: CAPPluginCall) {
        guard let preview = previewView, let webView = bridge?.webView, let host = preview.superview else { return }
        let scale = number(call.getValue("scale")) ?? 1
        guard scale.isFinite, scale > 0, scale <= 10 else { return }
        // CSS pixels are UIKit points in WKWebView, so `scale` (devicePixelRatio) is
        // only validated here; Android needs it to convert to physical pixels.
        let origin = webView.convert(CGPoint.zero, to: host)
        preview.frame = CGRect(x: origin.x + CGFloat(number(call.getValue("left")) ?? 0),
                               y: origin.y + CGFloat(number(call.getValue("top")) ?? 0),
                               width: max(1, CGFloat(number(call.getValue("width")) ?? 1)),
                               height: max(1, CGFloat(number(call.getValue("height")) ?? 1)))
        preview.isHidden = previewHidden
    }

    @objc func positionPreview(_ call: CAPPluginCall) {
        let session = sessionId(call)
        DispatchQueue.main.async {
            if session == self.rxSession { self.placePreview(call) }
            call.resolve()
        }
    }

    /// The camera preview is a native view above the web page, so a web dialog
    /// cannot cover it. The app hides it while any dialog is open.
    @objc func setPreviewHidden(_ call: CAPPluginCall) {
        let hidden = call.getBool("hidden", false)
        DispatchQueue.main.async {
            self.previewHidden = hidden
            self.previewView?.isHidden = hidden
            call.resolve()
        }
    }

    private func closeReceiver() {
        stoppedRx = max(stoppedRx, rxSession)
        rxSession = 0
        captureObservers.forEach { NotificationCenter.default.removeObserver($0) }
        captureObservers = []
        sampler?.stop()
        sampler = nil
        previewView?.removeFromSuperview()
        previewView = nil
        if let capture = capture {
            sessionQueue.async { capture.stopRunning() }
        }
        capture = nil
    }

    @objc func stopReceiver(_ call: CAPPluginCall) {
        let session = sessionId(call)
        DispatchQueue.main.async {
            self.stoppedRx = max(self.stoppedRx, session)
            if self.rxSession == session { self.closeReceiver() }
            call.resolve()
        }
    }

    // MARK: Device

    /// One haptic pulse per Morse mark; ms <= 0 cancels any pulse in progress.
    @objc func vibrate(_ call: CAPPluginCall) {
        let ms = min(number(call.getValue("ms")) ?? 0, 2000)
        DispatchQueue.main.async {
            guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
                call.resolve()
                return
            }
            do {
                if ms <= 0 {
                    try self.hapticPlayer?.stop(atTime: CHHapticTimeImmediate)
                    self.hapticPlayer = nil
                    call.resolve()
                    return
                }
                let engine = try self.hapticEngine()
                if self.hapticsNeedStart {
                    try engine.start()
                    self.hapticsNeedStart = false
                }
                let pulse = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)
                ], relativeTime: 0, duration: ms / 1000)
                try self.hapticPlayer?.stop(atTime: CHHapticTimeImmediate)
                let player = try engine.makePlayer(with: CHHapticPattern(events: [pulse], parameters: []))
                try player.start(atTime: CHHapticTimeImmediate)
                self.hapticPlayer = player
                call.resolve()
            } catch {
                self.hapticsNeedStart = true
                call.reject(error.localizedDescription)
            }
        }
    }

    private func hapticEngine() throws -> CHHapticEngine {
        if let engine = haptics { return engine }
        let engine = try CHHapticEngine()
        engine.playsHapticsOnly = true
        engine.stoppedHandler = { [weak self] _ in DispatchQueue.main.async { self?.hapticsNeedStart = true } }
        engine.resetHandler = { [weak self] in DispatchQueue.main.async { self?.hapticsNeedStart = true } }
        haptics = engine
        return engine
    }

    /// Keeps the display on (no auto-lock) while a message is being sent or received.
    @objc func keepScreenOn(_ call: CAPPluginCall) {
        let on = call.getBool("on", false)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    /// Dark status-bar text for light themes, light text for dark themes.
    @objc func setSystemBars(_ call: CAPPluginCall) {
        let light = call.getBool("light", false)
        bridge?.statusBarStyle = light ? .darkContent : .lightContent
        call.resolve()
    }

    /// Leaving the page (e.g. opening the privacy policy) stops the hardware.
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        DispatchQueue.main.async {
            self.closeReceiver()
            self.lightQueue.async { self.flashlightOff(release: true) }
        }
        return nil
    }
}

/// Reduces each camera frame to 64 tile brightness levels on-device. Only
/// 32x32 luminance samples are read; no image leaves this function.
private final class FrameSampler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private weak var plugin: MorseHardwarePlugin?
    private let session: Int64
    private let lock = NSLock()
    private var active = true
    private var presented: Int64 = 0

    init(plugin: MorseHardwarePlugin, session: Int64) {
        self.plugin = plugin
        self.session = session
    }

    func stop() {
        lock.lock()
        active = false
        lock.unlock()
    }

    private var isActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return active
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard isActive, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else {
            plugin?.frameFailed(session, "Camera frame had no luminance plane")
            return
        }
        let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var levels = [Double](repeating: 0, count: 64)
        var clipped = 0
        for y in 0..<32 {
            let py = min(height - 1, (2 * y + 1) * height / 64)
            for x in 0..<32 {
                let px = min(width - 1, (2 * x + 1) * width / 64)
                let raw = Double(bytes[py * stride + px])
                let luma = max(0, min(255, (raw - 16) * 255 / 219))
                levels[(y / 4) * 8 + x / 4] += luma / 16
                if luma >= 250 { clipped += 1 }
            }
        }
        let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        presented += 1
        guard isActive else { return }
        plugin?.deliver(frame: [
            "session": NSNumber(value: session),
            "tMs": CMTimeGetSeconds(time) * 1000,
            "presented": NSNumber(value: presented),
            "levels": levels,
            "clippingFraction": Double(clipped) / 1024
        ], session: session)
    }
}

/// A UIView whose backing layer is the camera preview, so it resizes with its frame.
private final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    init(session: AVCaptureSession) {
        super.init(frame: .zero)
        let previewLayer = layer as! AVCaptureVideoPreviewLayer
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
    }

    required init?(coder: NSCoder) { nil }
}
