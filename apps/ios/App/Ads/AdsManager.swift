import AppTrackingTransparency
import GoogleMobileAds
import SwiftUI

/// Rewarded ads unlock free VPN time; the reward itself is granted by the
/// dashboard after AdMob's server-side verification callback, never by the app.
@MainActor
final class AdsManager: NSObject, ObservableObject {
    @Published private(set) var rewardedReady = false

    private var config: ClientConfig.Ads?
    private var rewarded: RewardedAd?
    private var interstitial: InterstitialAd?
    private var dismissal: CheckedContinuation<Void, Never>?
    private var started = false

    // Google's test units, used in debug builds when the dashboard has none
    private static let testRewarded = "ca-app-pub-3940256099942544/1712485313"
    private static let testInterstitial = "ca-app-pub-3940256099942544/4411468910"
    private static let testBanner = "ca-app-pub-3940256099942544/2435281174"

    var bannerUnitId: String? { unit(config?.bannerUnitId, test: Self.testBanner) }

    func configure(_ config: ClientConfig.Ads) async {
        self.config = config
        guard config.enabled else { return }
        if !started {
            // Ask before the SDK starts so it can use the IDFA if allowed
            _ = await ATTrackingManager.requestTrackingAuthorization()
            await MobileAds.shared.start()
            started = true
        }
        await loadRewarded()
        await loadInterstitial()
    }

    // MARK: - Rewarded

    func loadRewarded() async {
        guard let unitId = unit(config?.rewardedUnitId, test: Self.testRewarded) else { return }
        do {
            let ad = try await RewardedAd.load(with: unitId, request: Request())
            // AdMob passes this to the dashboard's SSV callback as user_id
            let options = ServerSideVerificationOptions()
            options.userIdentifier = DeviceIdentity.installId
            ad.serverSideVerificationOptions = options
            ad.fullScreenContentDelegate = self
            rewarded = ad
            rewardedReady = true
        } catch {
            rewardedReady = false
        }
    }

    /// Shows the ad and waits until it is closed. Returns true if the user
    /// watched it to the end (the server grants the time separately).
    func showRewarded() async -> Bool {
        guard let ad = rewarded else { return false }
        rewarded = nil
        rewardedReady = false
        var earned = false
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            dismissal = continuation
            ad.present(from: nil) { earned = true }
        }
        Task { await loadRewarded() }
        return earned
    }

    // MARK: - Interstitial

    func loadInterstitial() async {
        guard let unitId = unit(config?.interstitialUnitId, test: Self.testInterstitial) else { return }
        do {
            let ad = try await InterstitialAd.load(with: unitId, request: Request())
            ad.fullScreenContentDelegate = self
            interstitial = ad
        } catch {
            interstitial = nil
        }
    }

    /// Shown to free users every N successful connects (set in the dashboard).
    func maybeShowInterstitial(connectCount: Int) async {
        guard let every = config?.interstitialEveryConnects, every > 0,
              connectCount % every == 0, let ad = interstitial
        else { return }
        interstitial = nil
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            dismissal = continuation
            ad.present(from: nil)
        }
        Task { await loadInterstitial() }
    }

    private func unit(_ configured: String?, test: String) -> String? {
        guard config?.enabled == true else { return nil }
        if let configured, !configured.isEmpty { return configured }
        #if DEBUG
            return test
        #else
            return nil
        #endif
    }

    private func finishPresentation() {
        dismissal?.resume()
        dismissal = nil
    }
}

extension AdsManager: FullScreenContentDelegate {
    nonisolated func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        Task { @MainActor in self.finishPresentation() }
    }

    nonisolated func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        Task { @MainActor in self.finishPresentation() }
    }
}

/// Anchored adaptive banner for free users.
struct BannerAdView: UIViewRepresentable {
    let unitId: String

    func makeUIView(context: Context) -> BannerView {
        let width = UIScreen.main.bounds.width
        let banner = BannerView(adSize: largeAnchoredAdaptiveBanner(width: width))
        banner.adUnitID = unitId
        banner.load(Request())
        return banner
    }

    func updateUIView(_ uiView: BannerView, context: Context) {}
}
