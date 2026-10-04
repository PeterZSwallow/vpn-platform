import Foundation

struct PaywallProduct: Identifiable, Equatable {
    let id: String
    let title: String
    let price: String
    /// e.g. "1 месяц"; nil for one-time purchases
    let period: String?
}

/// Purchase flow behind the dashboard's billing switch (RevenueCat or StoreKit 2).
/// Every successful purchase or restore is confirmed by the dashboard, which is
/// the source of truth for premium access.
protocol BillingService: AnyObject {
    func products() async throws -> [PaywallProduct]
    /// Returns the new account status, or nil if the user cancelled.
    func purchase(productId: String) async throws -> AccountStatus?
    func restore() async throws -> AccountStatus
}

enum BillingError: LocalizedError {
    case productNotFound
    case pending
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .productNotFound: return "Товар не найден в App Store."
        case .pending: return "Покупка ожидает подтверждения (например, родительского)."
        case .notConfigured: return "Оплата не настроена."
        }
    }
}

func formatPeriod(value: Int, unit: Calendar.Component) -> String {
    var components = DateComponents()
    components.setValue(value, for: unit)
    var calendar = Calendar.current
    calendar.locale = Locale(identifier: "ru_RU")
    let formatter = DateComponentsFormatter()
    formatter.unitsStyle = .full
    formatter.calendar = calendar
    return formatter.string(from: components) ?? ""
}
