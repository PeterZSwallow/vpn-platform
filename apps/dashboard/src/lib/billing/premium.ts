import { eq } from "drizzle-orm"
import { db, schema } from "@/db"
import { syncDeviceClients } from "../sync"

export async function logBillingEvent(
	provider: string,
	type: string,
	installId: string | null,
	payload: unknown,
) {
	await db.insert(schema.billingEvents).values({
		provider,
		type,
		installId,
		payload: payload as object,
	})
}

/**
 * Sets the device's premium expiry from the billing provider's source of truth.
 * null means "no active entitlement". Unknown install ids are created so a
 * webhook that arrives before the app's first register call is not lost.
 */
export async function setPremiumUntil(
	installId: string,
	until: Date | null,
	source: "revenuecat" | "storekit" | "manual",
) {
	const existing = await db.query.devices.findFirst({
		where: eq(schema.devices.installId, installId),
	})
	if (!existing) {
		await db
			.insert(schema.devices)
			.values({ installId, premiumUntil: until, premiumSource: source })
			.onConflictDoNothing()
		return
	}
	await db
		.update(schema.devices)
		.set({ premiumUntil: until, premiumSource: source })
		.where(eq(schema.devices.id, existing.id))

	const before = existing.premiumUntil?.getTime() ?? 0
	const after = until?.getTime() ?? 0
	if (after < before && before > Date.now())
		await syncDeviceClients(existing.id)
}
