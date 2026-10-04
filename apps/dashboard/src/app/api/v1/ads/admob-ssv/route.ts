import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, schema } from "@/db"
import { verifyAdMobCallback } from "@/lib/admob"
import { getSettings } from "@/lib/settings"

/**
 * AdMob calls this after a user finishes a rewarded ad. The app sets
 * ServerSideVerificationOptions.userIdentifier = installId.
 */
export async function GET(req: Request) {
	const rawQuery = new URL(req.url).search.slice(1)
	// AdMob sends an unsigned request when the callback URL is saved in the console
	if (!rawQuery.includes("signature=")) return NextResponse.json({ ok: true })

	let reward: Awaited<ReturnType<typeof verifyAdMobCallback>>
	try {
		reward = await verifyAdMobCallback(rawQuery)
	} catch (e) {
		console.warn("admob ssv rejected", e)
		return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
	}
	if (!reward.transactionId || !reward.userId) {
		return NextResponse.json({ error: "missing_fields" }, { status: 400 })
	}

	const { ads } = await getSettings()
	const installId = reward.userId.toLowerCase()

	await db.transaction(async (tx) => {
		const [fresh] = await tx
			.insert(schema.adRewards)
			.values({
				transactionId: reward.transactionId,
				installId,
				minutes: ads.rewardMinutes,
			})
			.onConflictDoNothing()
			.returning()
		if (!fresh) return // duplicate callback

		const device = await tx.query.devices.findFirst({
			where: eq(schema.devices.installId, installId),
		})
		if (!device) return
		const now = Date.now()
		const start = Math.max(now, device.freeUntil?.getTime() ?? 0)
		const until = Math.min(
			start + ads.rewardMinutes * 60_000,
			now + ads.maxFreeMinutes * 60_000,
		)
		await tx
			.update(schema.devices)
			.set({ freeUntil: new Date(until) })
			.where(eq(schema.devices.id, device.id))
	})

	return NextResponse.json({ ok: true })
}
