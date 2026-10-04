import type { AppSettings } from "../settings"

type RcEntitlement = { expires_date: string | null }
type RcSubscriberResponse = {
	subscriber?: { entitlements?: Record<string, RcEntitlement> }
}

// Far-future stand-in for lifetime purchases (expires_date: null)
const LIFETIME = new Date("2100-01-01T00:00:00Z")

/**
 * Reads the subscriber from RevenueCat's REST API and returns the expiry of
 * the configured entitlement, or null when it is not active.
 */
export async function fetchRevenueCatPremium(
	appUserId: string,
	settings: AppSettings,
): Promise<Date | null> {
	const { secretApiKey, entitlementId } = settings.revenuecat
	if (!secretApiKey)
		throw new Error("RevenueCat secret API key is not configured")

	const res = await fetch(
		`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
		{
			headers: { Authorization: `Bearer ${secretApiKey}` },
			signal: AbortSignal.timeout(10_000),
			cache: "no-store",
		},
	)
	if (!res.ok) throw new Error(`RevenueCat: HTTP ${res.status}`)
	const body = (await res.json()) as RcSubscriberResponse
	const ent = body.subscriber?.entitlements?.[entitlementId]
	if (!ent) return null
	if (ent.expires_date === null) return LIFETIME
	const expires = new Date(ent.expires_date)
	return expires > new Date() ? expires : null
}

export type RcWebhookEvent = {
	type: string
	app_user_id?: string
	original_app_user_id?: string
	aliases?: string[]
	transferred_from?: string[]
	transferred_to?: string[]
	entitlement_ids?: string[] | null
	expiration_at_ms?: number | null
	cancel_reason?: string
}

/** All app user ids a webhook event touches (transfers move access between users). */
export function rcAffectedUsers(event: RcWebhookEvent) {
	const ids = new Set<string>()
	for (const id of [
		event.app_user_id,
		event.original_app_user_id,
		...(event.transferred_from ?? []),
		...(event.transferred_to ?? []),
	]) {
		// Skip RevenueCat anonymous ids; the app always logs in with its install id
		if (id && !id.startsWith("$RCAnonymousID:")) ids.add(id)
	}
	return [...ids]
}

/**
 * Fallback when no secret API key is configured: derive expiry from the event.
 * Returns undefined when the event should not change premium state.
 */
export function rcExpiryFromEvent(
	event: RcWebhookEvent,
	settings: AppSettings,
): Date | null | undefined {
	const ent = settings.revenuecat.entitlementId
	if (event.entitlement_ids && !event.entitlement_ids.includes(ent))
		return undefined
	const exp = event.expiration_at_ms
		? new Date(event.expiration_at_ms)
		: LIFETIME
	switch (event.type) {
		case "INITIAL_PURCHASE":
		case "RENEWAL":
		case "PRODUCT_CHANGE":
		case "UNCANCELLATION":
		case "NON_RENEWING_PURCHASE":
		case "SUBSCRIPTION_EXTENDED":
		case "TEMPORARY_ENTITLEMENT_GRANT":
			return exp
		case "EXPIRATION":
			return null
		case "CANCELLATION":
			// Refunds revoke immediately; normal cancellations run to the period end
			return event.cancel_reason === "CUSTOMER_SUPPORT" ? null : undefined
		default:
			return undefined
	}
}
