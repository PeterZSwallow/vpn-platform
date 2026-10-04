import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db, schema } from "@/db"
import { decideAccess, deviceLabel } from "@/lib/access"
import { apiError, authDevice } from "@/lib/api"
import { provisionClient } from "@/lib/panels"
import { getSettings } from "@/lib/settings"
import { singBoxConfig, vlessUri } from "@/lib/vless"

const body = z.object({ serverId: z.uuid() })

export async function POST(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const parsed = body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return apiError(400, "invalid_body")

	const server = await db.query.servers.findFirst({
		where: eq(schema.servers.id, parsed.data.serverId),
	})
	if (!server) return apiError(404, "server_not_found")

	const access = decideAccess(device, server, await getSettings())
	if (!access.ok) return apiError(403, access.reason)

	let clientUuid: string
	let isNew = false
	if (server.panelType === "static") {
		if (!server.staticUuid) return apiError(503, "server_misconfigured")
		clientUuid = server.staticUuid
	} else {
		const [inserted] = await db
			.insert(schema.deviceClients)
			.values({
				deviceId: device.id,
				serverId: server.id,
				clientUuid: randomUUID(),
			})
			.onConflictDoNothing()
			.returning()
		if (inserted) {
			clientUuid = inserted.clientUuid
			isNew = true
		} else {
			const existing = await db.query.deviceClients.findFirst({
				where: and(
					eq(schema.deviceClients.deviceId, device.id),
					eq(schema.deviceClients.serverId, server.id),
				),
			})
			if (!existing) return apiError(500, "client_lookup_failed")
			clientUuid = existing.clientUuid
		}
	}

	try {
		await provisionClient(server, {
			clientUuid,
			label: deviceLabel(device),
			expiresAt: access.expiresAt,
			isNew,
		})
	} catch (e) {
		console.error("provision failed", server.id, e)
		// Let the next connect retry creation from scratch
		if (isNew) {
			await db
				.delete(schema.deviceClients)
				.where(
					and(
						eq(schema.deviceClients.deviceId, device.id),
						eq(schema.deviceClients.serverId, server.id),
					),
				)
		}
		return apiError(502, "provision_failed")
	}

	return NextResponse.json({
		expiresAt: access.expiresAt.toISOString(),
		vlessUri: vlessUri(server, clientUuid),
		singBox: singBoxConfig(server, clientUuid),
	})
}
