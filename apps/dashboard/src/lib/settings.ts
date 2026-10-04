import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/db"

export const appSettingsSchema = z.object({
	// Which purchase stack the iOS app should use and which backend path grants premium
	billingProvider: z.enum(["revenuecat", "storekit"]).default("revenuecat"),
	revenuecat: z
		.object({
			// Public SDK key (appl_...) sent to the app
			iosApiKey: z.string().default(""),
			// Secret REST key (sk_...) used to re-read subscriber state; never sent to the app
			secretApiKey: z.string().default(""),
			// Value RevenueCat sends in the Authorization header of webhooks
			webhookAuth: z.string().default(""),
			entitlementId: z.string().default("premium"),
			offeringId: z.string().default("default"),
		})
		.prefault({}),
	storekit: z
		.object({
			bundleId: z.string().default(""),
			productIds: z.array(z.string()).default([]),
			// Accept Sandbox transactions (TestFlight / Xcode)
			allowSandbox: z.boolean().default(true),
		})
		.prefault({}),
	ads: z
		.object({
			enabled: z.boolean().default(true),
			admobAppId: z.string().default(""),
			rewardedUnitId: z.string().default(""),
			interstitialUnitId: z.string().default(""),
			bannerUnitId: z.string().default(""),
			// Free VPN time granted per verified rewarded ad
			rewardMinutes: z.number().int().min(1).default(60),
			// Upper bound for accumulated free time
			maxFreeMinutes: z
				.number()
				.int()
				.min(1)
				.default(24 * 60),
			// Show an interstitial every N connects for free users (0 = never)
			interstitialEveryConnects: z.number().int().min(0).default(3),
		})
		.prefault({}),
})

export type AppSettings = z.infer<typeof appSettingsSchema>

const KEY = "app"

export async function getSettings(): Promise<AppSettings> {
	const row = await db.query.settings.findFirst({
		where: eq(schema.settings.key, KEY),
	})
	return appSettingsSchema.parse(row?.value ?? {})
}

export async function saveSettings(value: AppSettings) {
	const parsed = appSettingsSchema.parse(value)
	await db
		.insert(schema.settings)
		.values({ key: KEY, value: parsed })
		.onConflictDoUpdate({
			target: schema.settings.key,
			set: { value: parsed, updatedAt: new Date() },
		})
}
