import { and, asc, eq, ne } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, schema } from "@/db"
import { deviceStatus } from "@/lib/access"
import { apiError, authDevice } from "@/lib/api"
import { getSettings } from "@/lib/settings"

export async function GET(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const status = deviceStatus(device, await getSettings())

	const rows = await db
		.select()
		.from(schema.servers)
		.where(
			and(
				eq(schema.servers.enabled, true),
				ne(schema.servers.status, "offline"),
			),
		)
		.orderBy(asc(schema.servers.sortOrder), asc(schema.servers.name))

	return NextResponse.json({
		servers: rows.map((s) => ({
			id: s.id,
			name: s.name,
			countryCode: s.countryCode,
			city: s.city,
			tier: s.tier,
			latencyMs: s.latencyMs,
			locked: s.tier === "premium" && !status.premium,
			// Address families the server offers; IPv6-only servers need IPv6 on the device
			ipv6: !!s.ipv6Prefix,
			ipv4: s.exposeIpv4,
		})),
	})
}
