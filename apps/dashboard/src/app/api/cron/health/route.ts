import { NextResponse } from "next/server"
import { safeEqual } from "@/lib/auth"
import { checkAllServers } from "@/lib/health"

export const dynamic = "force-dynamic"

/** Call every minute from cron: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/health */
export async function GET(req: Request) {
	const secret = process.env.CRON_SECRET
	const got = req.headers.get("authorization") ?? ""
	if (!secret || !safeEqual(got, `Bearer ${secret}`)) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 })
	}
	return NextResponse.json({ results: await checkAllServers() })
}
