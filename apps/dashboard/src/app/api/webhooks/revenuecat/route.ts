import { NextResponse } from "next/server"
import { safeEqual } from "@/lib/auth"
import { logBillingEvent, setPremiumUntil } from "@/lib/billing/premium"
import {
	fetchRevenueCatPremium,
	type RcWebhookEvent,
	rcAffectedUsers,
	rcExpiryFromEvent,
} from "@/lib/billing/revenuecat"
import { getSettings } from "@/lib/settings"

export async function POST(req: Request) {
	const settings = await getSettings()
	const expected = settings.revenuecat.webhookAuth
	const got = req.headers.get("authorization") ?? ""
	if (!expected || !safeEqual(got, expected)) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 })
	}

	const body = (await req.json().catch(() => null)) as {
		event?: RcWebhookEvent
	} | null
	const event = body?.event
	if (!event?.type)
		return NextResponse.json({ error: "invalid_body" }, { status: 400 })

	const users = rcAffectedUsers(event)
	await logBillingEvent("revenuecat", event.type, users[0] ?? null, body)

	for (const id of users) {
		if (settings.revenuecat.secretApiKey) {
			// Source of truth: re-read the subscriber instead of trusting event ordering
			const until = await fetchRevenueCatPremium(id, settings)
			await setPremiumUntil(id, until, "revenuecat")
		} else {
			const until = rcExpiryFromEvent(event, settings)
			if (until !== undefined) await setPremiumUntil(id, until, "revenuecat")
		}
	}
	return NextResponse.json({ ok: true })
}
