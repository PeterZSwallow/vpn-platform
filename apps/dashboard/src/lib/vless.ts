import type { Server } from "@/db/schema"

export function vlessUri(server: Server, clientUuid: string) {
	const params = new URLSearchParams({
		encryption: "none",
		flow: server.flow,
		security: "reality",
		sni: server.realitySni,
		fp: server.fingerprint,
		pbk: server.realityPublicKey,
		sid: server.realityShortId,
		type: "tcp",
	})
	return `vless://${clientUuid}@${server.host}:${server.port}?${params}#${encodeURIComponent(server.name)}`
}

/**
 * Full sing-box (1.12+) config for the iOS Packet Tunnel (libbox).
 * Built server-side so routing/DNS can be changed without an app update.
 */
export function singBoxConfig(server: Server, clientUuid: string) {
	return {
		log: { level: "warn" },
		dns: {
			servers: [
				{ type: "https", tag: "remote", server: "1.1.1.1", detour: "proxy" },
				{ type: "local", tag: "local" },
			],
			final: "remote",
		},
		inbounds: [
			{
				type: "tun",
				tag: "tun-in",
				address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
				auto_route: true,
				strict_route: true,
				stack: "mixed",
			},
		],
		outbounds: [
			{
				type: "vless",
				tag: "proxy",
				server: server.host,
				server_port: server.port,
				uuid: clientUuid,
				flow: server.flow,
				tls: {
					enabled: true,
					server_name: server.realitySni,
					utls: { enabled: true, fingerprint: server.fingerprint },
					reality: {
						enabled: true,
						public_key: server.realityPublicKey,
						short_id: server.realityShortId,
					},
				},
			},
			{ type: "direct", tag: "direct" },
		],
		route: {
			rules: [
				{ action: "sniff" },
				{ protocol: "dns", action: "hijack-dns" },
				{ ip_is_private: true, outbound: "direct" },
			],
			final: "proxy",
			default_domain_resolver: "local",
		},
	}
}
