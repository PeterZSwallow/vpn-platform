import LibXray
import NetworkExtension
import os

/// Runs Xray-core (libXray) on the utun device created by NetworkExtension.
/// Xray's own TUN inbound reads packets straight from the file descriptor,
/// so no separate tun2socks layer is needed.
final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "vpn.tunnel", category: "provider")
    private var expiryTimer: DispatchSourceTimer?

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let profile: TunnelProfile
        do {
            profile = try TunnelProfile.load()
        } catch {
            log.error("cannot load profile: \(error.localizedDescription, privacy: .public)")
            completionHandler(TunnelError.noProfile)
            return
        }
        guard profile.expiresAt > Date() else {
            completionHandler(TunnelError.expired)
            return
        }

        setTunnelNetworkSettings(makeNetworkSettings(remoteAddress: profile.serverAddress)) { [weak self] error in
            guard let self else { return }
            if let error {
                completionHandler(error)
                return
            }
            do {
                try self.startXray(configJSON: profile.xrayConfig)
                self.scheduleExpiry(at: profile.expiresAt)
                completionHandler(nil)
            } catch {
                self.log.error("xray start failed: \(error.localizedDescription, privacy: .public)")
                completionHandler(error)
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        expiryTimer?.cancel()
        expiryTimer = nil
        _ = try? invoke(method: "stopXray", payload: [:])
        completionHandler()
    }

    // MARK: - Network settings

    private func makeNetworkSettings(remoteAddress: String) -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: remoteAddress)

        let ipv4 = NEIPv4Settings(addresses: ["172.19.0.1"], subnetMasks: ["255.255.255.252"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        settings.ipv4Settings = ipv4

        let ipv6 = NEIPv6Settings(addresses: ["fdfe:dcba:9876::1"], networkPrefixLengths: [126])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6

        // DNS goes through the tunnel like any other traffic
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns

        settings.mtu = 1500
        return settings
    }

    // MARK: - Xray

    private func startXray(configJSON: String) throws {
        guard let fd = tunnelFileDescriptor() else { throw TunnelError.noTunDevice }

        guard var config = try JSONSerialization.jsonObject(with: Data(configJSON.utf8)) as? [String: Any] else {
            throw TunnelError.badConfig
        }
        var env = config["env"] as? [String: String] ?? [:]
        env["xray.tun.fd"] = String(fd)
        config["env"] = env
        let xrayJSON = String(decoding: try JSONSerialization.data(withJSONObject: config), as: UTF8.self)

        try invoke(method: "runXray", payload: ["xrayJson": xrayJSON])
    }

    /// Calls libXray's single entrypoint: `{"apiVersion":3,"method":...,"payload":...}`.
    @discardableResult
    private func invoke(method: String, payload: [String: Any]) throws -> [String: Any] {
        let request: [String: Any] = ["apiVersion": 3, "method": method, "payload": payload]
        let requestJSON = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
        let responseJSON: String? = LibXrayInvoke(requestJSON)
        guard
            let data = responseJSON?.data(using: .utf8),
            let response = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw TunnelError.xray("empty response") }
        if response["success"] as? Bool != true {
            throw TunnelError.xray(response["error"] as? String ?? "unknown error")
        }
        return response
    }

    /// The utun socket NetworkExtension created for this tunnel. This is the
    /// lookup documented by Xray-core for iOS (proxy/tun/README.md).
    private func tunnelFileDescriptor() -> Int32? {
        var buf = [CChar](repeating: 0, count: Int(IFNAMSIZ))
        let utunPrefix = "utun".utf8CString.dropLast()
        return (0 ... 1024).first { (fd: Int32) -> Bool in
            var len = socklen_t(buf.count)
            // SYSPROTO_CONTROL = 2, UTUN_OPT_IFNAME = 2
            return getsockopt(fd, 2, 2, &buf, &len) == 0 && buf.starts(with: utunPrefix)
        }
    }

    // MARK: - Expiry

    /// The node disables the client at expiresAt anyway; stopping here makes
    /// the phone show "disconnected" instead of a silently dead tunnel.
    private func scheduleExpiry(at date: Date) {
        expiryTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .global())
        timer.schedule(deadline: .now() + max(0, date.timeIntervalSinceNow))
        timer.setEventHandler { [weak self] in
            self?.cancelTunnelWithError(TunnelError.expired)
        }
        timer.resume()
        expiryTimer = timer
    }
}

enum TunnelError: LocalizedError {
    case noProfile
    case expired
    case noTunDevice
    case badConfig
    case xray(String)

    var errorDescription: String? {
        switch self {
        case .noProfile: return "Нет конфигурации. Подключитесь из приложения."
        case .expired: return "Время доступа истекло."
        case .noTunDevice: return "Не найден туннельный интерфейс."
        case .badConfig: return "Некорректная конфигурация."
        case let .xray(message): return "Ошибка Xray: \(message)"
        }
    }
}
