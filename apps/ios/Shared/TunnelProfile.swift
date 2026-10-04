import Foundation

/// Everything the Packet Tunnel needs to start, written by the app into the
/// shared App Group container. The extension reads it on every start, so
/// iOS can also restart the tunnel by itself (e.g. from Settings).
struct TunnelProfile: Codable {
    /// Xray JSON config from the dashboard (`xray` in /api/v1/connect)
    var xrayConfig: String
    /// Access window enforced by the node; the tunnel stops itself after it
    var expiresAt: Date
    var serverName: String
    var serverAddress: String

    static let fileName = "tunnel-profile.json"

    static var appGroupIdentifier: String {
        Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String ?? ""
    }

    static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appendingPathComponent(fileName)
    }

    static func load() throws -> TunnelProfile {
        guard let url = fileURL else { throw TunnelProfileError.noAppGroup }
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(TunnelProfile.self, from: data)
    }

    func save() throws {
        guard let url = TunnelProfile.fileURL else { throw TunnelProfileError.noAppGroup }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        try encoder.encode(self).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

enum TunnelProfileError: LocalizedError {
    case noAppGroup

    var errorDescription: String? {
        "App Group is not configured (check APP_GROUP_ID and entitlements)"
    }
}
