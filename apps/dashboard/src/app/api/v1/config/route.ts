import { NextResponse } from "next/server"
import { getSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** Public client configuration. Contains no secrets. */
export async function GET() {
	const s = await getSettings()
	return NextResponse.json({
		billingProvider: s.billingProvider,
		revenuecat:
			s.billingProvider === "revenuecat"
				? {
						apiKey: s.revenuecat.iosApiKey,
						entitlementId: s.revenuecat.entitlementId,
						offeringId: s.revenuecat.offeringId,
					}
				: null,
		storekit:
			s.billingProvider === "storekit"
				? { productIds: s.storekit.productIds }
				: null,
		ads: {
			enabled: s.ads.enabled,
			rewardedUnitId: s.ads.rewardedUnitId,
			interstitialUnitId: s.ads.interstitialUnitId,
			bannerUnitId: s.ads.bannerUnitId,
			rewardMinutes: s.ads.rewardMinutes,
			interstitialEveryConnects: s.ads.interstitialEveryConnects,
		},
	})
}
