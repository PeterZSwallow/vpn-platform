import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db, schema } from "@/db"
import { safeEqual } from "@/lib/auth"
import { checkServer, tcpPing } from "@/lib/health"
import { normalizeIpv6Prefix, randomIpv6InPrefix } from "@/lib/ipv6"
import { testPanel } from "@/lib/panels"

// Errors meaning the dashboard host itself has no IPv6 connectivity
const NO_LOCAL_IPV6 = new Set(["ENETUNREACH", "EADDRNOTAVAIL", "EAFNOSUPPORT"])

const body = z.object({
	name: z.string().trim().min(1).max(64),
	countryCode: z.string().trim().length(2).toUpperCase(),
	city: z.string().trim().max(64).optional(),
	tier: z.enum(["free", "premium"]).default("free"),
	host: z.string().trim().min(1),
	port: z.number().int().min(1).max(65535),
	ipv6Prefix: z.string().optional(),
	exposeIpv4: z.boolean().default(true),
	realityPublicKey: z.string().min(1),
	realityShortId: z.string().regex(/^[0-9a-f]{0,16}$/),
	realitySni: z.string().min(1),
	fingerprint: z.string().default("chrome"),
	flow: z.string().default("xtls-rprx-vision"),
	panelUrl: z.url(),
	panelUsername: z.string().optional(),
	panelPassword: z.string().optional(),
	panelApiToken: z.string().optional(),
	panelInbound: z.string().min(1),
	panelTlsCert: z.string().optional(),
})

/**
 * Called by infra/node/install.sh after it sets up a node.
 * Auth: Authorization: Bearer <NODE_REGISTRATION_TOKEN>.
 * Re-running the installer on the same host:port updates the existing server.
 */
export async function POST(req: Request) {
	const expected = process.env.NODE_REGISTRATION_TOKEN
	const got = req.headers.get("authorization") ?? ""
	if (!expected || !safeEqual(got, `Bearer ${expected}`)) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 })
	}
	const parsed = body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) {
		return NextResponse.json(
			{
				error: "invalid_body",
				issues: parsed.error.issues.map((i) => i.path.join(".")),
			},
			{ status: 400 },
		)
	}
	let ipv6Prefix: string | null = null
	try {
		ipv6Prefix = parsed.data.ipv6Prefix
			? normalizeIpv6Prefix(parsed.data.ipv6Prefix)
			: null
	} catch (e) {
		return NextResponse.json(
			{ error: "invalid_ipv6_prefix", message: String(e) },
			{ status: 400 },
		)
	}
	if (!ipv6Prefix && !parsed.data.exposeIpv4) {
		return NextResponse.json({ error: "ipv6_prefix_required" }, { status: 400 })
	}
	const values = { ...parsed.data, ipv6Prefix, panelType: "3x-ui" as const }

	const existing = await db.query.servers.findFirst({
		where: and(
			eq(schema.servers.host, values.host),
			eq(schema.servers.port, values.port),
		),
	})
	const [server] = existing
		? await db
				.update(schema.servers)
				.set(values)
				.where(eq(schema.servers.id, existing.id))
				.returning()
		: await db.insert(schema.servers).values(values).returning()
	if (!server)
		return NextResponse.json({ error: "save_failed" }, { status: 500 })

	// Report problems to the installer so they show up in its output
	let panelError: string | null = null
	try {
		await testPanel(server)
	} catch (e) {
		panelError = e instanceof Error ? e.message : String(e)
	}
	const health = await checkServer(server)

	// Probe a random address from the prefix: proves AnyIP + routing work.
	// null = the dashboard host itself has no IPv6, so it cannot tell.
	let ipv6Reachable: boolean | null = null
	if (server.ipv6Prefix) {
		try {
			await tcpPing(randomIpv6InPrefix(server.ipv6Prefix), server.port)
			ipv6Reachable = true
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code
			ipv6Reachable = NO_LOCAL_IPV6.has(code ?? "") ? null : false
		}
	}

	return NextResponse.json({
		id: server.id,
		updated: !!existing,
		panelOk: !panelError,
		panelError,
		reachable: health.ok,
		ipv6Reachable,
	})
}
