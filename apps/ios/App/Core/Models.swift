import Foundation

struct ClientConfig: Decodable {
    struct RevenueCat: Decodable {
        let apiKey: String
        let entitlementId: String
        let offeringId: String
    }

    struct StoreKit: Decodable {
        let productIds: [String]
    }

    struct Ads: Decodable {
        let enabled: Bool
        let rewardedUnitId: String
        let interstitialUnitId: String
        let bannerUnitId: String
        let rewardMinutes: Int
        let interstitialEveryConnects: Int
    }

    let billingProvider: String
    let revenuecat: RevenueCat?
    let storekit: StoreKit?
    let ads: Ads
}

struct AccountStatus: Decodable, Equatable {
    let premium: Bool
    let premiumUntil: Date?
    let freeUntil: Date?
    let needsAd: Bool

    var hasFreeTime: Bool { (freeUntil ?? .distantPast) > Date() }
}

struct ServerItem: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let countryCode: String
    let city: String?
    let tier: String
    let latencyMs: Int?
    let locked: Bool
    let ipv6: Bool
    let ipv4: Bool

    var flag: String {
        countryCode.uppercased().unicodeScalars
            .compactMap { UnicodeScalar(127_397 + $0.value) }
            .map(String.init)
            .joined()
    }
}

struct ConnectResult {
    let expiresAt: Date
    let addresses: [String]
    let ipv6Address: String?
    let ipv6Rotated: Bool
    /// Xray JSON config as text, passed to the tunnel unchanged
    let xrayConfig: String
}
