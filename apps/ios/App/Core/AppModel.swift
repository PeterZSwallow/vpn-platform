import Foundation
import Network
import NetworkExtension
import SwiftUI

/// App state and the connect flow: access checks (ad / subscription),
/// fetching a personal config, starting the tunnel and verifying it works.
@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case failed(String)
        case ready
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var servers: [ServerItem] = []
    @Published private(set) var account: AccountStatus?
    @Published private(set) var config: ClientConfig?
    @Published private(set) var busy = false
    @Published var selectedServerId: String? {
        didSet { UserDefaults.standard.set(selectedServerId, forKey: "selectedServerId") }
    }

    @Published var alert: String?
    @Published var showPaywall = false

    let vpn = VPNManager()
    let ads = AdsManager()
    private(set) var billing: BillingService?

    private let api = APIClient()
    private let pathMonitor = NWPathMonitor()
    private var deviceHasIPv6 = true

    private var connectCount: Int {
        get { UserDefaults.standard.integer(forKey: "connectCount") }
        set { UserDefaults.standard.set(newValue, forKey: "connectCount") }
    }

    init() {
        selectedServerId = UserDefaults.standard.string(forKey: "selectedServerId")
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let hasIPv6 = path.supportsIPv6
            Task { @MainActor in
                // With our VPN up the path is the tunnel (which always has IPv6),
                // so only record what the physical network offers.
                guard let self, !self.vpn.isActive else { return }
                self.deviceHasIPv6 = hasIPv6
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "path-monitor"))
    }

    var selectedServer: ServerItem? {
        servers.first { $0.id == selectedServerId } ?? servers.first { !$0.locked }
    }

    var isPremium: Bool { account?.premium == true }
    var adsEnabled: Bool { config?.ads.enabled == true && !isPremium }

    // MARK: - Bootstrap

    func bootstrap() async {
        phase = .loading
        do {
            let config = try await api.config()
            self.config = config
            async let status = api.status()
            async let servers = api.servers()
            account = try await status
            self.servers = try await servers
            setUpBilling(config)
            await vpn.load()
            phase = .ready
            await ads.configure(config.ads)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func refresh() async {
        do {
            async let status = api.status()
            async let servers = api.servers()
            account = try await status
            self.servers = try await servers
        } catch {
            // Keep showing the last known state; pull-to-refresh can retry
        }
    }

    private func setUpBilling(_ config: ClientConfig) {
        switch config.billingProvider {
        case "revenuecat":
            if let rc = config.revenuecat, !rc.apiKey.isEmpty {
                billing = RevenueCatBilling(config: rc, api: api)
            }
        case "storekit":
            if let sk = config.storekit {
                billing = StoreKitBilling(config: sk, api: api)
            }
        default:
            billing = nil
        }
    }

    // MARK: - Connect

    func toggleConnection() async {
        if vpn.isActive {
            vpn.stop()
            return
        }
        await connect()
    }

    func select(_ server: ServerItem) async {
        if server.locked {
            showPaywall = true
            return
        }
        let wasActive = vpn.isActive
        selectedServerId = server.id
        if wasActive {
            vpn.stop()
            _ = await vpn.waitFor([.disconnected, .invalid], timeout: 10)
            await connect()
        }
    }

    func connect() async {
        guard !busy, let server = selectedServer else { return }
        if server.locked {
            showPaywall = true
            return
        }
        busy = true
        defer { busy = false }

        do {
            if account?.needsAd == true {
                guard try await watchAdForTime() else { return }
            }
            var result = try await fetchProfile(server: server, rotateIpv6: false)
            try await vpn.restart()
            guard await vpn.waitFor([.connected], timeout: 20) else {
                throw ConnectError.tunnelDidNotStart
            }

            // A personal IPv6 that does not work is most likely blocked:
            // ask the dashboard for a new one and try again once.
            if !(await tunnelWorks()), result.ipv6Address != nil {
                result = try await fetchProfile(server: server, rotateIpv6: true)
                if result.ipv6Rotated {
                    try await vpn.restart()
                    _ = await vpn.waitFor([.connected], timeout: 20)
                }
            }

            if !isPremium {
                connectCount += 1
                await ads.maybeShowInterstitial(connectCount: connectCount)
            }
        } catch let error as APIError where error.code == "ad_required" {
            account = try? await api.status()
            alert = error.localizedDescription
        } catch let error as APIError where error.code == "premium_required" {
            showPaywall = true
        } catch {
            alert = error.localizedDescription
        }
    }

    private func fetchProfile(server: ServerItem, rotateIpv6: Bool) async throws -> ConnectResult {
        let result = try await api.connect(
            serverId: server.id,
            ipv6: deviceHasIPv6,
            rotateIpv6: rotateIpv6
        )
        try TunnelProfile(
            xrayConfig: result.xrayConfig,
            expiresAt: result.expiresAt,
            serverName: server.name,
            serverAddress: result.addresses.first ?? server.name
        ).save()
        return result
    }

    /// Probes a well-known endpoint through the tunnel.
    private func tunnelWorks() async -> Bool {
        var request = URLRequest(url: URL(string: "https://www.gstatic.com/generate_204")!)
        request.timeoutInterval = 8
        for _ in 0 ..< 2 {
            if let (_, response) = try? await URLSession.shared.data(for: request),
               (response as? HTTPURLResponse)?.statusCode == 204
            {
                return true
            }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
        }
        return false
    }

    // MARK: - Ads

    /// Shows a rewarded ad and waits for the dashboard to credit the time
    /// (AdMob calls the dashboard's SSV endpoint shortly after the ad ends).
    @discardableResult
    func watchAdForTime() async throws -> Bool {
        if !ads.rewardedReady { await ads.loadRewarded() }
        guard ads.rewardedReady else { throw ConnectError.adUnavailable }
        let before = account?.freeUntil ?? .distantPast
        guard await ads.showRewarded() else { return false }

        for _ in 0 ..< 15 {
            if let status = try? await api.status() {
                account = status
                if (status.freeUntil ?? .distantPast) > max(before, Date()) { return true }
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        throw ConnectError.rewardNotCredited
    }

    // MARK: - Purchases

    func purchase(_ product: PaywallProduct) async {
        guard let billing else { return }
        do {
            if let status = try await billing.purchase(productId: product.id) {
                account = status
                if status.premium {
                    showPaywall = false
                    servers = (try? await api.servers()) ?? servers
                }
            }
        } catch {
            alert = error.localizedDescription
        }
    }

    func restorePurchases() async {
        guard let billing else { return }
        do {
            account = try await billing.restore()
            servers = (try? await api.servers()) ?? servers
            if account?.premium == true { showPaywall = false }
        } catch {
            alert = error.localizedDescription
        }
    }
}

enum ConnectError: LocalizedError {
    case tunnelDidNotStart
    case adUnavailable
    case rewardNotCredited

    var errorDescription: String? {
        switch self {
        case .tunnelDidNotStart: return "Не удалось запустить VPN. Попробуйте ещё раз."
        case .adUnavailable: return "Реклама сейчас недоступна. Попробуйте через минуту или оформите подписку."
        case .rewardNotCredited: return "Награда ещё не начислена. Попробуйте подключиться через несколько секунд."
        }
    }
}
