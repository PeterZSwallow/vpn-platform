import { eq } from "drizzle-orm"
import { db, schema } from "@/db"
import { decideAccess, deviceLabel } from "./access"
import { provisionClient } from "./panels"
import { getSettings } from "./settings"

/**
 * Pushes the device's current access window to every node it has a client on.
 * Needed when access shrinks (refund, expiry, ban): otherwise the node keeps
 * honouring the old expiry until the device's next connect.
 */
export async function syncDeviceClients(deviceId: string) {
	const device = await db.query.devices.findFirst({
		where: eq(schema.devices.id, deviceId),
	})
	if (!device) return
	const settings = await getSettings()
	const rows = await db
		.select({ client: schema.deviceClients, server: schema.servers })
		.from(schema.deviceClients)
		.innerJoin(
			schema.servers,
			eq(schema.servers.id, schema.deviceClients.serverId),
		)
		.where(eq(schema.deviceClients.deviceId, deviceId))

	await Promise.all(
		rows.map(async ({ client, server }) => {
			const access = decideAccess(device, server, settings)
			const expiresAt = access.ok ? access.expiresAt : new Date()
			try {
				await provisionClient(server, {
					clientUuid: client.clientUuid,
					label: deviceLabel(device),
					expiresAt,
					isNew: false,
				})
			} catch (e) {
				console.error("sync client failed", server.id, deviceId, e)
			}
		}),
	)
}
