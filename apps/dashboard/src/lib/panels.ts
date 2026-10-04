import type { Server } from "@/db/schema"

/**
 * Creates or updates a VLESS client on a node's control panel.
 * expiresAt is enforced by the node itself, so a client that stops paying
 * (or whose ad time runs out) is cut off even if it kept its config.
 */
export type ProvisionInput = {
	clientUuid: string
	// Stable, panel-safe label for the device (a-z0-9_, <= 32 chars)
	label: string
	expiresAt: Date
	isNew: boolean
}

const TIMEOUT_MS = 10_000

function base(server: Server) {
	if (!server.panelUrl) throw new Error("panel_url is not set")
	return server.panelUrl.replace(/\/+$/, "")
}

async function fetchJson(url: string, init: RequestInit) {
	const res = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(TIMEOUT_MS),
		cache: "no-store",
	})
	const text = await res.text()
	let body: unknown = null
	try {
		body = text ? JSON.parse(text) : null
	} catch {
		body = text
	}
	return { res, body }
}

// ---------------- 3x-ui ----------------

async function xuiLogin(server: Server) {
	const { res, body } = await fetchJson(`${base(server)}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			username: server.panelUsername ?? "",
			password: server.panelPassword ?? "",
		}),
	})
	const ok = (body as { success?: boolean } | null)?.success
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ")
	if (!res.ok || !ok || !cookie) throw new Error("3x-ui login failed")
	return cookie
}

async function xuiProvision(server: Server, input: ProvisionInput) {
	const inboundId = Number(server.panelInbound)
	if (!Number.isInteger(inboundId))
		throw new Error("3x-ui inbound id must be a number")
	const cookie = await xuiLogin(server)
	const client = {
		id: input.clientUuid,
		flow: server.flow,
		email: input.label,
		enable: true,
		limitIp: 0,
		totalGB: 0,
		expiryTime: input.expiresAt.getTime(),
		tgId: "",
		subId: "",
		reset: 0,
	}
	const payload = JSON.stringify({
		id: inboundId,
		settings: JSON.stringify({ clients: [client] }),
	})
	const call = (path: string) =>
		fetchJson(`${base(server)}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: payload,
		})

	const tryAdd = async () => {
		const { body } = await call("/panel/api/inbounds/addClient")
		return body as { success?: boolean; msg?: string } | null
	}
	const tryUpdate = async () => {
		const { body } = await call(
			`/panel/api/inbounds/updateClient/${input.clientUuid}`,
		)
		return body as { success?: boolean; msg?: string } | null
	}

	// A client may exist on one side but not the other (node reinstalled,
	// DB restored), so fall back to the other operation once.
	let r = input.isNew ? await tryAdd() : await tryUpdate()
	if (!r?.success) r = input.isNew ? await tryUpdate() : await tryAdd()
	if (!r?.success) throw new Error(`3x-ui: ${r?.msg ?? "request failed"}`)
}

// ---------------- Marzban ----------------

async function marzbanToken(server: Server) {
	const { res, body } = await fetchJson(`${base(server)}/api/admin/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			username: server.panelUsername ?? "",
			password: server.panelPassword ?? "",
		}),
	})
	const token = (body as { access_token?: string } | null)?.access_token
	if (!res.ok || !token) throw new Error("Marzban login failed")
	return token
}

async function marzbanProvision(server: Server, input: ProvisionInput) {
	const token = await marzbanToken(server)
	const headers = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
	}
	const expire = Math.floor(input.expiresAt.getTime() / 1000)
	const inbounds = server.panelInbound
		? { vless: [server.panelInbound] }
		: undefined

	const update = () =>
		fetchJson(`${base(server)}/api/user/${input.label}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ expire, status: "active" }),
		})
	const create = () =>
		fetchJson(`${base(server)}/api/user`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				username: input.label,
				proxies: { vless: { id: input.clientUuid, flow: server.flow } },
				inbounds,
				expire,
				data_limit: 0,
				status: "active",
			}),
		})

	let r = input.isNew ? await create() : await update()
	// 409 = already exists, 404 = missing on the node
	if (input.isNew && r.res.status === 409) r = await update()
	if (!input.isNew && r.res.status === 404) r = await create()
	if (!r.res.ok) throw new Error(`Marzban: HTTP ${r.res.status}`)
}

export async function provisionClient(server: Server, input: ProvisionInput) {
	switch (server.panelType) {
		case "3x-ui":
			return xuiProvision(server, input)
		case "marzban":
			return marzbanProvision(server, input)
		case "static":
			// Shared UUID configured by hand; nothing to do on the node
			return
	}
}

/** Checks the panel credentials work. Used by the "Test" button. */
export async function testPanel(server: Server) {
	switch (server.panelType) {
		case "3x-ui":
			await xuiLogin(server)
			return
		case "marzban":
			await marzbanToken(server)
			return
		case "static":
			if (!server.staticUuid) throw new Error("static_uuid is not set")
	}
}
