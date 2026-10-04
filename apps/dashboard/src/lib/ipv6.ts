import { randomBytes } from "node:crypto"
import { isIPv6 } from "node:net"

/**
 * Per-device IPv6 addresses. Nodes route their whole prefix to themselves
 * (AnyIP: `ip -6 route add local <prefix> dev lo`), so every address in it
 * reaches Xray and the dashboard can hand each device its own address.
 */

function toBigInt(addr: string): bigint {
	const [head = "", tail] = addr.split("::")
	const left = head ? head.split(":") : []
	const right = tail ? tail.split(":") : []
	const missing = 8 - left.length - right.length
	const groups =
		tail === undefined ? left : [...left, ...Array(missing).fill("0"), ...right]
	return groups.reduce(
		(acc, g) => (acc << 16n) | BigInt(Number.parseInt(g || "0", 16)),
		0n,
	)
}

function fromBigInt(n: bigint): string {
	const groups: string[] = []
	for (let i = 7; i >= 0; i--)
		groups.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16))
	// Compress the longest run of zero groups (RFC 5952)
	let best = { start: -1, len: 0 }
	for (let i = 0; i < 8; ) {
		if (groups[i] !== "0") {
			i++
			continue
		}
		let j = i
		while (j < 8 && groups[j] === "0") j++
		if (j - i > best.len && j - i > 1) best = { start: i, len: j - i }
		i = j
	}
	if (best.start < 0) return groups.join(":")
	const left = groups.slice(0, best.start).join(":")
	const right = groups.slice(best.start + best.len).join(":")
	return `${left}::${right}`
}

export type Ipv6Prefix = { network: bigint; length: number }

/**
 * Parses "2001:db8:1:2::/64". Accepts /32../96; the installer uses the upper
 * half of the node's /64 (a /65) so client addresses never collide with the
 * gateway or the node's own low addresses.
 */
export function parseIpv6Prefix(prefix: string): Ipv6Prefix {
	const [addr, len] = prefix.trim().split("/")
	const length = Number(len)
	if (!addr || !isIPv6(addr) || addr.includes("."))
		throw new Error("Некорректный IPv6-префикс")
	if (!Number.isInteger(length) || length < 32 || length > 96) {
		throw new Error("Длина IPv6-префикса должна быть от /32 до /96")
	}
	const hostBits = BigInt(128 - length)
	const network = (toBigInt(addr) >> hostBits) << hostBits
	return { network, length }
}

export function normalizeIpv6Prefix(prefix: string) {
	const p = parseIpv6Prefix(prefix)
	return `${fromBigInt(p.network)}/${p.length}`
}

/**
 * Random address inside the prefix. The host part is random but never small
 * (avoids ::, ::1 and other low addresses providers use for the host itself).
 */
export function randomIpv6InPrefix(prefix: string): string {
	const { network, length } = parseIpv6Prefix(prefix)
	const hostBits = BigInt(128 - length)
	const mask = (1n << hostBits) - 1n
	let host = 0n
	while (host < 0x10000n) {
		host = BigInt(`0x${randomBytes(16).toString("hex")}`) & mask
	}
	return fromBigInt(network | host)
}

export function ipv6InPrefix(addr: string, prefix: string) {
	const { network, length } = parseIpv6Prefix(prefix)
	const hostBits = BigInt(128 - length)
	return (toBigInt(addr) >> hostBits) << hostBits === network
}
