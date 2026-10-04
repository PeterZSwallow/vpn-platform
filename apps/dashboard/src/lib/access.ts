import type { Device, Server } from "@/db/schema"
import type { AppSettings } from "./settings"

// Free users without ads enabled get a rolling window, re-extended on each connect
const FREE_NO_ADS_WINDOW_MS = 24 * 60 * 60 * 1000

export type DeviceStatus = {
	premium: boolean
	premiumUntil: Date | null
	freeUntil: Date | null
	// Free users must watch a rewarded ad before connecting
	needsAd: boolean
}

export function deviceStatus(
	device: Device,
	settings: AppSettings,
	now = new Date(),
): DeviceStatus {
	const premium = !!device.premiumUntil && device.premiumUntil > now
	const freeActive = !!device.freeUntil && device.freeUntil > now
	return {
		premium,
		premiumUntil: device.premiumUntil,
		freeUntil: device.freeUntil,
		needsAd: !premium && settings.ads.enabled && !freeActive,
	}
}

export type AccessDecision =
	| { ok: true; expiresAt: Date }
	| {
			ok: false
			reason:
				| "banned"
				| "premium_required"
				| "ad_required"
				| "server_unavailable"
	  }

export function decideAccess(
	device: Device,
	server: Server,
	settings: AppSettings,
	now = new Date(),
): AccessDecision {
	if (device.banned) return { ok: false, reason: "banned" }
	if (!server.enabled) return { ok: false, reason: "server_unavailable" }

	const status = deviceStatus(device, settings, now)
	if (status.premium && status.premiumUntil)
		return { ok: true, expiresAt: status.premiumUntil }
	if (server.tier === "premium")
		return { ok: false, reason: "premium_required" }
	if (!settings.ads.enabled) {
		return {
			ok: true,
			expiresAt: new Date(now.getTime() + FREE_NO_ADS_WINDOW_MS),
		}
	}
	if (status.freeUntil && status.freeUntil > now)
		return { ok: true, expiresAt: status.freeUntil }
	return { ok: false, reason: "ad_required" }
}

/** Panel-safe label (Marzban usernames: a-z0-9_, 3..32 chars). */
export function deviceLabel(device: Device) {
	return `d_${device.id.replaceAll("-", "").slice(0, 30)}`
}
