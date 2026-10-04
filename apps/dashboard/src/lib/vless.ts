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
		tag,
		protocol: "vless",
		settings: {
			vnext: [
				{
					address,
					port: server.port,
					users: [{ id: clientUuid, encryption: "none", flow: server.flow }],
				},
			],
		},
		streamSettings: {
			network: "tcp",
			security: "reality",
			realitySettings: {
				serverName: server.realitySni,
				fingerprint: server.fingerprint,
				publicKey: server.realityPublicKey,
				shortId: server.realityShortId,
			},
		},
	}
}

// Traffic that must not enter the tunnel. Listed explicitly because the app
// ships without geoip.dat.
const LOCAL_NETWORKS = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"224.0.0.0/4",
	"255.255.255.255/32",
	"::1/128",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
]

/**
 * Xray-core client config for the iOS Packet Tunnel (libXray). The app adds
 * env["xray.tun.fd"] with the utun file descriptor before starting it.
 * Built server-side so routing can be changed without an app update.
 *
 * addresses are alternatives for the same node (the device's personal IPv6
 * and the node's IPv4): with more than one, a leastPing balancer probes them
 * and keeps whichever works.
 */
export function xrayClientConfig(
	server: Server,
	clientUuid: string,
	addresses: string[] = [server.host],
) {
	if (addresses.length === 0) throw new Error("no addresses")
	const multi = addresses.length > 1
	const proxies = addresses.map((a, i) =>
		vlessOutbound(
			server,
			clientUuid,
			a,
			multi ? `proxy-${isIPv6(a) ? "v6" : "v4"}-${i}` : "proxy",
		),
	)

	return {
		log: { loglevel: "warning" },
		inbounds: [
			{
				tag: "tun",
				port: 0,
				protocol: "tun",
				settings: { name: "utun", mtu: 1500 },
				sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
			},
		],
		// The first outbound is the default route when there is no balancer
		outbounds: [
			...proxies,
			{ tag: "direct", protocol: "freedom" },
			{ tag: "block", protocol: "blackhole" },
		],
		routing: {
			domainStrategy: "AsIs",
			rules: [
				{ type: "field", ip: LOCAL_NETWORKS, outboundTag: "direct" },
				...(multi
					? [{ type: "field", network: "tcp,udp", balancerTag: "auto" }]
					: []),
			],
			...(multi
				? {
						balancers: [
							{
								tag: "auto",
								selector: ["proxy-"],
								strategy: { type: "leastPing" },
								fallbackTag: proxies[proxies.length - 1]?.tag,
							},
						],
					}
				: {}),
		},
		...(multi
			? {
					observatory: {
						subjectSelector: ["proxy-"],
						probeUrl: "https://www.gstatic.com/generate_204",
						probeInterval: "1m",
						enableConcurrency: true,
					},
				}
			: {}),
	}
}
