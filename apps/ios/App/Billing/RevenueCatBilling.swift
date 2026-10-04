import Foundation
import RevenueCat

final class RevenueCatBilling: BillingService {
    private let api: APIClient
    private let offeringId: String
    private var packages: [String: Package] = [:]

    private static var configured = false

    init(config: ClientConfig.RevenueCat, api: APIClient) {
        self.api = api
        offeringId = config.offeringId
        // RevenueCat can be configured once per launch
        if !Self.configured {
            Purchases.configure(
                with: Configuration.Builder(withAPIKey: config.apiKey)
                    .with(appUserID: DeviceIdentity.installId)
                    .build()
            )
            Self.configured = true
        }
    }

    func products() async throws -> [PaywallProduct] {
        let offerings = try await Purchases.shared.offerings()
        guard let offering = offerings.offering(identifier: offeringId) ?? offerings.current else {
            return []
        }
        packages = Dictionary(uniqueKeysWithValues: offering.availablePackages.map { ($0.identifier, $0) })
        return offering.availablePackages.map { package in
            let product = package.storeProduct
            return PaywallProduct(
                id: package.identifier,
                title: product.localizedTitle,
                price: product.localizedPriceString,
                period: product.subscriptionPeriod.map(Self.describe)
            )
        }
    }

    func purchase(productId: String) async throws -> AccountStatus? {
        guard let package = packages[productId] else { throw BillingError.productNotFound }
        let result = try await Purchases.shared.purchase(package: package)
        if result.userCancelled { return nil }
        return try await api.refreshSubscription()
    }

    func restore() async throws -> AccountStatus {
        _ = try await Purchases.shared.restorePurchases()
        return try await api.refreshSubscription()
    }

    private static func describe(_ period: SubscriptionPeriod) -> String {
        switch period.unit {
        case .day: return formatPeriod(value: period.value, unit: .day)
        case .week: return formatPeriod(value: period.value, unit: .weekOfMonth)
        case .month: return formatPeriod(value: period.value, unit: .month)
        case .year: return formatPeriod(value: period.value, unit: .year)
        @unknown default: return ""
        }
    }
}
