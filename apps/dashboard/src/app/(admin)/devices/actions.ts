"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db, schema } from "@/db"
import { requireAdmin } from "@/lib/auth"
import { syncDeviceClients } from "@/lib/sync"

export async function grantPremium(id: string, formData: FormData) {
	await requireAdmin()
	const days = Number(formData.get("days"))
	if (!Number.isFinite(days) || days <= 0) return
	const device = await db.query.devices.findFirst({
		where: eq(schema.devices.id, id),
	})
	if (!device) return
	const from = Math.max(Date.now(), device.premiumUntil?.getTime() ?? 0)
	await db
		.update(schema.devices)
		.set({
			premiumUntil: new Date(from + days * 86_400_000),
			premiumSource: "manual",
		})
		.where(eq(schema.devices.id, id))
	revalidatePath("/devices")
}

export async function revokePremium(id: string) {
	await requireAdmin()
	await db
		.update(schema.devices)
		.set({ premiumUntil: null, premiumSource: null })
		.where(eq(schema.devices.id, id))
	await syncDeviceClients(id)
	revalidatePath("/devices")
}

export async function setBanned(id: string, banned: boolean) {
	await requireAdmin()
	await db
		.update(schema.devices)
		.set({ banned })
		.where(eq(schema.devices.id, id))
	if (banned) await syncDeviceClients(id)
	revalidatePath("/devices")
}
