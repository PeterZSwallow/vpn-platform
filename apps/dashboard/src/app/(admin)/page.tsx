import { count, eq, gt } from "drizzle-orm"
import { db, schema } from "@/db"
import { getSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

function Stat({
	label,
	value,
	sub,
}: {
	label: string
	value: string | number
	sub?: string
}) {
	return (
		<div className="card">
			<div className="text-xs text-zinc-500">{label}</div>
			<div className="mt-1 text-2xl font-semibold">{value}</div>
			{sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
		</div>
	)
}

export default async function OverviewPage() {
	const now = new Date()
	const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
	const [[servers], [online], [devices], [active], [premium], [ads], settings] =
		await Promise.all([
			db.select({ n: count() }).from(schema.servers),
			db
				.select({ n: count() })
				.from(schema.servers)
				.where(eq(schema.servers.status, "online")),
			db.select({ n: count() }).from(schema.devices),
			db
				.select({ n: count() })
				.from(schema.devices)
				.where(gt(schema.devices.lastSeenAt, dayAgo)),
			db
				.select({ n: count() })
				.from(schema.devices)
				.where(gt(schema.devices.premiumUntil, now)),
			db
				.select({ n: count() })
				.from(schema.adRewards)
				.where(gt(schema.adRewards.createdAt, dayAgo)),
			getSettings(),
		])

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Обзор</h1>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Stat
					label="Серверы онлайн"
					value={`${online?.n ?? 0} / ${servers?.n ?? 0}`}
				/>
				<Stat label="Установок всего" value={devices?.n ?? 0} />
				<Stat label="Активны за 24ч" value={active?.n ?? 0} />
				<Stat label="Активных подписок" value={premium?.n ?? 0} />
				<Stat label="Просмотров rewarded-рекламы за 24ч" value={ads?.n ?? 0} />
				<Stat
					label="Биллинг"
					value={
						settings.billingProvider === "revenuecat"
							? "RevenueCat"
							: "StoreKit"
					}
					sub={settings.ads.enabled ? "Реклама включена" : "Реклама выключена"}
				/>
			</div>
		</div>
	)
}
