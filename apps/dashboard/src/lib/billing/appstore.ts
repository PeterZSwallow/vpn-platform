import { X509Certificate } from "node:crypto"
import { compactVerify, decodeProtectedHeader } from "jose"
import type { AppSettings } from "../settings"

/**
 * Verifies Apple-signed JWS (StoreKit 2 transactions and App Store Server
 * Notifications V2): x5c chain must end in Apple Root CA - G3, and the leaf
 * and intermediate must carry Apple's marker extensions.
 */

const APPLE_ROOT_G3_URL =
	"https://www.apple.com/certificateauthority/AppleRootCA-G3.cer"
// DER-encoded OIDs: 1.2.840.113635.100.6.11.1 (leaf) and 1.2.840.113635.100.6.2.1 (intermediate)
const LEAF_OID = Buffer.from("060a2a864886f76364060b01", "hex")
const INTERMEDIATE_OID = Buffer.from("060a2a864886f76364060201", "hex")

let rootCache: X509Certificate | null = null

async function appleRoot() {
	if (rootCache) return rootCache
	const pinned = process.env.APPLE_ROOT_CA_G3_PEM
	if (pinned) {
		rootCache = new X509Certificate(pinned.replaceAll("\\n", "\n"))
	} else {
		const res = await fetch(APPLE_ROOT_G3_URL, {
			signal: AbortSignal.timeout(10_000),
		})
		if (!res.ok)
			throw new Error(`Cannot download Apple root CA: HTTP ${res.status}`)
		rootCache = new X509Certificate(Buffer.from(await res.arrayBuffer()))
	}
	if (!rootCache.subject.includes("Apple Root CA - G3")) {
		rootCache = null
		throw new Error("Unexpected Apple root certificate")
	}
	return rootCache
}

function within(cert: X509Certificate, at: Date) {
	return new Date(cert.validFrom) <= at && at <= new Date(cert.validTo)
}

export async function verifyAppleJws<T extends Record<string, unknown>>(
	jws: string,
): Promise<T> {
	const header = decodeProtectedHeader(jws)
	if (
		header.alg !== "ES256" ||
		!Array.isArray(header.x5c) ||
		header.x5c.length !== 3
	) {
		throw new Error("Invalid Apple JWS header")
	}
	const [leaf, intermediate, root] = header.x5c.map(
		(c) => new X509Certificate(Buffer.from(c, "base64")),
	) as [X509Certificate, X509Certificate, X509Certificate]

	const trusted = await appleRoot()
	if (!root.raw.equals(trusted.raw))
		throw new Error("JWS root is not Apple Root CA - G3")
	if (!intermediate.verify(trusted.publicKey))
		throw new Error("Bad intermediate signature")
	if (!leaf.verify(intermediate.publicKey))
		throw new Error("Bad leaf signature")
	if (!leaf.raw.includes(LEAF_OID))
		throw new Error("Leaf is missing Apple marker OID")
	if (!intermediate.raw.includes(INTERMEDIATE_OID)) {
		throw new Error("Intermediate is missing Apple marker OID")
	}

	const { payload } = await compactVerify(jws, leaf.publicKey)
	const data = JSON.parse(new TextDecoder().decode(payload)) as T

	// Like Apple's own library, check certificate validity at signing time
	const signedAt =
		typeof data.signedDate === "number" ? new Date(data.signedDate) : new Date()
	if (!within(leaf, signedAt) || !within(intermediate, signedAt)) {
		throw new Error("Certificate not valid at signing time")
	}
	return data
}

export type AppleTransaction = {
	bundleId: string
	productId: string
	expiresDate?: number
	revocationDate?: number
	appAccountToken?: string
	environment: "Production" | "Sandbox" | string
	signedDate?: number
}

export type AppleNotification = {
	notificationType: string
	subtype?: string
	data?: {
		bundleId?: string
		environment?: string
		signedTransactionInfo?: string
	}
}

/**
 * Validates a decoded transaction against settings and returns the install id
 * (appAccountToken) and the premium expiry it grants (null if revoked/expired).
 */
export function premiumFromTransaction(
	tx: AppleTransaction,
	settings: AppSettings,
) {
	const { bundleId, productIds, allowSandbox } = settings.storekit
	if (!bundleId || tx.bundleId !== bundleId)
		throw new Error("Bundle id mismatch")
	if (productIds.length && !productIds.includes(tx.productId)) {
		throw new Error("Unknown product id")
	}
	if (tx.environment === "Sandbox" && !allowSandbox)
		throw new Error("Sandbox not allowed")
	if (!tx.appAccountToken) throw new Error("Transaction has no appAccountToken")

	let until: Date | null = tx.expiresDate ? new Date(tx.expiresDate) : null
	if (tx.revocationDate) until = null
	if (until && until <= new Date()) until = null
	return { installId: tx.appAccountToken.toLowerCase(), until }
}
