import { expect, test } from "bun:test"
import { isIPv6 } from "node:net"
import {
	ipv6InPrefix,
	normalizeIpv6Prefix,
	parseIpv6Prefix,
	randomIpv6InPrefix,
} from "./ipv6"

test("normalizes prefixes and clears host bits", () => {
	expect(normalizeIpv6Prefix("2a01:4f8:c17:1234::/64")).toBe(
		"2a01:4f8:c17:1234::/64",
	)
	expect(normalizeIpv6Prefix("2a01:4f8:c17:1234:abcd::1/64")).toBe(
		"2a01:4f8:c17:1234::/64",
	)
	expect(normalizeIpv6Prefix("2001:db8:0:0:1::/48")).toBe("2001:db8::/48")
})

test("rejects bad prefixes", () => {
	expect(() => parseIpv6Prefix("10.0.0.0/8")).toThrow()
	expect(() => parseIpv6Prefix("2001:db8::/112")).toThrow()
	expect(() => parseIpv6Prefix("2001:db8::")).toThrow()
	expect(() => parseIpv6Prefix("::ffff:1.2.3.4/64")).toThrow()
})

test("random addresses are valid, inside the prefix, unique and not low", () => {
	const prefix = "2a01:4f8:c17:1234::/64"
	const seen = new Set<string>()
	for (let i = 0; i < 2000; i++) {
		const a = randomIpv6InPrefix(prefix)
		expect(isIPv6(a)).toBe(true)
		expect(ipv6InPrefix(a, prefix)).toBe(true)
		expect(a.startsWith("2a01:4f8:c17:1234:")).toBe(true)
		seen.add(a)
	}
	expect(seen.size).toBe(2000)
	expect(ipv6InPrefix("2a01:4f8:c17:1235::5", prefix)).toBe(false)
})

test("upper-half /65 used by the installer", () => {
	const prefix = "2a01:4f8:c17:1234:8000::/65"
	expect(normalizeIpv6Prefix(prefix)).toBe(prefix)
	for (let i = 0; i < 200; i++) {
		const a = randomIpv6InPrefix(prefix)
		expect(ipv6InPrefix(a, prefix)).toBe(true)
		expect(ipv6InPrefix(a, "2a01:4f8:c17:1234::/65")).toBe(false)
	}
})

test("works for /48 prefixes", () => {
	const a = randomIpv6InPrefix("2001:db8:abcd::/48")
	expect(ipv6InPrefix(a, "2001:db8:abcd::/48")).toBe(true)
})
