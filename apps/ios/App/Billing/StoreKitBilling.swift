import Foundation
import StoreKit

/// Direct StoreKit 2. Purchases carry appAccountToken = installId, and every
/// signed transaction is verified by the dashboard (/subscription/storekit).
final class StoreKitBilling: BillingService {
    private let api: APIClient
    private let productIds: [String]
    private var storeProducts: [String: Product] = [:]
    private var updatesTask: Task<Void, Never>?

    init(config: ClientConfig.StoreKit, api: APIClient) {
        self.api = api
        productIds = config.productIds
        // Renewals, refunds and purchases made outside the app
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
    }

    deinit { updatesTask?.cancel() }

    func products() async throws -> [PaywallProduct] {
        let products = try await Product.products(for: productIds)
        storeProducts = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
        return products
            .sorted { $0.price < $1.price }
            .map { product in
                PaywallProduct(
                    id: product.id,
                    title: product.displayName,
                    price: product.displayPrice,
                    period: product.subscription.map { Self.describe($0.subscriptionPeriod) }
                )
            }
    }

    func purchase(productId: String) async throws -> AccountStatus? {
        guard let product = storeProducts[productId] else { throw BillingError.productNotFound }
        var options: Set<Product.PurchaseOption> = []
        if let token = UUID(uuidString: DeviceIdentity.installId) {
            options.insert(.appAccountToken(token))
        }
        switch try await product.purchase(options: options) {
        case let .success(verification):
            let status = try await api.submitStoreKitTransaction(verification.jwsRepresentation)
            if case let .verified(transaction) = verification { await transaction.finish() }
            return status
        case .userCancelled:
            return nil
        case .pending:
            throw BillingError.pending
        @unknown default:
            return nil
        }
    }

    func restore() async throws -> AccountStatus {
        try await AppStore.sync()
        var latest: AccountStatus?
        for await entitlement in Transaction.currentEntitlements {
            latest = try? await api.submitStoreKitTransaction(entitlement.jwsRepresentation)
        }
        if let latest { return latest }
        return try await api.status()
    }

    private func handle(_ update: VerificationResult<Transaction>) async {
        _ = try? await api.submitStoreKitTransaction(update.jwsRepresentation)
        if case let .verified(transaction) = update { await transaction.finish() }
    }

    private static func describe(_ period: Product.SubscriptionPeriod) -> String {
        switch period.unit {
        case .day: return formatPeriod(value: period.value, unit: .day)
        case .week: return formatPeriod(value: period.value, unit: .weekOfMonth)
        case .month: return formatPeriod(value: period.value, unit: .month)
        case .year: return formatPeriod(value: period.value, unit: .year)
        @unknown default: return ""
        }
    }
}
