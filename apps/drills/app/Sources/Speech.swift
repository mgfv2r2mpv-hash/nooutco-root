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
        engine.prepare()
        do { try engine.start() } catch { return ["ok": false, "note": "The microphone would not start: \(error.localizedDescription)"] }
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            if let r = result { self?.send(text: r.bestTranscription.formattedString, final: r.isFinal) }
            if error != nil || (result?.isFinal ?? false) { self?.stopAudio() }
        }
        log("mic: listening, on device")
        return ["ok": true]
    }

    private func send(text: String, final: Bool) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["text": text, "final": final]),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web?.evaluateJavaScript("window.ClickClack && window.ClickClack.speech(\(json))") }
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
    }

    func stop() {
        stopAudio()
        task?.finish()
        task = nil; request = nil
    }
}
