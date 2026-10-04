import { isIPv6 } from "node:net"
import type { Server } from "@/db/schema"

const hostPart = (addr: string) => (isIPv6(addr) ? `[${addr}]` : addr)

export function vlessUri(
	server: Server,
	clientUuid: string,
	address = server.host,
) {
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
	return `vless://${clientUuid}@${hostPart(address)}:${server.port}?${params}#${encodeURIComponent(server.name)}`
}

function vlessOutbound(
	server: Server,
	clientUuid: string,
	address: string,
	tag: string,
) {
	return {
		type: "vless",
		tag,
		server: address,
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
	}
}

/**
 * Full sing-box (1.12+) config for the iOS Packet Tunnel (libbox).
 * Built server-side so routing/DNS can be changed without an app update.
 *
 * addresses are tried as alternatives (e.g. the device's personal IPv6 and the
 * node's IPv4): with more than one, a urltest group keeps whichever works.
 */
export function singBoxConfig(
	server: Server,
	clientUuid: string,
	addresses: string[] = [server.host],
) {
	if (addresses.length === 0) throw new Error("no addresses")
	const proxies =
		addresses.length === 1
			? [vlessOutbound(server, clientUuid, addresses[0] as string, "proxy")]
			: addresses.map((a, i) =>
					vlessOutbound(
						server,
						clientUuid,
						a,
						`proxy-${isIPv6(a) ? "v6" : "v4"}-${i}`,
					),
				)
	const group =
		proxies.length > 1
			? [
					{
						type: "urltest",
						tag: "proxy",
						outbounds: proxies.map((p) => p.tag),
						url: "https://www.gstatic.com/generate_204",
						interval: "3m",
						tolerance: 300,
					},
				]
			: []

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
		outbounds: [...group, ...proxies, { type: "direct", tag: "direct" }],
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
