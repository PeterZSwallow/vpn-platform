import Foundation

/// Error codes returned by the dashboard API (`{"error": "..."}`).
struct APIError: LocalizedError {
    let status: Int
    let code: String

    var errorDescription: String? {
        switch code {
        case "ad_required": return "Посмотрите рекламу, чтобы подключиться бесплатно."
        case "premium_required": return "Этот сервер доступен только по подписке."
        case "ipv6_required": return "Этому серверу нужен IPv6, а в вашей сети его нет."
        case "banned": return "Доступ заблокирован."
        case "provision_failed", "server_unavailable", "server_misconfigured":
            return "Сервер временно недоступен. Выберите другой."
        default: return "Ошибка сервера (\(status) \(code))."
        }
    }
}

/// Client for the dashboard's /api/v1 endpoints.
final class APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private var token: String?

    init(baseURL: URL = AppConfig.apiBaseURL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = APIClient.isoFractional.date(from: text) ?? APIClient.iso.date(from: text) {
                return date
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        token = Keychain.string(for: "apiToken")
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso = ISO8601DateFormatter()

    // MARK: - Endpoints

    func register() async throws {
        struct Body: Encodable { let installId: String; let appVersion: String; let platform = "ios" }
        struct Response: Decodable { let token: String }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let response: Response = try await send(
            "POST", "api/v1/devices/register",
            body: Body(installId: DeviceIdentity.installId, appVersion: version),
            authorized: false
        )
        token = response.token
        Keychain.set(response.token, for: "apiToken")
    }

    func config() async throws -> ClientConfig {
        try await send("GET", "api/v1/config", authorized: false)
    }

    func status() async throws -> AccountStatus {
        try await send("GET", "api/v1/me")
    }

    func servers() async throws -> [ServerItem] {
        struct Response: Decodable { let servers: [ServerItem] }
        let response: Response = try await send("GET", "api/v1/servers")
        return response.servers
    }

    func connect(serverId: String, ipv6: Bool, rotateIpv6: Bool) async throws -> ConnectResult {
        struct Body: Encodable { let serverId: String; let ipv6: Bool; let rotateIpv6: Bool }
        struct Response: Decodable {
            let expiresAt: Date
            let addresses: [String]
            let ipv6Address: String?
            let ipv6Rotated: Bool
        }
        let data = try await sendRaw(
            "POST", "api/v1/connect",
            body: Body(serverId: serverId, ipv6: ipv6, rotateIpv6: rotateIpv6)
        )
        let typed = try decoder.decode(Response.self, from: data)
        // Keep the Xray config as opaque JSON: the server owns its shape
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let xray = object["xray"]
        else { throw APIError(status: 200, code: "missing_config") }
        let xrayData = try JSONSerialization.data(withJSONObject: xray)
        return ConnectResult(
            expiresAt: typed.expiresAt,
            addresses: typed.addresses,
            ipv6Address: typed.ipv6Address,
            ipv6Rotated: typed.ipv6Rotated,
            xrayConfig: String(decoding: xrayData, as: UTF8.self)
        )
    }

    /// RevenueCat: ask the dashboard to re-read the subscriber right after a purchase.
    func refreshSubscription() async throws -> AccountStatus {
        try await send("POST", "api/v1/subscription/refresh")
    }

    /// StoreKit 2: hand a signed transaction to the dashboard for verification.
    func submitStoreKitTransaction(_ jws: String) async throws -> AccountStatus {
        struct Body: Encodable { let signedTransaction: String }
        return try await send("POST", "api/v1/subscription/storekit", body: Body(signedTransaction: jws))
    }

    // MARK: - Transport

    private struct Empty: Encodable {}

    private func send<T: Decodable>(_ method: String, _ path: String, authorized: Bool = true) async throws -> T {
        try await send(method, path, body: Optional<Empty>.none, authorized: authorized)
    }

    private func send<T: Decodable, B: Encodable>(
        _ method: String, _ path: String, body: B?, authorized: Bool = true
    ) async throws -> T {
        let data = try await sendRaw(method, path, body: body, authorized: authorized)
        return try decoder.decode(T.self, from: data)
    }

    private func sendRaw<B: Encodable>(
        _ method: String, _ path: String, body: B?, authorized: Bool = true, retried: Bool = false
    ) async throws -> Data {
        if authorized, token == nil { try await register() }

        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        if authorized, let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        // Token lost or server secret rotated: register again once
        if status == 401, authorized, !retried {
            try await register()
            return try await sendRaw(method, path, body: body, authorized: authorized, retried: true)
        }
        guard (200 ..< 300).contains(status) else {
            let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(status: status, code: code ?? "http_\(status)")
        }
        return data
    }
}
