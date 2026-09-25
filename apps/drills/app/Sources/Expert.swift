// Sending kept answers on to the expert that runs on the website, his ruling
// 2A of 2026-09-23: the app drafts knowledge records and PROPOSES them; he
// commits or rejects each one in the admin page. Nothing merges itself.
//
// The store has no public door of its own. The way in is the tools site,
// POST https://tools.nooutco.me/api/expert-knowledge?op=propose, with an
// admin session token (the one the admin page keeps after login). The login
// is behind Turnstile, so the app cannot log in by itself: he pastes that
// token once and it lives in the keychain, never in a file. It lasts 30 days.
import Foundation
import Security

let EXPERT_URL = "https://tools.nooutco.me/api/expert-knowledge?op=propose"
let KEYCHAIN_SERVICE = "dev.kaleb.clickclackoracle"
let KEYCHAIN_ACCOUNT = "tools-admin-token"

enum Keychain {
    // Read once per launch and held here, so the keychain asks at most once.
    // `nil` = not read yet; "" = read, and nothing saved.
    private static var cached: String?
    static func read() -> String? {
        if let c = cached { return c.isEmpty ? nil : c }
        let v = readStore()
        cached = v ?? ""
        return v
    }
    private static func readStore() -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: KEYCHAIN_SERVICE,
                                kSecAttrAccount as String: KEYCHAIN_ACCOUNT, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    @discardableResult static func write(_ value: String) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: KEYCHAIN_SERVICE,
                                   kSecAttrAccount as String: KEYCHAIN_ACCOUNT]
        SecItemDelete(base as CFDictionary)
        cached = value
        if value.isEmpty { return true }
        var add = base; add[kSecValueData as String] = Data(value.utf8)
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}

/// What the token says about itself (role, expiry). Read only to warn early;
/// the site checks the signature, the app never can.
func tokenStatus() -> [String: Any] {
    guard let t = Keychain.read(), !t.isEmpty else { return ["connected": false, "note": "Not connected to the expert yet."] }
    let payload = t.split(separator: ".").first.map(String.init) ?? ""
    var b64 = payload.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while b64.count % 4 != 0 { b64 += "=" }
    guard let d = Data(base64Encoded: b64), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
        return ["connected": false, "note": "The saved token is not in the form the admin page issues."]
    }
    let role = obj["role"] as? String ?? ""
    let exp = (obj["exp"] as? Double) ?? 0
    let left = exp > 0 ? (exp - Date().timeIntervalSince1970) / 86400 : 0
    if role != "admin" { return ["connected": false, "note": "The saved token is not an admin token."] }
    if exp > 0 && left <= 0 { return ["connected": false, "expired": true, "note": "The saved token has expired. Log in to the admin page and paste a fresh one."] }
    return ["connected": true, "daysLeft": Int(left.rounded(.down)), "note": "Connected to the expert. The token has \(Int(left.rounded(.down))) days left."]
}

/// Kept answers not yet sent on. Each line of expert-queue.jsonl is one kept
/// answer; sent.json lists the ones already proposed (by their `at` stamp).
var sentFile: URL { Paths.support.appendingPathComponent("expert-sent.json") }

func unsentQueue() -> [[String: Any]] {
    let sent = Set((readJSON(sentFile, fallback: []) as? [String]) ?? [])
    guard let text = try? String(contentsOf: Paths.expertQueue, encoding: .utf8) else { return [] }
    return text.split(separator: "\n").compactMap { line in
        guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
        guard let at = o["at"] as? String, !sent.contains(at) else { return nil }
        return o
    }
}

func markSent(_ stamps: [String]) {
    var sent = (readJSON(sentFile, fallback: []) as? [String]) ?? []
    sent.append(contentsOf: stamps.filter { !sent.contains($0) })
    try? writeJSON(sentFile, sent)
}

/// POST one proposal. Returns { ok, proposalId } or { ok: false, status, note }.
func propose(_ record: [String: Any]) -> [String: Any] {
    guard let token = Keychain.read(), !token.isEmpty else { return ["ok": false, "note": "Not connected to the expert."] }
    guard let url = URL(string: EXPERT_URL), let body = try? JSONSerialization.data(withJSONObject: record) else {
        return ["ok": false, "note": "The proposal could not be encoded."]
    }
    var req = URLRequest(url: url, timeoutInterval: 30)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpBody = body
    var result: [String: Any] = ["ok": false, "note": "No answer from the tools site."]
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { data, resp, error in
        defer { sem.signal() }
        if let error = error { result = ["ok": false, "note": "Could not reach the tools site: \(error.localizedDescription)"]; return }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if status == 200, let id = obj["proposalId"] as? String { result = ["ok": true, "proposalId": id]; return }
        let why = (obj["error"] as? String) ?? "status \(status)"
        result = ["ok": false, "status": status, "note": status == 401 || status == 403 ? "The site refused the token (\(why)). Paste a fresh one." : "The site said: \(why)"]
    }.resume()
    sem.wait()
    log("propose: \(result["ok"] as? Bool == true ? "staged" : "refused \(result["status"] ?? "")")")
    return result
}

/// The records in force, for the baton pass to weigh his answer against.
/// GET ?op=list, the same call the admin Knowledge tab makes. These are
/// authored knowledge, never a clinician's typed text.
/// Returns { ok, records } or { ok: false, note }.
func listRecords() -> [String: Any] {
    guard let token = Keychain.read(), !token.isEmpty else { return ["ok": false, "note": "Not connected to the expert."] }
    guard let url = URL(string: EXPERT_URL.replacingOccurrences(of: "op=propose", with: "op=list")) else {
        return ["ok": false, "note": "The list address could not be built."]
    }
    var req = URLRequest(url: url, timeoutInterval: 20)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    var result: [String: Any] = ["ok": false, "note": "No answer from the tools site."]
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { data, resp, error in
        defer { sem.signal() }
        if let error = error { result = ["ok": false, "note": "Could not reach the tools site: \(error.localizedDescription)"]; return }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if status == 200 { result = ["ok": true, "records": obj["records"] ?? []]; return }
        result = ["ok": false, "status": status, "note": "The site said: \((obj["error"] as? String) ?? "status \(status)")"]
    }.resume()
    sem.wait()
    log("list: \(result["ok"] as? Bool == true ? "\((result["records"] as? [Any])?.count ?? 0) records" : "refused \(result["status"] ?? "")")")
    return result
}

/// One call to the tools site's expert-knowledge route, the same door the admin
/// page's Knowledge tab uses. Returns { ok, status, data } or { ok: false, note }.
/// Only the ops named at the bridge (main.swift) ever reach here.
func expertRequest(op: String, method: String, query: [String: String] = [:], body: [String: Any]? = nil) -> [String: Any] {
    guard let token = Keychain.read(), !token.isEmpty else { return ["ok": false, "note": "Not connected to the expert."] }
    var parts = URLComponents(string: "https://tools.nooutco.me/api/expert-knowledge")!
    parts.queryItems = [URLQueryItem(name: "op", value: op)] + query.map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let url = parts.url else { return ["ok": false, "note": "The address could not be built."] }
    var req = URLRequest(url: url, timeoutInterval: 30)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body = body, let data = try? JSONSerialization.data(withJSONObject: body) {
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
    }
    var result: [String: Any] = ["ok": false, "note": "No answer from the tools site."]
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { data, resp, error in
        defer { sem.signal() }
        if let error = error { result = ["ok": false, "note": "Could not reach the tools site: \(error.localizedDescription)"]; return }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        if status == 200 { result = ["ok": true, "status": status, "data": obj]; return }
        let why = (obj["error"] as? String) ?? "status \(status)"
        result = ["ok": false, "status": status, "note": status == 401 || status == 403 ? "The site refused the token (\(why)). Paste a fresh one in Settings." : "The site said: \(why)"]
    }.resume()
    sem.wait()
    log("expert \(op): \(result["ok"] as? Bool == true ? "ok" : "refused \(result["status"] ?? "")")")
    return result
}
