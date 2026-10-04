import { NextResponse } from "next/server"
import { deviceStatus } from "@/lib/access"
import { apiError, authDevice, statusJson } from "@/lib/api"
import { getSettings } from "@/lib/settings"

export async function GET(req: Request) {
	const device = await authDevice(req)
	if (!device) return apiError(401, "unauthorized")
	const settings = await getSettings()
	return NextResponse.json(statusJson(deviceStatus(device, settings)))
}
