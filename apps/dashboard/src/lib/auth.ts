import { createHash, timingSafeEqual } from "node:crypto"
import { jwtVerify, SignJWT } from "jose"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

const ADMIN_COOKIE = "admin_session"

function secret() {
	const s = process.env.AUTH_SECRET
	if (!s || s.length < 32)
		throw new Error("AUTH_SECRET must be at least 32 chars")
	return new TextEncoder().encode(s)
}

export function safeEqual(a: string, b: string) {
	// Hash first so lengths always match
	const ha = createHash("sha256").update(a).digest()
	const hb = createHash("sha256").update(b).digest()
	return timingSafeEqual(ha, hb)
}

export function checkAdminCredentials(email: string, password: string) {
	const e = process.env.ADMIN_EMAIL
	const p = process.env.ADMIN_PASSWORD
	if (!e || !p) return false
	return (
		safeEqual(email.trim().toLowerCase(), e.toLowerCase()) &&
		safeEqual(password, p)
	)
}

export async function createAdminSession() {
	const token = await new SignJWT({ role: "admin" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("7d")
		.sign(secret())
	const jar = await cookies()
	jar.set(ADMIN_COOKIE, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 7,
	})
}

export async function destroyAdminSession() {
	const jar = await cookies()
	jar.delete(ADMIN_COOKIE)
}

export async function isAdmin() {
	const token = (await cookies()).get(ADMIN_COOKIE)?.value
	if (!token) return false
	try {
		const { payload } = await jwtVerify(token, secret())
		return payload.role === "admin"
	} catch {
		return false
	}
}

/** Call at the top of every admin page and server action. */
export async function requireAdmin() {
	if (!(await isAdmin())) redirect("/login")
}

// ---- Device tokens (iOS app) ----

export async function createDeviceToken(installId: string) {
	return new SignJWT({ typ: "device" })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(installId)
		.setIssuedAt()
		.sign(secret())
}

export async function verifyDeviceToken(token: string) {
	try {
		const { payload } = await jwtVerify(token, secret())
		if (payload.typ !== "device" || !payload.sub) return null
		return payload.sub
	} catch {
		return null
	}
}
