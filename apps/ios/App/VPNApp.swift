import SwiftUI

@main
struct VPNApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.bootstrap() }
                .onChange(of: scenePhase) { phase in
                    // Pick up subscription changes and ad rewards made elsewhere
                    if phase == .active, model.phase == .ready {
                        Task { await model.refresh() }
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ProgressView()
            case let .failed(message):
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button("Повторить") { Task { await model.bootstrap() } }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
            case .ready:
                HomeView(vpn: model.vpn, ads: model.ads)
            }
        }
        .alert(
            "Ошибка",
            isPresented: Binding(get: { model.alert != nil }, set: { if !$0 { model.alert = nil } }),
            actions: { Button("OK", role: .cancel) {} },
            message: { Text(model.alert ?? "") }
        )
    }
}
