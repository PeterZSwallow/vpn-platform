import Foundation
import Security

/// Small generic-password Keychain wrapper. Values survive app reinstalls,
/// so a device keeps its identity (and its ad/subscription history).
enum Keychain {
    private static let service = (Bundle.main.bundleIdentifier ?? "vpn") + ".identity"

    static func string(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String, for account: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

enum DeviceIdentity {
    /// Lowercase UUID. Also used as RevenueCat app_user_id, StoreKit
    /// appAccountToken and AdMob SSV user id, so the dashboard can match them.
    static var installId: String {
        if let existing = Keychain.string(for: "installId") { return existing }
        let id = UUID().uuidString.lowercased()
        Keychain.set(id, for: "installId")
        return id
    }
}
