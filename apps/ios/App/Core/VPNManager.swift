import Foundation
import NetworkExtension

/// Owns the app's NETunnelProviderManager (the VPN profile in iOS Settings).
@MainActor
final class VPNManager: ObservableObject {
    @Published private(set) var status: NEVPNStatus = .invalid

    private var manager: NETunnelProviderManager?
    private var statusObserver: NSObjectProtocol?

    var isActive: Bool {
        [.connected, .connecting, .reasserting].contains(status)
    }

    func load() async {
        let managers = (try? await NETunnelProviderManager.loadAllFromPreferences()) ?? []
        if let existing = managers.first {
            attach(existing)
        }
    }

    /// Starts the tunnel with the profile already saved by `TunnelProfile.save()`.
    /// The first call shows the system "Add VPN configuration" prompt.
    func start() async throws {
        let manager = try await preparedManager()
        try manager.connection.startVPNTunnel()
    }

    func stop() {
        manager?.connection.stopVPNTunnel()
    }

    /// Restarts with a fresh profile (e.g. after the server issued a new IPv6).
    func restart() async throws {
        if status != .disconnected, status != .invalid {
            stop()
            _ = await waitFor([.disconnected, .invalid], timeout: 10)
        }
        try await start()
    }

    /// Waits until the status is one of `targets`; returns false on timeout.
    func waitFor(_ targets: [NEVPNStatus], timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if targets.contains(status) { return true }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return targets.contains(status)
    }

    private func preparedManager() async throws -> NETunnelProviderManager {
        let manager = self.manager ?? NETunnelProviderManager()
        let proto = (manager.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        proto.providerBundleIdentifier = AppConfig.tunnelBundleIdentifier
        proto.serverAddress = AppConfig.appName
        manager.protocolConfiguration = proto
        manager.localizedDescription = AppConfig.appName
        manager.isEnabled = true
        try await manager.saveToPreferences()
        // Required after saving, otherwise the first start can fail
        try await manager.loadFromPreferences()
        attach(manager)
        return manager
    }

    private func attach(_ manager: NETunnelProviderManager) {
        self.manager = manager
        status = manager.connection.status
        if let statusObserver { NotificationCenter.default.removeObserver(statusObserver) }
        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: manager.connection,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.status = manager.connection.status
            }
        }
    }
}
