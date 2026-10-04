import { NextResponse } from "next/server"
import {
	type AppleNotification,
	type AppleTransaction,
	premiumFromTransaction,
	verifyAppleJws,
} from "@/lib/billing/appstore"
import { logBillingEvent, setPremiumUntil } from "@/lib/billing/premium"
import { getSettings } from "@/lib/settings"

/** App Store Server Notifications V2. Set this URL in App Store Connect. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as {
		signedPayload?: string
	} | null
	if (!body?.signedPayload)
		return NextResponse.json({ error: "invalid_body" }, { status: 400 })

	let notification: AppleNotification
	try {
		notification = await verifyAppleJws<AppleNotification>(body.signedPayload)
	} catch (e) {
		console.warn("appstore notification rejected", e)
		return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
	}

	const signedTx = notification.data?.signedTransactionInfo
	if (!signedTx) {
		await logBillingEvent(
			"storekit",
			notification.notificationType,
			null,
			notification,
		)
		return NextResponse.json({ ok: true })
	}

	const settings = await getSettings()
	try {
		const tx = await verifyAppleJws<AppleTransaction>(signedTx)
		const { installId, until } = premiumFromTransaction(tx, settings)
		await setPremiumUntil(installId, until, "storekit")
		await logBillingEvent(
			"storekit",
			notification.notificationType,
			installId,
			{
				notification,
				transaction: tx,
			},
		)
	} catch (e) {
		// Acknowledge so Apple stops retrying an event we can never apply
		console.warn("appstore transaction ignored", e)
		await logBillingEvent(
			"storekit",
			`ignored:${notification.notificationType}`,
			null,
			{
				notification,
				error: String(e),
			},
		)
	}
	return NextResponse.json({ ok: true })
}
