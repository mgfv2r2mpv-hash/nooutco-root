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
    static func read() -> String? {
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
