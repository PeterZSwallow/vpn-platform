import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, schema } from "@/db"
import { verifyDeviceToken } from "./auth"

export function apiError(status: number, error: string, extra?: object) {
	return NextResponse.json({ error, ...extra }, { status })
}

/** Resolves the device from "Authorization: Bearer <device token>". */
export async function authDevice(req: Request) {
	const header = req.headers.get("authorization") ?? ""
	const token = header.startsWith("Bearer ") ? header.slice(7) : ""
	const installId = token ? await verifyDeviceToken(token) : null
	if (!installId) return null
	const [device] = await db
		.update(schema.devices)
		.set({ lastSeenAt: new Date() })
		.where(eq(schema.devices.installId, installId))
		.returning()
	return device ?? null
}

export function statusJson(s: {
	premium: boolean
	premiumUntil: Date | null
	freeUntil: Date | null
	needsAd: boolean
}) {
	return {
		premium: s.premium,
		premiumUntil: s.premiumUntil?.toISOString() ?? null,
		freeUntil: s.freeUntil?.toISOString() ?? null,
		needsAd: s.needsAd,
	}
}
