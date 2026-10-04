import { Agent, fetch as undiciFetch } from "undici"
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

// One dispatcher per pinned certificate. Panels installed by infra/node use a
// self-signed certificate, which is trusted only for that exact server.
const pinnedAgents = new Map<string, Agent>()

function dispatcherFor(server: Server) {
	const cert = server.panelTlsCert?.trim()
	if (!cert) return undefined
	let agent = pinnedAgents.get(cert)
	if (!agent) {
		agent = new Agent({
			connect: {
				ca: cert,
				// The pinned certificate is the trust anchor; the URL may use a
				// different hostname than the one in the certificate.
				checkServerIdentity: () => undefined,
			},
		})
		pinnedAgents.set(cert, agent)
	}
	return agent
}

type JsonResult = { res: Response; body: unknown }

async function fetchJson(
	server: Server,
	path: string,
	init: {
		method?: string
		headers?: Record<string, string>
		body?: string | URLSearchParams
	},
): Promise<JsonResult> {
	const res = (await undiciFetch(`${base(server)}${path}`, {
		...init,
		dispatcher: dispatcherFor(server),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})) as unknown as Response
	const text = await res.text()
	let body: unknown = null
	try {
		body = text ? JSON.parse(text) : null
	} catch {
		body = text
	}
	return { res, body }
}

function cookiesOf(res: Response) {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ")
}

// ---------------- 3x-ui ----------------

type XuiResult = { success?: boolean; msg?: string } | null

/**
 * Returns auth headers for 3x-ui. Prefers an API token (3x-ui 3.x,
 * `x-ui setting -getApiToken`); otherwise logs in with username/password.
 * 3.x requires a CSRF token from the panel page for cookie sessions; older
 * versions ignore the header.
 */
async function xuiAuth(server: Server): Promise<Record<string, string>> {
	if (server.panelApiToken)
		return { Authorization: `Bearer ${server.panelApiToken}` }

	const page = await fetchJson(server, "/", {})
	const csrf =
		String(page.body).match(/name="csrf-token" content="([^"]+)"/)?.[1] ?? ""
	const pageCookie = cookiesOf(page.res)

	const login = await fetchJson(server, "/login", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			...(pageCookie ? { Cookie: pageCookie } : {}),
			...(csrf ? { "X-CSRF-Token": csrf } : {}),
		},
		body: new URLSearchParams({
			username: server.panelUsername ?? "",
			password: server.panelPassword ?? "",
		}),
	})
	const cookie = cookiesOf(login.res) || pageCookie
	if (!login.res.ok || !(login.body as XuiResult)?.success || !cookie) {
		throw new Error("3x-ui login failed")
	}
	return { Cookie: cookie, ...(csrf ? { "X-CSRF-Token": csrf } : {}) }
}

async function xuiProvision(server: Server, input: ProvisionInput) {
	const inboundId = Number(server.panelInbound)
	if (!Number.isInteger(inboundId))
		throw new Error("3x-ui inbound id must be a number")
	const auth = await xuiAuth(server)
	const post = (path: string, payload: unknown) =>
		fetchJson(server, path, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...auth },
			body: JSON.stringify(payload),
		})

	const client = {
		id: input.clientUuid,
		flow: server.flow,
		email: input.label,
		enable: true,
		limitIp: 0,
		totalGB: 0,
		expiryTime: input.expiresAt.getTime(),
	}

	// 3x-ui 3.x: clients are first-class objects addressed by email
	const v3Add = () =>
		post("/panel/api/clients/add", { client, inboundIds: [inboundId] })
	const v3Update = () =>
		post(`/panel/api/clients/update/${encodeURIComponent(input.label)}`, client)
	// 3x-ui 2.x: clients live inside the inbound settings
	const legacy = {
		id: inboundId,
		settings: JSON.stringify({
			clients: [{ ...client, tgId: "", subId: "", reset: 0 }],
		}),
	}
	const v2Add = () => post("/panel/api/inbounds/addClient", legacy)
	const v2Update = () =>
		post(`/panel/api/inbounds/updateClient/${input.clientUuid}`, legacy)

	const run = async (
		add: () => Promise<JsonResult>,
		update: () => Promise<JsonResult>,
	) => {
		// A client may exist on one side but not the other (node reinstalled,
		// DB restored), so fall back to the other operation once.
		let r = input.isNew ? await add() : await update()
		if (r.res.status === 404) return r
		if (!(r.body as XuiResult)?.success)
			r = input.isNew ? await update() : await add()
		return r
	}

	let r = await run(v3Add, v3Update)
	if (r.res.status === 404) r = await run(v2Add, v2Update)
	const body = r.body as XuiResult
	if (!r.res.ok || !body?.success) {
		throw new Error(`3x-ui: ${body?.msg ?? `HTTP ${r.res.status}`}`)
	}
}

async function xuiTest(server: Server) {
	const auth = await xuiAuth(server)
	const r = await fetchJson(server, "/panel/api/inbounds/list", {
		headers: auth,
	})
	if (!(r.body as XuiResult)?.success)
		throw new Error(`3x-ui: HTTP ${r.res.status}`)
}

// ---------------- Marzban ----------------

async function marzbanToken(server: Server) {
	const { res, body } = await fetchJson(server, "/api/admin/token", {
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
		fetchJson(server, `/api/user/${input.label}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ expire, status: "active" }),
		})
	const create = () =>
		fetchJson(server, "/api/user", {
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
			await xuiTest(server)
			return
		case "marzban":
			await marzbanToken(server)
			return
		case "static":
			if (!server.staticUuid) throw new Error("static_uuid is not set")
	}
}
