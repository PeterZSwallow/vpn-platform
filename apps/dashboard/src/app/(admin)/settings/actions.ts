"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth"
import { type AppSettings, getSettings, saveSettings } from "@/lib/settings"

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim()
// Secret inputs are rendered empty; blank means "keep the current value"
const secret = (f: FormData, k: string, current: string) => str(f, k) || current
const int = (f: FormData, k: string, fallback: number) => {
	const n = Number.parseInt(str(f, k), 10)
	return Number.isFinite(n) ? n : fallback
}

export async function saveAppSettings(formData: FormData) {
	await requireAdmin()
	const cur = await getSettings()
	const next: AppSettings = {
		billingProvider:
			str(formData, "billingProvider") === "storekit"
				? "storekit"
				: "revenuecat",
		revenuecat: {
			iosApiKey: str(formData, "rcIosApiKey"),
			secretApiKey: secret(
				formData,
				"rcSecretApiKey",
				cur.revenuecat.secretApiKey,
			),
			webhookAuth: secret(
				formData,
				"rcWebhookAuth",
				cur.revenuecat.webhookAuth,
			),
			entitlementId: str(formData, "rcEntitlementId") || "premium",
			offeringId: str(formData, "rcOfferingId") || "default",
		},
		storekit: {
			bundleId: str(formData, "skBundleId"),
			productIds: str(formData, "skProductIds")
				.split(/[\s,]+/)
				.filter(Boolean),
			allowSandbox: formData.get("skAllowSandbox") === "on",
		},
		ads: {
			enabled: formData.get("adsEnabled") === "on",
			admobAppId: str(formData, "admobAppId"),
			rewardedUnitId: str(formData, "rewardedUnitId"),
			interstitialUnitId: str(formData, "interstitialUnitId"),
			bannerUnitId: str(formData, "bannerUnitId"),
			rewardMinutes: int(formData, "rewardMinutes", cur.ads.rewardMinutes),
			maxFreeMinutes: int(formData, "maxFreeMinutes", cur.ads.maxFreeMinutes),
			interstitialEveryConnects: int(
				formData,
				"interstitialEveryConnects",
				cur.ads.interstitialEveryConnects,
			),
		},
	}
	await saveSettings(next)
	revalidatePath("/settings")
}
