import { connect } from "node:net"
import { eq } from "drizzle-orm"
import { db, schema } from "@/db"
import type { Server } from "@/db/schema"

function tcpPing(host: string, port: number, timeoutMs = 4000) {
	return new Promise<number>((resolve, reject) => {
		const started = performance.now()
		const socket = connect({ host, port })
		const done = (err?: Error) => {
			socket.destroy()
			if (err) reject(err)
			else resolve(Math.round(performance.now() - started))
		}
		socket.setTimeout(timeoutMs, () => done(new Error("timeout")))
		socket.once("connect", () => done())
		socket.once("error", (e) => done(e))
	})
}

export async function checkServer(server: Server) {
	try {
		const latency = await tcpPing(server.host, server.port)
		await db
			.update(schema.servers)
			.set({
				status: "online",
				latencyMs: latency,
				lastCheckedAt: new Date(),
				lastError: null,
			})
			.where(eq(schema.servers.id, server.id))
		return { id: server.id, ok: true, latency }
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		await db
			.update(schema.servers)
			.set({ status: "offline", lastCheckedAt: new Date(), lastError: message })
			.where(eq(schema.servers.id, server.id))
		return { id: server.id, ok: false, error: message }
	}
}

export async function checkAllServers() {
	const all = await db.select().from(schema.servers)
	return Promise.all(all.map(checkServer))
}
