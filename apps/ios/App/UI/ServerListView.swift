import SwiftUI

struct ServerListView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(model.servers) { server in
                Button {
                    Task {
                        dismiss()
                        await model.select(server)
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text(server.flag).font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(server.name)
                            HStack(spacing: 6) {
                                if let city = server.city { Text(city) }
                                if server.ipv6 { Text("IPv6") }
                                if let ms = server.latencyMs { Text("\(ms) мс") }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if server.locked {
                            Image(systemName: "lock.fill").foregroundStyle(.yellow)
                        } else if server.id == model.selectedServer?.id {
                            Image(systemName: "checkmark").foregroundStyle(.tint)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("Серверы")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .refreshable { await model.refresh() }
        }
    }
}
