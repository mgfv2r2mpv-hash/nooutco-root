// Talking instead of typing, his ruling 3A of 2026-09-23. Apple's speech
// recognition, ON THIS MAC ONLY: requiresOnDeviceRecognition is set, and if
// this Mac cannot recognise on device the microphone refuses rather than send
// audio anywhere. The audio is never written to disk; only the words reach the
// page, and only the page's Keep sends them on (register `spoken`).
import Foundation
import AVFoundation
import Speech
import WebKit

final class Listener {
    static let shared = Listener()
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var hasTap = false
    // Bumped on every begin and stop, so a callback from a stopped task can
    // neither add words nor end the next one.
    private var generation = 0
    weak var web: WKWebView?

    /// Ask for both permissions, then start. Replies { ok } or { ok: false, note }.
    func start(_ reply: @escaping ([String: Any]) -> Void) {
        SFSpeechRecognizer.requestAuthorization { auth in
            guard auth == .authorized else {
                DispatchQueue.main.async { reply(["ok": false, "note": "Speech recognition is not allowed for ClickClackOracle. Turn it on in System Settings, Privacy & Security, Speech Recognition."]) }
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard granted else { reply(["ok": false, "note": "The microphone is not allowed for ClickClackOracle. Turn it on in System Settings, Privacy & Security, Microphone."]); return }
                    reply(self.begin())
                }
            }
        }
    }

    private func begin() -> [String: Any] {
        stop()
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), rec.isAvailable else {
            return ["ok": false, "note": "Speech recognition is not available right now."]
        }
        guard rec.supportsOnDeviceRecognition else {
            return ["ok": false, "note": "This Mac cannot recognise speech on device, and the app will not send audio anywhere. Type instead."]
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        request = req
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buf, _ in req.append(buf) }
        hasTap = true
        engine.prepare()
        // A failed start must not leave the tap on, or the next Talk installs a
        // second one and AVAudioEngine raises (AUDIT S13).
        do { try engine.start() } catch { stop(); return ["ok": false, "note": "The microphone would not start: \(error.localizedDescription)"] }
        let gen = generation
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            DispatchQueue.main.async {
                guard let self = self, self.generation == gen else { return }
                if let t = text { self.send(text: t, final: isFinal) }
                // It stopped on its own: tell the page, so the button is not
                // left saying Stop talking (AUDIT S14).
                if error != nil || isFinal { self.stop(); self.sendEnded() }
            }
        }
        log("mic: listening, on device")
        return ["ok": true]
    }

    private func send(text: String, final: Bool) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["text": text, "final": final]),
              let json = String(data: data, encoding: .utf8) else { return }
        // Called on main, in order, so the last words land before speechEnded.
        web?.evaluateJavaScript("window.ClickClack && window.ClickClack.speech(\(json))")
    }

    private func sendEnded() {
        web?.evaluateJavaScript("window.ClickClack && window.ClickClack.speechEnded && window.ClickClack.speechEnded()")
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio()
    }

    func stop() {
        generation += 1
        stopAudio()
        task?.finish()
        task = nil; request = nil
    }
}
