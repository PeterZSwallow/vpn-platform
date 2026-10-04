"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { db, schema } from "@/db"
import { requireAdmin } from "@/lib/auth"
import { checkAllServers, checkServer } from "@/lib/health"
import { normalizeIpv6Prefix } from "@/lib/ipv6"
import { testPanel } from "@/lib/panels"

const optional = z
	.string()
	.trim()
	.transform((s) => (s === "" ? null : s))

const serverForm = z.object({
	name: z.string().trim().min(1),
	countryCode: z.string().trim().length(2).toUpperCase(),
	city: optional,
	host: z.string().trim().min(1),
	port: z.coerce.number().int().min(1).max(65535),
	ipv6Prefix: optional,
	exposeIpv4: z.preprocess((v) => v === "on", z.boolean()),
	tier: z.enum(["free", "premium"]),
	enabled: z.preprocess((v) => v === "on", z.boolean()),
	sortOrder: z.coerce.number().int().default(0),
	realityPublicKey: z.string().trim().min(1),
	realityShortId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{0,16}$/, "short id must be hex"),
	realitySni: z.string().trim().min(1),
	fingerprint: z.string().trim().min(1),
	flow: z.string().trim(),
	panelType: z.enum(["3x-ui", "marzban", "static"]),
	panelUrl: optional,
	panelUsername: optional,
	panelPassword: optional,
	panelApiToken: optional,
	panelTlsCert: optional,
	panelInbound: optional,
	staticUuid: optional,
})

function parse(formData: FormData) {
	const result = serverForm.safeParse(Object.fromEntries(formData))
	if (!result.success) {
		const msg = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ")
		throw new Error(msg)
	}
	const v = result.data
	if (v.ipv6Prefix) v.ipv6Prefix = normalizeIpv6Prefix(v.ipv6Prefix)
	if (!v.ipv6Prefix && !v.exposeIpv4) {
		throw new Error(
			"Без IPv6-префикса нельзя скрыть IPv4: клиентам не к чему подключаться",
		)
	}
	if (v.panelType === "static" && !v.staticUuid)
		throw new Error("static: укажите UUID клиента")
	if (
		v.panelType !== "static" &&
		(!v.panelUrl || !v.panelUsername || !v.panelInbound)
	) {
		throw new Error("Для панели нужны URL, логин и inbound")
	}
	return v
}

export async function createServer(formData: FormData) {
	await requireAdmin()
	const values = parse(formData)
	const [row] = await db.insert(schema.servers).values(values).returning()
	if (row) await checkServer(row)
	revalidatePath("/servers")
	redirect("/servers")
}

export async function updateServer(id: string, formData: FormData) {
	await requireAdmin()
	const values = parse(formData)
	// Keep the stored password when the field is left blank
	if (!values.panelPassword)
		delete (values as Partial<typeof values>).panelPassword
	await db.update(schema.servers).set(values).where(eq(schema.servers.id, id))
	revalidatePath("/servers")
	redirect("/servers")
}

export async function deleteServer(id: string) {
	await requireAdmin()
	await db.delete(schema.servers).where(eq(schema.servers.id, id))
	revalidatePath("/servers")
	redirect("/servers")
}

export async function toggleServer(id: string, enabled: boolean) {
	await requireAdmin()
	await db
		.update(schema.servers)
		.set({ enabled })
		.where(eq(schema.servers.id, id))
	revalidatePath("/servers")
}

export async function checkServersNow() {
	await requireAdmin()
	await checkAllServers()
	revalidatePath("/servers")
}

/** New personal IPv6 for every device on the next connect (e.g. after the prefix was blocked). */
export async function resetServerIpv6(id: string) {
	await requireAdmin()
	await db
		.update(schema.deviceClients)
		.set({ ipv6Address: null })
		.where(eq(schema.deviceClients.serverId, id))
	revalidatePath("/servers")
}

export async function testServerPanel(id: string) {
	await requireAdmin()
	const server = await db.query.servers.findFirst({
		where: eq(schema.servers.id, id),
	})
	if (!server) return
	let lastError: string | null = null
	try {
		await testPanel(server)
	} catch (e) {
		lastError = `panel: ${e instanceof Error ? e.message : String(e)}`
	}
	await db
		.update(schema.servers)
		.set({ lastError })
		.where(eq(schema.servers.id, id))
	if (!lastError) await checkServer(server)
	revalidatePath("/servers")
}
