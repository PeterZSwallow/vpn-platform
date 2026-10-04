// Run with: bun test (needs the openssl CLI to build a throwaway Apple-like PKI)
import { beforeAll, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import {
	createPrivateKey,
	generateKeyPairSync,
	sign,
	X509Certificate,
} from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CompactSign } from "jose"
import { verifyAdMobCallback } from "./admob"
import { premiumFromTransaction, verifyAppleJws } from "./billing/appstore"
import type { AppSettings } from "./settings"

const dir = mkdtempSync(join(tmpdir(), "pki-"))
const pem = (f: string) => readFileSync(join(dir, f), "utf8")
const der = (f: string) => new X509Certificate(pem(f)).raw.toString("base64")

beforeAll(() => {
	const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" })
	writeFileSync(
		join(dir, "int.ext"),
		"basicConstraints=critical,CA:true\n1.2.840.113635.100.6.2.1=ASN1:NULL\n",
	)
	writeFileSync(join(dir, "leaf.ext"), "1.2.840.113635.100.6.11.1=ASN1:NULL\n")
	for (const k of ["root", "int", "leaf"])
		sh(`openssl ecparam -name prime256v1 -genkey -noout -out ${k}.key`)
	sh(
		`openssl req -x509 -new -key root.key -subj "/CN=Apple Root CA - G3" -days 30 -out root.pem`,
	)
	sh(`openssl req -new -key int.key -subj "/CN=Test WWDR" -out int.csr`)
	sh(
		`openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -days 30 -extfile int.ext -out int.pem`,
	)
	sh(`openssl req -new -key leaf.key -subj "/CN=Test Leaf" -out leaf.csr`)
	sh(
		`openssl x509 -req -in leaf.csr -CA int.pem -CAkey int.key -CAcreateserial -days 30 -extfile leaf.ext -out leaf.pem`,
	)
	// Leaf signed straight by the root: no Apple intermediate in the chain
	sh(
		`openssl x509 -req -in leaf.csr -CA root.pem -CAkey root.key -CAcreateserial -days 30 -extfile leaf.ext -out leaf-direct.pem`,
	)
	process.env.APPLE_ROOT_CA_G3_PEM = pem("root.pem")
})

function jws(payload: object, chain = ["leaf.pem", "int.pem", "root.pem"]) {
	return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
		.setProtectedHeader({ alg: "ES256", x5c: chain.map(der) })
		.sign(createPrivateKey(pem("leaf.key")))
}

const settings = {
	storekit: {
		bundleId: "com.x.vpn",
		productIds: ["month"],
		allowSandbox: true,
	},
} as AppSettings
const installId = "6f1c2d3e-1111-4222-8333-944455556666"

test("valid Apple JWS maps to premium expiry", async () => {
	const exp = Date.now() + 86_400_000
	const tx = await verifyAppleJws<Parameters<typeof premiumFromTransaction>[0]>(
		await jws({
			bundleId: "com.x.vpn",
			productId: "month",
			expiresDate: exp,
			appAccountToken: installId.toUpperCase(),
			environment: "Sandbox",
			signedDate: Date.now(),
		}),
	)
	const r = premiumFromTransaction(tx, settings)
	expect(r.installId).toBe(installId)
	expect(r.until?.getTime()).toBe(exp)
})

test("revoked transaction gives no premium", async () => {
	const tx = await verifyAppleJws<Parameters<typeof premiumFromTransaction>[0]>(
		await jws({
			bundleId: "com.x.vpn",
			productId: "month",
			expiresDate: Date.now() + 1e8,
			revocationDate: Date.now(),
			appAccountToken: installId,
			environment: "Production",
		}),
	)
	expect(premiumFromTransaction(tx, settings).until).toBeNull()
})

test("wrong bundle id is rejected", () => {
	expect(() =>
		premiumFromTransaction(
			{
				bundleId: "com.other",
				productId: "month",
				environment: "Production",
				appAccountToken: installId,
			},
			settings,
		),
	).toThrow("Bundle id")
})

test("tampered payload is rejected", async () => {
	const parts = (await jws({ bundleId: "com.x.vpn" })).split(".")
	parts[1] = Buffer.from(JSON.stringify({ bundleId: "evil" })).toString(
		"base64url",
	)
	await expect(verifyAppleJws(parts.join("."))).rejects.toThrow()
})

test("chain without the Apple intermediate is rejected", async () => {
	await expect(
		verifyAppleJws(await jws({}, ["leaf-direct.pem", "root.pem", "root.pem"])),
	).rejects.toThrow()
})

test("chain not ending in the trusted root is rejected", async () => {
	await expect(
		verifyAppleJws(await jws({}, ["leaf.pem", "int.pem", "leaf.pem"])),
	).rejects.toThrow("Apple Root")
})

test("AdMob SSV signature is verified", async () => {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	})
	const realFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		Response.json({
			keys: [
				{ keyId: 42, pem: publicKey.export({ type: "spki", format: "pem" }) },
			],
		})) as unknown as typeof fetch
	try {
		const msg =
			"ad_network=1&ad_unit=2&custom_data=&reward_amount=1&reward_item=x&timestamp=1&transaction_id=tx1&user_id=abc"
		const sig = sign("sha256", Buffer.from(msg), privateKey).toString(
			"base64url",
		)
		expect(
			await verifyAdMobCallback(`${msg}&signature=${sig}&key_id=42`),
		).toEqual({
			transactionId: "tx1",
			userId: "abc",
			adUnit: "2",
		})
		await expect(
			verifyAdMobCallback(
				`${msg.replace("abc", "zzz")}&signature=${sig}&key_id=42`,
			),
		).rejects.toThrow("Bad signature")
	} finally {
		globalThis.fetch = realFetch
	}
})
