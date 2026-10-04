import NetworkExtension
import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var vpn: VPNManager
    @ObservedObject var ads: AdsManager
    @State private var showServers = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                Spacer()
                ConnectButton(status: vpn.status, busy: model.busy) {
                    Task { await model.toggleConnection() }
                }
                Text(statusText)
                    .font(.headline)
                    .foregroundStyle(.secondary)

                serverRow
                accessInfo
                Spacer()
            }
            .padding(.horizontal, 20)
            .navigationTitle(AppConfig.appName)
            .toolbar {
                if !model.isPremium {
                    Button("Premium") { model.showPaywall = true }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.adsEnabled, let unitId = ads.bannerUnitId {
                    BannerAdView(unitId: unitId).frame(height: 60)
                }
            }
            .refreshable { await model.refresh() }
        }
        .sheet(isPresented: $showServers) { ServerListView() }
        .sheet(isPresented: $model.showPaywall) { PaywallView() }
    }

    private var statusText: String {
        switch vpn.status {
        case .connected: return "Подключено"
        case .connecting, .reasserting: return "Подключение…"
        case .disconnecting: return "Отключение…"
        default: return model.busy ? "Подключение…" : "Не подключено"
        }
    }

    private var serverRow: some View {
        Button { showServers = true } label: {
            HStack {
                if let server = model.selectedServer {
                    Text(server.flag).font(.title2)
                    VStack(alignment: .leading) {
                        Text(server.name).font(.body.weight(.medium))
                        if let city = server.city { Text(city).font(.caption).foregroundStyle(.secondary) }
                    }
                } else {
                    Text("Нет доступных серверов")
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var accessInfo: some View {
        if let account = model.account {
            if account.premium, let until = account.premiumUntil {
                Label("Premium до \(until.formatted(date: .abbreviated, time: .omitted))", systemImage: "crown.fill")
                    .foregroundStyle(.yellow)
            } else if model.config?.ads.enabled == true {
                VStack(spacing: 10) {
                    if account.hasFreeTime, let until = account.freeUntil {
                        Text("Бесплатное время до \(until.formatted(date: .omitted, time: .shortened))")
                            .font(.subheadline)
                    }
                    Button {
                        Task {
                            do { try await model.watchAdForTime() } catch { model.alert = error.localizedDescription }
                        }
                    } label: {
                        Label("Смотреть рекламу +\(model.config?.ads.rewardMinutes ?? 60) мин", systemImage: "play.rectangle.fill")
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.busy)
                }
            }
        }
    }
}

private struct ConnectButton: View {
    let status: NEVPNStatus
    let busy: Bool
    let action: () -> Void

    private var connected: Bool { status == .connected }

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(connected ? Color.green.gradient : Color.gray.opacity(0.25).gradient)
                    .frame(width: 180, height: 180)
                    .shadow(color: connected ? .green.opacity(0.5) : .clear, radius: 24)
                if busy || status == .connecting || status == .reasserting {
                    ProgressView().controlSize(.large).tint(.white)
                } else {
                    Image(systemName: "power")
                        .font(.system(size: 64, weight: .semibold))
                        .foregroundStyle(connected ? Color.white : Color.primary)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(connected ? "Отключить VPN" : "Подключить VPN")
    }
}
