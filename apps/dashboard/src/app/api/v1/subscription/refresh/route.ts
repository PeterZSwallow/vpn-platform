import { NextResponse } from "next/server"
import { deviceStatus } from "@/lib/access"
import { apiError, authDevice, statusJson } from "@/lib/api"
import { setPremiumUntil } from "@/lib/billing/premium"
import { fetchRevenueCatPremium } from "@/lib/billing/revenuecat"
import { getSettings } from "@/lib/settings"

/** Called by the app right after a RevenueCat purchase/restore, so premium applies without waiting for the webhook. */
export async function POST(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const settings = await getSettings()
	try {
		const until = await fetchRevenueCatPremium(device.installId, settings)
		await setPremiumUntil(device.installId, until, "revenuecat")
		const updated = { ...device, premiumUntil: until }
		return NextResponse.json(statusJson(deviceStatus(updated, settings)))
	} catch (e) {
		console.error("revenuecat refresh failed", e)
		return apiError(502, "revenuecat_unavailable")
	}
}
