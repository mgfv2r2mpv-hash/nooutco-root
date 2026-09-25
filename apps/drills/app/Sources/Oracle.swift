// The oracle's thinking and the expert's drafting: one call to his own Claude
// Code (`claude -p`) on this Mac, his ruling 1A of 2026-09-23. No key lives in
// the app; the CLI uses his subscription login.
//
// The page supplies the system prompt, the prompt and the JSON schema (they
// live in web/oracle.js, where the tests read them). The shell fixes what the
// call may DO: web search only, no files, no shell, no MCP servers, no hooks,
// no saved session. The page cannot widen that.
import Foundation

func findClaude() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    for p in ["\(home)/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
    where FileManager.default.isExecutableFile(atPath: p) { return p }
    return nil
}

/// A quiet folder for the CLI to run in, so no project's CLAUDE.md is read.
var oracleCwd: URL {
    let d = Paths.support.appendingPathComponent("oracle", isDirectory: true)
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
}

/// Ask Claude once. Returns { ok, output } where output is the structured JSON
/// the schema asked for, or { ok: false, note } in plain words.
func askClaude(system: String, prompt: String, schema: String, webSearch: Bool) -> [String: Any] {
    guard let claude = findClaude() else {
        return ["ok": false, "note": "Claude Code was not found on this Mac (looked in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin)."]
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: claude)
    p.currentDirectoryURL = oracleCwd
    p.arguments = [
        "-p", "--output-format", "json", "--no-session-persistence",
        "--setting-sources", "", "--strict-mcp-config",
        "--tools", webSearch ? "WebSearch" : "",
        "--system-prompt", system, "--json-schema", schema, prompt,
    ]
    // A GUI app has no shell environment; the CLI's login is keyed by USER and HOME.
    let env = ProcessInfo.processInfo.environment
    p.environment = [
        "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
        "USER": env["USER"] ?? NSUserName(),
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "LANG": "en_US.UTF-8",
    ]
    let out = Pipe(), err = Pipe()
    p.standardOutput = out; p.standardError = err
    do { try p.run() } catch { return ["ok": false, "note": "Could not start Claude Code: \(error.localizedDescription)"] }
    // Read while it runs, so a large answer never fills the pipe and stalls it.
    var data = Data()
    let reader = DispatchQueue(label: "oracle.read")
    let done = DispatchSemaphore(value: 0)
    reader.async { data = out.fileHandleForReading.readDataToEndOfFile(); done.signal() }
    let deadline = Date().addingTimeInterval(180)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
    if p.isRunning { p.terminate(); return ["ok": false, "note": "Claude Code took over three minutes and was stopped."] }
    done.wait()
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        let e = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        log("oracle: unreadable output, status \(p.terminationStatus)")
        return ["ok": false, "note": "Claude Code answered in a form the app could not read. \(e.prefix(160))"]
    }
    if (obj["is_error"] as? Bool) == true {
        return ["ok": false, "note": "Claude Code said: \(String(describing: obj["result"] ?? "an error").prefix(200))"]
    }
    guard let structured = obj["structured_output"] else {
        return ["ok": false, "note": "Claude Code answered without the structured reply the app asked for."]
    }
    log("oracle: ok in \(obj["duration_ms"] ?? "?") ms")
    return ["ok": true, "output": structured]
}
