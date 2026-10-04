import SwiftUI

struct PaywallView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var products: [PaywallProduct] = []
    @State private var loading = true
    @State private var error: String?
    @State private var purchasing: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "crown.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.yellow)
                        .padding(.top, 24)
                    Text("Premium").font(.largeTitle.bold())

                    VStack(alignment: .leading, spacing: 10) {
                        feature("Без рекламы")
                        feature("Все серверы и страны")
                        feature("Без ограничения по времени")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                    if loading {
                        ProgressView()
                    } else if let error {
                        Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    } else {
                        ForEach(products) { product in
                            Button {
                                Task {
                                    purchasing = product.id
                                    await model.purchase(product)
                                    purchasing = nil
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(product.title).font(.headline)
                                        if let period = product.period {
                                            Text(period).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if purchasing == product.id {
                                        ProgressView()
                                    } else {
                                        Text(product.price).font(.headline)
                                    }
                                }
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                            }
                            .buttonStyle(.plain)
                            .disabled(purchasing != nil)
                        }
                    }

                    Button("Восстановить покупки") {
                        Task { await model.restorePurchases() }
                    }
                    .font(.footnote)

                    Text("Подписка продлевается автоматически, если не отменить её минимум за 24 часа до конца периода. Управлять подпиской можно в настройках Apple ID.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 20)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func feature(_ text: String) -> some View {
        Label(text, systemImage: "checkmark.circle.fill").foregroundStyle(.primary)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        guard let billing = model.billing else {
            error = BillingError.notConfigured.localizedDescription
            return
        }
        do {
            products = try await billing.products()
            if products.isEmpty { error = "Нет доступных тарифов." }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
