import { NextResponse } from "next/server"
import { z } from "zod"
import { db, schema } from "@/db"
import { apiError } from "@/lib/api"
import { createDeviceToken } from "@/lib/auth"

const body = z.object({
	// UUID kept in the iOS Keychain; doubles as RevenueCat app_user_id and StoreKit appAccountToken
	installId: z.uuid().transform((s) => s.toLowerCase()),
	appVersion: z.string().max(32).optional(),
	platform: z.enum(["ios"]).default("ios"),
})

export async function POST(req: Request) {
	const parsed = body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return apiError(400, "invalid_body")
	const { installId, appVersion, platform } = parsed.data

	await db
		.insert(schema.devices)
		.values({ installId, appVersion, platform })
		.onConflictDoUpdate({
			target: schema.devices.installId,
			set: { appVersion, lastSeenAt: new Date() },
		})

	return NextResponse.json({ token: await createDeviceToken(installId) })
}
