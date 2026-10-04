import { NextResponse } from "next/server"
import { z } from "zod"
import { deviceStatus } from "@/lib/access"
import { apiError, authDevice, statusJson } from "@/lib/api"
import {
	type AppleTransaction,
	premiumFromTransaction,
	verifyAppleJws,
} from "@/lib/billing/appstore"
import { logBillingEvent, setPremiumUntil } from "@/lib/billing/premium"
import { getSettings } from "@/lib/settings"

const body = z.object({ signedTransaction: z.string().min(10) })

/** The app posts Transaction.jwsRepresentation after a StoreKit 2 purchase or on launch. */
export async function POST(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const parsed = body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return apiError(400, "invalid_body")
	const settings = await getSettings()

	try {
		const tx = await verifyAppleJws<AppleTransaction>(
			parsed.data.signedTransaction,
		)
		const { installId, until } = premiumFromTransaction(tx, settings)
		// A device may only claim transactions bought under its own appAccountToken
		if (installId !== device.installId)
			return apiError(403, "account_token_mismatch")
		await setPremiumUntil(installId, until, "storekit")
		await logBillingEvent("storekit", "client_transaction", installId, tx)
		return NextResponse.json(
			statusJson(deviceStatus({ ...device, premiumUntil: until }, settings)),
		)
	} catch (e) {
		console.error("storekit verify failed", e)
		return apiError(400, "invalid_transaction")
	}
}
