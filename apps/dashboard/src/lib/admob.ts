import { createPublicKey, type KeyObject, verify } from "node:crypto"

/**
 * AdMob rewarded-ad server-side verification (SSV).
 * https://developers.google.com/admob/android/ssv
 */

const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json"
const KEYS_TTL_MS = 24 * 60 * 60 * 1000

let cache: { at: number; keys: Map<string, KeyObject> } | null = null

async function verifierKeys(force = false) {
	if (!force && cache && Date.now() - cache.at < KEYS_TTL_MS) return cache.keys
	const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(10_000) })
	if (!res.ok) throw new Error(`AdMob keys: HTTP ${res.status}`)
	const body = (await res.json()) as { keys: { keyId: number; pem: string }[] }
	const keys = new Map(
		body.keys.map((k) => [String(k.keyId), createPublicKey(k.pem)]),
	)
	cache = { at: Date.now(), keys }
	return keys
}

/**
 * rawQuery is the URL query string without the leading "?".
 * Signed content is everything before "&signature=" (signature and key_id are last).
 */
export async function verifyAdMobCallback(rawQuery: string) {
	const idx = rawQuery.indexOf("&signature=")
	if (idx < 0) throw new Error("Missing signature")
	const message = Buffer.from(rawQuery.slice(0, idx))
	const params = new URLSearchParams(rawQuery)
	const signature = Buffer.from(params.get("signature") ?? "", "base64url")
	const keyId = params.get("key_id") ?? ""

	let key = (await verifierKeys()).get(keyId)
	// Google rotates keys; refresh once on an unknown id
	if (!key) key = (await verifierKeys(true)).get(keyId)
	if (!key) throw new Error("Unknown key_id")
	if (!verify("sha256", message, key, signature))
		throw new Error("Bad signature")

	return {
		transactionId: params.get("transaction_id") ?? "",
		userId: params.get("user_id") ?? "",
		adUnit: params.get("ad_unit") ?? "",
	}
}
