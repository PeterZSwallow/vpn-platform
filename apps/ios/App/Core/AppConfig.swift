import Foundation

enum AppConfig {
    static var apiBaseURL: URL {
        let raw = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String ?? ""
        guard let url = URL(string: raw), url.scheme != nil else {
            fatalError("APIBaseURL is not set; check API_BASE_URL in Config/Local.xcconfig")
        }
        return url
    }

    static var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "VPN"
    }

    static var tunnelBundleIdentifier: String {
        (Bundle.main.bundleIdentifier ?? "") + ".tunnel"
    }
}
