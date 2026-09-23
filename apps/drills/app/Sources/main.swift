// ClickClackOracle (was Clinical Typing Drills) - the macOS shell.
//
// A Swift window over a WKWebView, the same shape as Sass C. Assistant. The page
// is the drill in apps/drills/web, copied into the bundle verbatim, so the code
// the tests run is the code that ships. WebKit refuses ES modules over file://,
// so the bundle is served on the app's own URL scheme, drill://app/. No node at
// runtime for the page, no localhost port, nothing left listening after quit.
//
// ONE message handler, `drill`, answers the page with a promise:
//   load          history, lexicon and settings from Application Support
//   saveHistory   numbers only, one record per drill
//   saveLexicon   the clinical terms he marked as his
//   saveSettings  the clock he last picked
//   keep          THE TEXT, only ever from the Keep it button (his ruling,
//                 2026-09-22): into the voice corpus through ingest.mjs, drill
//                 register, safe tier; and onto the expert queue
//   log           a line in app.log, counts and names only
//   ready         the self-test's signal that the page came up whole
//
// Run with --selftest to load the page, wait for `ready`, dry-run the corpus
// intake, print a report and exit 0 or 1.

import AppKit
import WebKit
import UniformTypeIdentifiers

let SCHEME = "drill"
let ORIGIN = "drill://app"
let APP_NAME = "ClickClackOracle"
/// The name before 2026-09-23. Its data folder is moved to the new name once.
let OLD_NAME = "Clinical Typing Drills"

// ------------------------------------------------------------------ files

enum Paths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent(APP_NAME, isDirectory: true)
        let old = base.appendingPathComponent(OLD_NAME, isDirectory: true)
        // The rename: bring the drill history, lexicon and kept answers along,
        // once. A move, never a copy, so there is one history and not two.
        if !FileManager.default.fileExists(atPath: dir.path), FileManager.default.fileExists(atPath: old.path) {
            try? FileManager.default.moveItem(at: old, to: dir)
        }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    static var history: URL { support.appendingPathComponent("history.json") }
    static var lexicon: URL { support.appendingPathComponent("lexicon.json") }
    static var settings: URL { support.appendingPathComponent("settings.json") }
    static var kept: URL {
        let d = support.appendingPathComponent("kept", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static var expertQueue: URL { support.appendingPathComponent("expert-queue.jsonl") }
    static var log: URL { support.appendingPathComponent("app.log") }
    static let home = FileManager.default.homeDirectoryForCurrentUser
    static var ingest: URL { home.appendingPathComponent(".claude/voice/tools/ingest.mjs") }
    static var web: URL { Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true) }
}

func log(_ line: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    let text = "\(stamp) \(line)\n"
    if let h = try? FileHandle(forWritingTo: Paths.log) {
        h.seekToEndOfFile(); h.write(text.data(using: .utf8)!); try? h.close()
    } else {
        try? text.write(to: Paths.log, atomically: true, encoding: .utf8)
    }
}

func readJSON(_ url: URL, fallback: Any) -> Any {
    guard let d = try? Data(contentsOf: url), let v = try? JSONSerialization.jsonObject(with: d) else { return fallback }
    return v
}

/// Write through a temporary file and a rename, so a crash mid-write never
/// leaves half a history behind.
func writeJSON(_ url: URL, _ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    let tmp = url.appendingPathExtension("tmp")
    try data.write(to: tmp, options: .atomic)
    _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
}

// ------------------------------------------------------------------ node

/// A GUI app does not inherit the shell's PATH, so node is looked for where
/// Homebrew and the installer put it.
func findNode() -> String? {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] where FileManager.default.isExecutableFile(atPath: p) {
        return p
    }
    return nil
}

struct RunResult { let status: Int32; let out: String }

func run(_ exe: String, _ args: [String], timeout: TimeInterval = 60) -> RunResult {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    p.environment = env
    let pipe = Pipe()
    p.standardOutput = pipe; p.standardError = pipe
    do { try p.run() } catch { return RunResult(status: -1, out: "\(error)") }
    let deadline = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
    if p.isRunning { p.terminate(); return RunResult(status: -2, out: "timed out") }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return RunResult(status: p.terminationStatus, out: String(data: data, encoding: .utf8) ?? "")
}

/// Hand one kept answer to the voice corpus. ingest.mjs scrubs identifiers,
/// writes the safe tier and updates the manifest; it prints counts, never text.
/// The register is `drill`: typed at speed, for himself, on a clock, so it is
/// its own register and never joins the note bands by accident.
func ingest(file: URL, doc: String, dry: Bool, register: String = "drill") -> RunResult {
    guard let node = findNode() else { return RunResult(status: -3, out: "node was not found") }
    guard FileManager.default.fileExists(atPath: Paths.ingest.path) else { return RunResult(status: -4, out: "ingest.mjs was not found at ~/.claude/voice/tools") }
    var args = [Paths.ingest.path, file.path, "--register", register, "--tier", "safe", "--doc", doc]
    if dry { args.append("--dry") }
    return run(node, args)
}

// ------------------------------------------------------------------ the scheme

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "txt": "text/plain; charset=utf-8", "svg": "image/svg+xml", "png": "image/png", "json": "application/json",
    ]
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = Paths.web.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(Paths.web.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            task.didFinish(); return
        }
        let type = SchemeHandler.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-store"])!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// ------------------------------------------------------------------ the bridge

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    var onReady: (([String: Any]) -> Void)?

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // Only the app's own page may call in.
        guard message.frameInfo.securityOrigin.protocol == SCHEME else { replyHandler(nil, "refused"); return }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { replyHandler(nil, "no op"); return }
        switch op {
        case "load":
            replyHandler([
                "history": readJSON(Paths.history, fallback: []),
                "lexicon": readJSON(Paths.lexicon, fallback: []),
                "settings": readJSON(Paths.settings, fallback: [:]),
            ], nil)
        case "saveHistory":
            save(Paths.history, body["history"] as? [Any], replyHandler)
        case "saveLexicon":
            save(Paths.lexicon, body["lexicon"] as? [Any], replyHandler)
        case "saveSettings":
            save(Paths.settings, body["settings"] as? [String: Any], replyHandler)
        case "keep":
            guard let r = body["record"] as? [String: Any] else { replyHandler(nil, "no record"); return }
            DispatchQueue.global(qos: .userInitiated).async {
                let out = keep(r)
                DispatchQueue.main.async { replyHandler(out, nil) }
            }
        case "askClaude":
            // The oracle's question and thoughts, or a drafted proposal. Off the main thread: it takes seconds.
            guard let system = body["system"] as? String, let prompt = body["prompt"] as? String, let schema = body["schema"] as? String else { replyHandler(nil, "missing system, prompt or schema"); return }
            let web = (body["webSearch"] as? Bool) ?? false
            DispatchQueue.global(qos: .userInitiated).async {
                let out = askClaude(system: system, prompt: prompt, schema: schema, webSearch: web)
                DispatchQueue.main.async { replyHandler(out, nil) }
            }
        case "micStart":
            Listener.shared.start { replyHandler($0, nil) }
        case "micStop":
            Listener.shared.stop()
            replyHandler(["ok": true], nil)
        case "expertStatus":
            var s = tokenStatus(); s["queued"] = unsentQueue().count
            replyHandler(s, nil)
        case "expertToken":
            // Pasted once from the admin page; kept in the keychain, never in a file or the log.
            let t = ((body["token"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            Keychain.write(t)
            var s = tokenStatus(); s["queued"] = unsentQueue().count
            replyHandler(s, nil)
        case "expertQueue":
            replyHandler(["items": unsentQueue()], nil)
        case "expertPropose":
            guard let rec = body["record"] as? [String: Any] else { replyHandler(nil, "no record"); return }
            DispatchQueue.global(qos: .userInitiated).async {
                let out = propose(rec)
                DispatchQueue.main.async { replyHandler(out, nil) }
            }
        case "expertSent":
            markSent((body["stamps"] as? [String]) ?? [])
            replyHandler(["ok": true, "queued": unsentQueue().count], nil)
        case "log":
            log("page: \((body["line"] as? String) ?? "")")
            replyHandler(["ok": true], nil)
        case "ready":
            let report = (body["report"] as? [String: Any]) ?? [:]
            log("ready \(report)")
            onReady?(report)
            replyHandler(["ok": true], nil)
        default:
            replyHandler(nil, "unknown op \(op)")
        }
    }

    private func save(_ url: URL, _ value: Any?, _ reply: @escaping (Any?, String?) -> Void) {
        guard let value = value else { reply(nil, "nothing to save"); return }
        do { try writeJSON(url, value); reply(["ok": true], nil) } catch { reply(nil, "\(error)") }
    }
}

/// Keep one answer: the text to a file, the file to the corpus, the answer and
/// its question to the expert queue. Returns what happened, in plain words.
func keep(_ r: [String: Any]) -> [String: Any] {
    guard let text = r["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return ["ok": false, "note": "Nothing to keep."]
    }
    let at = (r["at"] as? String) ?? ISO8601DateFormatter().string(from: Date())
    let outline = (r["outline"] as? String) ?? "x"
    // Typed answers are `drill`; answers he TALKED are `spoken` (his ruling 3A),
    // so speech never mixes with the writing bands. Nothing else is accepted.
    let register = (r["register"] as? String) == "spoken" ? "spoken" : "drill"
    let stamp = at.replacingOccurrences(of: ":", with: "").replacingOccurrences(of: ".", with: "").prefix(17)
    let file = Paths.kept.appendingPathComponent("\(stamp)-\(outline).txt")
    do { try text.write(to: file, atomically: true, encoding: .utf8) } catch {
        return ["ok": false, "note": "Could not write the answer: \(error.localizedDescription)"]
    }
    // The sidecar: what the answer was an answer TO, and the clock it ran on.
    let meta: [String: Any] = [
        "at": at, "outline": outline, "itemId": r["itemId"] ?? "", "question": r["question"] ?? "",
        "minutes": r["minutes"] ?? 0, "seconds": r["seconds"] ?? 0, "nwam": r["nwam"] ?? 0, "accuracy": r["accuracy"] ?? 0,
        "register": register, "audience": "self", "timed": true, "mode": r["mode"] ?? "answer",
        "oracle": r["oracle"] ?? [:],
        // Where he stopped to think (character offset, ms, kind) and how many
        // times he changed his mind with Option or Command+Backspace.
        "pauses": r["pauses"] ?? [], "revisions": r["revisions"] ?? 0,
        // A respond round names the passage it answered; a Keep going round
        // kept after an earlier Keep names the answer it continues.
        "passage": r["passage"] ?? "", "passageSource": r["passageSource"] ?? "", "continues": r["continues"] ?? "",
    ]
    try? writeJSON(file.deletingPathExtension().appendingPathExtension("json"), meta)

    // The expert queue: one line per kept answer, for the propose step.
    var q = meta; q["answer"] = text
    if let line = try? JSONSerialization.data(withJSONObject: q), var s = String(data: line, encoding: .utf8) {
        s += "\n"
        if let h = try? FileHandle(forWritingTo: Paths.expertQueue) { h.seekToEndOfFile(); h.write(s.data(using: .utf8)!); try? h.close() }
        else { try? s.write(to: Paths.expertQueue, atomically: true, encoding: .utf8) }
    }

    let doc = "Drill \(at.prefix(10)) \(outline)"
    let res = ingest(file: file, doc: doc, dry: false, register: register)
    log("keep \(outline) ingest status \(res.status)")
    let corpus: String
    if res.status == 0 {
        corpus = "In your voice corpus (\(register) register)."
    } else {
        let first = res.out.split(separator: "\n").first.map(String.init) ?? "no output"
        corpus = "Saved on this Mac; the corpus intake said: \(first.prefix(140))"
    }
    return ["ok": true, "corpus": corpus, "expert": "Queued for the expert.", "file": file.path]
}

// ------------------------------------------------------------------ the window

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let bridge = Bridge()
    let selftest = CommandLine.arguments.contains("--selftest")

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: SCHEME)
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "drill")
        cfg.preferences.isTextInteractionEnabled = true
        web = WKWebView(frame: .zero, configuration: cfg)
        Listener.shared.web = web
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = APP_NAME
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(calibratedRed: 243/255, green: 245/255, blue: 248/255, alpha: 1)
        window.minSize = NSSize(width: 720, height: 600)
        window.contentView = web
        window.setFrameAutosaveName("DrillWindow")
        if !window.setFrameUsingName("DrillWindow") { window.center() }

        if selftest { runSelftest() } else { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
        web.load(URLRequest(url: URL(string: ORIGIN + "/index.html")!))
        log("launch \(selftest ? "selftest" : "run")")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Links out of the page open in the browser, never in the drill window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme != SCHEME {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func runSelftest() {
        var done = false
        func finish(_ ok: Bool, _ lines: [String]) {
            guard !done else { return }
            done = true
            print((ok ? "SELFTEST PASS" : "SELFTEST FAIL") + "\n" + lines.joined(separator: "\n"))
            fflush(stdout)
            exit(ok ? 0 : 1)
        }
        bridge.onReady = { report in
            var lines = ["page: \(report)"]
            let bank = (report["bank"] as? Int) ?? 0
            let outline = (report["outline"] as? Int) ?? 0
            let words = (report["words"] as? Int) ?? 0
            var ok = bank > 40 && outline == 104 && words > 100_000
            // Dry-run the corpus intake on a scratch answer: proves node,
            // ingest.mjs and the drill register are reachable, writes nothing.
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("drill-selftest.txt")
            try? "The BCBA modeled the prompt and the parent ran it twice, then the BCBA gave feedback on the second step.".write(to: tmp, atomically: true, encoding: .utf8)
            let r = ingest(file: tmp, doc: "Drill selftest", dry: true)
            lines.append("ingest --dry status \(r.status)")
            lines.append(contentsOf: r.out.split(separator: "\n").prefix(6).map { "  " + $0 })
            if r.status != 0 { ok = false }
            lines.append("support \(Paths.support.path)")
            finish(ok, lines)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { finish(false, ["the page never reported ready"]) }
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(APP_NAME)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Show Data Folder", action: #selector(showData), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(APP_NAME)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit \(APP_NAME)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
    }

    @objc func showData() { NSWorkspace.shared.activateFileViewerSelecting([Paths.support]) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(CommandLine.arguments.contains("--selftest") ? .accessory : .regular)
app.run()
