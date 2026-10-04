import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db, schema } from "@/db"
import { decideAccess, deviceLabel } from "@/lib/access"
import { apiError, authDevice } from "@/lib/api"
import { ipv6InPrefix, randomIpv6InPrefix } from "@/lib/ipv6"
import { provisionClient } from "@/lib/panels"
import { getSettings } from "@/lib/settings"
import { vlessUri, xrayClientConfig } from "@/lib/vless"

// A device may move to a new IPv6 at most this often
const ROTATE_COOLDOWN_MS = 10 * 60 * 1000

const body = z.object({
	serverId: z.uuid(),
	// Whether the device currently has IPv6 connectivity (app-side check)
	ipv6: z.boolean().default(true),
	// The app's personal IPv6 stopped working (likely blocked): issue a new one
	rotateIpv6: z.boolean().default(false),
})

export async function POST(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const parsed = body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return apiError(400, "invalid_body")
	const input = parsed.data

	const server = await db.query.servers.findFirst({
		where: eq(schema.servers.id, input.serverId),
	})
	if (!server) return apiError(404, "server_not_found")

	const access = decideAccess(device, server, await getSettings())
	if (!access.ok) return apiError(403, access.reason)

	const useIpv6 = !!server.ipv6Prefix && input.ipv6
	if (!useIpv6 && !server.exposeIpv4) {
		return server.ipv6Prefix
			? apiError(409, "ipv6_required")
			: apiError(503, "server_misconfigured")
	}
	if (server.panelType === "static" && !server.staticUuid) {
		return apiError(503, "server_misconfigured")
	}

	const where = and(
		eq(schema.deviceClients.deviceId, device.id),
		eq(schema.deviceClients.serverId, server.id),
	)
	const [inserted] = await db
		.insert(schema.deviceClients)
		.values({
			deviceId: device.id,
			serverId: server.id,
			clientUuid: randomUUID(),
		})
		.onConflictDoNothing()
		.returning()
	const isNew = !!inserted
	let client = inserted ?? (await db.query.deviceClients.findFirst({ where }))
	if (!client) return apiError(500, "client_lookup_failed")
	const clientUuid =
		server.panelType === "static"
			? (server.staticUuid as string)
			: client.clientUuid

	// Personal IPv6: assign on first use, after a prefix change, or on request
	let rotated = false
	if (server.ipv6Prefix) {
		const missing =
			!client.ipv6Address ||
			!ipv6InPrefix(client.ipv6Address, server.ipv6Prefix)
		const cooledDown =
			!client.ipv6RotatedAt ||
			Date.now() - client.ipv6RotatedAt.getTime() > ROTATE_COOLDOWN_MS
		const rotate = input.rotateIpv6 && cooledDown && !missing
		if (missing || rotate) {
			const [updated] = await db
				.update(schema.deviceClients)
				.set({
					ipv6Address: randomIpv6InPrefix(server.ipv6Prefix),
					...(rotate
						? {
								ipv6Rotations: client.ipv6Rotations + 1,
								ipv6RotatedAt: new Date(),
							}
						: {}),
				})
				.where(where)
				.returning()
			if (updated) client = updated
			rotated = rotate
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
		if (isNew) await db.delete(schema.deviceClients).where(where)
		return apiError(502, "provision_failed")
	}

	const addresses = [
		...(useIpv6 && client.ipv6Address ? [client.ipv6Address] : []),
		...(server.exposeIpv4 ? [server.host] : []),
	]
	return NextResponse.json({
		expiresAt: access.expiresAt.toISOString(),
		addresses,
		ipv6Address: useIpv6 ? client.ipv6Address : null,
		ipv6Rotated: rotated,
		vlessUri: vlessUri(server, clientUuid, addresses[0]),
		xray: xrayClientConfig(server, clientUuid, addresses),
	})
}
